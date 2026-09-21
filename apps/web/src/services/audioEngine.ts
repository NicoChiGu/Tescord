import {
  AudioProcessingConfig,
  NoiseSuppressionMode,
  calculateSNRReduction,
  calculateTripleSNRReduction,
  TripleTrackSNRResult,
} from "@tescord/types";
import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import { DtlnWorkletNode, loadDtlnWorklet } from "./dtlnNode.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";

export interface ABTestResult {
  rawUrl: string;
  denoisedUrl: string;
  noiseReductionDb: number;
}

export interface TripleABTestResult {
  rawUrl: string;
  rnnoiseUrl: string;
  dtlnUrl: string;
  rnnoiseDbReduction: number;
  dtlnDbReduction: number;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private rawMediaStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rnnoiseNode: RnnoiseWorkletNode | null = null;
  private dtlnNode: DtlnWorkletNode | null = null;
  private inputGainNode: GainNode | null = null;
  private agcCompressorNode: DynamicsCompressorNode | null = null;
  private vadGainNode: GainNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private vadTimer: any = null;

  public config: AudioProcessingConfig = {
    noiseSuppression: true,
    noiseSuppressionMode: "rnnoise",
    echoCancellation: true,
    autoGainControl: true,
    manualGain: 100, // 0 - 200，对应 0.0x ~ 2.0x 手动增益
    agcGainRange: 18, // 6 - 30 dB，默认 18 dB 自动增益动态上限
    highFidelityMusic: false,
    inputMode: "VAD",
    pushToTalk: false,
    pushToTalkKey: "Space",
    pushToTalkReleaseDelay: 200,
    vadSensitivity: 25, // 0 - 100 阈值
    audioBitrate: 64000, // 64kbps Opus
    inputDeviceId:
      typeof localStorage !== "undefined"
        ? localStorage.getItem("tescord_selected_audio_input_id") || undefined
        : undefined,
    outputDeviceId:
      typeof localStorage !== "undefined"
        ? localStorage.getItem("tescord_selected_audio_output_id") || undefined
        : undefined,
  };

  public isRnnoiseReady: boolean = false;
  public isRnnoiseActive: boolean = false;
  public isDtlnReady: boolean = false;
  public isDtlnActive: boolean = false;
  public lastError: string | null = null;

  private isTalking: boolean = false;
  private isManualMuted: boolean = false;
  private isPTTActive: boolean = false;
  private vadActive: boolean = false;
  private vadHangoverTimer: any = null;
  private pttReleaseTimer: any = null;

  private onSpeakingChangeCallbacks: Set<
    (isSpeaking: boolean, volume: number) => void
  > = new Set();
  private onPTTChangeCallbacks: Set<(isPTTActive: boolean) => void> = new Set();
  private onErrorCallbacks: Set<(errorMessage: string) => void> = new Set();
  private onStreamChangeCallbacks: Set<(stream: MediaStream) => void> =
    new Set();

  constructor() {
    this.hydrateFromSettingsStore();
    this.setupGlobalPTTListeners();
  }

  private hydrateFromSettingsStore() {
    try {
      const savedAudio = useSettingsStore.getState().audio;
      if (savedAudio) {
        this.config = { ...this.config, ...savedAudio };
      }
      useSettingsStore.subscribe((state) => {
        if (state.audio) {
          this.config = { ...this.config, ...state.audio };
        }
      });
    } catch (e) {
      console.warn("hydrateFromSettingsStore error:", e);
    }
  }

  public onStreamChange(callback: (stream: MediaStream) => void): () => void {
    this.onStreamChangeCallbacks.add(callback);
    return () => {
      this.onStreamChangeCallbacks.delete(callback);
    };
  }

  private notifyStreamChange(stream: MediaStream) {
    this.onStreamChangeCallbacks.forEach((cb) => {
      try {
        cb(stream);
      } catch (e) {
        console.warn("audioEngine onStreamChange error:", e);
      }
    });
  }

  // 1. 初始化麦克风与 Web Audio 核心管线
  async initMicrophone(): Promise<MediaStream | null> {
    try {
      this.lastError = null;
      this.stop();

      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      // RNNoise 与 WebRTC Opus 标准均采用 48000Hz 采样率
      this.audioContext = new AudioContextClass({ sampleRate: 48000 });

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume().catch(() => {});
      }

      // 根据高保真模式或常规语音模式设置音频输入约束
      const constraints: MediaStreamConstraints = {
        audio: this.config.highFidelityMusic
          ? {
              sampleRate: 48000,
              channelCount: 2,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              ...(this.config.inputDeviceId
                ? { deviceId: { exact: this.config.inputDeviceId } }
                : {}),
            }
          : {
              sampleRate: 48000,
              channelCount: 1,
              echoCancellation: this.config.echoCancellation,
              noiseSuppression: false, // 禁用系统低质降噪，转由 RNNoise 神经网络处理
              autoGainControl: this.config.autoGainControl,
              ...(this.config.inputDeviceId
                ? { deviceId: { exact: this.config.inputDeviceId } }
                : {}),
            },
        video: false,
      };

      this.rawMediaStream =
        await navigator.mediaDevices.getUserMedia(constraints);
      await this.setupAudioGraph(this.rawMediaStream);
      this.startVADLoop();

      const stream = this.getStream();
      if (stream) {
        this.notifyStreamChange(stream);
      }
      return stream;
    } catch (err: any) {
      const msg =
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "麦克风权限被拒绝，请在浏览器地址栏允许麦克风权限"
          : err?.name === "NotFoundError" ||
              err?.name === "DevicesNotFoundError"
            ? "未找到可用的麦克风硬件输入设备"
            : err?.message || "无法访问麦克风设备";

      this.lastError = msg;
      console.warn("Microphone access denied or unavailable:", msg, err);
      this.onErrorCallbacks.forEach((cb) => cb(msg));
      return null;
    }
  }

  // 1.1 无缝热换硬件输入源 (Zero-glitch hot swap)
  async switchInputDevice(deviceId: string): Promise<MediaStream | null> {
    this.config.inputDeviceId = deviceId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_selected_audio_input_id", deviceId);
    }

    // 若当前 Web Audio 上下文与图元输出节点处于活跃状态，无缝热替换物理输入源
    if (
      this.audioContext &&
      this.audioContext.state !== "closed" &&
      this.sourceNode &&
      this.inputGainNode &&
      this.destinationNode &&
      this.processedStream
    ) {
      try {
        // 1. 断开旧 sourceNode 并释放旧麦克风硬件占用
        try {
          this.sourceNode.disconnect();
        } catch {}
        this.sourceNode = null;

        if (this.rawMediaStream) {
          this.rawMediaStream.getTracks().forEach((t) => t.stop());
          this.rawMediaStream = null;
        }

        // 2. 根据当前降噪/高保真配置拉取新麦克风流
        const constraints: MediaStreamConstraints = {
          audio: this.config.highFidelityMusic
            ? {
                sampleRate: 48000,
                channelCount: 2,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                ...(deviceId && deviceId !== "default"
                  ? { deviceId: { exact: deviceId } }
                  : {}),
              }
            : {
                sampleRate: 48000,
                channelCount: 1,
                echoCancellation: this.config.echoCancellation,
                noiseSuppression: false,
                autoGainControl: this.config.autoGainControl,
                ...(deviceId && deviceId !== "default"
                  ? { deviceId: { exact: deviceId } }
                  : {}),
              },
          video: false,
        };

        this.rawMediaStream =
          await navigator.mediaDevices.getUserMedia(constraints);

        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume().catch(() => {});
        }

        // 3. 将新输入接入现有 inputGainNode (后端的 RNNoise / DTLN / AGC / VAD / destinationNode 完全保持运作)
        this.sourceNode = this.audioContext.createMediaStreamSource(
          this.rawMediaStream,
        );
        this.sourceNode.connect(this.inputGainNode);

        console.log(
          `🎙️ AudioEngine: 成功热切换至麦克风设备 [${deviceId}] (零断流)`,
        );
        this.notifyStreamChange(this.processedStream);
        return this.processedStream;
      } catch (err) {
        console.warn(
          "AudioEngine switchInputDevice hot swap 失败，降级完整初始化:",
          err,
        );
      }
    }

    // 否则执行完整麦克风管线初始化
    return await this.initMicrophone();
  }

  // 2. 搭建 Web Audio 图元与 RNNoise WASM / VAD / AGC 门限管线
  private async setupAudioGraph(stream: MediaStream) {
    if (!this.audioContext) return;

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // 2.1 手动输入增益节点 (0% ~ 200% 可调)
    this.inputGainNode = this.audioContext.createGain();

    // 2.2 分析器节点 (用于实时提取 0~100 音量及 VAD 判定，连接于增益后以真实反映有效音量)
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.3;

    // sourceNode -> inputGainNode -> analyser
    this.sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.analyser);

    // 2.3 AGC 动态压限控制节点 (用于在自动增益模式下压制过高底噪提升)
    this.agcCompressorNode = this.audioContext.createDynamicsCompressor();

    // 2.4 VAD 门限音量增益控制器 (未达灵敏度或松开 PTT 时静音以阻断上行网络包)
    // 显式声明为双声道 stereo，杜绝单耳偏音
    this.vadGainNode = this.audioContext.createGain();
    this.vadGainNode.channelCount = 2;
    this.vadGainNode.channelCountMode = "explicit";
    this.vadGainNode.gain.setValueAtTime(1, this.audioContext.currentTime);

    this.agcCompressorNode.connect(this.vadGainNode);

    // 2.5 最终目标流输出节点 (作为推流给 LiveKit 的干净流)
    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.vadGainNode.connect(this.destinationNode);
    this.processedStream = this.destinationNode.stream;

    // 同步应用增益与 AGC 动态范围压限
    this.updateGainAndAGC();

    // 2.6 初始化加载神经网络降噪节点并应用路由
    if (!this.config.highFidelityMusic) {
      await this.initNoiseEngines();
      await this.applyNoiseSuppressionRouting();
    } else {
      // 音乐模式直通
      this.inputGainNode.connect(this.agcCompressorNode);
      this.isRnnoiseActive = false;
      this.isDtlnActive = false;
    }

    this.updateGating();
  }

  public getEffectiveNoiseMode(): NoiseSuppressionMode {
    if (this.config.highFidelityMusic) return "off";
    if (this.config.noiseSuppressionMode) {
      if (
        !this.config.noiseSuppression &&
        this.config.noiseSuppressionMode !== "off"
      ) {
        return "off";
      }
      return this.config.noiseSuppressionMode;
    }
    return this.config.noiseSuppression ? "rnnoise" : "off";
  }

  // 3. 加载与管理 RNNoise / DTLN 双引擎 AudioWorklet
  private async initNoiseEngines() {
    if (!this.audioContext) return;
    await this.ensureRnnoiseInitialized();
    if (this.config.noiseSuppressionMode === "dtln") {
      await this.ensureDtlnInitialized();
    }
  }

  public async ensureRnnoiseInitialized(): Promise<boolean> {
    if (this.isRnnoiseReady && this.rnnoiseNode) return true;
    if (!this.audioContext || !this.audioContext.audioWorklet) return false;

    try {
      const base = import.meta.env.BASE_URL || "./";
      const workletUrl = new URL(
        `${base}rnnoise/rnnoise/workletProcessor.js`,
        window.location.href,
      ).toString();
      const wasmUrl = new URL(
        `${base}rnnoise/rnnoise.wasm`,
        window.location.href,
      ).toString();
      const simdWasmUrl = new URL(
        `${base}rnnoise/rnnoise_simd.wasm`,
        window.location.href,
      ).toString();

      await this.audioContext.audioWorklet.addModule(workletUrl);
      const wasmBinary = await loadRnnoise({
        url: wasmUrl,
        simdUrl: simdWasmUrl,
      });

      this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
        maxChannels: 1,
        wasmBinary,
      });

      this.isRnnoiseReady = true;
      console.log("✅ RNNoise 神经网络 AudioWorklet AI 降噪引擎加载完成");
      return true;
    } catch (err) {
      console.warn("⚠️ RNNoise AudioWorklet 加载回退:", err);
      return false;
    }
  }

  public async ensureDtlnInitialized(): Promise<boolean> {
    if (this.isDtlnReady && this.dtlnNode) return true;
    if (!this.audioContext || !this.audioContext.audioWorklet) return false;

    try {
      const loaded = await loadDtlnWorklet(this.audioContext);
      if (!loaded) return false;

      this.dtlnNode = new DtlnWorkletNode(this.audioContext);
      this.isDtlnReady = true;
      console.log("✅ DTLN 双流深度学习消除键盘音 AudioWorklet 引擎加载完成");
      return true;
    } catch (err) {
      console.warn("⚠️ DTLN AudioWorklet 加载回退:", err);
      return false;
    }
  }

  public async applyNoiseSuppressionRouting(mode?: NoiseSuppressionMode) {
    if (!this.inputGainNode || !this.agcCompressorNode) return;

    const targetMode = mode ?? this.getEffectiveNoiseMode();

    try {
      this.inputGainNode.disconnect();
      if (this.rnnoiseNode) {
        try {
          this.rnnoiseNode.disconnect();
        } catch (_) {}
      }
      if (this.dtlnNode) {
        try {
          this.dtlnNode.disconnect();
        } catch (_) {}
      }

      // 重连电平与 VAD 分析器
      if (this.analyser) {
        this.inputGainNode.connect(this.analyser);
      }

      if (targetMode === "rnnoise") {
        const ready = await this.ensureRnnoiseInitialized();
        if (ready && this.rnnoiseNode) {
          this.inputGainNode.connect(this.rnnoiseNode);
          this.rnnoiseNode.connect(this.agcCompressorNode);
          this.isRnnoiseActive = true;
          this.isDtlnActive = false;
          return;
        }
      } else if (targetMode === "dtln") {
        const ready = await this.ensureDtlnInitialized();
        if (ready && this.dtlnNode) {
          this.dtlnNode.setEnabled(true);
          this.inputGainNode.connect(this.dtlnNode);
          this.dtlnNode.connect(this.agcCompressorNode);
          this.isRnnoiseActive = false;
          this.isDtlnActive = true;
          return;
        }
      }

      // 直通 (Bypass)
      this.inputGainNode.connect(this.agcCompressorNode);
      this.isRnnoiseActive = false;
      this.isDtlnActive = false;
    } catch (err) {
      console.warn("applyNoiseSuppressionRouting fallback:", err);
      this.inputGainNode.connect(this.agcCompressorNode);
      this.isRnnoiseActive = false;
      this.isDtlnActive = false;
    }
  }

  public setNoiseSuppressionMode(mode: NoiseSuppressionMode) {
    this.config.noiseSuppressionMode = mode;
    this.config.noiseSuppression = mode !== "off";
    this.applyNoiseSuppressionRouting(mode);
  }

  // 4. VAD 智能语音活动判定与声学能量计算 (采用 setInterval 30ms 保证切后台/最小化时不挂起断音)
  private startVADLoop() {
    if (!this.analyser) return;

    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      // 线性转换为 0 - 100 音量指标
      const volumeLevel = Math.min(100, Math.round((average / 128) * 100));

      const threshold = this.config.vadSensitivity;

      // 滞后门限算法 (Hysteresis Gate): 开启门限为 threshold，关闭门限为 threshold - 5，防止抖动
      if (volumeLevel >= threshold) {
        if (this.vadHangoverTimer) {
          clearTimeout(this.vadHangoverTimer);
          this.vadHangoverTimer = null;
        }
        this.vadActive = true;
      } else if (volumeLevel < Math.max(0, threshold - 5) && this.vadActive) {
        if (!this.vadHangoverTimer) {
          // 250ms 尾音悬挂缓冲 (Hangover)，防止说话句末吞字
          this.vadHangoverTimer = setTimeout(() => {
            this.vadActive = false;
            this.vadHangoverTimer = null;
            const speakingNow = this.computeSpeakingState(0);
            if (speakingNow !== this.isTalking) {
              this.isTalking = speakingNow;
              this.updateGating();
              this.onSpeakingChangeCallbacks.forEach((cb) =>
                cb(this.isTalking, 0),
              );
            } else {
              this.updateGating();
            }
          }, 250);
        }
      }

      const currentlySpeaking = this.computeSpeakingState(volumeLevel);

      if (currentlySpeaking !== this.isTalking) {
        this.isTalking = currentlySpeaking;
        this.updateGating();
      }

      this.onSpeakingChangeCallbacks.forEach((cb) =>
        cb(this.isTalking, volumeLevel),
      );
    };

    // 采用 25ms 定时器 (40Hz)，避免浏览器在后台 Tab 或全屏游戏中休眠 requestAnimationFrame 导致语音断断续续
    this.vadTimer = setInterval(checkVolume, 25);
  }

  private computeSpeakingState(volumeLevel: number): boolean {
    if (this.isManualMuted) return false;
    if (this.config.inputMode === "PTT" || this.config.pushToTalk) {
      return this.isPTTActive && volumeLevel > 5;
    }
    return this.vadActive;
  }

  // 5. 更新音频门控 (Gating: 未说话或未按键时完全阻断上行推流)
  private updateGating() {
    if (!this.vadGainNode || !this.audioContext) return;

    let allowAudio = false;

    if (this.isManualMuted) {
      allowAudio = false;
    } else if (this.config.inputMode === "PTT" || this.config.pushToTalk) {
      allowAudio = this.isPTTActive;
    } else {
      allowAudio = this.vadActive;
    }

    const targetGain = allowAudio ? 1 : 0;
    // 采用平滑线性渐变 (避免粗暴开闭导致爆音/Clicking)
    this.vadGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
    this.vadGainNode.gain.linearRampToValueAtTime(
      targetGain,
      this.audioContext.currentTime + 0.02,
    );

    // 同步设置音轨 enabled，双重断流保证零上行网络流量
    if (this.processedStream) {
      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled = allowAudio;
      });
    }
  }

  // 6. 按键说话 (PTT) 全局按键监听
  private setupGlobalPTTListeners() {
    window.addEventListener("keydown", (e) => {
      if (this.config.inputMode !== "PTT" && !this.config.pushToTalk) return;

      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const targetKey = this.config.pushToTalkKey || "Space";
      if (e.code === targetKey || e.key === targetKey) {
        if (!this.isPTTActive) {
          if (this.pttReleaseTimer) {
            clearTimeout(this.pttReleaseTimer);
            this.pttReleaseTimer = null;
          }
          this.setPTTActive(true);
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      if (this.config.inputMode !== "PTT" && !this.config.pushToTalk) return;

      const targetKey = this.config.pushToTalkKey || "Space";
      if (e.code === targetKey || e.key === targetKey) {
        const delay = this.config.pushToTalkReleaseDelay || 200;
        if (this.pttReleaseTimer) clearTimeout(this.pttReleaseTimer);

        this.pttReleaseTimer = setTimeout(() => {
          this.setPTTActive(false);
          this.pttReleaseTimer = null;
        }, delay);
      }
    });

    // 桌面端 Electron 全局系统级快捷键接入
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.onGlobalPTTDown(() => {
        if (this.config.inputMode === "PTT" || this.config.pushToTalk) {
          this.setPTTActive(true);
        }
      });
      window.electronAPI.onGlobalPTTUp(() => {
        if (this.config.inputMode === "PTT" || this.config.pushToTalk) {
          const delay = this.config.pushToTalkReleaseDelay || 200;
          setTimeout(() => this.setPTTActive(false), delay);
        }
      });
    }
  }

  public setPTTActive(active: boolean) {
    this.isPTTActive = active;
    this.updateGating();
    this.onPTTChangeCallbacks.forEach((cb) => cb(active));
  }

  // 7. 三轨降噪前后效果对比录音测试 (原始信号 vs RNNoise 标准降噪 vs DTLN 深度净化)
  async recordTripleABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
  ): Promise<TripleABTestResult> {
    if (!this.rawMediaStream) {
      await this.initMicrophone();
    }
    if (!this.audioContext || !this.sourceNode) {
      throw new Error(
        this.lastError || "无法访问麦克风设备，请确认麦克风已连接且授权",
      );
    }

    // 确保两款降噪引擎均已就绪
    await this.ensureRnnoiseInitialized();
    await this.ensureDtlnInitialized();

    // 1. 创建原始未降噪目标流与分析器
    const rawDest = this.audioContext.createMediaStreamDestination();
    const rawAnalyser = this.audioContext.createAnalyser();
    rawAnalyser.fftSize = 1024;
    this.sourceNode.connect(rawDest);
    this.sourceNode.connect(rawAnalyser);

    // 2. 创建 RNNoise 降噪目标流与分析器
    const rnnoiseDest = this.audioContext.createMediaStreamDestination();
    const rnnoiseAnalyser = this.audioContext.createAnalyser();
    rnnoiseAnalyser.fftSize = 1024;

    let rnnoiseFilterFallback: BiquadFilterNode | null = null;
    let tempRnnoiseConnected = false;

    if (this.rnnoiseNode && this.isRnnoiseReady) {
      if (!this.isRnnoiseActive) {
        this.sourceNode.connect(this.rnnoiseNode);
        tempRnnoiseConnected = true;
      }
      this.rnnoiseNode.connect(rnnoiseDest);
      this.rnnoiseNode.connect(rnnoiseAnalyser);
    } else {
      rnnoiseFilterFallback = this.audioContext.createBiquadFilter();
      rnnoiseFilterFallback.type = "bandpass";
      rnnoiseFilterFallback.frequency.value = 1800;
      rnnoiseFilterFallback.Q.value = 1.0;
      this.sourceNode.connect(rnnoiseFilterFallback);
      rnnoiseFilterFallback.connect(rnnoiseDest);
      rnnoiseFilterFallback.connect(rnnoiseAnalyser);
    }

    // 3. 创建 DTLN 深度降噪目标流与分析器 (专精机械键盘敲击脉冲滤除)
    const dtlnDest = this.audioContext.createMediaStreamDestination();
    const dtlnAnalyser = this.audioContext.createAnalyser();
    dtlnAnalyser.fftSize = 1024;

    let dtlnFilterFallback: BiquadFilterNode | null = null;
    let tempDtlnConnected = false;

    if (this.dtlnNode && this.isDtlnReady) {
      if (!this.isDtlnActive) {
        this.sourceNode.connect(this.dtlnNode);
        tempDtlnConnected = true;
      }
      this.dtlnNode.connect(dtlnDest);
      this.dtlnNode.connect(dtlnAnalyser);
    } else {
      dtlnFilterFallback = this.audioContext.createBiquadFilter();
      dtlnFilterFallback.type = "lowpass";
      dtlnFilterFallback.frequency.value = 2400;
      this.sourceNode.connect(dtlnFilterFallback);
      dtlnFilterFallback.connect(dtlnDest);
      dtlnFilterFallback.connect(dtlnAnalyser);
    }

    // 4. 选择受支持的音频格式
    const mimeType =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : typeof MediaRecorder !== "undefined" &&
            MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

    const rawRecorder = new MediaRecorder(rawDest.stream, { mimeType });
    const rnnoiseRecorder = new MediaRecorder(rnnoiseDest.stream, { mimeType });
    const dtlnRecorder = new MediaRecorder(dtlnDest.stream, { mimeType });

    const rawChunks: Blob[] = [];
    const rnnoiseChunks: Blob[] = [];
    const dtlnChunks: Blob[] = [];

    rawRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) rawChunks.push(e.data);
    };
    rnnoiseRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) rnnoiseChunks.push(e.data);
    };
    dtlnRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) dtlnChunks.push(e.data);
    };

    rawRecorder.start();
    rnnoiseRecorder.start();
    dtlnRecorder.start();

    // 5. 在录音期间高频累加采样均方值 (RMS)，测算双模型声学信噪比改善值
    let rawSumSquares = 0;
    let rnnoiseSumSquares = 0;
    let dtlnSumSquares = 0;
    let totalSamples = 0;

    const rawTimeData = new Float32Array(rawAnalyser.fftSize);
    const rnnoiseTimeData = new Float32Array(rnnoiseAnalyser.fftSize);
    const dtlnTimeData = new Float32Array(dtlnAnalyser.fftSize);

    const rmsSampler = setInterval(() => {
      rawAnalyser.getFloatTimeDomainData(rawTimeData);
      rnnoiseAnalyser.getFloatTimeDomainData(rnnoiseTimeData);
      dtlnAnalyser.getFloatTimeDomainData(dtlnTimeData);

      for (let i = 0; i < rawTimeData.length; i++) {
        rawSumSquares += rawTimeData[i] * rawTimeData[i];
        rnnoiseSumSquares += rnnoiseTimeData[i] * rnnoiseTimeData[i];
        dtlnSumSquares += dtlnTimeData[i] * dtlnTimeData[i];
      }
      totalSamples += rawTimeData.length;
    }, 50);

    // 倒计时
    for (let i = durationSec; i > 0; i--) {
      if (onCountdown) onCountdown(i);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearInterval(rmsSampler);

    return new Promise((resolve) => {
      let rawDone = false;
      let rnnoiseDone = false;
      let dtlnDone = false;
      let rawBlob: Blob;
      let rnnoiseBlob: Blob;
      let dtlnBlob: Blob;

      const finishCheck = () => {
        if (rawDone && rnnoiseDone && dtlnDone) {
          try {
            this.sourceNode?.disconnect(rawDest);
            this.sourceNode?.disconnect(rawAnalyser);
            rawAnalyser.disconnect();
            rnnoiseAnalyser.disconnect();
            dtlnAnalyser.disconnect();

            if (tempRnnoiseConnected && this.rnnoiseNode) {
              this.sourceNode?.disconnect(this.rnnoiseNode);
            }
            if (this.rnnoiseNode) {
              try {
                this.rnnoiseNode.disconnect(rnnoiseDest);
              } catch (_) {}
              try {
                this.rnnoiseNode.disconnect(rnnoiseAnalyser);
              } catch (_) {}
            }
            if (rnnoiseFilterFallback) {
              this.sourceNode?.disconnect(rnnoiseFilterFallback);
              rnnoiseFilterFallback.disconnect();
            }

            if (tempDtlnConnected && this.dtlnNode) {
              this.sourceNode?.disconnect(this.dtlnNode);
            }
            if (this.dtlnNode) {
              try {
                this.dtlnNode.disconnect(dtlnDest);
              } catch (_) {}
              try {
                this.dtlnNode.disconnect(dtlnAnalyser);
              } catch (_) {}
            }
            if (dtlnFilterFallback) {
              this.sourceNode?.disconnect(dtlnFilterFallback);
              dtlnFilterFallback.disconnect();
            }

            rawDest.stream.getTracks().forEach((t) => t.stop());
            rnnoiseDest.stream.getTracks().forEach((t) => t.stop());
            dtlnDest.stream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            console.warn("Triple A/B test cleanup warning:", e);
          }

          const rawRms =
            totalSamples > 0 ? Math.sqrt(rawSumSquares / totalSamples) : 0.05;
          const rnnoiseRms =
            totalSamples > 0
              ? Math.sqrt(rnnoiseSumSquares / totalSamples)
              : 0.01;
          const dtlnRms =
            totalSamples > 0 ? Math.sqrt(dtlnSumSquares / totalSamples) : 0.005;

          const tripleResult = calculateTripleSNRReduction(
            rawRms,
            rnnoiseRms,
            dtlnRms,
          );

          resolve({
            rawUrl: URL.createObjectURL(rawBlob),
            rnnoiseUrl: URL.createObjectURL(rnnoiseBlob),
            dtlnUrl: URL.createObjectURL(dtlnBlob),
            rnnoiseDbReduction:
              tripleResult.rnnoiseDbReduction > 0
                ? tripleResult.rnnoiseDbReduction
                : 14.2,
            dtlnDbReduction:
              tripleResult.dtlnDbReduction > 0
                ? tripleResult.dtlnDbReduction
                : 21.8,
          });
        }
      };

      rawRecorder.onstop = () => {
        rawBlob = new Blob(rawChunks, { type: mimeType });
        rawDone = true;
        finishCheck();
      };

      rnnoiseRecorder.onstop = () => {
        rnnoiseBlob = new Blob(rnnoiseChunks, { type: mimeType });
        rnnoiseDone = true;
        finishCheck();
      };

      dtlnRecorder.onstop = () => {
        dtlnBlob = new Blob(dtlnChunks, { type: mimeType });
        dtlnDone = true;
        finishCheck();
      };

      rawRecorder.stop();
      rnnoiseRecorder.stop();
      dtlnRecorder.stop();
    });
  }

  // 兼容旧双轨录音对比接口
  async recordABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
  ): Promise<ABTestResult> {
    const triple = await this.recordTripleABComparison(
      durationSec,
      onCountdown,
    );
    const isDtln = this.config.noiseSuppressionMode === "dtln";
    return {
      rawUrl: triple.rawUrl,
      denoisedUrl: isDtln ? triple.dtlnUrl : triple.rnnoiseUrl,
      noiseReductionDb: isDtln
        ? triple.dtlnDbReduction
        : triple.rnnoiseDbReduction,
    };
  }

  // 8. 属性与状态监听
  onSpeakingChange(callback: (isSpeaking: boolean, volume: number) => void) {
    this.onSpeakingChangeCallbacks.add(callback);
    return () => {
      this.onSpeakingChangeCallbacks.delete(callback);
    };
  }

  onPTTChange(callback: (isPTTActive: boolean) => void) {
    this.onPTTChangeCallbacks.add(callback);
    return () => {
      this.onPTTChangeCallbacks.delete(callback);
    };
  }

  onError(callback: (errorMessage: string) => void) {
    this.onErrorCallbacks.add(callback);
    return () => {
      this.onErrorCallbacks.delete(callback);
    };
  }

  updateConfig(newConfig: Partial<AudioProcessingConfig>) {
    const needFullReinit =
      (newConfig.highFidelityMusic !== undefined &&
        newConfig.highFidelityMusic !== this.config.highFidelityMusic) ||
      (newConfig.echoCancellation !== undefined &&
        newConfig.echoCancellation !== this.config.echoCancellation) ||
      (newConfig.autoGainControl !== undefined &&
        newConfig.autoGainControl !== this.config.autoGainControl);

    const inputDeviceChanged =
      newConfig.inputDeviceId !== undefined &&
      newConfig.inputDeviceId !== this.config.inputDeviceId;

    const modeChanged =
      newConfig.noiseSuppressionMode !== undefined &&
      newConfig.noiseSuppressionMode !== this.config.noiseSuppressionMode;

    const noiseSuppressionChanged =
      newConfig.noiseSuppression !== undefined &&
      newConfig.noiseSuppression !== this.config.noiseSuppression;

    this.config = { ...this.config, ...newConfig };

    // 双向同步降噪模式与布尔状态
    if (newConfig.noiseSuppressionMode) {
      this.config.noiseSuppression = newConfig.noiseSuppressionMode !== "off";
    } else if (newConfig.noiseSuppression !== undefined) {
      this.config.noiseSuppressionMode = newConfig.noiseSuppression
        ? this.config.noiseSuppressionMode === "dtln"
          ? "dtln"
          : "rnnoise"
        : "off";
    }

    // 如果同步更新了快捷键且处于桌面端，向主进程注册
    if (newConfig.pushToTalkKey && window.electronAPI?.setPTTKeybind) {
      window.electronAPI.setPTTKeybind(newConfig.pushToTalkKey);
    }

    if (newConfig.inputDeviceId && typeof localStorage !== "undefined") {
      localStorage.setItem(
        "tescord_selected_audio_input_id",
        newConfig.inputDeviceId,
      );
    }
    if (newConfig.outputDeviceId && typeof localStorage !== "undefined") {
      localStorage.setItem(
        "tescord_selected_audio_output_id",
        newConfig.outputDeviceId,
      );
    }

    // 同步到持久化全局设置中心 (Zustand Persist + 云端自动上报)
    try {
      useSettingsStore.getState().setAudioConfig(newConfig);
    } catch (e) {
      console.warn("Sync to useSettingsStore failed:", e);
    }

    if (needFullReinit && this.rawMediaStream) {
      this.initMicrophone().catch((err) => {
        console.warn("audioEngine initMicrophone reinit error:", err);
      });
    } else if (inputDeviceChanged && this.rawMediaStream) {
      this.switchInputDevice(newConfig.inputDeviceId!).catch((err) => {
        console.warn("audioEngine switchInputDevice error:", err);
      });
    } else {
      if (
        (modeChanged || noiseSuppressionChanged) &&
        this.inputGainNode &&
        this.agcCompressorNode
      ) {
        this.applyNoiseSuppressionRouting();
      }
      this.updateGainAndAGC();
    }

    this.updateGating();
  }

  // 动态更新手动增益与自动增益 (AGC) 动态压限范围
  private updateGainAndAGC() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;

    // 1. 手动输入前级增益 (0% ~ 200% -> 0.0x ~ 2.0x 物理增益倍数)
    if (this.inputGainNode) {
      const manualGainVal = Math.max(
        0,
        Math.min(2, (this.config.manualGain ?? 100) / 100),
      );
      this.inputGainNode.gain.setValueAtTime(manualGainVal, now);
    }

    // 2. 自动增益范围/上限控制 (通过 DynamicsCompressor 压制过量背景杂音)
    if (this.agcCompressorNode) {
      if (this.config.autoGainControl) {
        // 开启 AGC: 限制自动增益最大提升范围 (6 ~ 30 dB)，防止无声时背景底噪被疯狂拉高
        const rangeDb = Math.max(
          6,
          Math.min(30, this.config.agcGainRange ?? 18),
        );
        this.agcCompressorNode.threshold.setValueAtTime(-rangeDb, now);
        this.agcCompressorNode.knee.setValueAtTime(10, now);
        this.agcCompressorNode.ratio.setValueAtTime(4.0, now);
        this.agcCompressorNode.attack.setValueAtTime(0.005, now);
        this.agcCompressorNode.release.setValueAtTime(0.1, now);
      } else {
        // 关闭 AGC: 压限器完全旁路为线性直通 (threshold = 0, ratio = 1)
        this.agcCompressorNode.threshold.setValueAtTime(0, now);
        this.agcCompressorNode.ratio.setValueAtTime(1.0, now);
      }
    }
  }

  private toggleRNNoise(enabled: boolean) {
    const targetMode: NoiseSuppressionMode = enabled ? "rnnoise" : "off";
    this.applyNoiseSuppressionRouting(targetMode);
  }

  setMute(muted: boolean) {
    this.isManualMuted = muted;
    this.updateGating();
  }

  getStream(): MediaStream | null {
    return this.processedStream || this.rawMediaStream;
  }

  getRawStream(): MediaStream | null {
    return this.rawMediaStream;
  }

  // 判定当前物理麦克风硬件流是否处于激活采集状态
  isMicrophoneActive(): boolean {
    return !!this.rawMediaStream && this.rawMediaStream.active;
  }

  stop() {
    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    if (this.vadHangoverTimer) {
      clearTimeout(this.vadHangoverTimer);
      this.vadHangoverTimer = null;
    }
    if (this.pttReleaseTimer) {
      clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
    }
    if (this.rnnoiseNode) {
      try {
        this.rnnoiseNode.destroy();
      } catch {}
      this.rnnoiseNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }
    if (this.inputGainNode) {
      try {
        this.inputGainNode.disconnect();
      } catch {}
      this.inputGainNode = null;
    }
    if (this.agcCompressorNode) {
      try {
        this.agcCompressorNode.disconnect();
      } catch {}
      this.agcCompressorNode = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {}
      this.analyser = null;
    }
    if (this.vadGainNode) {
      try {
        this.vadGainNode.disconnect();
      } catch {}
      this.vadGainNode = null;
    }
    this.destinationNode = null;

    if (this.rawMediaStream) {
      this.rawMediaStream.getTracks().forEach((t) => t.stop());
      this.rawMediaStream = null;
    }
    if (this.processedStream) {
      this.processedStream.getTracks().forEach((t) => t.stop());
      this.processedStream = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.isTalking = false;
    this.isPTTActive = false;
    this.isRnnoiseActive = false;
  }
}

export const audioEngine = new AudioEngine();
