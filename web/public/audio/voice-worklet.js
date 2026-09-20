/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */
// The output stays silent. Exact consecutive input samples go to the page for
// bounded VAD/utterance encoding; the full MediaRecorder stream is independent.
class RewindVoiceInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.[0]?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.samples[this.offset++] = sample / channels.length;
      if (this.offset === this.samples.length) {
        this.port.postMessage(
          {
            samples: this.samples,
            sampleRate,
            time: (currentFrame + i + 1 - this.samples.length) / sampleRate,
          },
          [this.samples.buffer],
        );
        this.samples = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('rewind-voice-input', RewindVoiceInput);
