class VoicePostProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "VAD";
    this.muted = false;
    this.ptt = false;
    this.sensitivity = 25;
    this.envelope = 1;
    this.holdSamples = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type !== "CONFIG") return;
      this.mode = data.mode === "PTT" ? "PTT" : "VAD";
      this.muted = data.muted === true;
      this.ptt = data.ptt === true;
      this.sensitivity = Math.max(
        0,
        Math.min(100, Number(data.sensitivity) || 0),
      );
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    let sum = 0;
    for (const sample of input) sum += sample * sample;
    const rms = Math.sqrt(sum / input.length);
    const threshold = Math.pow(10, (-55 + this.sensitivity * 0.4) / 20);
    if (rms >= threshold) this.holdSamples = Math.round(sampleRate * 0.25);
    else this.holdSamples = Math.max(0, this.holdSamples - input.length);
    const speech = this.holdSamples > 0;
    const hardClosed = this.muted || (this.mode === "PTT" && !this.ptt);
    const target = hardClosed
      ? 0
      : this.mode === "PTT" || speech
        ? 1
        : Math.pow(10, -12 / 20);
    const seconds = target > this.envelope ? 0.005 : 0.15;
    const coefficient = Math.exp(-1 / (seconds * sampleRate));
    for (let i = 0; i < output.length; i++) {
      this.envelope = target + coefficient * (this.envelope - target);
      const value = input[i] * this.envelope;
      const magnitude = Math.abs(value);
      const limited =
        magnitude <= 0.7
          ? magnitude
          : 0.7 +
            (0.89125 - 0.7) *
              (1 - Math.exp(-(magnitude - 0.7) / (0.89125 - 0.7)));
      output[i] = Math.sign(value) * limited;
    }
    return true;
  }
}
registerProcessor("tescord-voice-post", VoicePostProcessor);
