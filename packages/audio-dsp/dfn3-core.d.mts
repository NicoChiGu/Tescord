export class Dfn3Processor {
  constructor(session: any, Tensor: any, meta: any, layout: any, stateBytes: Uint8Array, attenuationLimitDb?: number);
  processedFrames: number;
  reset(): void;
  push48k(input: Float32Array): Promise<Float32Array>;
  processingStats(): { processingMs: number; processingP50Ms: number; processingP95Ms: number; processingP99Ms: number };
}
