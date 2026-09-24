/**
 * DeepFilterNet3 (DFNv3) AudioWorklet 节点封装
 * 遵循 Web Audio API 标准规范，支持热启停、降噪强度与衰减深度动态调谐
 */

export class Dfn3WorkletNode extends AudioWorkletNode {
  constructor(context: BaseAudioContext) {
    super(context, "dfn3-worklet-processor", {
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

  setAttenuationLimit(limitDb: number) {
    this.port.postMessage({ type: "SET_ATTENUATION_LIMIT", limitDb });
  }
}

export async function loadDfn3Worklet(
  audioContext: AudioContext,
): Promise<boolean> {
  try {
    if (!audioContext.audioWorklet) return false;
    const base = import.meta.env.BASE_URL || "./";
    const workletUrl = new URL(
      `${base}models/dfn3/dfn3WorkletProcessor.js`,
      window.location.href,
    ).toString();
    await audioContext.audioWorklet.addModule(workletUrl);
    return true;
  } catch (err) {
    console.warn("⚠️ DFNv3 AudioWorklet 模块加载失败:", err);
    return false;
  }
}
