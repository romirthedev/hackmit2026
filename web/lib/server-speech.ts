import { api, AUTH_REQUIRED_EVENT, type VoiceStatus } from './api';

function nativeAvailable() {
  return (
    !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function silence() {
  const buffer = new ArrayBuffer(844);
  const view = new DataView(buffer);
  for (const [offset, word] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    for (let i = 0; i < word.length; i++)
      view.setUint8(offset + i, word.charCodeAt(i));
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, buffer.byteLength - 44, true);
  // A fixed data URL has no revocation race with WebKit's lazy audio loader.
  // Audio.play() resolves when playback starts, before all bytes are consumed.
  return (
    'data:audio/wav;base64,' +
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
  );
}

function message(code: string) {
  if (code === 'not-allowed' || code === 'NotAllowedError')
    return 'Your browser blocked voice. Tap Retry voice to allow playback.';
  if (code === 'start-timeout')
    return 'Voice did not start. Tap Retry voice and check your phone’s media volume.';
  return 'Voice could not play. Tap Retry voice and check your phone’s media volume.';
}

/** One playback owner for both phone and desktop, with bounded failure recovery. */
export class ServerSpeech {
  enabled = false;
  error = '';
  private player = new Audio();
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private request: AbortController | null = null;
  private finish: ((ok: boolean) => void) | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private priming: SpeechSynthesisUtterance | null = null;
  private generation = 0;
  private disposed = false;

  constructor() {
    this.player.preload = 'auto';
    void api<VoiceStatus>('/voice/status')
      .then((status) => {
        this.enabled = status.deepgram;
      })
      .catch(() => {});
  }

  get available() {
    return this.enabled || nativeAvailable();
  }
  get active() {
    return this.request !== null || this.finish !== null;
  }

  // Invoke synchronously in the interaction that starts voice/capture, before
  // permission prompts or network awaits consume the browser's user gesture.
  unlock() {
    if (this.disposed) return;
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      void this.context.resume().catch(() => {});
      const pulse = this.context.createBufferSource();
      pulse.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      pulse.connect(this.context.destination);
      pulse.onended = () => pulse.disconnect();
      pulse.start();
    } catch {
      // Retained HTMLAudio and native speech are independent fallbacks.
    }
    if (!this.active) {
      this.player.src = silence();
      // Muted autoplay does not grant permission for later audible playback.
      this.player.muted = false;
      void this.player.play().catch(() => {});
    }
    if (nativeAvailable() && !this.active && !this.utterance && !this.priming) {
      try {
        const prime = new SpeechSynthesisUtterance(' ');
        prime.volume = 0;
        this.priming = prime;
        const done = () => {
          if (this.priming === prime) this.priming = null;
        };
        prime.onend = done;
        prime.onerror = done;
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(prime);
      } catch {
        this.priming = null;
      }
    }
  }

  cancel() {
    this.generation++;
    const nativePlaying = this.utterance !== null;
    this.request?.abort();
    this.request = null;
    this.finish?.(false);
    this.finish = null;
    this.player.pause();
    this.player.removeAttribute('src');
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* Already ended. */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (nativePlaying) {
      this.utterance = null;
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* Still settle cancellation. */
      }
    }
  }

  async speak(raw: string, onStart: () => void = () => {}): Promise<boolean> {
    this.cancel();
    this.error = '';
    const text = raw.replace(/\[[0-9a-f-]{36}\]/gi, '').trim();
    if (this.disposed || !text || document.hidden) return false;
    const generation = this.generation;
    if (this.enabled) {
      const request = new AbortController();
      this.request = request;
      const timeout = setTimeout(() => request.abort(), 15000);
      try {
        const response = await fetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: request.signal,
        });
        if (response.status === 401) {
          window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
          return false;
        }
        if (response.ok) {
          const blob = await response.blob();
          if (generation !== this.generation || request.signal.aborted)
            return false;
          clearTimeout(timeout);
          if (await this.play(blob, text, onStart, generation)) return true;
        }
      } catch {
        /* A server/network failure can still use the device's voice. */
      } finally {
        clearTimeout(timeout);
        if (this.request === request) this.request = null;
      }
    }
    if (generation !== this.generation || this.disposed) return false;
    return this.native(text, onStart);
  }

  private async play(
    blob: Blob,
    text: string,
    onStart: () => void,
    generation: number,
  ) {
    // An AudioContext resumed in the original tap survives the network await.
    // HTMLAudio remains a fallback for devices without Web Audio decoding.
    const context = this.context;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      await Promise.race([
        context.resume().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    if (context?.state === 'running') {
      try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        if (generation !== this.generation) return false;
        return await new Promise<boolean>((resolve) => {
          const source = context.createBufferSource();
          this.source = source;
          source.buffer = buffer;
          source.connect(context.destination);
          let settled = false;
          const timer = setTimeout(
            () => finish(false),
            Math.min(180000, (buffer.duration + 5) * 1000),
          );
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            source.onended = null;
            try {
              source.stop();
            } catch {
              /* May already be ended. */
            }
            source.disconnect();
            if (this.source === source) this.source = null;
            if (this.finish === finish) this.finish = null;
            resolve(ok);
          };
          this.finish = finish;
          source.onended = () => finish(true);
          source.start();
          onStart();
        });
      } catch {
        /* Try the unlocked media element next. */
      }
    }
    if (generation !== this.generation) return false;
    const url = URL.createObjectURL(blob);
    return new Promise<boolean>((resolve) => {
      let started = false,
        settled = false;
      let timer = setTimeout(() => finish(false), 5000);
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.player.onplaying =
          this.player.onended =
          this.player.onerror =
            null;
        this.player.pause();
        URL.revokeObjectURL(url);
        if (this.finish === finish) this.finish = null;
        resolve(ok);
      };
      this.finish = finish;
      this.player.onplaying = () => {
        if (started) return;
        started = true;
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(false),
          Math.min(180000, Math.max(20000, text.length * 110)),
        );
        onStart();
      };
      this.player.onended = () => finish(started);
      this.player.onerror = () => finish(false);
      this.player.src = url;
      void this.player.play().catch(() => finish(false));
    });
  }

  private native(text: string, onStart: () => void): Promise<boolean> {
    if (!nativeAvailable()) {
      this.error =
        'Voice is unavailable in this browser. You can still read the answer.';
      return Promise.resolve(false);
    }
    if (this.priming) {
      this.priming = null;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* The real request reports errors. */
      }
    }
    return new Promise<boolean>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      this.utterance = utterance;
      utterance.lang = navigator.language || 'en-US';
      utterance.volume = 1;
      utterance.rate = 1;
      let started = false,
        settled = false;
      let timer = setTimeout(() => {
        finish(false, 'start-timeout');
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* Failure already reported. */
        }
      }, 5000);
      const finish = (ok: boolean, code = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        utterance.onstart = utterance.onend = utterance.onerror = null;
        if (this.utterance === utterance) this.utterance = null;
        if (this.finish === finish) this.finish = null;
        if (!ok && code) this.error = message(code);
        resolve(ok);
      };
      this.finish = finish;
      utterance.onstart = () => {
        if (started || settled) return;
        started = true;
        clearTimeout(timer);
        timer = setTimeout(
          () => {
            finish(false, 'finish-timeout');
            try {
              window.speechSynthesis.cancel();
            } catch {
              /* Failure already reported. */
            }
          },
          Math.min(180000, Math.max(20000, text.length * 110)),
        );
        onStart();
      };
      utterance.onend = () => finish(started, started ? '' : 'start-timeout');
      utterance.onerror = (event) => finish(false, event.error);
      try {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch {
        finish(false, 'synthesis-failed');
      }
    });
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    if (this.priming) {
      this.priming = null;
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* No active request. */
      }
    }
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
