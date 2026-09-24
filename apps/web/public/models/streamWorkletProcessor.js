/** Audio-thread bridge for asynchronous, bounded denoisers. */
class StreamDenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new Float32Array(16384);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.primed = false;
    this.workerPort = null;
    this.generation = 0;
    this.nextInputSequence = 0;
    this.inputSampleCount = 0;
    this.lastOutputSequence = -1;
    this.port.onmessage = ({ data, ports }) => {
      if (data?.type === "CONNECT" && ports?.[0]) {
        this.workerPort?.close();
        this.generation++;
        const generation = this.generation;
        this.read = this.write = this.available = 0;
        this.primed = false;
        this.nextInputSequence = this.inputSampleCount = 0;
        this.lastOutputSequence = -1;
        this.workerPort = ports[0];
        this.workerPort.onmessage = ({ data: reply }) => {
          if (generation !== this.generation) return;
          if (reply?.type === "RESET") {
            this.read = this.write = this.available = 0;
            this.primed = false;
          } else if (
            reply?.type === "PCM" &&
            reply.pcm instanceof Float32Array
          ) {
            if (
              !Number.isSafeInteger(reply.sequence) ||
              reply.sequence <= this.lastOutputSequence ||
              !Number.isSafeInteger(reply.sampleCount) ||
              reply.sampleCount > this.inputSampleCount
            ) {
              this.port.postMessage({
                type: "ERROR",
                reason: "Invalid inference frame sequence",
              });
              return;
            }
            this.lastOutputSequence = reply.sequence;
            const pcm = reply.pcm;
            if (pcm.length > this.queue.length - this.available) {
              this.read = this.write = this.available = 0;
              this.primed = false;
              this.port.postMessage({ type: "OVERFLOW" });
              return;
            }
            for (let i = 0; i < pcm.length; i++) {
              this.queue[this.write] = pcm[i];
              this.write = (this.write + 1) % this.queue.length;
            }
            this.available += pcm.length;
          } else if (reply?.type === "ERROR") this.port.postMessage(reply);
          else if (reply?.type === "READY") this.port.postMessage(reply);
          else if (reply?.type === "STATS") this.port.postMessage(reply);
        };
        this.workerPort.start();
      } else if (data?.type === "STOP") {
        this.generation++;
        this.workerPort?.postMessage({ type: "STOP" });
        this.workerPort?.close();
        this.workerPort = null;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (input && this.workerPort) {
      const pcm = new Float32Array(input);
      this.inputSampleCount += pcm.length;
      this.workerPort.postMessage({
        type: "PCM",
        pcm,
        sequence: this.nextInputSequence++,
        sampleCount: this.inputSampleCount,
      });
    }
    if (!this.primed && this.available >= 2400) this.primed = true;
    if (!this.primed || this.available < output.length) {
      output.fill(0);
      if (this.primed && this.available < output.length) {
        this.primed = false;
        this.port.postMessage({ type: "UNDERFLOW" });
      }
      return true;
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.queue[this.read];
      this.read = (this.read + 1) % this.queue.length;
    }
    this.available -= output.length;
    return true;
  }
}
registerProcessor("stream-denoise-processor", StreamDenoiseProcessor);
