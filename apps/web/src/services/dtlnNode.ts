/**
 * DTLN AudioWorklet 节点封装
 * 遵循 Web Audio API 标准规范，支持热启停与强度动态调谐
 */

export class DtlnWorkletNode extends AudioWorkletNode {
  constructor(context: BaseAudioContext) {
    super(context, "dtln-worklet-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
  }

  setEnabled(enabled: boolean) {
    this.port.postMessage({ type: "SET_ENABLED", enabled });
  }

  setIntensity(intensity: number) {
    this.port.postMessage({ type: "SET_INTENSITY", intensity });
  }
}

export async function loadDtlnWorklet(audioContext: AudioContext): Promise<boolean> {
  try {
    if (!audioContext.audioWorklet) return false;
    const base = import.meta.env.BASE_URL || "./";
    const workletUrl = new URL(
      `${base}models/dtln/dtlnWorkletProcessor.js`,
      window.location.href,
    ).toString();
    await audioContext.audioWorklet.addModule(workletUrl);
    return true;
  } catch (err) {
    console.warn("⚠️ DTLN AudioWorklet 模块加载失败:", err);
    return false;
  }
}
