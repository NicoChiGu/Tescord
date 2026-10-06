/* Stereo 48 kHz PCM from scoped WASAPI capture. Bounded ring, no microphone DSP. */
class DisplayAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000 / 4;
    this.samples = new Float32Array(this.capacity * 2);
    this.read = 0;
    this.write = 0;
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || data.length % 2) return;
      const incoming = Math.min(data.length / 2, this.capacity);
      if (this.frames + incoming > this.capacity) {
        const drop = this.frames + incoming - this.capacity;
        this.read = (this.read + drop) % this.capacity;
        this.frames -= drop;
      }
      const offset = data.length / 2 - incoming;
      for (let i = 0; i < incoming; i++) {
        this.samples[this.write * 2] = data[(offset + i) * 2];
        this.samples[this.write * 2 + 1] = data[(offset + i) * 2 + 1];
        this.write = (this.write + 1) % this.capacity;
      }
      this.frames += incoming;
    };
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      if (!this.frames) break;
      for (let channel = 0; channel < channels.length; channel++)
        channels[channel][frame] =
          this.samples[this.read * 2 + Math.min(channel, 1)];
      this.read = (this.read + 1) % this.capacity;
      this.frames--;
    }
    return true;
  }
}
registerProcessor("tescord-display-audio", DisplayAudioProcessor);
