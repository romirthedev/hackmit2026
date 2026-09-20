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
  // When muted, answers still arrive as text; nothing is played.
  muted = false;
  setMuted(value: boolean) {
    this.muted = value;
    if (value) this.stop();
  }
  onSpeaking: ((speaking: boolean) => void) | null = null;

  constructor() {
    this.player.preload = 'auto';
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
    if (this.disposed || this.muted || generation !== this.generation)
      return true;
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
    const ok = await this.play(
      this.fillers[Math.floor(Math.random() * this.fillers.length)],
      generation,
    );
    return ok;
  }

  stop() {
    this.generation++;
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
    const exchange: Exchange = {
      id: crypto.randomUUID(),
      heard,
      question,
      spoken: '',
      answer: null,
      at: Date.now() / 1000,
    };
    this.set('thinking', exchange);
    const filler = this.fillers.length
      ? this.play(
          this.fillers[Math.floor(Math.random() * this.fillers.length)],
          generation,
        )
      : Promise.resolve(false);
    let reply: VoiceReply;
    try {
      reply = await api<VoiceReply>('/voice/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
    } catch (problem) {
      const error =
        problem instanceof Error ? problem.message : String(problem);
      const failed = { ...exchange, error, spoken: "Sorry, I couldn't check." };
      if (generation === this.generation) this.set('idle', failed);
      return failed;
    }
    exchange.spoken = reply.spoken;
    exchange.answer = reply.answer;
    if (generation !== this.generation) return exchange;
    await filler;
    if (generation !== this.generation) return exchange;
    this.set('speaking', exchange);
    let ok = false;
    if (reply.speech_url) {
      try {
        ok = await this.play(
          await fetchAudio(reply.speech_url.replace(/^\/api/, '')),
          generation,
        );
      } catch {
        ok = false;
      }
    }
    if (!ok) await this.browserSpeak(reply.spoken, generation);
    if (generation === this.generation) this.set('idle', exchange);
    void this.prefetchFillers();
    return exchange;
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
    this.listeners.clear();
  }
}

// Record one utterance from a tapped microphone: stops after ~1.2 s of
// silence or 15 s, whichever comes first. Resolves with the clip.
export async function recordUtterance(
  onLevel?: (level: number) => void,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  );
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) parts.push(event.data);
  };
  let spoke = false;
  let quiet = 0;
  const started = Date.now();
  const clip = new Promise<Blob | null>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      resolve(
        parts.length && spoke
          ? new Blob(parts, { type: (mime || 'audio/webm').split(';')[0] })
          : null,
      );
    };
  });
  recorder.start(250);
  const tick = () => {
    if (recorder.state !== 'recording') return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const level = Math.sqrt(sum / data.length);
    onLevel?.(level);
    if (level > 0.03) {
      spoke = true;
      quiet = 0;
    } else if (spoke) quiet += 60;
    const elapsed = Date.now() - started;
    if (
      signal?.aborted ||
      (spoke && quiet >= 1200) ||
      elapsed > 15000 ||
      (!spoke && elapsed > 6000)
    )
      recorder.stop();
    else setTimeout(tick, 60);
  };
  tick();
  return clip;
}
