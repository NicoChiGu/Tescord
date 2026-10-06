import React, { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { useAudioPlayerStore } from "../../stores/useAudioPlayerStore.js";
import {
  getAudioPeaks,
  getInitialAudioPeaks,
  formatAudioTime,
} from "../../utils/audioWaveform.js";

const BARS_COUNT = 32;

export const GlobalMiniPlayer: React.FC = () => {
  const { t } = useTranslation("chat");
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
    playTrack,
    pauseTrack,
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

  useEffect(() => {
    return () => {
      scrubCleanupRef.current?.();
      scrubCleanupRef.current = null;
    };
  }, []);

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

  const progressRatio = duration > 0
    ? Math.max(0, Math.min(1, (scrubPercent !== null ? scrubPercent : (currentTime / duration))))
    : 0;

  // 波形拖拽寻道计算
  const calculatePercent = (clientX: number): number => {
    if (!waveformRef.current) return 0;
    const rect = waveformRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleWaveformMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const percent = calculatePercent(e.clientX);
    setIsScrubbing(true);
    setScrubPercent(percent);

    const onMouseMove = (moveEvent: MouseEvent) => {
      setScrubPercent(calculatePercent(moveEvent.clientX));
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      scrubCleanupRef.current = null;
    };
    scrubCleanupRef.current = cleanup;

    const onMouseUp = (upEvent: MouseEvent) => {
      cleanup();

      const finalPercent = calculatePercent(upEvent.clientX);
      setIsScrubbing(false);
      setScrubPercent(null);
      seek(finalPercent * (duration || 1));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const cyclePlaybackRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  const displayTime = formatAudioTime(currentTime);
  const displayTotalDuration = formatAudioTime(duration);

  return (
    <div
      data-testid="global-mini-audio-player"
      className="fixed bottom-5 right-5 z-50 select-none animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      {!isExpanded ? (
        /* 极简迷你胶囊状态 (Minimal Capsule Pill) */
        <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#1e1f22]/95 backdrop-blur-md border border-[#383a40] hover:border-discord-brand/50 rounded-full shadow-2xl text-white transition-all duration-200 hover:shadow-discord-brand/10">
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
          <button
            type="button"
            onClick={() => togglePlay(activeTrack)}
            title={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
            aria-label={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
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

          {/* 展开完整面板按钮 */}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            title={t("audioPlayer.expand")}
            aria-label={t("audioPlayer.expand")}
            className="p-1 text-discord-textMuted hover:text-white transition-colors rounded-full hover:bg-[#35373c] cursor-pointer"
          >
            <ChevronUp className="w-4 h-4" />
          </button>

          {/* 关闭/销毁当前播放器 */}
          <button
            type="button"
            onClick={close}
            title={t("audioPlayer.close")}
            aria-label={t("audioPlayer.close")}
            className="p-1 text-discord-textMuted hover:text-red-400 transition-colors rounded-full hover:bg-[#35373c] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* 展开完整浮动播放卡片 (Expanded Floating Dock) */
        <div className="flex flex-col gap-3 p-4 bg-[#1e1f22]/95 backdrop-blur-lg border border-[#383a40] rounded-2xl shadow-2xl text-white w-80 transition-all duration-200">
          {/* 顶栏：标题与操作 */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
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
                <div className="text-[10px] text-discord-textMuted">
                  {t("audioPlayer.nowPlaying")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                title={t("audioPlayer.collapse")}
                aria-label={t("audioPlayer.collapse")}
                className="p-1 text-discord-textMuted hover:text-white transition-colors rounded hover:bg-[#35373c] cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={close}
                title={t("audioPlayer.close")}
                aria-label={t("audioPlayer.close")}
                className="p-1 text-discord-textMuted hover:text-red-400 transition-colors rounded hover:bg-[#35373c] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 波形进度轨 (支持点击/拖拽 seek) */}
          <div className="flex flex-col gap-1">
            <div
              ref={waveformRef}
              role="slider"
              tabIndex={0}
              aria-label={t("audioPlayer.seekTooltip")}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              onMouseDown={handleWaveformMouseDown}
              className={`h-9 flex items-center justify-between gap-[2px] px-1.5 py-1 bg-[#2b2d31]/80 rounded-lg cursor-pointer select-none border border-transparent hover:border-[#4e5058]/50 ${
                isScrubbing ? "ring-1 ring-discord-brand" : ""
              }`}
            >
              {peaks.map((heightRatio, idx) => {
                const barRatio = (idx + 0.5) / BARS_COUNT;
                const isPlayed = barRatio <= progressRatio;
                const heightPercent = Math.round(heightRatio * 100);

                return (
                  <div
                    key={idx}
                    className="flex-1 h-full flex items-center justify-center"
                  >
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full max-w-[3.5px] rounded-full transition-all duration-75 ${
                        isPlayed
                          ? "bg-discord-brand"
                          : "bg-[#4e5058] hover:bg-[#5c5e66]"
                      }`}
                    />
                  </div>
                );
              })}
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
              <button
                type="button"
                onClick={() => togglePlay(activeTrack)}
                title={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
                aria-label={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
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

              {/* 倍速 */}
              <button
                type="button"
                onClick={cyclePlaybackRate}
                title={t("audioPlayer.playbackRate", { rate: playbackRate })}
                aria-label={t("audioPlayer.playbackRate", { rate: playbackRate })}
                className="text-[10px] font-bold px-2 py-1 rounded bg-[#2b2d31] text-discord-interactiveNormal hover:text-white hover:bg-[#35373c] transition-colors cursor-pointer"
              >
                {playbackRate}x
              </button>
            </div>

            {/* 音量控制 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")}
                aria-label={isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")}
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
