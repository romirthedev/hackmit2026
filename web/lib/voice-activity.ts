export type VoiceActivity = 'off' | 'listening' | 'hearing' | 'unavailable';

type AudioFrame = { samples: Float32Array; sampleRate: number; time: number };
const PRE_ROLL_SECONDS = 0.25;
const SILENCE_SECONDS = 0.85;
// Keep short replies such as "yes" and "no" while rejecting brief clicks.
const MIN_VOICED_SECONDS = 0.18;
const MAX_UTTERANCE_SECONDS = 20;

export function speechWav(parts: Float32Array[], sourceRate: number): Blob {
  const count = parts.reduce((n, part) => n + part.length, 0);
  const input = new Float32Array(count);
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  const rate = 16000;
  const length = Math.floor((count * rate) / sourceRate);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const first = Math.floor((i * sourceRate) / rate);
    const last = Math.max(first + 1, Math.floor(((i + 1) * sourceRate) / rate));
    let total = 0;
    for (let j = first; j < last && j < input.length; j++) total += input[j];
    const sample = Math.max(-1, Math.min(1, total / (last - first)));
    view.setInt16(
      44 + i * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true,
    );
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Silence segmentation only: language/intent decisions stay in the conversation service. */
export class VoiceActivityCapture {
  private context: AudioContext;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private stopped = false;
  private suppressed = false;
  private resumeAfter = 0;
  private epoch = 0;
  private rate = 48000;
  private noise = 0.003;
  private before: AudioFrame[] = [];
  private parts: Float32Array[] = [];
  private startedAt = 0;
  private duration = 0;
  private voiced = 0;
  private quiet = 0;
  private activity: VoiceActivity = 'off';

  constructor(
    private utterance: (blob: Blob, at: number) => void,
    private changed: (activity: VoiceActivity) => void,
    private failed: () => void,
  ) {
    // Construct and resume during the Record gesture, before camera permission awaits.
    this.context = new AudioContext({ latencyHint: 'interactive' });
    void this.context.resume().catch(() => this.failed());
  }

  private update(activity: VoiceActivity) {
    if (activity === this.activity) return;
    this.activity = activity;
    this.changed(activity);
  }

  async start(stream: MediaStream) {
    if (this.stopped) return;
    if (!this.context.audioWorklet)
      throw new Error('Audio worklets are unavailable');
    await this.context.audioWorklet.addModule('/audio/voice-worklet.js');
    if (this.stopped) return;
    await this.context.resume();
    if (this.context.state !== 'running')
      throw new Error('Microphone analysis is suspended');
    this.epoch = Date.now() / 1000 - this.context.currentTime;
    this.source = this.context.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.context, 'rewind-voice-input', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = (event: MessageEvent<AudioFrame>) =>
      this.receive(event.data);
    this.node.onprocessorerror = () => {
      this.update('unavailable');
      this.failed();
    };
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.gain);
    this.gain.connect(this.context.destination);
    this.update('listening');
  }

  private receive(frame: AudioFrame) {
    if (this.stopped || this.suppressed || Date.now() < this.resumeAfter)
      return;
    this.rate = frame.sampleRate;
    const seconds = frame.samples.length / frame.sampleRate;
    let square = 0;
    for (const sample of frame.samples) square += sample * sample;
    const rms = Math.sqrt(square / frame.samples.length);
    const threshold = Math.max(0.008, this.noise * 3);
    const isSpeech = rms >= threshold;
    if (!this.parts.length && !isSpeech) {
      this.noise = this.noise * 0.98 + rms * 0.02;
      this.before.push(frame);
      while (
        this.before.reduce(
          (n, part) => n + part.samples.length / part.sampleRate,
          0,
        ) > PRE_ROLL_SECONDS
      )
        this.before.shift();
      return;
    }
    if (!this.parts.length) {
      this.parts = this.before.map((part) => part.samples);
      this.startedAt = this.epoch + (this.before[0]?.time ?? frame.time);
      this.duration = this.parts.reduce(
        (n, part) => n + part.length / this.rate,
        0,
      );
      this.before = [];
      this.update('hearing');
    }
    this.parts.push(frame.samples);
    this.duration += seconds;
    if (isSpeech) {
      this.voiced += seconds;
      this.quiet = 0;
    } else {
      this.quiet += seconds;
    }
    if (this.quiet >= SILENCE_SECONDS || this.duration >= MAX_UTTERANCE_SECONDS)
      this.flush();
  }

  private flush() {
    const parts = this.parts;
    const at = this.startedAt;
    const valid = this.voiced >= MIN_VOICED_SECONDS;
    this.parts = [];
    this.before = [];
    this.duration = this.voiced = this.quiet = 0;
    if (valid && parts.length) this.utterance(speechWav(parts, this.rate), at);
    if (!this.stopped) this.update('listening');
  }

  suppress(value: boolean) {
    this.suppressed = value;
    this.parts = [];
    this.before = [];
    this.duration = this.voiced = this.quiet = 0;
    // Leave a short gap for the speaker's acoustic tail after speech synthesis.
    this.resumeAfter = value ? 0 : Date.now() + 350;
    if (!this.stopped) this.update('listening');
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.gain?.disconnect();
    void this.context.close().catch(() => {});
    this.update('off');
  }
}
