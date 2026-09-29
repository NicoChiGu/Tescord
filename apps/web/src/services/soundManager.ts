import { SoundEffectType } from "@tescord/types";

/**
 * Tescord 程序化音效管理器 (SoundManager)
 *
 * 特性：
 * 1. 100% 纯离线 Web Audio API 程序化合成，零静态文件依赖与网络加载延迟
 * 2. 毫秒级 ADSR 振幅包络调制，消除 DC 偏移与爆音 (Anti-Clicking / Anti-Popping)
 * 3. 智能生命周期管理与事件节流，防止连续按键与高频网络事件重叠失真
 */
class SoundEffectManager {
  private ctx: AudioContext | null = null;
  private lastPlayedMap: Map<SoundEffectType, number> = new Map();
  private readonly THROTTLE_MS = 60; // 同类音效触发节流时间

  /**
   * 惰性初始化或获取已有的 AudioContext
   */
  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContextClass();
    }

    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {
        // 等待首次用户手势自动激活
      });
    }

    return this.ctx;
  }

  /**
   * 播放单音节正弦波/三角波，平滑 ADSR 包络防爆音
   */
  private playTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType = "sine",
    peakGain: number = 0.15,
    attackTime: number = 0.008,
    releaseTime: number = 0.02,
  ) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    // 严密防爆音：初始增益设为零，平滑过渡至峰值再指数衰减
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + duration + releaseTime,
    );

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startTime);
    const stopTime = startTime + duration + releaseTime;
    osc.stop(stopTime);

    // 播放完成后主动断开音频图节点，防止内存泄露
    setTimeout(
      () => {
        try {
          osc.disconnect();
          gainNode.disconnect();
        } catch {
          // 节点已被回收时忽略
        }
      },
      (stopTime - ctx.currentTime + 0.1) * 1000,
    );
  }

  /**
   * 播放连续音符组成的音效序列
   */
  private playNotes(
    ctx: AudioContext,
    notes: Array<{
      freq: number;
      duration: number;
      type?: OscillatorType;
      gain?: number;
    }>,
    gap: number = 0.02,
  ) {
    let currentTime = ctx.currentTime + 0.005; // 微量延时，避免硬件时钟抖动

    notes.forEach((note) => {
      this.playTone(
        ctx,
        note.freq,
        currentTime,
        note.duration,
        note.type || "sine",
        note.gain ?? 0.15,
      );
      currentTime += note.duration + gap;
    });
  }

  /**
   * 播放指定提示音
   */
  public play(effect: SoundEffectType): void {
    const now = Date.now();
    const lastTime = this.lastPlayedMap.get(effect) || 0;
    if (now - lastTime < this.THROTTLE_MS) {
      return; // 节流丢弃，避免连按爆音
    }
    this.lastPlayedMap.set(effect, now);

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      switch (effect) {
        case "MUTE":
          // 麦克风静音：双音下行，带温和阻尼收敛感
          this.playNotes(ctx, [
            { freq: 480, duration: 0.06, type: "sine", gain: 0.14 },
            { freq: 330, duration: 0.08, type: "sine", gain: 0.12 },
          ]);
          break;

        case "UNMUTE":
          // 麦克风开启：双音上行，清脆明亮
          this.playNotes(ctx, [
            { freq: 330, duration: 0.06, type: "sine", gain: 0.12 },
            { freq: 480, duration: 0.08, type: "sine", gain: 0.15 },
          ]);
          break;

        case "DEAFEN":
          // 开启拒听：低沉三音阶下行，提示声音完全切断
          this.playNotes(
            ctx,
            [
              { freq: 440, duration: 0.05, type: "triangle", gain: 0.15 },
              { freq: 330, duration: 0.05, type: "triangle", gain: 0.13 },
              { freq: 220, duration: 0.09, type: "triangle", gain: 0.11 },
            ],
            0.015,
          );
          break;

        case "UNDEAFEN":
          // 解除拒听：明亮三音阶上行，提示音频恢复连通
          this.playNotes(
            ctx,
            [
              { freq: 220, duration: 0.05, type: "sine", gain: 0.12 },
              { freq: 330, duration: 0.05, type: "sine", gain: 0.14 },
              { freq: 440, duration: 0.08, type: "sine", gain: 0.16 },
            ],
            0.015,
          );
          break;

        case "VOICE_JOIN":
          // 自己进入语音频道：清脆饱满的大三和弦上行琶音
          this.playNotes(
            ctx,
            [
              { freq: 523.25, duration: 0.06, type: "sine", gain: 0.15 }, // C5
              { freq: 659.25, duration: 0.06, type: "sine", gain: 0.16 }, // E5
              { freq: 783.99, duration: 0.11, type: "sine", gain: 0.18 }, // G5
            ],
            0.02,
          );
          break;

        case "VOICE_LEAVE":
          // 自己退出语音频道：大三和弦下行渐弱
          this.playNotes(
            ctx,
            [
              { freq: 783.99, duration: 0.05, type: "sine", gain: 0.16 }, // G5
              { freq: 659.25, duration: 0.05, type: "sine", gain: 0.14 }, // E5
              { freq: 523.25, duration: 0.1, type: "sine", gain: 0.12 }, // C5
            ],
            0.02,
          );
          break;

        case "USER_JOIN":
          // 频道内其他成员加入：轻量短促双音（音量略低于自身提示音，不喧宾夺主）
          this.playNotes(
            ctx,
            [
              { freq: 587.33, duration: 0.04, type: "sine", gain: 0.08 }, // D5
              { freq: 880.0, duration: 0.06, type: "sine", gain: 0.09 }, // A5
            ],
            0.015,
          );
          break;

        case "USER_LEAVE":
          // 频道内其他成员离开：轻量短促双音下行
          this.playNotes(
            ctx,
            [
              { freq: 880.0, duration: 0.04, type: "sine", gain: 0.09 }, // A5
              { freq: 587.33, duration: 0.06, type: "sine", gain: 0.07 }, // D5
            ],
            0.015,
          );
          break;

        case "CALL_CONNECT":
          // 通话接通：清脆明快的大三和弦升调
          this.playNotes(
            ctx,
            [
              { freq: 440.0, duration: 0.06, type: "sine", gain: 0.14 },
              { freq: 554.37, duration: 0.06, type: "sine", gain: 0.16 },
              { freq: 659.25, duration: 0.08, type: "sine", gain: 0.18 },
              { freq: 880.0, duration: 0.12, type: "sine", gain: 0.2 },
            ],
            0.02,
          );
          break;

        case "CALL_DISCONNECT":
          // 通话挂断/拒接：Discord 经典下行沉闷三连音
          this.playNotes(
            ctx,
            [
              { freq: 587.33, duration: 0.07, type: "sine", gain: 0.16 }, // D5
              { freq: 440.0, duration: 0.07, type: "sine", gain: 0.14 }, // A4
              { freq: 329.63, duration: 0.12, type: "sine", gain: 0.12 }, // E4
            ],
            0.03,
          );
          break;

        case "CALL_CALLING":
        case "CALL_RINGING":
          // 单次触发直接委托给单周期播放
          this.playLoopStep(ctx, effect);
          break;

        default:
          break;
      }
    } catch (err) {
      console.warn("[SoundManager] Failed to synthesize sound effect:", err);
    }
  }

  private loopIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private currentLoopEffect: "CALL_RINGING" | "CALL_CALLING" | null = null;

  private playLoopStep(
    ctx: AudioContext,
    effect: "CALL_RINGING" | "CALL_CALLING",
  ) {
    if (effect === "CALL_CALLING") {
      // 呼出回铃音：经典优雅的 440Hz + 480Hz 双音和弦，节奏 1.2s 响，1.8s 停
      const now = ctx.currentTime + 0.01;
      this.playDualTone(ctx, 440, 480, now, 1.1, "sine", 0.12);
    } else if (effect === "CALL_RINGING") {
      // 来电振铃音：模拟 Discord 标志性的活力和弦旋律节奏
      this.playNotes(
        ctx,
        [
          { freq: 523.25, duration: 0.09, type: "sine", gain: 0.16 }, // C5
          { freq: 659.25, duration: 0.09, type: "sine", gain: 0.16 }, // E5
          { freq: 783.99, duration: 0.12, type: "sine", gain: 0.18 }, // G5
          { freq: 659.25, duration: 0.09, type: "sine", gain: 0.15 }, // E5
          { freq: 783.99, duration: 0.09, type: "sine", gain: 0.18 }, // G5
          { freq: 1046.5, duration: 0.18, type: "sine", gain: 0.2 }, // C6
        ],
        0.02,
      );
    }
  }

  /**
   * 播放双音和弦 (如呼出回铃音)
   */
  private playDualTone(
    ctx: AudioContext,
    freq1: number,
    freq2: number,
    startTime: number,
    duration: number,
    type: OscillatorType = "sine",
    peakGain: number = 0.12,
  ) {
    this.playTone(ctx, freq1, startTime, duration, type, peakGain * 0.6);
    this.playTone(ctx, freq2, startTime, duration, type, peakGain * 0.6);
  }

  /**
   * 开启持续循环音效 (如回铃音或来电铃声)
   */
  public startLoop(effect: "CALL_RINGING" | "CALL_CALLING"): void {
    if (this.currentLoopEffect === effect && this.loopIntervalTimer) {
      return; // 已经在播放该循环
    }
    this.stopLoop();
    this.currentLoopEffect = effect;

    const ctx = this.getAudioContext();
    if (!ctx) return;

    // 立即播放第一拍
    this.playLoopStep(ctx, effect);

    const periodMs = effect === "CALL_CALLING" ? 3000 : 2500;
    this.loopIntervalTimer = setInterval(() => {
      const activeCtx = this.getAudioContext();
      if (!activeCtx) return;
      this.playLoopStep(activeCtx, effect);
    }, periodMs);
  }

  /**
   * 停止循环音效
   */
  public stopLoop(): void {
    if (this.loopIntervalTimer) {
      clearInterval(this.loopIntervalTimer);
      this.loopIntervalTimer = null;
    }
    this.currentLoopEffect = null;
  }

  /**
   * 路由提示音输出设备 (setSinkId)
   */
  public async setSinkId(deviceId: string): Promise<void> {
    const ctx = this.getAudioContext();
    if (ctx && typeof (ctx as any).setSinkId === "function") {
      try {
        await (ctx as any).setSinkId(deviceId === "default" ? "" : deviceId);
      } catch (err) {
        console.warn("[SoundManager] setSinkId failed:", err);
      }
    }
  }
}

export const soundManager = new SoundEffectManager();
