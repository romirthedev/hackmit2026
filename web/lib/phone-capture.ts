// Original chunks are persisted before upload. Retries keep the same sequence and bytes.
export type CaptureState = {
  recording: boolean;
  requesting: boolean;
  question: boolean;
  queued: number;
  saved: number;
  error: string;
  awake: boolean;
  startedAt: number;
};
type Chunk = {
  id: string;
  boot: string;
  seq: number;
  kind: 'frame' | 'audio';
  at: number;
  blob: Blob;
  intent: 'memory' | 'question';
};
const MAX_QUEUE_BYTES = 150 * 1024 * 1024;
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('rewind-phone-recordings', 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore('chunks', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbPromise;
}
async function chunks(): Promise<Chunk[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction('chunks').objectStore('chunks').getAll();
    req.onsuccess = () => resolve(req.result as Chunk[]);
    req.onerror = () => reject(req.error);
  });
}
async function write(item: Chunk | string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    if (typeof item === 'string') tx.objectStore('chunks').delete(item);
    else tx.objectStore('chunks').put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class PhoneCapture {
  state: CaptureState = {
    recording: false,
    requesting: false,
    question: false,
    queued: 0,
    saved: 0,
    error: '',
    awake: false,
    startedAt: 0,
  };
  private stream: MediaStream | null = null;
  private wake: WakeLockSentinel | null = null;
  private audio: MediaRecorder | null = null;
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadTimer: ReturnType<typeof setInterval>;
  private boot = '';
  private seq = { frame: 0, audio: 0 };
  private pumping = false;
  private disposed = false;
  private speaking = false;
  private speechQueue: string[] = [];
  private speechGeneration = 0;
  private uploadError = '';
  private persist = Promise.resolve();
  constructor(
    private video: HTMLVideoElement,
    private changed: (state: CaptureState) => void,
  ) {
    this.uploadTimer = setInterval(() => void this.upload(), 3000);
    document.addEventListener('visibilitychange', this.visibility);
    void this.upload();
  }
  private update(patch: Partial<CaptureState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.changed(this.state);
  }
  private visibility = () => {
    if (document.visibilityState === 'hidden' && this.state.recording) {
      this.stop();
      this.update({
        error:
          'Recording paused because this page was hidden. Open the page and tap Record to continue.',
      });
    }
  };
  async start() {
    if (this.state.recording || this.state.requesting) return;
    this.update({ requesting: true, error: '' });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Open the secure HTTPS phone link to use the camera and microphone.',
        );
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (this.disposed) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      this.boot = crypto.randomUUID();
      this.seq = { frame: 0, audio: 0 };
      this.stream.getTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (this.state.recording) {
            this.stop();
            this.update({
              error: 'Camera or microphone stopped. Tap Record to reconnect.',
            });
          }
        }),
      );
      this.update({ recording: true, startedAt: Date.now() });
      try {
        if ('wakeLock' in navigator) {
          this.wake = await navigator.wakeLock.request('screen');
          if (!this.state.recording || this.disposed) {
            await this.wake.release();
            this.wake = null;
            return;
          }
          this.update({ awake: true });
          this.wake.addEventListener('release', () =>
            this.update({ awake: false }),
          );
        }
      } catch {
        this.update({ awake: false });
      }
      if (navigator.storage?.persist)
        void navigator.storage.persist().catch(() => false);
      this.beginAudio();
      void this.frame();
    } catch (error) {
      this.stop();
      this.update({
        error:
          error instanceof Error ? error.message : 'Unable to start recording.',
      });
    } finally {
      this.update({ requesting: false });
    }
  }
  stop() {
    this.update({ recording: false, question: false });
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.audioTimer) clearTimeout(this.audioTimer);
    if (this.audio?.state === 'recording') this.audio.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (this.wake) void this.wake.release().catch(() => {});
    this.wake = null;
    this.update({ awake: false });
  }
  toggleQuestion() {
    if (!this.state.recording) return;
    if (this.speaking) {
      this.speechGeneration++;
      this.speechQueue = [];
      this.speaking = false;
      window.speechSynthesis.cancel();
    }
    this.update({ question: !this.state.question, error: '' });
    if (this.audioTimer) clearTimeout(this.audioTimer);
    if (this.audio?.state === 'recording') this.audio.stop();
    else this.beginAudio();
  }
  private beginAudio() {
    if (
      !this.stream ||
      !this.state.recording ||
      this.speaking ||
      this.audio?.state === 'recording'
    )
      return;
    const mime = [
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) {
      this.stop();
      this.update({
        error: 'This browser cannot record audio. Try Safari or Chrome.',
      });
      return;
    }
    const input = new MediaStream(this.stream.getAudioTracks());
    const rec = new MediaRecorder(input, {
      mimeType: mime,
      audioBitsPerSecond: 64000,
    });
    this.audio = rec;
    const parts: Blob[] = [];
    const at = Date.now() / 1000;
    const identity = { boot: this.boot, seq: this.seq.audio++ };
    const intent = this.state.question ? 'question' : 'memory';
    rec.ondataavailable = (event) => {
      if (event.data.size) parts.push(event.data);
    };
    rec.onerror = () => {
      this.stop();
      this.update({
        error: 'Audio recording was interrupted. Tap Record to reconnect.',
      });
    };
    rec.onstop = () => {
      if (parts.length)
        this.enqueue(
          'audio',
          new Blob(parts, { type: mime.split(';')[0] }),
          at,
          intent,
          identity,
        );
      // A fresh recorder makes every clip independently decodable, including MP4 on Safari.
      const current = this.audio === rec;
      if (current) this.audio = null;
      if (identity.boot !== this.boot || !current) return;
      if (intent === 'question' && this.state.question)
        this.update({ question: false });
      this.beginAudio();
    };
    rec.start();
    this.audioTimer = setTimeout(
      () => {
        if (rec.state === 'recording') rec.stop();
      },
      intent === 'question' ? 30000 : 10000,
    );
  }
  private async frame() {
    if (!this.state.recording) return;
    const identity = { boot: this.boot, seq: this.seq.frame++ };
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(
        1,
        960 / Math.max(this.video.videoWidth, this.video.videoHeight),
      );
      canvas.width = Math.max(1, Math.round(this.video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(this.video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Camera canvas unavailable');
      context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const at = Date.now() / 1000;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.82),
      );
      if (blob) this.enqueue('frame', blob, at, 'memory', identity);
    } catch {
      this.update({ error: 'A camera frame could not be captured.' });
    }
    if (this.state.recording && identity.boot === this.boot)
      this.frameTimer = setTimeout(() => void this.frame(), 1000);
  }
  private enqueue(
    kind: Chunk['kind'],
    blob: Blob,
    at: number,
    intent: Chunk['intent'],
    identity: { boot: string; seq: number },
  ) {
    const item: Chunk = {
      id: crypto.randomUUID(),
      ...identity,
      kind,
      blob,
      at,
      intent,
    };
    this.persist = this.persist
      .then(async () => {
        const pending = await chunks();
        if (
          pending.reduce((n, chunk) => n + chunk.blob.size, 0) + blob.size >
          MAX_QUEUE_BYTES
        )
          throw new Error(
            'Phone storage queue is full. Reconnect to upload saved recordings, then tap Record.',
          );
        await write(item);
        this.update({ queued: pending.length + 1 });
        void this.upload();
      })
      .catch((error) => {
        this.stop();
        this.update({ error: String(error) });
      });
  }
  async upload() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      const pending = (await chunks()).sort(
        (a, b) =>
          Number(b.intent === 'question') - Number(a.intent === 'question') ||
          a.at - b.at,
      );
      this.update({ queued: pending.length });
      for (let i = 0; i < pending.length; i += 2) {
        if (this.disposed) break;
        await Promise.all(
          pending.slice(i, i + 2).map(async (item) => {
            const response = await fetch('/api/ingest/' + item.kind, {
              method: 'POST',
              headers: {
                'Content-Type': item.blob.type,
                'X-Boot-ID': item.boot,
                'X-Sequence': String(item.seq),
                'X-Captured-At': String(item.at),
                'X-Intent': item.intent,
              },
              body: item.blob,
              signal: AbortSignal.timeout(20000),
            });
            if (!response.ok)
              throw new Error(
                response.status === 401
                  ? 'Reconnect this phone to upload its saved recordings.'
                  : response.status === 507
                    ? 'The memory server is full. Recordings remain queued on this phone.'
                    : 'Connection interrupted. Saved recordings will retry.',
              );
            await write(item.id);
            this.update({
              saved: this.state.saved + 1,
              queued: Math.max(0, this.state.queued - 1),
            });
          }),
        );
      }
      if (this.state.error === this.uploadError) this.update({ error: '' });
      this.uploadError = '';
    } catch (error) {
      this.uploadError =
        error instanceof Error
          ? error.message
          : 'Offline. Saved recordings will retry.';
      this.update({
        error: this.uploadError,
      });
    } finally {
      this.pumping = false;
    }
  }
  speak(text: string) {
    if (!('speechSynthesis' in window) || this.disposed) return;
    this.speechQueue.push(text);
    if (!this.speaking) this.playSpeech();
  }
  private playSpeech() {
    const text = this.speechQueue.shift();
    if (!text || this.disposed) {
      this.speaking = false;
      this.beginAudio();
      return;
    }
    this.speaking = true;
    const generation = this.speechGeneration;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    if (this.audio?.state === 'recording') this.audio.stop();
    const utterance = new SpeechSynthesisUtterance(
      text.replace(/\[[0-9a-f-]{36}\]/g, ''),
    );
    const resume = () => {
      if (generation === this.speechGeneration) this.playSpeech();
    };
    utterance.onend = resume;
    utterance.onerror = resume;
    window.speechSynthesis.speak(utterance);
  }
  dispose() {
    this.disposed = true;
    this.speechGeneration++;
    this.speechQueue = [];
    this.stop();
    clearInterval(this.uploadTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.speechSynthesis?.cancel();
  }
}
