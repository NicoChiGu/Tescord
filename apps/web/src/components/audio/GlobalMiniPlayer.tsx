import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  X,
  ChevronUp,
  ChevronDown,
  Music,
  Loader2,
  GripVertical,
} from "lucide-react";
import { useAudioPlayerStore } from "../../stores/useAudioPlayerStore.js";
import {
  getAudioPeaks,
  getInitialAudioPeaks,
  formatAudioTime,
} from "../../utils/audioWaveform.js";
import { Tooltip } from "../ui/Tooltip.js";

const BARS_COUNT = 32;

export const GlobalMiniPlayer: React.FC = () => {
  const { t } = useTranslation("chat");
  const playerRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  const {
    activeTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playbackRate,
    isBuffering,
    isExpanded,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    setIsExpanded,
    close,
  } = useAudioPlayerStore();

  const [peaks, setPeaks] = useState<number[]>([]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const scrubCleanupRef = useRef<(() => void) | null>(null);

  // 窗口拖拽与磁吸状态
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isDraggingPlayer, setIsDraggingPlayer] = useState(false);
  const [snappedSide, setSnappedSide] = useState<"left" | "right">("right");
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      scrubCleanupRef.current?.();
      dragCleanupRef.current?.();
    };
  }, []);

  // 窗口初始化位置
  useEffect(() => {
    if (position === null && typeof window !== "undefined") {
      const widgetWidth = 320;
      const initialY = Math.max(20, window.innerHeight - 240);
      const initialX = Math.max(10, window.innerWidth - widgetWidth - 20);
      setPosition({ x: initialX, y: initialY });
    }
  }, [position]);

  // 窗口 resize 保持贴边与移动端边界约束
  useEffect(() => {
    const handleResize = () => {
      if (!playerRef.current) return;
      const widgetWidth = playerRef.current.offsetWidth || 320;
      setPosition((prev) => {
        if (!prev) return null;
        const margin = Math.min(
          20,
          Math.max(8, (window.innerWidth - widgetWidth) / 2),
        );
        const newX =
          snappedSide === "left"
            ? Math.max(0, margin)
            : Math.max(0, window.innerWidth - widgetWidth - margin);
        const newY = Math.max(
          10,
          Math.min(
            window.innerHeight - (playerRef.current?.offsetHeight || 80) - 10,
            prev.y,
          ),
        );
        return { x: newX, y: newY };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [snappedSide]);

  // 浮窗全窗口拖拽与吸附两侧逻辑 (全端统合 Pointer Events，深度支持触屏与移动端手势)
  const handlePlayerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 鼠标仅允许主键 (左键)，移动端触控/触控笔不受 button 限制
    if (e.pointerType === "mouse" && e.button !== 0) {
      return;
    }
    // 忽略按钮与交互区域触发的拖拽
    if ((e.target as HTMLElement).closest("button, input, [role='slider']")) {
      return;
    }
    e.preventDefault();

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {}

    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = position || {
      x: Math.max(
        10,
        window.innerWidth - (playerRef.current?.offsetWidth || 320) - 20,
      ),
      y: Math.max(10, window.innerHeight - 240),
    };

    setIsDraggingPlayer(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const widgetWidth = playerRef.current?.offsetWidth || 320;
      const widgetHeight = playerRef.current?.offsetHeight || 160;

      // 移动端视口边界防护：确保不超出屏幕可视区域
      const safeMaxX = Math.max(0, window.innerWidth - widgetWidth);
      const safeMaxY = Math.max(0, window.innerHeight - widgetHeight - 10);

      const clampedX = Math.max(0, Math.min(safeMaxX, initialPos.x + deltaX));
      const clampedY = Math.max(10, Math.min(safeMaxY, initialPos.y + deltaY));

      setPosition({ x: clampedX, y: clampedY });
    };

    const cleanup = () => {
      try {
        target.releasePointerCapture(pointerId);
      } catch {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      setIsDraggingPlayer(false);

      if (!playerRef.current) return;
      const widgetWidth = playerRef.current.offsetWidth || 320;

      setPosition((prev) => {
        if (!prev) return null;
        const centerX = prev.x + widgetWidth / 2;
        const snapLeft = centerX < window.innerWidth / 2;

        setSnappedSide(snapLeft ? "left" : "right");
        // 移动端防越界安全磁吸边距
        const margin = Math.min(
          20,
          Math.max(8, (window.innerWidth - widgetWidth) / 2),
        );
        const targetX = snapLeft
          ? Math.max(0, margin)
          : Math.max(0, window.innerWidth - widgetWidth - margin);

        return { x: targetX, y: prev.y };
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  // 当活跃音轨变更时加载波形数据
  useEffect(() => {
    if (!activeTrack) {
      setPeaks([]);
      return;
    }
    setPeaks(getInitialAudioPeaks(activeTrack.id, BARS_COUNT));
    getAudioPeaks(activeTrack.url, activeTrack.id, BARS_COUNT)
      .then((extracted) => {
        setPeaks(extracted);
      })
      .catch(() => {});
  }, [activeTrack?.id, activeTrack?.url]);

  if (!activeTrack) {
    return null;
  }

  const progressRatio =
    duration > 0
      ? Math.max(
          0,
          Math.min(
            1,
            scrubPercent !== null ? scrubPercent : currentTime / duration,
          ),
        )
      : 0;

  // 波形拖拽寻道计算
  const calculatePercent = (clientX: number): number => {
    if (!waveformRef.current) return 0;
    const rect = waveformRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {}

    const percent = calculatePercent(e.clientX);
    setIsScrubbing(true);
    setScrubPercent(percent);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setScrubPercent(calculatePercent(moveEvent.clientX));
    };

    const cleanup = () => {
      try {
        target.releasePointerCapture(pointerId);
      } catch {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      scrubCleanupRef.current = null;
    };
    scrubCleanupRef.current = cleanup;

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      const finalPercent = calculatePercent(upEvent.clientX);
      setIsScrubbing(false);
      setScrubPercent(null);
      seek(finalPercent * (duration || 1));
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const cyclePlaybackRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  const displayTime = formatAudioTime(currentTime);
  const displayTotalDuration = formatAudioTime(duration);
  const scrubTargetSeconds =
    (scrubPercent !== null ? scrubPercent : progressRatio) * (duration || 0);
  const scrubDisplayTime = formatAudioTime(scrubTargetSeconds);

  const stylePosition: React.CSSProperties = position
    ? {
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
        transition: isDraggingPlayer
          ? "none"
          : "left 0.3s cubic-bezier(0.16, 1, 0.3, 1), top 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }
    : {};

  return (
    <div
      ref={playerRef}
      style={stylePosition}
      data-testid="global-mini-audio-player"
      onPointerDown={handlePlayerPointerDown}
      className={`fixed z-50 select-none touch-none ${
        position ? "" : "bottom-5 right-5"
      } ${
        isDraggingPlayer
          ? "cursor-grabbing opacity-90 scale-[1.01]"
          : "cursor-default"
      }`}
    >
      {!isExpanded ? (
        /* 极简迷你胶囊状态 (Minimal Capsule Pill) */
        <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#1e1f22]/95 backdrop-blur-md border border-[#383a40] hover:border-discord-brand/50 rounded-full shadow-2xl text-white transition-all duration-200 hover:shadow-discord-brand/10">
          <div className="cursor-grab active:cursor-grabbing text-discord-textMuted hover:text-white p-1 -ml-1 touch-none">
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* 音乐状态图标 */}
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
              isPlaying
                ? "bg-discord-brand text-white animate-pulse"
                : "bg-discord-brand/20 text-discord-brand"
            }`}
          >
            <Music className="w-3.5 h-3.5" />
          </div>

          {/* 简要歌曲信息与时间 */}
          <div
            className="flex flex-col min-w-0 max-w-[130px] cursor-pointer"
            onClick={() => setIsExpanded(true)}
            title={activeTrack.fileName}
          >
            <span className="text-xs font-semibold truncate leading-tight">
              {activeTrack.fileName}
            </span>
            <span className="text-[10px] font-mono text-discord-textMuted mt-0.5">
              {displayTime} / {displayTotalDuration}
            </span>
          </div>

          {/* 播放/暂停控制 */}
          <Tooltip
            content={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
          >
            <button
              type="button"
              onClick={() => togglePlay(activeTrack)}
              aria-label={
                isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")
              }
              className="w-7 h-7 rounded-full bg-discord-brand hover:bg-discord-brand/90 text-white flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer shadow"
            >
              {isBuffering ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
              )}
            </button>
          </Tooltip>

          {/* 展开完整面板按钮 */}
          <Tooltip content={t("audioPlayer.expand")}>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              aria-label={t("audioPlayer.expand")}
              className="p-1 text-discord-textMuted hover:text-white transition-colors rounded-full hover:bg-[#35373c] cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </Tooltip>

          {/* 关闭/销毁当前播放器 */}
          <Tooltip content={t("audioPlayer.close")}>
            <button
              type="button"
              onClick={close}
              aria-label={t("audioPlayer.close")}
              className="p-1 text-discord-textMuted hover:text-red-400 transition-colors rounded-full hover:bg-[#35373c] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      ) : (
        /* 展开完整浮动播放卡片 (Expanded Floating Dock) */
        <div className="flex flex-col gap-3 p-4 bg-[#1e1f22]/95 backdrop-blur-lg border border-[#383a40] rounded-2xl shadow-2xl text-white w-80 max-w-[calc(100vw-20px)] transition-all duration-200">
          {/* 顶栏：拖拽把手、标题与操作 */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="cursor-grab active:cursor-grabbing text-discord-textMuted hover:text-white p-1 -ml-1 touch-none">
                <GripVertical className="w-4 h-4" />
              </div>

              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isPlaying
                    ? "bg-discord-brand text-white animate-pulse"
                    : "bg-discord-brand/20 text-discord-brand"
                }`}
              >
                <Music className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-semibold truncate text-white"
                  title={activeTrack.fileName}
                >
                  {activeTrack.fileName}
                </div>
                <div className="text-[10px] text-discord-textMuted flex items-center gap-1.5">
                  <span>{t("audioPlayer.nowPlaying")}</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-black/40 text-gray-400">
                    {snappedSide === "left"
                      ? t("audioPlayer.snapLeft")
                      : t("audioPlayer.snapRight")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Tooltip content={t("audioPlayer.collapse")}>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  aria-label={t("audioPlayer.collapse")}
                  className="p-1 text-discord-textMuted hover:text-white transition-colors rounded hover:bg-[#35373c] cursor-pointer"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </Tooltip>

              <Tooltip content={t("audioPlayer.close")}>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("audioPlayer.close")}
                  className="p-1 text-discord-textMuted hover:text-red-400 transition-colors rounded hover:bg-[#35373c] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* 波形进度轨：左向右平滑连续填充效果 + 拖拽时间下指示标 Tooltip */}
          <div className="flex flex-col gap-1 relative">
            {/* 拖拽寻道时浮动的 Tooltip + 下标小三角指示器 */}
            {isScrubbing && (
              <div
                data-testid="audio-scrub-tooltip"
                style={{
                  left: `${(scrubPercent !== null ? scrubPercent : progressRatio) * 100}%`,
                }}
                className="absolute -top-11 -translate-x-1/2 pointer-events-none z-30 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="bg-[#111214] text-white px-2.5 py-1 rounded-md shadow-2xl border border-[#383a40] flex items-center gap-1.5 text-[11px] font-mono whitespace-nowrap">
                  <span className="font-bold text-discord-brand">
                    {scrubDisplayTime}
                  </span>
                  <span className="text-[10px] text-discord-textMuted">
                    / {displayTotalDuration}
                  </span>
                </div>
                {/* 向下三角形下标指示器 (Down-arrow pin indicator) */}
                <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#111214] -mt-[1px]" />
              </div>
            )}

            <div
              ref={waveformRef}
              role="slider"
              tabIndex={0}
              aria-label={t("audioPlayer.seekTooltip")}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              onPointerDown={handleWaveformPointerDown}
              className={`relative h-10 bg-[#2b2d31]/80 rounded-lg cursor-pointer select-none touch-none border border-transparent hover:border-[#4e5058]/50 overflow-hidden ${
                isScrubbing ? "ring-1 ring-discord-brand" : ""
              }`}
            >
              {/* 底层：未播放波形条柱 (灰阶底色) */}
              <div className="absolute inset-0 flex items-center justify-between gap-[2px] px-1.5 py-1">
                {peaks.map((heightRatio, idx) => {
                  const heightPercent = Math.round(heightRatio * 100);
                  return (
                    <div
                      key={`bg-${idx}`}
                      className="flex-1 h-full flex items-center justify-center"
                    >
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className="w-full max-w-[3.5px] rounded-full bg-[#4e5058]/70"
                      />
                    </div>
                  );
                })}
              </div>

              {/* 顶层：已播放波形条柱 (利用 clipPath 实现亚像素级从左到右平滑连续填充) */}
              <div
                data-testid="audio-waveform-fill"
                style={{
                  clipPath: `inset(0 ${Math.max(
                    0,
                    (1 - progressRatio) * 100,
                  )}% 0 0)`,
                }}
                className="absolute inset-0 flex items-center justify-between gap-[2px] px-1.5 py-1 pointer-events-none transition-[clip-path] duration-75"
              >
                {peaks.map((heightRatio, idx) => {
                  const heightPercent = Math.round(heightRatio * 100);
                  return (
                    <div
                      key={`fg-${idx}`}
                      className="flex-1 h-full flex items-center justify-center"
                    >
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className="w-full max-w-[3.5px] rounded-full bg-gradient-to-r from-[#5865f2] to-[#7983f5] shadow-sm"
                      />
                    </div>
                  );
                })}
              </div>

              {/* 播放光标游标 (Cursor Thumb) */}
              <div
                style={{
                  left: `${progressRatio * 100}%`,
                }}
                className="absolute top-1 bottom-1 w-[2px] bg-white rounded-full shadow pointer-events-none -translate-x-1/2"
              />
            </div>

            {/* 时间标签 */}
            <div className="flex items-center justify-between text-[10px] font-mono text-discord-textMuted px-0.5">
              <span>{displayTime}</span>
              <span>{displayTotalDuration}</span>
            </div>
          </div>

          {/* 控制按钮与音量滑块 */}
          <div className="flex items-center justify-between pt-1 border-t border-[#313338]">
            {/* 播放/暂停控制 */}
            <div className="flex items-center gap-2">
              <Tooltip
                content={
                  isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")
                }
              >
                <button
                  type="button"
                  onClick={() => togglePlay(activeTrack)}
                  aria-label={
                    isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")
                  }
                  className="w-8 h-8 rounded-full bg-discord-brand hover:bg-discord-brand/90 text-white flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer shadow"
                >
                  {isBuffering ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current translate-x-0.5" />
                  )}
                </button>
              </Tooltip>

              {/* 倍速 */}
              <Tooltip
                content={t("audioPlayer.playbackRate", { rate: playbackRate })}
              >
                <button
                  type="button"
                  onClick={cyclePlaybackRate}
                  aria-label={t("audioPlayer.playbackRate", {
                    rate: playbackRate,
                  })}
                  className="text-[10px] font-bold px-2 py-1 rounded bg-[#2b2d31] text-discord-interactiveNormal hover:text-white hover:bg-[#35373c] transition-colors cursor-pointer"
                >
                  {playbackRate}x
                </button>
              </Tooltip>
            </div>

            {/* 音量控制 */}
            <div className="flex items-center gap-2">
              <Tooltip
                content={
                  isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")
                }
              >
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={
                    isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")
                  }
                  className="p-1 text-discord-textMuted hover:text-white transition-colors rounded hover:bg-[#35373c] cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
              </Tooltip>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-16 h-1.5 accent-discord-brand bg-[#383a40] rounded-lg cursor-pointer"
                aria-label={t("audioPlayer.volume")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
