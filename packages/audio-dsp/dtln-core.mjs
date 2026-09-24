/** Streaming DTLN signal path. The two ONNX sessions are supplied by the host. */
const FRAME = 512;
const HOP = 128;
const INPUT_RATE = 48000;
const MODEL_RATE = 16000;

function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k,
          b = a + size / 2;
        const tr = cr * real[b] - ci * imag[b];
        const ti = cr * imag[b] + ci * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
        const nextR = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nextR;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) real[i] /= n;
}

function lowPassTaps() {
  const count = 63,
    taps = new Float32Array(count),
    center = (count - 1) / 2;
  const cutoff = 7200 / INPUT_RATE;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const x = i - center;
    const sinc =
      x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    taps[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (count - 1)));
    sum += taps[i];
  }
  for (let i = 0; i < count; i++) taps[i] /= sum;
  return taps;
}

export class DtlnProcessor {
  constructor(stage1, stage2, Tensor) {
    this.stage1 = stage1;
    this.stage2 = stage2;
    this.Tensor = Tensor;
    this.taps = lowPassTaps();
    this.reset();
  }

  reset() {
    this.history = new Float32Array(this.taps.length);
    this.historyAt = 0;
    this.decimationPhase = 0;
    this.inputWindow = new Float32Array(FRAME);
    this.inputCount = 0;
    this.outputWindow = new Float32Array(FRAME);
    this.state1 = new Float32Array(512);
    this.state2 = new Float32Array(512);
    this.upsampleHistory = new Float32Array(this.taps.length);
    this.upsampleAt = 0;
    this.processedFrames = 0;
    this.processingTimes = [];
  }

  async push48k(input) {
    if (!(input instanceof Float32Array))
      throw new TypeError("DTLN requires Float32 PCM");
    const output = [];
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      if (!Number.isFinite(sample)) throw new RangeError("Non-finite PCM");
      this.history[this.historyAt] = sample;
      this.historyAt = (this.historyAt + 1) % this.history.length;
      if (this.decimationPhase === 0) {
        let value = 0;
        for (let k = 0; k < this.taps.length; k++) {
          const at =
            (this.historyAt - 1 - k + this.history.length) %
            this.history.length;
          value += this.history[at] * this.taps[k];
        }
        this.inputWindow.copyWithin(0, 1);
        this.inputWindow[FRAME - 1] = value;
        this.inputCount++;
        // The official streaming reference starts with a zero-filled 512-sample
        // window and runs the first inference after the first 128 real samples.
        if (this.inputCount % HOP === 0) {
          const hop = await this.processFrame();
          for (const sample of this.upsample16k(hop)) output.push(sample);
        }
      }
      this.decimationPhase = (this.decimationPhase + 1) % 3;
    }
    return Float32Array.from(output);
  }

  upsample16k(input) {
    const output = new Float32Array(input.length * 3);
    for (let i = 0; i < input.length; i++) {
      for (let phase = 0; phase < 3; phase++) {
        this.upsampleHistory[this.upsampleAt] = phase === 0 ? input[i] : 0;
        this.upsampleAt = (this.upsampleAt + 1) % this.taps.length;
        let value = 0;
        for (let k = 0; k < this.taps.length; k++) {
          const at =
            (this.upsampleAt - 1 - k + this.taps.length) % this.taps.length;
          value += this.upsampleHistory[at] * this.taps[k];
        }
        output[i * 3 + phase] = value * 3;
      }
    }
    return output;
  }

  async processFrame() {
    const started = performance.now();
    const re = Float32Array.from(this.inputWindow),
      im = new Float32Array(FRAME);
    fft(re, im);
    const magnitude = new Float32Array(FRAME / 2 + 1);
    for (let k = 0; k < magnitude.length; k++)
      magnitude[k] = Math.hypot(re[k], im[k]);
    const one = await this.stage1.run({
      input_2: new this.Tensor("float32", magnitude, [1, 1, magnitude.length]),
      input_3: new this.Tensor("float32", this.state1, [1, 2, 128, 2]),
    });
    const mask = one.activation_2.data;
    this.state1 = Float32Array.from(one.tf_op_layer_stack_2.data);
    for (let k = 0; k < magnitude.length; k++) {
      re[k] *= mask[k];
      im[k] *= mask[k];
      if (k > 0 && k < FRAME / 2) {
        re[FRAME - k] = re[k];
        im[FRAME - k] = -im[k];
      }
    }
    fft(re, im, true);
    const two = await this.stage2.run({
      input_4: new this.Tensor("float32", re, [1, 1, FRAME]),
      input_5: new this.Tensor("float32", this.state2, [1, 2, 128, 2]),
    });
    this.state2 = Float32Array.from(two.tf_op_layer_stack_5.data);
    const enhanced = two.conv1d_3.data;
    this.outputWindow.copyWithin(0, HOP);
    this.outputWindow.fill(0, FRAME - HOP);
    for (let i = 0; i < FRAME; i++) this.outputWindow[i] += enhanced[i];
    this.processedFrames++;
    this.processingTimes.push(performance.now() - started);
    if (this.processingTimes.length > 256) this.processingTimes.shift();
    return this.outputWindow.slice(0, HOP);
  }

  processingStats() {
    const sorted = [...this.processingTimes].sort((a, b) => a - b);
    const at = (fraction) =>
      sorted[
        Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
      ] ?? 0;
    return {
      processingMs: sorted.at(-1) ?? 0,
      processingP50Ms: at(0.5),
      processingP95Ms: at(0.95),
      processingP99Ms: at(0.99),
    };
  }
}

export const DTLN_FRAME_SIZE = FRAME;
export const DTLN_HOP_SIZE = HOP;
export const DTLN_MODEL_SAMPLE_RATE = MODEL_RATE;
