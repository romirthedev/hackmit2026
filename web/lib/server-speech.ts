import { api, AUTH_REQUIRED_EVENT, type VoiceStatus } from './api';

// Server speech shares one unlocked player per surface. A response is delivered
// only after actual playback ends, with bounded start and completion waits.
export class ServerSpeech {
  enabled = false;
  private player = new Audio();
  private request: AbortController | null = null;
  private finish: ((ok: boolean) => void) | null = null;
  private generation = 0;
  constructor() {
    void api<VoiceStatus>('/voice/status')
      .then((status) => {
        this.enabled = status.deepgram;
      })
      .catch(() => {});
  }
  get active() {
    return this.request !== null || this.finish !== null;
  }
  unlock() {
    // Unlock this exact audio element during the user's gesture.
    const buffer = new ArrayBuffer(46);
    const view = new DataView(buffer);
    for (const [offset, word] of [
      [0, 'RIFF'],
      [8, 'WAVE'],
      [12, 'fmt '],
      [36, 'data'],
    ] as const)
      for (let i = 0; i < word.length; i++)
        view.setUint8(offset + i, word.charCodeAt(i));
    view.setUint32(4, 38, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, 2, true);
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    this.player.src = url;
    void this.player
      .play()
      .catch(() => {})
      .finally(() => URL.revokeObjectURL(url));
  }
  cancel() {
    this.generation++;
    this.request?.abort();
    this.finish?.(false);
    this.player.pause();
    this.player.removeAttribute('src');
  }
  async speak(text: string, onStart: () => void): Promise<boolean> {
    this.cancel();
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    const deadline = setTimeout(() => request.abort(), 20000);
    try {
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: request.signal,
      });
      if (response.status === 401)
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      if (!response.ok) return false;
      const blob = await response.blob();
      if (request.signal.aborted || generation !== this.generation)
        return false;
      clearTimeout(deadline);
      const url = URL.createObjectURL(blob);
      return await new Promise<boolean>((resolve) => {
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
    } catch {
      return false;
    } finally {
      clearTimeout(deadline);
      if (this.request === request) this.request = null;
    }
  }
}
