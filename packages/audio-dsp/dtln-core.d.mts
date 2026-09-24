export class DtlnProcessor {
  constructor(stage1: any, stage2: any, Tensor: any);
  processedFrames: number;
  reset(): void;
  push48k(input: Float32Array): Promise<Float32Array>;
  processingStats(): { processingMs: number; processingP50Ms: number; processingP95Ms: number; processingP99Ms: number };
}
export const DTLN_FRAME_SIZE: 512;
export const DTLN_HOP_SIZE: 128;
export const DTLN_MODEL_SAMPLE_RATE: 16000;
