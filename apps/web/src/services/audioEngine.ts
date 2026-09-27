import {
  AudioProcessingConfig,
  NoiseSuppressionMode,
  NoiseEngineStatus,
} from "@tescord/types";
import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import { DtlnWorkletNode, loadDtlnWorklet } from "./dtlnNode.js";
import { Dfn3WorkletNode, loadDfn3Worklet } from "./dfn3Node.js";
import {
  monoPcm,
  estimateComparisonLag,
  alignComparisonPcm,
  wavBlob,
} from "./audioComparison.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";

export interface ABTestResult {
  rawUrl: string;
  denoisedUrl: string | null;
}

export interface QuadABTestResult {
  rawUrl: string;
  rnnoiseUrl: string | null;
  dtlnUrl: string | null;
  dfn3Url: string | null;
  rnnoiseError?: string;
  dtlnError?: string;
  dfn3Error?: string;
}

export type TripleABTestResult = QuadABTestResult;

const RNNOISE_WASM_HASHES = new Set([
  "8b60a2ab88fdae2d1a9f940249d0eb072f28ba8e796f7304347b4e07839c8853",
  "378fd17c294db15ee4e818ba5ef072242a21c8ad7445b483f7f46d7dc4f2c253",
]);

async function verifyRnnoiseWasm(binary: ArrayBuffer): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest("SHA-256", binary);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (!RNNOISE_WASM_HASHES.has(hash))
    throw new Error("RNNoise WASM checksum mismatch");
  return binary;
}

type NoiseRoute = {
  mode: NoiseSuppressionMode;
  input: AudioNode;
  output: AudioNode;
  gain: GainNode;
};

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private rawMediaStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private rnnoiseNode: RnnoiseWorkletNode | DtlnWorkletNode | null = null;
  private dtlnNode: DtlnWorkletNode | null = null;
  private dfn3Node: Dfn3WorkletNode | null = null;
  private inputGainNode: GainNode | null = null;
  private postGainNode: GainNode | null = null;
  private agcCompressorNode: DynamicsCompressorNode | null = null;
  private vadGainNode: GainNode | null = null;
  private voicePostNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private activeRoute: NoiseRoute | null = null;
  private routes = new Set<NoiseRoute>();
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
  public isDfn3Ready: boolean = false;
  public isDfn3Active: boolean = false;
  public lastError: string | null = null;
  public noiseStatus: NoiseEngineStatus = {
    requestedMode: "rnnoise",
    effectiveMode: "off",
    backend: "bypass",
    phase: "idle",
    sampleRate: 48000,
  };
  private routingGeneration = 0;
  private desiredNoiseMode: NoiseSuppressionMode = "rnnoise";
  private pendingRnnoise: Promise<boolean> | null = null;
  private pendingDtln: Promise<boolean> | null = null;
  private pendingDfn3: Promise<boolean> | null = null;
  private agcGainDb = 0;

  private isTalking: boolean = false;
  private isManualMuted: boolean = false;
  private isPTTActive: boolean = false;
  private vadActive: boolean = false;
  private vadHangoverTimer: any = null;
  private pttReleaseTimer: any = null;

  private onSpeakingChangeCallbacks: Set<
    (isSpeaking: boolean, volume: number) => void
  > = new Set();
  private onInputLevelCallbacks: Set<(volume: number) => void> = new Set();
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

  private reportCaptureSettings() {
    const settings = this.rawMediaStream?.getAudioTracks()[0]?.getSettings();
    if (!settings) return;
    const contextSampleRate = this.audioContext?.sampleRate ?? 48000;
    this.noiseStatus.sampleRate = contextSampleRate;
    const warnings: string[] = [];
    if (settings.echoCancellation === undefined)
      warnings.push("无法确认浏览器 AEC 状态");
    else if (settings.echoCancellation !== this.config.echoCancellation)
      warnings.push("浏览器 AEC 与请求值不一致");
    if (settings.noiseSuppression === undefined)
      warnings.push("无法确认浏览器 NS 状态");
    else if (settings.noiseSuppression) warnings.push("浏览器 NS 未关闭");
    if (settings.autoGainControl === undefined)
      warnings.push("无法确认浏览器 AGC 状态");
    else if (settings.autoGainControl) warnings.push("浏览器 AGC 未关闭");
    this.noiseStatus.capture = {
      requestedEchoCancellation: this.config.echoCancellation,
      actualEchoCancellation: settings.echoCancellation,
      actualNoiseSuppression: settings.noiseSuppression,
      actualAutoGainControl: settings.autoGainControl,
      actualSampleRate: settings.sampleRate,
      actualChannelCount: settings.channelCount,
      contextSampleRate,
      warnings,
    };
    console.info(
      "Audio capture settings",
      settings,
      "AudioContext",
      this.audioContext?.sampleRate,
    );
    if (warnings.length)
      console.warn("音频采集约束与实际状态", warnings, settings);
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

      const constraints: MediaStreamConstraints = {
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: false, // 禁用系统低质降噪，全权由 RNNoise/DTLN/DFNv3 神经网络处理
          autoGainControl: false,
          ...(this.config.inputDeviceId
            ? { deviceId: { exact: this.config.inputDeviceId } }
            : {}),
        },
        video: false,
      };

      this.rawMediaStream =
        await navigator.mediaDevices.getUserMedia(constraints);
      this.reportCaptureSettings();
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
        // Acquire the replacement before releasing the live capture source.
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
                autoGainControl: false,
                ...(deviceId && deviceId !== "default"
                  ? { deviceId: { exact: deviceId } }
                  : {}),
              },
          video: false,
        };

        const replacement =
          await navigator.mediaDevices.getUserMedia(constraints);

        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume().catch(() => {});
        }

        const replacementSource =
          this.audioContext.createMediaStreamSource(replacement);
        try {
          replacementSource.connect(this.inputGainNode);
        } catch (error) {
          replacement.getTracks().forEach((track) => track.stop());
          throw error;
        }
        const previousSource = this.sourceNode;
        const previousStream = this.rawMediaStream;
        this.sourceNode = replacementSource;
        this.rawMediaStream = replacement;
        this.reportCaptureSettings();
        try {
          previousSource.disconnect();
        } catch {}
        previousStream?.getTracks().forEach((track) => track.stop());

        console.log(
          `🎙️ AudioEngine: 成功热切换至麦克风设备 [${deviceId}] (零断流)`,
        );
        this.notifyStreamChange(this.processedStream);
        return this.processedStream;
      } catch (err) {
        console.warn(
          "AudioEngine switchInputDevice hot swap 失败，保留原麦克风:",
          err,
        );
        this.lastError = String(err);
        this.onErrorCallbacks.forEach((cb) => cb(this.lastError!));
        return this.processedStream;
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

    // Keep the VAD input independent of the manual transmit gain.
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.3;

    // sourceNode -> inputGainNode -> analyser
    this.sourceNode.connect(this.inputGainNode);

    // 2.3 AGC 动态压限控制节点 (用于在自动增益模式下压制过高底噪提升)
    this.agcCompressorNode = this.audioContext.createDynamicsCompressor();
    this.postGainNode = this.audioContext.createGain();
    this.postGainNode.connect(this.agcCompressorNode);

    // 2.4 VAD 门限音量增益控制器 (未达灵敏度或松开 PTT 时静音以阻断上行网络包)
    // 显式声明为双声道 stereo，杜绝单耳偏音
    this.vadGainNode = this.audioContext.createGain();
    this.vadGainNode.channelCount = 2;
    this.vadGainNode.channelCountMode = "explicit";
    this.vadGainNode.gain.setValueAtTime(1, this.audioContext.currentTime);

    this.agcCompressorNode.connect(this.vadGainNode);

    // 2.5 最终目标流输出节点 (作为推流给 LiveKit 的干净流)
    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.outputAnalyser = this.audioContext.createAnalyser();
    this.outputAnalyser.fftSize = 512;
    this.outputAnalyser.smoothingTimeConstant = 0.3;
    this.outputAnalyser.connect(this.destinationNode);
    const base = new URL(
      import.meta.env.BASE_URL || "./",
      window.location.href,
    );
    await this.audioContext.audioWorklet.addModule(
      new URL("models/voicePostProcessor.js", base),
    );
    this.voicePostNode = new AudioWorkletNode(
      this.audioContext,
      "tescord-voice-post",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      },
    );
    this.vadGainNode.connect(this.voicePostNode);
    this.voicePostNode.connect(this.outputAnalyser);
    this.processedStream = this.destinationNode.stream;

    // 同步应用增益与 AGC 动态范围压限
    this.updateGainAndAGC();

    // 2.6 初始化加载神经网络降噪节点并应用路由
    await this.initNoiseEngines();
    await this.applyNoiseSuppressionRouting();

    this.updateGating();
  }

  public getEffectiveNoiseMode(): NoiseSuppressionMode {
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

  // 3. 加载与管理 RNNoise / DTLN / DFNv3 多引擎 AudioWorklet
  private async initNoiseEngines() {
    if (!this.audioContext) return;
    await this.ensureRnnoiseInitialized();
    if (this.config.noiseSuppressionMode === "dtln") {
      await this.ensureDtlnInitialized();
    } else if (this.config.noiseSuppressionMode === "dfn3") {
      await this.ensureDfn3Initialized();
    }
  }

  public ensureRnnoiseInitialized(): Promise<boolean> {
    if (this.pendingRnnoise) return this.pendingRnnoise;
    const pending = this.initializeRnnoise();
    this.pendingRnnoise = pending;
    void pending.finally(() => {
      if (this.pendingRnnoise === pending) this.pendingRnnoise = null;
    });
    return pending;
  }

  private async initializeRnnoise(): Promise<boolean> {
    if (this.isRnnoiseReady && this.rnnoiseNode) return true;
    if (!this.audioContext || !this.audioContext.audioWorklet) return false;
    const context = this.audioContext;

    if (window.electronAPI?.openAudioInferencePort) {
      let node: DtlnWorkletNode | null = null;
      try {
        await loadDtlnWorklet(context);
        if (context !== this.audioContext) return false;
        node = new DtlnWorkletNode(context, "rnnoise");
        await node.ready();
        if (context !== this.audioContext) {
          node.destroy();
          return false;
        }
        node.onFailure = (reason) => {
          this.lastError = `RNNoise 原生推理中断：${reason}`;
          if (this.isRnnoiseActive)
            void this.applyNoiseSuppressionRouting("off").then(() => {
              this.noiseStatus.phase = "failed";
              this.noiseStatus.reason = this.lastError || undefined;
            });
        };
        node.onStats = (stats) => {
          if (this.isRnnoiseActive) Object.assign(this.noiseStatus, stats);
        };
        this.rnnoiseNode = node;
        this.isRnnoiseReady = true;
        return true;
      } catch (error) {
        this.lastError = String(error);
        node?.destroy();
        return false;
      }
    }

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

      await context.audioWorklet.addModule(workletUrl);
      const wasmBinary = await verifyRnnoiseWasm(
        await loadRnnoise({ url: wasmUrl, simdUrl: simdWasmUrl }),
      );

      if (context !== this.audioContext) return false;
      this.rnnoiseNode = new RnnoiseWorkletNode(context, {
        maxChannels: 1,
        wasmBinary,
      });

      this.isRnnoiseReady = true;
      console.log("✅ RNNoise 神经网络 AudioWorklet AI 降噪引擎加载完成");
      return true;
    } catch (err) {
      this.lastError = String(err);
      console.warn("⚠️ RNNoise AudioWorklet 加载回退:", err);
      return false;
    }
  }

  public ensureDtlnInitialized(): Promise<boolean> {
    if (this.pendingDtln) return this.pendingDtln;
    const pending = this.initializeDtln();
    this.pendingDtln = pending;
    void pending.finally(() => {
      if (this.pendingDtln === pending) this.pendingDtln = null;
    });
    return pending;
  }

  private async initializeDtln(): Promise<boolean> {
    if (this.isDtlnReady && this.dtlnNode) return true;
    if (!this.audioContext || !this.audioContext.audioWorklet) return false;
    const context = this.audioContext;
    let node: DtlnWorkletNode | null = null;

    try {
      const loaded = await loadDtlnWorklet(context);
      if (!loaded || context !== this.audioContext) return false;

      node = new DtlnWorkletNode(context);
      await node.ready();
      if (context !== this.audioContext) {
        node.destroy();
        return false;
      }
      node.onFailure = (reason) => {
        if (this.dtlnNode !== node) return;
        this.lastError = `DTLN 推理中断：${reason}`;
        if (this.isDtlnActive)
          void this.applyNoiseSuppressionRouting("rnnoise");
      };
      node.onStats = (stats) => {
        if (this.isDtlnActive) Object.assign(this.noiseStatus, stats);
      };
      this.dtlnNode = node;
      this.isDtlnReady = true;
      console.log("DTLN 双阶段 ONNX 降噪引擎已就绪");
      return true;
    } catch (err) {
      node?.destroy();
      this.lastError = String(err);
      console.warn("⚠️ DTLN AudioWorklet 加载回退:", err);
      return false;
    }
  }

  public ensureDfn3Initialized(): Promise<boolean> {
    if (this.pendingDfn3) return this.pendingDfn3;
    const pending = this.initializeDfn3();
    this.pendingDfn3 = pending;
    void pending.finally(() => {
      if (this.pendingDfn3 === pending) this.pendingDfn3 = null;
    });
    return pending;
  }

  private async initializeDfn3(): Promise<boolean> {
    if (this.isDfn3Ready && this.dfn3Node) return true;
    if (!this.audioContext?.audioWorklet) return false;
    const context = this.audioContext;
    let node: Dfn3WorkletNode | null = null;
    try {
      await loadDfn3Worklet(context);
      if (context !== this.audioContext) return false;
      node = new Dfn3WorkletNode(context);
      await node.ready();
      if (context !== this.audioContext) {
        node.destroy();
        return false;
      }
      node.onFailure = (reason) => {
        if (this.dfn3Node !== node) return;
        this.lastError = `DeepFilterNet3 推理中断：${reason}`;
        if (this.isDfn3Active)
          void this.applyNoiseSuppressionRouting("rnnoise");
      };
      node.onStats = (stats) => {
        if (this.isDfn3Active) Object.assign(this.noiseStatus, stats);
      };
      this.dfn3Node = node;
      this.isDfn3Ready = true;
      return true;
    } catch (error) {
      this.lastError = String(error);
      node?.destroy();
      return false;
    }
  }

  public async applyNoiseSuppressionRouting(mode?: NoiseSuppressionMode) {
    if (
      !this.inputGainNode ||
      !this.postGainNode ||
      !this.audioContext ||
      !this.analyser
    )
      return;
    const generation = ++this.routingGeneration;
    const requested = mode ?? this.getEffectiveNoiseMode();
    this.desiredNoiseMode = requested;
    let effective: NoiseSuppressionMode = requested;
    let reason: string | undefined;
    this.noiseStatus = {
      ...this.noiseStatus,
      requestedMode: this.config.noiseSuppressionMode ?? requested,
      phase: requested === "off" ? "ready" : "loading",
    };

    // Keep the old route audible while the new engine loads.
    if (requested === "dtln" && !(await this.ensureDtlnInitialized())) {
      reason = this.lastError || "DTLN model unavailable";
    } else if (requested === "dfn3" && !(await this.ensureDfn3Initialized())) {
      reason = this.lastError || "DeepFilterNet3 model unavailable";
    } else if (
      requested === "rnnoise" &&
      !(await this.ensureRnnoiseInitialized())
    ) {
      reason = this.lastError || "RNNoise unavailable";
    }
    if (generation !== this.routingGeneration) {
      this.releaseUnusedEngines();
      return;
    }
    if (reason && this.activeRoute) {
      this.noiseStatus = {
        ...this.noiseStatus,
        effectiveMode: this.activeRoute.mode,
        phase: "failed",
        reason,
      };
      this.onErrorCallbacks.forEach((cb) => cb(reason!));
      this.releaseUnusedEngines();
      return;
    }
    if (
      reason &&
      effective !== "rnnoise" &&
      (await this.ensureRnnoiseInitialized())
    ) {
      effective = "rnnoise";
    } else if (reason) {
      effective = "off";
    }
    if (
      generation !== this.routingGeneration ||
      !this.inputGainNode ||
      !this.postGainNode
    ) {
      this.releaseUnusedEngines();
      return;
    }

    const engine =
      effective === "rnnoise"
        ? this.rnnoiseNode
        : effective === "dtln"
          ? this.dtlnNode
          : effective === "dfn3"
            ? this.dfn3Node
            : null;
    if (this.activeRoute?.mode !== effective) {
      const context = this.audioContext;
      const gain = context.createGain();
      const input: AudioNode = engine ?? gain;
      const output: AudioNode = engine ?? this.inputGainNode;
      gain.gain.setValueAtTime(this.activeRoute ? 0 : 1, context.currentTime);
      if (engine) {
        this.inputGainNode.connect(engine);
        engine.connect(gain);
      } else this.inputGainNode.connect(gain);
      gain.connect(this.analyser);
      gain.connect(this.postGainNode);
      const next = { mode: effective, input, output, gain };
      this.routes.add(next);
      if (this.activeRoute) {
        // Feed the new stream long enough to fill its analysis window and output queue.
        await new Promise((resolve) => setTimeout(resolve, engine ? 120 : 20));
        if (
          generation !== this.routingGeneration ||
          !this.inputGainNode ||
          !this.postGainNode
        ) {
          this.releaseRoute(next);
          return;
        }
        const old = this.activeRoute;
        const now = context.currentTime;
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setValueAtTime(old.gain.gain.value, now);
        old.gain.gain.linearRampToValueAtTime(0, now + 0.04);
        gain.gain.linearRampToValueAtTime(1, now + 0.04);
        this.activeRoute = next;
        setTimeout(() => this.releaseRoute(old), 100);
      } else {
        this.activeRoute = next;
      }
    }
    this.isRnnoiseActive = effective === "rnnoise";
    this.isDtlnActive = effective === "dtln";
    this.isDfn3Active = effective === "dfn3";
    this.noiseStatus = {
      ...this.noiseStatus,
      effectiveMode: effective,
      backend:
        effective === "off"
          ? "bypass"
          : effective === "dtln"
            ? this.dtlnNode!.backend
            : effective === "dfn3"
              ? this.dfn3Node!.backend
              : this.rnnoiseNode instanceof DtlnWorkletNode
                ? "desktop-native"
                : "web-wasm",
      phase: reason ? "failed" : "ready",
      reason,
      processedFrames: undefined,
      queueMs: undefined,
      processingMs: undefined,
      processingP50Ms: undefined,
      processingP95Ms: undefined,
      processingP99Ms: undefined,
    };
    if (reason) this.onErrorCallbacks.forEach((cb) => cb(reason!));
    this.releaseUnusedEngines();
  }

  private releaseUnusedEngines() {
    const unused = (node: AudioNode | null, mode: NoiseSuppressionMode) =>
      node &&
      mode !== this.desiredNoiseMode &&
      ![...this.routes].some((route) => route.output === node);
    if (unused(this.rnnoiseNode, "rnnoise")) {
      this.rnnoiseNode?.destroy();
      this.rnnoiseNode = null;
      this.isRnnoiseReady = false;
    }
    if (unused(this.dtlnNode, "dtln")) {
      this.dtlnNode?.destroy();
      this.dtlnNode = null;
      this.isDtlnReady = false;
    }
    if (unused(this.dfn3Node, "dfn3")) {
      this.dfn3Node?.destroy();
      this.dfn3Node = null;
      this.isDfn3Ready = false;
    }
  }

  private releaseRoute(route: NoiseRoute) {
    if (!this.routes.delete(route)) return;
    // An engine may be shared by an active, fading, or warming route during
    // rapid switches. Release its input and state only after its last route.
    const stillUsed = [...this.routes].some(
      (other) => other.input === route.input,
    );
    if (route.input !== route.gain && !stillUsed) {
      try {
        this.inputGainNode?.disconnect(route.input);
      } catch {}
    }
    try {
      route.output.disconnect(route.gain);
    } catch {}
    try {
      route.gain.disconnect();
    } catch {}
    if (stillUsed) return;
    if (
      route.output instanceof DtlnWorkletNode ||
      route.output instanceof RnnoiseWorkletNode
    )
      route.output.destroy();
    if (route.output === this.rnnoiseNode) {
      this.rnnoiseNode = null;
      this.isRnnoiseReady = false;
    } else if (route.output === this.dtlnNode) {
      this.dtlnNode = null;
      this.isDtlnReady = false;
    } else if (route.output === this.dfn3Node) {
      this.dfn3Node = null;
      this.isDfn3Ready = false;
    }
  }

  public setNoiseSuppressionMode(mode: NoiseSuppressionMode) {
    this.config.noiseSuppressionMode = mode;
    this.config.noiseSuppression = mode !== "off";
    this.applyNoiseSuppressionRouting(mode);
  }

  // 4. VAD 智能语音活动判定与声学能量计算 (采用 setInterval 30ms 保证切后台/最小化时不挂起断音)
  private startVADLoop() {
    if (!this.analyser || !this.outputAnalyser) return;

    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }

    const timeData = new Float32Array(this.analyser.fftSize);
    const outputData = new Float32Array(this.outputAnalyser.fftSize);

    const checkVolume = () => {
      if (!this.analyser) return;

      this.analyser.getFloatTimeDomainData(timeData);
      let energy = 0;
      for (const sample of timeData) energy += sample * sample;
      const rms = Math.sqrt(energy / timeData.length);
      const currentDb = 20 * Math.log10(Math.max(rms, 1e-6));
      // Match the AudioWorklet expander's -55 + sensitivity * 0.4 dBFS gate.
      const volumeLevel = Math.max(
        0,
        Math.min(100, Math.round((currentDb + 55) / 0.4)),
      );
      if (
        this.config.autoGainControl &&
        this.postGainNode &&
        this.audioContext
      ) {
        const targetDb = Math.max(
          -6,
          Math.min(this.config.agcGainRange ?? 18, -20 - currentDb),
        );
        // Never raise the floor while the VAD is closed. Decrease excess gain promptly.
        if (this.vadActive || targetDb < this.agcGainDb) {
          const change = targetDb - this.agcGainDb;
          this.agcGainDb += Math.max(-0.5, Math.min(0.075, change));
          const manual = Math.max(
            0,
            Math.min(2, (this.config.manualGain ?? 100) / 100),
          );
          this.postGainNode.gain.setTargetAtTime(
            manual * Math.pow(10, this.agcGainDb / 20),
            this.audioContext.currentTime,
            0.05,
          );
        }
      }

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

      this.outputAnalyser?.getFloatTimeDomainData(outputData);
      let outputEnergy = 0;
      for (const sample of outputData) outputEnergy += sample * sample;
      const outputRms = Math.sqrt(outputEnergy / outputData.length);
      const outputDb = 20 * Math.log10(Math.max(outputRms, 1e-6));
      const outputLevel = this.isManualMuted
        ? 0
        : Math.max(0, Math.min(100, Math.round((outputDb + 55) / 0.4)));
      this.onSpeakingChangeCallbacks.forEach((cb) =>
        cb(this.isTalking, outputLevel),
      );
      // 触发真实前级物理输入音量回调（不受闭麦影响，设置面板电平检测专用）
      this.onInputLevelCallbacks.forEach((cb) => cb(volumeLevel));
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
    this.voicePostNode?.port.postMessage({
      type: "CONFIG",
      mode:
        this.config.inputMode === "PTT" || this.config.pushToTalk
          ? "PTT"
          : "VAD",
      muted: this.isManualMuted,
      ptt: this.isPTTActive,
      sensitivity: this.config.vadSensitivity,
    });

    // VAD uses the gain envelope; disabling the track at every VAD edge cuts phonemes.
    if (this.processedStream) {
      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled =
          !this.isManualMuted &&
          ((this.config.inputMode !== "PTT" && !this.config.pushToTalk) ||
            this.isPTTActive);
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
      window.electronAPI.onGlobalPTTDown?.(() => {
        if (this.config.inputMode === "PTT" || this.config.pushToTalk) {
          this.setPTTActive(true);
        }
      });
      window.electronAPI.onGlobalPTTUp?.(() => {
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

  // Record the microphone once, then replay exactly that recording into fresh,
  // independent engines. Live-call model state never enters the comparison.
  async recordTripleABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
    signal?: AbortSignal,
  ): Promise<QuadABTestResult> {
    const checkCancelled = () => {
      if (signal?.aborted) throw new DOMException("试听已取消", "AbortError");
    };
    checkCancelled();
    if (!this.rawMediaStream) await this.initMicrophone();
    if (!this.audioContext || !this.sourceNode)
      throw new Error(this.lastError || "麦克风不可用");
    const context = this.audioContext;
    const source = this.sourceNode;
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(
      (value) => MediaRecorder.isTypeSupported(value),
    );
    if (!mimeType) throw new Error("当前浏览器不支持音频录制");
    const captureDest = context.createMediaStreamDestination();
    const captureRecorder = new MediaRecorder(captureDest.stream, { mimeType });
    const capturedChunks: Blob[] = [];
    captureRecorder.ondataavailable = (event) => {
      if (event.data.size) capturedChunks.push(event.data);
    };
    let playback: AudioBufferSourceNode | null = null;
    const outputs: Array<{
      mode: "raw" | "rnnoise" | "dtln" | "dfn3";
      dest: MediaStreamAudioDestinationNode;
      node?: AudioNode;
      recorder: MediaRecorder;
      chunks: Blob[];
    }> = [];
    const urls: Record<string, string> = {};
    let completed = false;
    const errors: Partial<Record<"rnnoise" | "dtln" | "dfn3", string>> = {};
    let freshRnnoise: RnnoiseWorkletNode | DtlnWorkletNode | null = null;
    let freshDtln: DtlnWorkletNode | null = null;
    let freshDfn3: Dfn3WorkletNode | null = null;
    const addOutput = (
      mode: "raw" | "rnnoise" | "dtln" | "dfn3",
      node?: AudioNode,
    ) => {
      const dest = context.createMediaStreamDestination();
      if (node) {
        playback!.connect(node);
        node.connect(dest);
      } else playback!.connect(dest);
      const recorder = new MediaRecorder(dest.stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      outputs.push({ mode, dest, node, recorder, chunks });
    };
    try {
      source.connect(captureDest);
      captureRecorder.start();
      for (let remaining = durationSec; remaining > 0; remaining--) {
        checkCancelled();
        onCountdown?.(remaining);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      checkCancelled();
      await new Promise<void>((resolve, reject) => {
        captureRecorder.onstop = () => resolve();
        captureRecorder.onerror = () => reject(new Error("原声录制失败"));
        captureRecorder.stop();
      });
      source.disconnect(captureDest);
      const recorded = new Blob(capturedChunks, { type: mimeType });
      if (!recorded.size) throw new Error("原声录制为空");
      const recordedPcm = await context.decodeAudioData(
        await recorded.arrayBuffer(),
      );
      if (!recordedPcm.length) throw new Error("无法解码试听录音");
      playback = context.createBufferSource();
      playback.buffer = recordedPcm;
      checkCancelled();
      addOutput("raw");
      checkCancelled();
      try {
        if (window.electronAPI?.openAudioInferencePort) {
          await loadDtlnWorklet(context);
          const nativeNode = new DtlnWorkletNode(context, "rnnoise");
          freshRnnoise = nativeNode;
          await nativeNode.ready();
          nativeNode.onFailure = (reason) => {
            errors.rnnoise = reason;
          };
        } else {
          const base = new URL(
            import.meta.env.BASE_URL || "./",
            window.location.href,
          );
          await context.audioWorklet.addModule(
            new URL("rnnoise/rnnoise/workletProcessor.js", base),
          );
          const wasmBinary = await verifyRnnoiseWasm(
            await loadRnnoise({
              url: new URL("rnnoise/rnnoise.wasm", base).href,
              simdUrl: new URL("rnnoise/rnnoise_simd.wasm", base).href,
            }),
          );
          freshRnnoise = new RnnoiseWorkletNode(context, {
            maxChannels: 1,
            wasmBinary,
          });
        }
        addOutput("rnnoise", freshRnnoise);
      } catch (error) {
        errors.rnnoise = String(error);
      }
      checkCancelled();
      try {
        await loadDtlnWorklet(context);
        freshDtln = new DtlnWorkletNode(context);
        await freshDtln.ready();
        freshDtln.onFailure = (reason) => {
          errors.dtln = reason;
        };
        addOutput("dtln", freshDtln);
      } catch (error) {
        errors.dtln = String(error);
      }
      checkCancelled();
      try {
        await loadDfn3Worklet(context);
        freshDfn3 = new Dfn3WorkletNode(context);
        await freshDfn3.ready();
        freshDfn3.onFailure = (reason) => {
          errors.dfn3 = reason;
        };
        addOutput("dfn3", freshDfn3);
      } catch (error) {
        errors.dfn3 = String(error);
      }
      checkCancelled();
      for (const output of outputs) output.recorder.start();
      playback.start();
      const playbackMs = Math.ceil(recordedPcm.duration * 1000) + 600;
      for (let elapsed = 0; elapsed < playbackMs; elapsed += 100) {
        checkCancelled();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      checkCancelled();
      const blobs: Record<string, Blob> = {};
      await Promise.all(
        outputs.map(
          (output) =>
            new Promise<void>((resolve, reject) => {
              output.recorder.onstop = () => {
                blobs[output.mode] = new Blob(output.chunks, {
                  type: mimeType,
                });
                resolve();
              };
              output.recorder.onerror = () =>
                reject(new Error(output.mode + " 录制失败"));
              output.recorder.stop();
            }),
        ),
      );
      checkCancelled();
      const rawPcm = monoPcm(
        await context.decodeAudioData(await blobs.raw.arrayBuffer()),
      );
      const sampleRate = context.sampleRate;
      const targetLength = Math.min(rawPcm.length, recordedPcm.length);
      const reference = rawPcm.subarray(0, targetLength);
      urls.raw = URL.createObjectURL(wavBlob(reference, sampleRate));
      for (const mode of ["rnnoise", "dtln", "dfn3"] as const) {
        if (errors[mode] || !blobs[mode]?.size) continue;
        try {
          const processed = monoPcm(
            await context.decodeAudioData(await blobs[mode].arrayBuffer()),
          );
          checkCancelled();
          const lag = estimateComparisonLag(reference, processed, sampleRate);
          urls[mode] = URL.createObjectURL(
            wavBlob(
              alignComparisonPcm(processed, lag.samples, targetLength),
              sampleRate,
            ),
          );
        } catch (error) {
          errors[mode] = String(error);
        }
      }
      checkCancelled();
      completed = true;
      return {
        rawUrl: urls.raw,
        rnnoiseUrl: urls.rnnoise || null,
        dtlnUrl: urls.dtln || null,
        dfn3Url: urls.dfn3 || null,
        rnnoiseError: errors.rnnoise,
        dtlnError: errors.dtln,
        dfn3Error: errors.dfn3,
      };
    } finally {
      if (!completed)
        Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
      if (captureRecorder.state !== "inactive") captureRecorder.stop();
      try {
        source.disconnect(captureDest);
      } catch {}
      captureDest.stream.getTracks().forEach((track) => track.stop());
      try {
        playback?.stop();
      } catch {}
      for (const output of outputs) {
        if (output.recorder.state !== "inactive") output.recorder.stop();
        try {
          playback?.disconnect(output.node || output.dest);
        } catch {}
        output.node?.disconnect();
        output.dest.stream.getTracks().forEach((track) => track.stop());
      }
      freshRnnoise?.destroy();
      freshDtln?.destroy();
      freshDfn3?.destroy();
      playback?.disconnect();
    }
  }

  async recordQuadABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
  ): Promise<QuadABTestResult> {
    return this.recordTripleABComparison(durationSec, onCountdown);
  }

  async recordABComparison(
    durationSec: number = 5,
    onCountdown?: (remainingSec: number) => void,
  ): Promise<ABTestResult> {
    const quad = await this.recordQuadABComparison(durationSec, onCountdown);
    const mode = this.config.noiseSuppressionMode;
    return {
      rawUrl: quad.rawUrl,
      denoisedUrl:
        mode === "dtln"
          ? quad.dtlnUrl
          : mode === "dfn3"
            ? quad.dfn3Url
            : quad.rnnoiseUrl,
    };
  }

  // 8. 属性与状态监听
  onSpeakingChange(callback: (isSpeaking: boolean, volume: number) => void) {
    this.onSpeakingChangeCallbacks.add(callback);
    return () => {
      this.onSpeakingChangeCallbacks.delete(callback);
    };
  }

  onInputLevel(callback: (volume: number) => void) {
    this.onInputLevelCallbacks.add(callback);
    return () => {
      this.onInputLevelCallbacks.delete(callback);
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
          : this.config.noiseSuppressionMode === "dfn3"
            ? "dfn3"
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

    // Keep model input at the captured level. Apply gain after denoising.
    if (this.inputGainNode) {
      this.inputGainNode.gain.setValueAtTime(1, now);
    }
    if (this.postGainNode) {
      const manual = Math.max(
        0,
        Math.min(2, (this.config.manualGain ?? 100) / 100),
      );
      if (!this.config.autoGainControl) this.agcGainDb = 0;
      this.postGainNode.gain.setTargetAtTime(
        manual * Math.pow(10, this.agcGainDb / 20),
        now,
        0.05,
      );
    }

    // Peak limiter, independent of the automatic gain controller.
    if (this.agcCompressorNode) {
      this.agcCompressorNode.threshold.setValueAtTime(-1, now);
      this.agcCompressorNode.knee.setValueAtTime(0, now);
      this.agcCompressorNode.ratio.setValueAtTime(20, now);
      this.agcCompressorNode.attack.setValueAtTime(0.003, now);
      this.agcCompressorNode.release.setValueAtTime(0.05, now);
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
    this.routingGeneration++;
    this.pendingRnnoise = null;
    this.pendingDtln = null;
    this.pendingDfn3 = null;
    for (const route of [...this.routes]) this.releaseRoute(route);
    this.activeRoute = null;
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
    if (this.dtlnNode) {
      try {
        this.dtlnNode.destroy();
      } catch {}
      this.dtlnNode = null;
    }
    if (this.dfn3Node) {
      try {
        this.dfn3Node.destroy();
      } catch {}
      this.dfn3Node = null;
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
    if (this.postGainNode) {
      try {
        this.postGainNode.disconnect();
      } catch {}
      this.postGainNode = null;
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
    if (this.outputAnalyser) {
      try {
        this.outputAnalyser.disconnect();
      } catch {}
      this.outputAnalyser = null;
    }
    if (this.vadGainNode) {
      try {
        this.vadGainNode.disconnect();
      } catch {}
      this.vadGainNode = null;
    }
    if (this.voicePostNode) {
      try {
        this.voicePostNode.disconnect();
      } catch {}
      this.voicePostNode = null;
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
    this.isDtlnActive = false;
    this.isDfn3Active = false;
    this.isRnnoiseReady = false;
    this.isDtlnReady = false;
    this.isDfn3Ready = false;
    this.noiseStatus = {
      requestedMode: this.getEffectiveNoiseMode(),
      effectiveMode: "off",
      backend: "bypass",
      phase: "idle",
      sampleRate: 48000,
    };
    this.onInputLevelCallbacks.forEach((cb) => cb(0));
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  public async resume(): Promise<boolean> {
    if (!this.audioContext || this.audioContext.state === "closed") {
      return true;
    }
    if (
      this.audioContext.state === "suspended" ||
      (this.audioContext.state as string) === "interrupted"
    ) {
      try {
        await this.audioContext.resume();
        return this.audioContext.state === "running";
      } catch (e) {
        console.warn("[AudioEngine] resume audioContext failed:", e);
        return false;
      }
    }
    return true;
  }
}

export const audioEngine = new AudioEngine();
