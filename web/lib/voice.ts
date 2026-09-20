// One spoken exchange: hear a clip, say a filler line right away, ask the
// memory, then read the short answer back with Deepgram. If the server has no
// Deepgram key the browser's own voice reads the text instead.
import {
  api,
  AUTH_REQUIRED_EVENT,
  type Answer,
  type Heard,
  type VoiceReply,
  type VoiceStatus,
} from './api';

export type VoiceState =
  | 'idle'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'unavailable';
export type Exchange = {
  id: string;
  heard: string;
  question: string;
  spoken: string;
  answer: Answer | null;
  at: number;
  error?: string;
};
type Listener = (state: VoiceState, exchange: Exchange | null) => void;

export function isReviewedAnswer(answer: Answer | null) {
  return (
    !!answer &&
    ['verified', 'insufficient'].includes(answer.mode) &&
    answer.verification?.receipt?.claims_reviewed === true
  );
}

function waitForReviewPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(new DOMException('Request stopped', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, 1250);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

// 50 ms of silence as a WAV blob. Playing it inside a tap unlocks audio
// output on iOS, so later answers can start without another gesture.
function silentWav(): Blob {
  const rate = 8000;
  const samples = rate / 20;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

async function fetchAudio(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch('/api' + path, init);
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    throw new Error('Sign in to hear answers.');
  }
  if (!response.ok) throw new Error(`Voice unavailable (${response.status})`);
  return response.blob();
}

export class VoiceClient {
  state: VoiceState = 'idle';
  exchange: Exchange | null = null;
  status: VoiceStatus | null = null;
  private listeners = new Set<Listener>();
  private player = new Audio();
  private activeFinish: ((ok: boolean) => void) | null = null;
  private fillers: Blob[] = [];
  private fillerFetch: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;
  private authExpired = false;
  private askRequest: AbortController | null = null;
  private authenticationRequired = () => {
    this.authExpired = true;
    this.stop();
    this.set('idle', null);
  };
  // When muted, answers still arrive as text; nothing is played.
  muted = false;
  setMuted(value: boolean) {
    this.muted = value;
    if (value) this.stop();
  }
  onSpeaking: ((speaking: boolean) => void) | null = null;

  constructor() {
    this.player.preload = 'auto';
    window.addEventListener(AUTH_REQUIRED_EVENT, this.authenticationRequired);
    void api<VoiceStatus>('/voice/status')
      .then((status) => {
        this.status = status;
        if (status.deepgram) void this.prefetchFillers();
      })
      .catch(() => {});
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.exchange);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private set(state: VoiceState, exchange: Exchange | null = this.exchange) {
    if (this.disposed) return;
    this.state = state;
    this.exchange = exchange;
    this.listeners.forEach((listener) => listener(state, exchange));
  }

  // Call inside a click/tap handler.
  unlock() {
    try {
      const url = URL.createObjectURL(silentWav());
      this.player.src = url;
      this.player.muted = true;
      void this.player
        .play()
        .catch(() => {})
        .finally(() => {
          this.player.muted = false;
          URL.revokeObjectURL(url);
        });
    } catch {
      // Unlocking is best effort; playback errors surface when speaking.
    }
  }

  private prefetchFillers() {
    if (this.fillerFetch) return this.fillerFetch;
    this.fillerFetch = (async () => {
      for (let i = 0; i < 3 && !this.disposed; i++) {
        try {
          const blob = await fetchAudio('/voice/filler');
          if (!this.fillers.some((f) => f.size === blob.size))
            this.fillers.push(blob);
        } catch {
          break;
        }
      }
    })();
    return this.fillerFetch;
  }

  private async play(blob: Blob, generation: number): Promise<boolean> {
    if (this.disposed || this.authExpired || generation !== this.generation)
      return false;
    if (this.muted) return true;
    // Starting a new clip settles whatever was playing before it.
    this.activeFinish?.(false);
    const url = URL.createObjectURL(blob);
    const player = this.player;
    const done = new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        if (this.activeFinish === finish) this.activeFinish = null;
        player.onended = player.onerror = null;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      this.activeFinish = finish;
      player.onended = () => finish(true);
      player.onerror = () => finish(false);
      player.src = url;
      player.play().catch(() => finish(false));
    });
    this.onSpeaking?.(true);
    const ok = await done;
    if (!this.activeFinish) this.onSpeaking?.(false);
    return ok;
  }

  private browserSpeak(text: string, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.muted) return resolve(true);
      if (
        typeof window === 'undefined' ||
        !window.speechSynthesis ||
        typeof SpeechSynthesisUtterance === 'undefined' ||
        this.disposed ||
        this.authExpired ||
        generation !== this.generation
      )
        return resolve(false);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.onend = () => {
        this.onSpeaking?.(false);
        resolve(true);
      };
      utterance.onerror = () => {
        this.onSpeaking?.(false);
        resolve(false);
      };
      this.onSpeaking?.(true);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  // Read text aloud: Deepgram if the server has it, otherwise the browser voice.
  async say(text: string): Promise<boolean> {
    const generation = ++this.generation;
    this.askRequest?.abort();
    if (this.disposed || this.authExpired) return false;
    const clean = text.replace(/\[[0-9a-f-]{36}\]/gi, '').trim();
    if (!clean) return false;
    this.set('speaking');
    let ok = false;
    if (this.status?.deepgram !== false) {
      try {
        const blob = await fetchAudio('/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean }),
        });
        ok = await this.play(blob, generation);
      } catch {
        ok = false;
      }
    }
    if (!ok) ok = await this.browserSpeak(clean, generation);
    if (generation === this.generation) this.set('idle');
    return ok;
  }

  // Say one of the pre-made "let me look" lines while something loads.
  async filler(): Promise<boolean> {
    if (!this.fillers.length) await this.prefetchFillers();
    if (!this.fillers.length) return false;
    const generation = ++this.generation;
    this.askRequest?.abort();
    const ok = await this.play(
      this.fillers[Math.floor(Math.random() * this.fillers.length)],
      generation,
    );
    return ok;
  }

  stop() {
    this.generation++;
    this.askRequest?.abort();
    this.activeFinish?.(false);
    try {
      this.player.pause();
      this.player.removeAttribute('src');
      window.speechSynthesis?.cancel();
    } catch {
      // Stopping is best effort.
    }
    this.onSpeaking?.(false);
    this.set('idle');
  }

  // Send a clip. With `wake` the sentence must start with "Rewind"; the phone
  // uses that while it listens all day. A tapped mic passes wake=false.
  async hear(clip: Blob, wake: boolean): Promise<Heard> {
    this.set('hearing');
    try {
      const response = await fetch(`/api/voice/hear?wake=${wake}`, {
        method: 'POST',
        headers: { 'Content-Type': clip.type || 'audio/wav' },
        body: clip,
      });
      if (response.status === 401)
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      if (!response.ok) {
        let message = `Could not hear that (${response.status})`;
        try {
          const detail = ((await response.json()) as { detail?: string })
            .detail;
          if (detail) message = detail;
        } catch {}
        throw new Error(message);
      }
      return (await response.json()) as Heard;
    } finally {
      if (this.state === 'hearing') this.set('idle');
    }
  }

  // Say a filler line, ask, then speak the answer.
  async ask(question: string, heard = question): Promise<Exchange> {
    const generation = ++this.generation;
    this.askRequest?.abort();
    const request = new AbortController();
    this.askRequest = request;
    const current = () =>
      !this.disposed && !this.authExpired && generation === this.generation;
    const exchange: Exchange = {
      id: crypto.randomUUID(),
      heard,
      question,
      spoken: '',
      answer: null,
      at: Date.now() / 1000,
    };
    const stopped = () => ({
      ...exchange,
      answer: null,
      spoken: '',
      error: 'This request was stopped.',
    });
    if (!current()) return stopped();
    this.set('thinking', exchange);
    const filler = this.fillers.length
      ? this.play(
          this.fillers[Math.floor(Math.random() * this.fillers.length)],
          generation,
        )
      : Promise.resolve(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const reply = await api<VoiceReply>('/voice/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
        signal: request.signal,
      });
      if (!current() || request.signal.aborted) return stopped();
      exchange.answer = reply.answer;
      if (exchange.answer?.mode === 'checking') {
        exchange.spoken = 'Checking the original evidence…';
        this.set('thinking', { ...exchange });
        timeout = setTimeout(() => {
          timedOut = true;
          request.abort();
        }, 120000);
        const id = exchange.answer.id;
        while (exchange.answer.mode === 'checking') {
          const answers = await api<Answer[]>('/answers', {
            signal: request.signal,
          });
          if (!current() || request.signal.aborted) return stopped();
          const answer = answers.find((item) => item.id === id);
          if (answer) exchange.answer = answer;
          if (exchange.answer.mode === 'checking')
            await waitForReviewPoll(request.signal);
        }
        clearTimeout(timeout);
      }
      if (!current() || request.signal.aborted) return stopped();
      let speechUrl = reply.speech_url;
      if (exchange.answer) {
        if (isReviewedAnswer(exchange.answer)) {
          // Speak the reviewed answer in full, including its uncertainty.
          exchange.spoken = exchange.answer.answer
            .replace(/\[[0-9a-f-]{36}\]/gi, '')
            .trim();
          speechUrl =
            this.status?.deepgram === false
              ? null
              : `/api/voice/speech/${encodeURIComponent(exchange.answer.id)}`;
        } else {
          exchange.spoken =
            exchange.answer.mode === 'no_evidence'
              ? "I couldn't find recorded evidence to answer that."
              : "I couldn't verify that answer. Please try again.";
          exchange.error = 'The answer has not passed evidence review.';
          speechUrl = null;
        }
      } else exchange.spoken = reply.spoken;
      // A stalled filler must not indefinitely hold up a checked answer.
      await Promise.race([
        filler,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      if (!current() || request.signal.aborted) return stopped();
      this.activeFinish?.(false);
      this.player.pause();
      this.set('speaking', { ...exchange });
      let ok = false;
      if (speechUrl) {
        try {
          ok = await this.play(
            await fetchAudio(speechUrl.replace(/^\/api/, ''), {
              signal: request.signal,
            }),
            generation,
          );
        } catch {
          ok = false;
        }
      }
      if (!current() || request.signal.aborted) return stopped();
      if (!ok) ok = await this.browserSpeak(exchange.spoken, generation);
      if (!current() || request.signal.aborted) return stopped();
      if (!ok)
        exchange.error =
          'The checked response is ready, but voice playback is unavailable.';
      this.set('idle', { ...exchange });
      void this.prefetchFillers();
      return exchange;
    } catch (problem) {
      if (!current()) return stopped();
      const error = timedOut
        ? 'Evidence review is taking longer than expected. Check your answer history or try again.'
        : problem instanceof Error
          ? problem.message
          : String(problem);
      const failed = {
        ...exchange,
        error,
        spoken: timedOut
          ? "The evidence check is still pending. I can't give a checked answer yet."
          : "Sorry, I couldn't check that answer.",
      };
      this.set('idle', failed);
      return failed;
    } finally {
      clearTimeout(timeout);
      request.abort();
      if (this.askRequest === request) this.askRequest = null;
    }
  }

  // Hear a clip and, if it was meant for Rewind, answer it.
  async converse(clip: Blob, wake: boolean): Promise<Exchange | null> {
    const heard = await this.hear(clip, wake);
    if (!heard.directed) return null;
    return this.ask(heard.question, heard.transcript);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener(
      AUTH_REQUIRED_EVENT,
      this.authenticationRequired,
    );
    this.listeners.clear();
  }
}

// Separate finishing (submit the clip) from cancellation (discard it).
export async function recordUtterance(
  onLevel?: (level: number) => void,
  signal?: AbortSignal,
  finishSignal?: AbortSignal,
): Promise<Blob | null> {
  if (signal?.aborted) return null;
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'Microphone access needs HTTPS or localhost. Open the secure Rewind link.',
    );
  if (typeof MediaRecorder === 'undefined')
    throw new Error('This browser cannot record audio. Try Safari or Chrome.');
  // Resume during the tap, before the permission prompt loses user activation.
  const context = new AudioContext();
  const resumed = context.resume();
  let stream: MediaStream | null = null;
  try {
    await resumed;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (signal?.aborted || finishSignal?.aborted) return null;
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running')
      throw new Error('Microphone audio is paused. Tap the orb to try again.');
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined,
    );
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const parts: Blob[] = [];
    let voiced = 0,
      quietSince = 0,
      noise = 0.002;
    const started = performance.now();
    let previous = started;
    return await new Promise<Blob | null>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const stop = () => {
        if (recorder.state === 'recording') recorder.stop();
      };
      const clean = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        finishSignal?.removeEventListener('abort', stop);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      recorder.onerror = () => {
        clean();
        reject(new Error('The microphone recording failed. Please try again.'));
      };
      recorder.onstop = () => {
        clean();
        // An explicit finish submits quiet speech too; the transcriber decides
        // whether it contains words. Cancellation never uploads anything.
        resolve(
          parts.length &&
            !signal?.aborted &&
            (voiced >= 180 ||
              (finishSignal?.aborted && performance.now() - started >= 250))
            ? new Blob(parts, {
                type: recorder.mimeType || mime || parts[0].type,
              })
            : null,
        );
      };
      signal?.addEventListener('abort', stop, { once: true });
      finishSignal?.addEventListener('abort', stop, { once: true });
      recorder.start(250);
      const tick = () => {
        if (recorder.state !== 'recording') return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const level = Math.sqrt(sum / data.length);
        onLevel?.(level);
        const now = performance.now();
        if (level > Math.max(0.008, noise * 3)) {
          voiced += Math.min(now - previous, 100);
          quietSince = 0;
        } else {
          if (!voiced) noise = noise * 0.98 + level * 0.02;
          if (!quietSince) quietSince = now;
        }
        previous = now;
        const elapsed = now - started;
        if (
          signal?.aborted ||
          finishSignal?.aborted ||
          (voiced >= 180 && quietSince && now - quietSince >= 1200) ||
          elapsed >= 20000 ||
          (!voiced && elapsed >= 8000)
        )
          stop();
        else timer = setTimeout(tick, 60);
      };
      tick();
    });
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
  }
}
