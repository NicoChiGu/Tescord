import { AudioMixerConfig, computeMixGains } from "@tescord/types";

/**
 * 伴音与麦克风原生混音器 (AudioMixer)
 * 利用 Web Audio API 实现游戏/系统音频与麦克风人声在客户端原生合成立体声流推流
 */
export class AudioMixer {
  private audioContext: AudioContext | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private systemSourceNode: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private systemGainNode: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private outputDestination: MediaStreamAudioDestinationNode | null = null;

  public config: AudioMixerConfig = {
    micVolume: 100,
    systemAudioVolume: 85,
    enabled: true,
    stereoDirect: true,
  };

  initContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 48000 });
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  /**
   * 将麦克风流与系统/窗口伴音流在客户端混合为单一立体声 MediaStream
   */
  mixStreams(
    micStream: MediaStream | null,
    systemStream: MediaStream | null,
  ): MediaStream | null {
    if (!micStream && !systemStream) return null;
    if (!systemStream || systemStream.getAudioTracks().length === 0) {
      return micStream;
    }
    if (!micStream || micStream.getAudioTracks().length === 0) {
      return systemStream;
    }

    const ctx = this.initContext();
    this.cleanup();

    this.outputDestination = ctx.createMediaStreamDestination();

    // 软压限器 (DynamicsCompressorNode): 保证双轨全满幅叠加时不发生极端硬削波失真
    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime); // -1 dBFS 门限
    this.limiterNode.knee.setValueAtTime(3.0, ctx.currentTime);
    this.limiterNode.ratio.setValueAtTime(20.0, ctx.currentTime); // 广播级高压缩比
    this.limiterNode.attack.setValueAtTime(0.003, ctx.currentTime); // 3ms 快速响应
    this.limiterNode.release.setValueAtTime(0.1, ctx.currentTime); // 100ms 平滑释放
    this.limiterNode.connect(this.outputDestination);

    // 1. 麦克风通道
    try {
      this.micSourceNode = ctx.createMediaStreamSource(micStream);
      this.micGainNode = ctx.createGain();
      const gains = computeMixGains(
        this.config.micVolume,
        this.config.systemAudioVolume,
      );
      this.micGainNode.gain.setValueAtTime(gains.micGain, ctx.currentTime);
      this.micSourceNode.connect(this.micGainNode);
      this.micGainNode.connect(this.limiterNode);
    } catch (e) {
      console.warn("Failed to connect mic to AudioMixer:", e);
    }

    // 2. 伴音/游戏音频通道 (立体声直通)
    try {
      this.systemSourceNode = ctx.createMediaStreamSource(systemStream);
      this.systemGainNode = ctx.createGain();
      const gains = computeMixGains(
        this.config.micVolume,
        this.config.systemAudioVolume,
      );
      this.systemGainNode.gain.setValueAtTime(
        gains.systemGain,
        ctx.currentTime,
      );
      this.systemSourceNode.connect(this.systemGainNode);
      this.systemGainNode.connect(this.limiterNode);
    } catch (e) {
      console.warn("Failed to connect system audio to AudioMixer:", e);
    }

    return this.outputDestination.stream;
  }

  /**
   * 动态调节麦克风与伴音的增益混合比 (0% - 100%)
   */
  setGains(micVol: number, systemVol: number, isMuted: boolean = false) {
    this.config.micVolume = micVol;
    this.config.systemAudioVolume = systemVol;
    const { micGain, systemGain } = computeMixGains(micVol, systemVol, isMuted);

    if (this.micGainNode && this.audioContext) {
      // 使用平滑过渡参数防止爆音 (Click/Pop Artifacts)
      this.micGainNode.gain.setTargetAtTime(
        micGain,
        this.audioContext.currentTime,
        0.015,
      );
    }
    if (this.systemGainNode && this.audioContext) {
      this.systemGainNode.gain.setTargetAtTime(
        systemGain,
        this.audioContext.currentTime,
        0.015,
      );
    }
  }

  cleanup() {
    if (this.micGainNode) {
      try {
        this.micGainNode.disconnect();
      } catch {}
      this.micGainNode = null;
    }
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch {}
      this.micSourceNode = null;
    }
    if (this.systemGainNode) {
      try {
        this.systemGainNode.disconnect();
      } catch {}
      this.systemGainNode = null;
    }
    if (this.systemSourceNode) {
      try {
        this.systemSourceNode.disconnect();
      } catch {}
      this.systemSourceNode = null;
    }
    if (this.limiterNode) {
      try {
        this.limiterNode.disconnect();
      } catch {}
      this.limiterNode = null;
    }
    this.outputDestination = null;
  }
}

export const audioMixer = new AudioMixer();
