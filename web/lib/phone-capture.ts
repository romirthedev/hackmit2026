// Original chunks are persisted before upload. Retries keep the same sequence and bytes.
import { VoiceActivityCapture, type VoiceActivity } from './voice-activity';
import { AUTH_REQUIRED_EVENT } from './api';

export type CaptureState = {
  recording: boolean;
  requesting: boolean;
  question: boolean;
  queued: number;
  saved: number;
  error: string;
  awake: boolean;
  startedAt: number;
  finalizing: boolean;
  originalBytes: number;
  voice: VoiceActivity;
  speaking: boolean;
  speechError: string;
  speechRetryAvailable: boolean;
  previewing: boolean;
};
type SpeechRequest = {
  text: string;
  resolve: (played: boolean) => void;
  result?: Promise<boolean>;
};
export type Snapshot = { url: string; width: number; height: number };
type Chunk = {
  id: string;
  boot: string;
  seq: number;
  kind: 'frame' | 'audio' | 'video' | 'recording_end' | 'conversation_audio';
  at: number;
  blob: Blob;
  intent: 'memory' | 'question' | 'scan';
  recordingStartedAt?: number;
};
export type CaptureOptions = {
  // Receives each spoken utterance while recording. When set, speech is
  // handled by the caller (the wake-word voice flow) instead of the
  // server-side conversation queue.
  onUtterance?: (blob: Blob, at: number) => void;
};
type EndReason =
  | 'stopped'
  | 'hidden'
  | 'interrupted'
  | 'storage_full'
  | 'page_closed';
type RecordingSession = {
  id: string;
  mime: string;
  startedAt: number;
  lastAt: number;
  chunks: number;
  closed: boolean;
};
const MAX_QUEUE_BYTES = 150 * 1024 * 1024;
// Leave room for the final recorder fragment after stopping at the soft limit.
const STOP_QUEUE_BYTES = 120 * 1024 * 1024;
const ORIGINAL_FRAGMENT_BYTES = 4 * 1024 * 1024;
const activeOriginals = new Set<string>();
const pageHidden = () => document.visibilityState === 'hidden';
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('rewind-phone-recordings', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('chunks'))
          req.result.createObjectStore('chunks', { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains('sessions'))
          req.result.createObjectStore('sessions', { keyPath: 'id' });
      };
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
async function write(
  item: Chunk | string,
  session?: RecordingSession | string,
) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
    if (typeof item === 'string') tx.objectStore('chunks').delete(item);
    else tx.objectStore('chunks').put(item);
    if (typeof session === 'string') tx.objectStore('sessions').delete(session);
    else if (session) tx.objectStore('sessions').put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function endChunk(
  session: RecordingSession,
  reason: EndReason,
  endedAt: number,
): Chunk {
  return {
    id: `finish-${session.id}`,
    boot: session.id,
    seq: session.chunks,
    kind: 'recording_end',
    at: endedAt,
    intent: 'memory',
    blob: new Blob(
      [
        JSON.stringify({
          mime: session.mime,
          started_at: session.startedAt,
          ended_at: Math.max(session.startedAt, endedAt),
          chunks: session.chunks,
          reason,
        }),
      ],
      { type: 'application/json' },
    ),
  };
}

async function recoverSessions() {
  const db = await database();
  const sessions = await new Promise<RecordingSession[]>((resolve, reject) => {
    const req = db.transaction('sessions').objectStore('sessions').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const session of sessions) {
    if (!session.closed && !activeOriginals.has(session.id)) {
      await write(endChunk(session, 'page_closed', session.lastAt), {
        ...session,
        closed: true,
      });
    }
  }
  return sessions.some(
    (session) => !session.closed && !activeOriginals.has(session.id),
  );
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
    finalizing: false,
    originalBytes: 0,
    voice: 'off',
    speaking: false,
    speechError: '',
    speechRetryAvailable: false,
    previewing: false,
  };
  private stream: MediaStream | null = null;
  private previewStream: MediaStream | null = null;
  private previewBoot = '';
  private previewSequence = 0;
  private mediaGeneration = 0;
  private mediaOpening = false;
  private wake: WakeLockSentinel | null = null;
  private audio: MediaRecorder | null = null;
  private original: MediaRecorder | null = null;
  private voice: VoiceActivityCapture | null = null;
  private releaseCaptureLease: (() => void) | null = null;
  private endReason: EndReason = 'stopped';
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadTimer: ReturnType<typeof setInterval>;
  private boot = '';
  private seq = { frame: 0, audio: 0 };
  private pumping = false;
  private disposed = false;
  private speaking = false;
  private speechQueue: SpeechRequest[] = [];
  private activeSpeech: SpeechRequest | null = null;
  // Safari may release an utterance that has no JavaScript owner before it ends.
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private lastFailedSpeech: string | null = null;
  private lastFailedRequest: SpeechRequest | null = null;
  private speechGeneration = 0;
  private speechTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadError = '';
  private persist = Promise.resolve();
  private ready: Promise<void>;
  constructor(
    private video: HTMLVideoElement,
    private changed: (state: CaptureState) => void,
    private options: CaptureOptions = {},
  ) {
    this.uploadTimer = setInterval(() => void this.upload(), 3000);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pagehide);
    window.addEventListener('beforeunload', this.beforeunload);
    const recovery = navigator.locks
      ? navigator.locks.request(
          'rewind-phone-capture',
          { ifAvailable: true },
          (lock) => (lock ? recoverSessions() : false),
        )
      : recoverSessions();
    this.ready = recovery
      .then((recovered) => {
        if (recovered)
          this.update({
            error:
              'The previous recording was interrupted. Saved video is uploading; the final seconds before the page closed may be missing.',
          });
      })
      .catch(() => {
        this.update({
          error:
            'Phone storage could not be opened. Recording cannot safely begin.',
        });
      });
    void this.ready.then(() => this.upload());
  }
  private update(patch: Partial<CaptureState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.changed(this.state);
  }
  private visibility = () => {
    if (
      pageHidden() &&
      (this.state.recording || this.state.previewing || this.mediaOpening)
    ) {
      this.stop('hidden');
      this.update({
        error:
          'Camera paused because this page was hidden. Open the page and tap Record or Scan to continue.',
      });
    }
  };
  private pagehide = () => this.stop('page_closed');
  private beforeunload = (event: BeforeUnloadEvent) => {
    if (this.state.recording || this.state.finalizing || this.state.queued) {
      event.preventDefault();
    }
  };
  async start() {
    if (
      this.disposed ||
      this.state.recording ||
      this.mediaOpening ||
      this.state.finalizing
    )
      return;
    this.stopPreview();
    const generation = ++this.mediaGeneration;
    const current = () => !this.disposed && generation === this.mediaGeneration;
    this.mediaOpening = true;
    this.update({ requesting: true, error: '' });
    try {
      try {
        this.voice = new VoiceActivityCapture(
          (blob, at) =>
            this.options.onUtterance
              ? this.options.onUtterance(blob, at)
              : this.enqueue('conversation_audio', blob, at, 'question', {
                  boot: this.boot,
                  seq: this.seq.audio++,
                }),
          (voice) => {
            this.update({ voice });
            if (
              voice === 'listening' &&
              !this.speaking &&
              this.speechQueue.length
            )
              this.playSpeech();
          },
          () => {
            this.update({
              voice: 'unavailable',
              error:
                'Voice listening was interrupted. Your recording is still saved; you can type a request below.',
            });
            this.beginAudio();
          },
        );
      } catch {
        this.voice = null;
        this.update({ voice: 'unavailable' });
      }
      await this.ready;
      if (!current()) return;
      await database();
      if (!current()) return;
      await this.acquireCaptureLease();
      if (!current()) {
        this.releaseStream();
        return;
      }
      // Another tab may have owned capture when this controller was created,
      // then disappeared. Reconcile its durable session only after acquiring
      // exclusive ownership; constructor-only recovery would miss this case.
      if (await recoverSessions()) {
        this.update({
          error:
            'The previous recording was interrupted. Saved video is uploading; the final seconds before the page closed may be missing.',
        });
        void this.upload();
      }
      if (!current()) return;
      if (typeof MediaRecorder === 'undefined')
        throw new Error(
          'This browser cannot save full video recordings. Try current Safari or Chrome.',
        );
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Open the secure HTTPS phone link to use the camera and microphone.',
        );
      if (pageHidden())
        throw new Error('Keep this page open to begin recording.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!current()) {
        stream.getTracks().forEach((t) => t.stop());
        this.releaseStream();
        return;
      }
      this.stream = stream;
      if (pageHidden())
        throw new Error('Keep this page open to begin recording.');
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!current()) return;
      this.boot = crypto.randomUUID();
      this.seq = { frame: 0, audio: 0 };
      this.stream.getTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (this.state.recording) {
            this.stop('interrupted');
            this.update({
              error: 'Camera or microphone stopped. Tap Record to reconnect.',
            });
          }
        }),
      );
      this.update({ recording: true, startedAt: Date.now(), originalBytes: 0 });
      await this.beginOriginal();
      if (!current() || !this.state.recording) return;
      const voice = this.voice;
      if (voice && this.stream) {
        try {
          // A response may already be speaking while Record is opening the
          // camera or restarting. The new microphone analyzer must inherit it.
          voice.suppress(this.speaking);
          await voice.start(this.stream);
          if (!current() || !this.state.recording) return;
        } catch {
          voice.stop();
          this.voice = null;
          if (this.state.recording)
            this.update({
              voice: 'unavailable',
              error:
                'This browser could not start hands-free listening. Your recording is still saved; type a request below.',
            });
        }
      }
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
      if (!current()) return;
      this.stop('interrupted');
      this.update({
        error:
          error instanceof Error ? error.message : 'Unable to start recording.',
      });
    } finally {
      this.mediaOpening = false;
      this.update({ requesting: false });
    }
  }
  stop(reason: EndReason = 'stopped') {
    ++this.mediaGeneration;
    this.closePreview();
    this.endReason = reason;
    this.update({ recording: false, question: false });
    this.voice?.stop();
    this.voice = null;
    this.update({ voice: 'off' });
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.audioTimer) clearTimeout(this.audioTimer);
    if (this.audio?.state === 'recording') this.audio.stop();
    if (this.original && this.original.state !== 'inactive') {
      this.update({ finalizing: true });
      this.original.stop();
    } else if (!this.state.finalizing) {
      this.releaseStream();
    }
    if (this.wake) void this.wake.release().catch(() => {});
    this.wake = null;
    this.update({ awake: false });
  }
  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.releaseCaptureLease?.();
    this.releaseCaptureLease = null;
  }
  private closePreview() {
    const stream = this.previewStream;
    stream?.getTracks().forEach((track) => track.stop());
    this.previewStream = null;
    if (stream && this.video.srcObject === stream) this.video.srcObject = null;
    this.update({ previewing: false });
  }
  stopPreview() {
    if (this.state.recording || this.state.finalizing) return;
    ++this.mediaGeneration;
    this.closePreview();
  }
  async preview(): Promise<boolean> {
    if (this.state.recording || this.state.previewing) return true;
    if (this.disposed || this.mediaOpening || this.state.finalizing)
      return false;
    const generation = ++this.mediaGeneration;
    const current = () => !this.disposed && generation === this.mediaGeneration;
    this.mediaOpening = true;
    this.update({ requesting: true, error: '' });
    let opened: MediaStream | null = null;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error('Open the secure HTTPS phone link to use the camera.');
      if (pageHidden())
        throw new Error('Keep this page open to use the camera.');
      opened = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!current() || pageHidden()) return false;
      this.previewStream = opened;
      this.video.srcObject = opened;
      await this.video.play();
      if (!current() || pageHidden()) return false;
      this.previewBoot = crypto.randomUUID();
      this.previewSequence = 0;
      opened.getTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (this.previewStream === opened) {
            this.stopPreview();
            this.update({ error: 'Camera stopped. Open it again to scan.' });
          }
        }),
      );
      this.update({ previewing: true });
      return true;
    } catch (error) {
      if (current())
        this.update({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to open the camera.',
        });
      return false;
    } finally {
      if (!current() || !this.state.previewing) {
        opened?.getTracks().forEach((track) => track.stop());
        if (this.previewStream === opened) this.closePreview();
      }
      this.mediaOpening = false;
      this.update({ requesting: false });
    }
  }
  async snap(): Promise<Snapshot | null> {
    if (this.disposed || !(this.state.recording || this.state.previewing))
      return null;
    const generation = this.mediaGeneration;
    try {
      if (
        this.video.readyState < 2 ||
        !this.video.videoWidth ||
        !this.video.videoHeight
      )
        throw new Error('The camera is still opening. Try Scan again.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(
        1,
        960 / Math.max(this.video.videoWidth, this.video.videoHeight),
      );
      canvas.width = Math.round(this.video.videoWidth * scale);
      canvas.height = Math.round(this.video.videoHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Camera canvas unavailable.');
      context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const at = Date.now() / 1000;
      const identity = this.state.recording
        ? { boot: this.boot, seq: this.seq.frame++ }
        : { boot: this.previewBoot, seq: this.previewSequence++ };
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.82),
      );
      if (
        !blob ||
        this.disposed ||
        generation !== this.mediaGeneration ||
        pageHidden()
      )
        return null;
      const saved = await this.enqueue('frame', blob, at, 'scan', identity);
      if (!saved || this.disposed || generation !== this.mediaGeneration)
        return null;
      return {
        url: URL.createObjectURL(blob),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (error) {
      if (!this.disposed && generation === this.mediaGeneration)
        this.update({
          error:
            error instanceof Error
              ? error.message
              : 'A camera frame could not be captured.',
        });
      return null;
    }
  }
  private async acquireCaptureLease() {
    if (!navigator.locks) return;
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request(
          'rewind-phone-capture',
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              reject(
                new Error(
                  'Recording is already open in another tab. Use that tab or stop it first.',
                ),
              );
              return;
            }
            await new Promise<void>((release) => {
              this.releaseCaptureLease = release;
              resolve();
            });
          },
        )
        .catch(reject);
    });
  }
  private async beginOriginal() {
    if (!this.stream) return;
    const mime = ['video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    if (!mime)
      throw new Error(
        'This browser cannot save full camera and audio recordings. Try Safari or Chrome.',
      );
    const recorder = new MediaRecorder(this.stream, {
      mimeType: mime,
      videoBitsPerSecond: 1500000,
      audioBitsPerSecond: 64000,
    });
    const session: RecordingSession = {
      id: this.boot,
      mime: recorder.mimeType || mime,
      startedAt: this.state.startedAt / 1000,
      lastAt: this.state.startedAt / 1000,
      chunks: 0,
      closed: false,
    };
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    if (!this.state.recording || this.disposed) {
      await write(endChunk(session, 'interrupted', Date.now() / 1000), {
        ...session,
        closed: true,
      });
      return;
    }
    this.original = recorder;
    activeOriginals.add(session.id);
    this.endReason = 'stopped';
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const at = Date.now() / 1000;
      session.lastAt = at;
      // A fragment is part of ONE continuous container. Keep the same recording
      // identity and exact bytes; only ordered concatenation is the original.
      // Browsers may emit a large delayed blob despite a short timeslice. Split
      // only its transport boundaries, preserving every byte and their order.
      for (
        let offset = 0;
        offset < event.data.size;
        offset += ORIGINAL_FRAGMENT_BYTES
      ) {
        const sequence = session.chunks++;
        void this.enqueue(
          'video',
          event.data.slice(
            offset,
            offset + ORIGINAL_FRAGMENT_BYTES,
            session.mime,
          ),
          at,
          'memory',
          { boot: session.id, seq: sequence },
          { ...session },
        );
      }
    };
    recorder.onerror = () => {
      this.stop('interrupted');
      this.update({
        error:
          'Full video recording was interrupted. Saved portions are retained. Tap Record to reconnect.',
      });
    };
    recorder.onstop = () => {
      const endedAt = Date.now() / 1000;
      const reason = this.endReason;
      const closed = { ...session, closed: true };
      this.persist = this.persist
        .then(async () => {
          await write(endChunk(closed, reason, endedAt), closed);
          void this.upload();
        })
        .catch(() => {
          this.update({
            error:
              'The final recording marker could not be saved. Already saved fragments are retained; reopen this page to recover them.',
          });
        })
        .finally(() => {
          if (this.original === recorder) {
            this.original = null;
            activeOriginals.delete(session.id);
            this.releaseStream();
            this.update({ finalizing: false });
          }
        });
    };
    try {
      recorder.start(2000);
    } catch (error) {
      this.original = null;
      activeOriginals.delete(session.id);
      await write(endChunk(session, 'interrupted', Date.now() / 1000), {
        ...session,
        closed: true,
      });
      throw error;
    }
  }
  // Pause hands-free listening while a spoken answer plays, so the answer is
  // not heard as a new question.
  suppressListening(value: boolean) {
    this.voice?.suppress(value);
  }
  toggleQuestion() {
    if (!this.state.recording) return;
    if (this.speaking) this.silenceSpeech();
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
      this.audio?.state === 'recording' ||
      (this.voice && this.state.voice !== 'unavailable')
    )
      return;
    const mime = [
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) {
      this.stop('interrupted');
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
      this.stop('interrupted');
      this.update({
        error: 'Audio recording was interrupted. Tap Record to reconnect.',
      });
    };
    rec.onstop = () => {
      if (parts.length)
        void this.enqueue(
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
      if (blob) void this.enqueue('frame', blob, at, 'memory', identity);
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
    session?: RecordingSession,
  ): Promise<boolean> {
    let saved = false;
    const item: Chunk = {
      id: crypto.randomUUID(),
      ...identity,
      kind,
      blob,
      at,
      intent,
      recordingStartedAt: session?.startedAt,
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
        await write(item, session);
        saved = true;
        this.update({
          queued: pending.length + 1,
          originalBytes:
            this.state.originalBytes + (kind === 'video' ? blob.size : 0),
        });
        if (
          pending.reduce((n, chunk) => n + chunk.blob.size, 0) + blob.size >
            STOP_QUEUE_BYTES &&
          this.state.recording
        ) {
          this.stop('storage_full');
          this.update({
            error:
              'Recording stopped because this phone’s upload queue is almost full. Reconnect to save the queued originals, then tap Record.',
          });
        }
        void this.upload();
      })
      .catch((error) => {
        this.stop('storage_full');
        this.update({
          error: `A recording fragment could not be saved. Recording stopped to prevent further loss. ${String(error)}`,
        });
      });
    return this.persist.then(() => saved);
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
            const recording =
              item.kind === 'video' || item.kind === 'recording_end';
            const url =
              item.kind === 'conversation_audio'
                ? '/api/conversation/audio'
                : recording
                  ? `/api/continuous-recordings/${item.boot}/${item.kind === 'video' ? `chunks/${item.seq}` : 'finish'}`
                  : '/api/ingest/' + item.kind;
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': item.blob.type,
                'X-Boot-ID': item.boot,
                'X-Sequence': String(item.seq),
                'X-Captured-At': String(item.at),
                'X-Intent': item.intent,
                ...(item.recordingStartedAt
                  ? {
                      'X-Recording-Started-At': String(item.recordingStartedAt),
                    }
                  : {}),
              },
              body: item.blob,
              signal: AbortSignal.timeout(20000),
            });
            if (response.status === 401)
              window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
            if (!response.ok)
              throw new Error(
                response.status === 401
                  ? 'Reconnect this phone to upload its saved recordings.'
                  : response.status === 507
                    ? 'The memory server is full. Recordings remain queued on this phone.'
                    : 'Connection interrupted. Saved recordings will retry.',
              );
            await write(
              item.id,
              item.kind === 'recording_end' ? item.boot : undefined,
            );
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
  get failedSpeechText() {
    return this.lastFailedSpeech;
  }
  isFailedSpeech(result: Promise<boolean>) {
    return this.lastFailedRequest?.result === result;
  }
  speak(text: string): Promise<boolean> {
    return this.enqueueSpeech(text);
  }
  // Call directly inside a click handler, before any await or camera prompt.
  testVoice(): Promise<boolean> {
    return this.speakFromGesture('Voice is on.');
  }
  retrySpeech(): Promise<boolean> {
    return this.speakFromGesture(this.lastFailedSpeech || 'Voice is on.');
  }
  speakFromGesture(text: string): Promise<boolean> {
    this.silenceSpeech();
    return this.enqueueSpeech(text, true);
  }
  private enqueueSpeech(text: string, fromGesture = false): Promise<boolean> {
    if (this.disposed || !text.trim()) return Promise.resolve(false);
    if (
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      const result = Promise.resolve(false);
      this.lastFailedRequest = { text, resolve: () => {}, result };
      this.lastFailedSpeech = text;
      this.update({
        speechError:
          'This browser cannot play spoken answers. You can still read answers below.',
        speechRetryAvailable: true,
      });
      return result;
    }
    let request!: SpeechRequest;
    const result = new Promise<boolean>((resolve) => {
      request = { text, resolve };
      this.speechQueue.push(request);
      if (!this.speaking && (fromGesture || this.state.voice !== 'hearing'))
        this.playSpeech(fromGesture);
    });
    request.result = result;
    return result;
  }
  silenceSpeech() {
    this.speechGeneration++;
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = null;
    const active = this.activeSpeech;
    this.activeSpeech = null;
    this.activeUtterance = null;
    active?.resolve(false);
    this.speechQueue.splice(0).forEach((request) => request.resolve(false));
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Cancellation must still release listening and settle every request.
    }
    this.speaking = false;
    this.update({ speaking: false });
    this.voice?.suppress(false);
    this.beginAudio();
  }
  private playSpeech(fromGesture = false) {
    if (!fromGesture && this.state.voice === 'hearing') return;
    const request = this.speechQueue.shift();
    if (!request || this.disposed) {
      request?.resolve(false);
      this.speaking = false;
      this.update({ speaking: false });
      this.voice?.suppress(false);
      this.beginAudio();
      return;
    }
    this.activeSpeech = request;
    // Suppress the analyzer before asking the browser to play, including while
    // it is starting. The full original recorder keeps the microphone audio.
    this.speaking = true;
    this.voice?.suppress(true);
    const generation = this.speechGeneration;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    if (this.audio?.state === 'recording') this.audio.stop();
    let started = false;
    let finished = false;
    const finish = (played: boolean, message = '') => {
      if (finished || generation !== this.speechGeneration) return;
      finished = true;
      if (this.speechTimer) clearTimeout(this.speechTimer);
      this.speechTimer = null;
      this.activeSpeech = null;
      this.activeUtterance = null;
      if (!played) {
        this.lastFailedSpeech = request.text;
        this.lastFailedRequest = request;
        this.speechGeneration++;
        this.speechQueue.splice(0).forEach((queued) => queued.resolve(false));
        try {
          window.speechSynthesis.cancel();
        } catch {
          // The error below remains actionable even when native cancel fails.
        }
        this.speaking = false;
        this.update({
          speaking: false,
          speechError: message,
          speechRetryAvailable: true,
        });
        this.voice?.suppress(false);
        this.beginAudio();
      } else {
        if (this.lastFailedSpeech === request.text) {
          this.lastFailedSpeech = null;
          this.lastFailedRequest = null;
        }
        this.update({
          speaking: false,
          speechError: '',
          speechRetryAvailable: !!this.lastFailedSpeech,
        });
      }
      request.resolve(played);
      if (played) this.playSpeech();
    };
    try {
      const utterance = new SpeechSynthesisUtterance(
        request.text.replace(/\[[0-9a-f-]{36}\]/g, ''),
      );
      this.activeUtterance = utterance;
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        if (finished || generation !== this.speechGeneration) return;
        started = true;
        if (this.speechTimer) clearTimeout(this.speechTimer);
        this.update({ speaking: true, speechError: '' });
        this.speechTimer = setTimeout(
          () =>
            finish(
              false,
              'Voice playback stopped before finishing. Tap Retry voice to try again.',
            ),
          Math.min(90000, Math.max(15000, request.text.length * 100)),
        );
      };
      utterance.onend = () =>
        finish(
          started,
          'Voice playback did not start. Tap Retry voice and check your phone’s media volume.',
        );
      utterance.onerror = (event) =>
        finish(
          false,
          event.error === 'not-allowed'
            ? 'Your browser blocked voice. Tap Retry voice and check your phone’s media volume.'
            : `Voice could not play (${event.error || 'playback error'}). Tap Retry voice to try again.`,
        );
      this.speechTimer = setTimeout(
        () =>
          finish(
            false,
            'Voice did not start within 5 seconds. Tap Retry voice and check your phone’s media volume.',
          ),
        5000,
      );
      window.speechSynthesis.resume();
      // This stays synchronous for testVoice/retrySpeech/speakFromGesture.
      window.speechSynthesis.speak(utterance);
    } catch {
      finish(false, 'Voice could not start. Tap Retry voice to try again.');
    }
  }
  dispose() {
    this.disposed = true;
    this.silenceSpeech();
    this.stop('page_closed');
    clearInterval(this.uploadTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pagehide);
    window.removeEventListener('beforeunload', this.beforeunload);
  }
}
