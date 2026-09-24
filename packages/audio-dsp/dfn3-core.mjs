/** DeepFilterNet3 torchDF stateful ONNX frame adapter (512 samples at 48 kHz). */
export class Dfn3Processor {
  constructor(
    session,
    Tensor,
    meta,
    layout,
    stateBytes,
    attenuationLimitDb = 12,
  ) {
    if (
      meta.sample_rate !== 48000 ||
      meta.frame_size !== 512 ||
      meta.input_names.length !== 13 ||
      meta.output_names.length !== 13
    )
      throw new Error("Unsupported DeepFilterNet3 model contract");
    this.session = session;
    this.Tensor = Tensor;
    this.meta = meta;
    this.layout = layout;
    this.initialBytes = stateBytes;
    this.dryWeight = Math.pow(10, -attenuationLimitDb / 20);
    this.reset();
  }

  reset() {
    this.state = {};
    const view = new DataView(
      this.initialBytes.buffer,
      this.initialBytes.byteOffset,
      this.initialBytes.byteLength,
    );
    for (const name of this.meta.input_names.slice(1)) {
      const item = this.layout[name];
      if (!item || item.byteLength % 4)
        throw new Error(`Invalid DFN3 state ${name}`);
      const values = new Float32Array(item.byteLength / 4);
      for (let i = 0; i < values.length; i++)
        values[i] = view.getFloat32(item.byteOffset + i * 4, true);
      this.state[name] = values;
    }
    this.pending = new Float32Array(512);
    this.pendingLength = 0;
    this.lastDry = new Float32Array(512);
    this.processedFrames = 0;
    this.processingTimes = [];
  }

  async push48k(input) {
    if (!(input instanceof Float32Array))
      throw new TypeError("DFN3 requires Float32 PCM");
    const output = [];
    for (let i = 0; i < input.length; i++) {
      if (!Number.isFinite(input[i])) throw new RangeError("Non-finite PCM");
      this.pending[this.pendingLength++] = input[i];
      if (this.pendingLength === 512) {
        const chunk = await this.processFrame(this.pending);
        for (let j = 0; j < chunk.length; j++) output.push(chunk[j]);
        this.pendingLength = 0;
      }
    }
    return Float32Array.from(output);
  }

  async processFrame(frame) {
    const started = performance.now();
    const feeds = {
      input_frame: new this.Tensor("float32", Float32Array.from(frame), [512]),
    };
    for (const name of this.meta.input_names.slice(1)) {
      feeds[name] = new this.Tensor(
        "float32",
        this.state[name],
        this.layout[name].shape,
      );
    }
    const result = await this.session.run(feeds);
    const enhanced = result.enhanced_audio_frame?.data;
    if (!enhanced || enhanced.length !== 512)
      throw new Error("DFN3 returned an invalid frame");
    for (let i = 1; i < this.meta.input_names.length; i++) {
      const name = this.meta.input_names[i];
      const outputName = this.meta.output_names[i];
      const tensor = result[outputName];
      if (!tensor || tensor.data.length !== this.state[name].length)
        throw new Error(`DFN3 returned an invalid state: ${name}`);
      this.state[name] = Float32Array.from(tensor.data);
    }
    const out = new Float32Array(512);
    for (let i = 0; i < out.length; i++) {
      out[i] =
        this.dryWeight * this.lastDry[i] + (1 - this.dryWeight) * enhanced[i];
      if (!Number.isFinite(out[i]))
        throw new Error("DFN3 produced non-finite PCM");
    }
    this.lastDry.set(frame);
    this.processedFrames++;
    this.processingTimes.push(performance.now() - started);
    if (this.processingTimes.length > 256) this.processingTimes.shift();
    return out;
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
