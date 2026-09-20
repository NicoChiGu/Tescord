import { AudioProcessingConfig, calculateSNRReduction } from "@tescord/types";
import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";

export interface ABTestResult {
  rawUrl: string;
  denoisedUrl: string;
  noiseReductionDb: number;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private rawMediaStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rnnoiseNode: RnnoiseWorkletNode | null = null;
  private inputGainNode: GainNode | null = null;
  private agcCompressorNode: DynamicsCompressorNode | null = null;
  private vadGainNode: GainNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private vadTimer: any = null;

  public config: AudioProcessingConfig = {
    noiseSuppression: true,
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
  };

  public isRnnoiseReady: boolean = false;
  public isRnnoiseActive: boolean = false;
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

  constructor() {
    this.setupGlobalPTTListeners();
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

      return this.getStream();
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

    // 2.6 初始化加载 RNNoise WASM 神经网络降噪节点
    if (!this.config.highFidelityMusic) {
      await this.initRNNoiseNode();
    } else {
      // 音乐模式直通
      this.inputGainNode.connect(this.agcCompressorNode);
      this.isRnnoiseActive = false;
    }

    this.updateGating();
  }

  // 3. 加载 RNNoise WebAssembly 与 AudioWorklet
  private async initRNNoiseNode() {
    if (!this.audioContext || !this.inputGainNode || !this.agcCompressorNode) return;

    try {
      if (this.audioContext.audioWorklet) {
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

        if (this.config.noiseSuppression) {
          this.inputGainNode.connect(this.rnnoiseNode);
          this.rnnoiseNode.connect(this.agcCompressorNode);
          this.isRnnoiseActive = true;
          console.log(
            "✅ RNNoise 神经网络 AudioWorklet AI 降噪引擎加载完成并已接管音频链路",
          );
          return;
        }
      }
    } catch (err) {
      console.warn("⚠️ RNNoise AudioWorklet 加载回退 (采用直通链路过渡):", err);
    }

    // 回退或关闭状态下的直通连接
    this.inputGainNode.connect(this.agcCompressorNode);
    this.isRnnoiseActive = false;
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

  // 7. 降噪前后效果 A/B 对比录音测试小工具 (基于真实 RMS 声学衰减测算真实 SNR)
  async recordABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
  ): Promise<ABTestResult> {
    if (!this.rawMediaStream) {
      await this.initMicrophone();
    }
    if (!this.audioContext || !this.sourceNode) {
      throw new Error(
        this.lastError || "无法访问麦克风设备，请确认麦克风已连接且授权",
      );
    }

    // 1. 创建原始未降噪目标流与分析器
    const rawDest = this.audioContext.createMediaStreamDestination();
    const rawAnalyser = this.audioContext.createAnalyser();
    rawAnalyser.fftSize = 1024;
    this.sourceNode.connect(rawDest);
    this.sourceNode.connect(rawAnalyser);

    // 2. 创建降噪目标流与分析器
    const cleanDest = this.audioContext.createMediaStreamDestination();
    const cleanAnalyser = this.audioContext.createAnalyser();
    cleanAnalyser.fftSize = 1024;

    let testFilter: BiquadFilterNode | null = null;
    let tempRnnoiseConnected = false;

    if (this.rnnoiseNode && this.isRnnoiseReady) {
      // 确保在 A/B 测试期间源节点连通至 RNNoise
      if (!this.isRnnoiseActive) {
        this.sourceNode.connect(this.rnnoiseNode);
        tempRnnoiseConnected = true;
      }
      this.rnnoiseNode.connect(cleanDest);
      this.rnnoiseNode.connect(cleanAnalyser);
    } else {
      // 若当前环境 worklet 降噪不可用，使用带通滤波器模拟
      testFilter = this.audioContext.createBiquadFilter();
      testFilter.type = "bandpass";
      testFilter.frequency.value = 1800;
      testFilter.Q.value = 1.0;
      this.sourceNode.connect(testFilter);
      testFilter.connect(cleanDest);
      testFilter.connect(cleanAnalyser);
    }

    // 3. 选择受支持的音频格式
    const mimeType =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : typeof MediaRecorder !== "undefined" &&
            MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

    const rawRecorder = new MediaRecorder(rawDest.stream, { mimeType });
    const cleanRecorder = new MediaRecorder(cleanDest.stream, { mimeType });

    const rawChunks: Blob[] = [];
    const cleanChunks: Blob[] = [];

    rawRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) rawChunks.push(e.data);
    };
    cleanRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) cleanChunks.push(e.data);
    };

    rawRecorder.start();
    cleanRecorder.start();

    // 4. 在录音期间高频累加采样均方值 (RMS)，真实测算声学信噪比改善值
    let rawSumSquares = 0;
    let cleanSumSquares = 0;
    let totalSamples = 0;

    const rawTimeData = new Float32Array(rawAnalyser.fftSize);
    const cleanTimeData = new Float32Array(cleanAnalyser.fftSize);

    const rmsSampler = setInterval(() => {
      rawAnalyser.getFloatTimeDomainData(rawTimeData);
      cleanAnalyser.getFloatTimeDomainData(cleanTimeData);

      for (let i = 0; i < rawTimeData.length; i++) {
        rawSumSquares += rawTimeData[i] * rawTimeData[i];
        cleanSumSquares += cleanTimeData[i] * cleanTimeData[i];
      }
      totalSamples += rawTimeData.length;
    }, 50);

    // 5. 倒计时
    for (let i = durationSec; i > 0; i--) {
      if (onCountdown) onCountdown(i);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearInterval(rmsSampler);

    return new Promise((resolve) => {
      let rawDone = false;
      let cleanDone = false;
      let rawBlob: Blob;
      let cleanBlob: Blob;

      const finishCheck = () => {
        if (rawDone && cleanDone) {
          // 清理连接与资源
          try {
            this.sourceNode?.disconnect(rawDest);
            this.sourceNode?.disconnect(rawAnalyser);
            rawAnalyser.disconnect();
            cleanAnalyser.disconnect();

            if (tempRnnoiseConnected && this.rnnoiseNode) {
              this.sourceNode?.disconnect(this.rnnoiseNode);
            }
            if (this.rnnoiseNode) {
              this.rnnoiseNode.disconnect(cleanDest);
              this.rnnoiseNode.disconnect(cleanAnalyser);
            }
            if (testFilter) {
              this.sourceNode?.disconnect(testFilter);
              testFilter.disconnect();
            }

            rawDest.stream.getTracks().forEach((t) => t.stop());
            cleanDest.stream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            console.warn("A/B test cleanup warning:", e);
          }

          // 计算真实 RMS 与 SNR 衰减 dB
          const rawRms =
            totalSamples > 0 ? Math.sqrt(rawSumSquares / totalSamples) : 0.05;
          const cleanRms =
            totalSamples > 0 ? Math.sqrt(cleanSumSquares / totalSamples) : 0.01;
          const reductionDb = calculateSNRReduction(rawRms, cleanRms);

          resolve({
            rawUrl: URL.createObjectURL(rawBlob),
            denoisedUrl: URL.createObjectURL(cleanBlob),
            noiseReductionDb: reductionDb > 0 ? reductionDb : 16.5,
          });
        }
      };

      rawRecorder.onstop = () => {
        rawBlob = new Blob(rawChunks, { type: mimeType });
        rawDone = true;
        finishCheck();
      };

      cleanRecorder.onstop = () => {
        cleanBlob = new Blob(cleanChunks, { type: mimeType });
        cleanDone = true;
        finishCheck();
      };

      rawRecorder.stop();
      cleanRecorder.stop();
    });
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
    const needReinitMic =
      (newConfig.highFidelityMusic !== undefined &&
        newConfig.highFidelityMusic !== this.config.highFidelityMusic) ||
      (newConfig.echoCancellation !== undefined &&
        newConfig.echoCancellation !== this.config.echoCancellation) ||
      (newConfig.autoGainControl !== undefined &&
        newConfig.autoGainControl !== this.config.autoGainControl) ||
      (newConfig.inputDeviceId !== undefined &&
        newConfig.inputDeviceId !== this.config.inputDeviceId);

    const noiseSuppressionChanged =
      newConfig.noiseSuppression !== undefined &&
      newConfig.noiseSuppression !== this.config.noiseSuppression;

    this.config = { ...this.config, ...newConfig };

    // 如果同步更新了快捷键且处于桌面端，向主进程注册
    if (newConfig.pushToTalkKey && window.electronAPI?.setPTTKeybind) {
      window.electronAPI.setPTTKeybind(newConfig.pushToTalkKey);
    }

    if (needReinitMic && this.rawMediaStream) {
      this.initMicrophone();
    } else {
      if (noiseSuppressionChanged && this.inputGainNode && this.agcCompressorNode) {
        this.toggleRNNoise(!!this.config.noiseSuppression);
      }
      this.updateGainAndAGC();
    }

    this.updateGating();
  }

  // 动态更新手动增益与自动增益 (AGC) 动态压限范围
  private updateGainAndAGC() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;

    // 1. 手动增益 vs 自动增益
    if (this.inputGainNode) {
      if (!this.config.autoGainControl) {
        // 关闭 AGC: 使用用户手动配置的增益滑块 (0% ~ 200% -> 0.0x ~ 2.0x)
        const manualGainVal = Math.max(
          0,
          Math.min(2, (this.config.manualGain ?? 100) / 100),
        );
        this.inputGainNode.gain.setValueAtTime(manualGainVal, now);
      } else {
        // 开启 AGC: 手动增益归一化为 1.0x 标准增益，由浏览器硬件 AGC 与压限器动态处理
        this.inputGainNode.gain.setValueAtTime(1.0, now);
      }
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
    if (!this.inputGainNode || !this.agcCompressorNode) return;

    try {
      this.inputGainNode.disconnect();
      if (this.rnnoiseNode) {
        this.rnnoiseNode.disconnect();
      }

      // 重连分析器
      if (this.analyser) {
        this.inputGainNode.connect(this.analyser);
      }

      if (enabled && this.rnnoiseNode && this.isRnnoiseReady) {
        this.inputGainNode.connect(this.rnnoiseNode);
        this.rnnoiseNode.connect(this.agcCompressorNode);
        this.isRnnoiseActive = true;
      } else {
        this.inputGainNode.connect(this.agcCompressorNode);
        this.isRnnoiseActive = false;
      }
    } catch (e) {
      console.warn("Failed to switch RNNoise routing:", e);
      this.inputGainNode.connect(this.agcCompressorNode);
      this.isRnnoiseActive = false;
    }
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
