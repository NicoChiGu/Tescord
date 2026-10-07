import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Attachment } from "@tescord/types";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Volume1,
  Download,
  RefreshCw,
  Loader2,
  Music,
} from "lucide-react";
import { resolveServerUrl } from "../../config.js";
import {
  getAttachmentAccess,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";
import {
  useAudioPlayerStore,
  type AudioTrackInfo,
} from "../../stores/useAudioPlayerStore.js";
import {
  getAudioPeaks,
  getInitialAudioPeaks,
  formatAudioTime,
} from "../../utils/audioWaveform.js";

const BARS_COUNT = 36;

interface AudioAttachmentProps {
  attachment: Attachment;
}

export const AudioAttachment: React.FC<AudioAttachmentProps> = ({
  attachment,
}) => {
  const { t } = useTranslation("chat");
  const waveformRef = useRef<HTMLDivElement>(null);
  const scrubCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      scrubCleanupRef.current?.();
      scrubCleanupRef.current = null;
    };
  }, []);

  const [mediaUrl, setMediaUrl] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() =>
    getInitialAudioPeaks(attachment.id, BARS_COUNT),
  );
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [localDuration, setLocalDuration] = useState<number>(0);

  // 全局音频播放器 Store
  const {
    activeTrack,
    isPlaying,
    currentTime,
    duration: globalDuration,
    volume,
    isMuted,
    playbackRate,
    isBuffering,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
  } = useAudioPlayerStore();

  const isCurrentTrack = activeTrack?.id === attachment.id;
  const isCurrentlyPlaying = isCurrentTrack && isPlaying;
  const isCurrentlyBuffering = isCurrentTrack && isBuffering;

  const currentDuration =
    isCurrentTrack && globalDuration > 0 ? globalDuration : localDuration;

  const currentProgressSeconds = isCurrentTrack ? currentTime : 0;
  const progressRatio =
    currentDuration > 0
      ? Math.max(
          0,
          Math.min(
            1,
            scrubPercent !== null
              ? scrubPercent
              : currentProgressSeconds / currentDuration,
          ),
        )
      : 0;

  // 1. 获取直链与初始元数据
  const loadMedia = useCallback(
    (forceRefresh = false) => {
      setLoadError(null);
      getAttachmentAccess(attachment, forceRefresh)
        .then((access) => {
          const finalUrl = resolveServerUrl(access.url);
          setMediaUrl(finalUrl);

          // 探测音频时长
          const tempAudio = new Audio();
          tempAudio.preload = "metadata";
          tempAudio.src = finalUrl;
          tempAudio.onloadedmetadata = () => {
            if (Number.isFinite(tempAudio.duration) && tempAudio.duration > 0) {
              setLocalDuration(tempAudio.duration);
            }
          };

          // 提取波形 peaks
          getAudioPeaks(finalUrl, attachment.id, BARS_COUNT)
            .then((extractedPeaks) => {
              setPeaks(extractedPeaks);
            })
            .catch(() => {
              // 失败已有 fallback
            });
        })
        .catch((cause: unknown) => {
          setLoadError(
            cause instanceof Error
              ? cause.message
              : t("audioPlayer.loadFailed"),
          );
        });
    },
    [attachment, t],
  );

  useEffect(() => {
    loadMedia(false);
  }, [loadMedia]);

  // 2. 播放/暂停控制
  const handleTogglePlay = () => {
    if (!mediaUrl) return;
    const trackInfo: AudioTrackInfo = {
      id: attachment.id,
      url: mediaUrl,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      duration: currentDuration,
    };
    togglePlay(trackInfo);
  };

  // 3. 波形 Seek 与拖拽
  const calculatePercentFromEvent = (clientX: number): number => {
    if (!waveformRef.current) return 0;
    const rect = waveformRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    return Math.max(0, Math.min(1, relativeX / rect.width));
  };

  const handleWaveformMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!mediaUrl) return;

    const percent = calculatePercentFromEvent(e.clientX);
    setIsScrubbing(true);
    setScrubPercent(percent);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const p = calculatePercentFromEvent(moveEvent.clientX);
      setScrubPercent(p);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      scrubCleanupRef.current = null;
    };
    scrubCleanupRef.current = cleanup;

    const onMouseUp = (upEvent: MouseEvent) => {
      cleanup();

      const finalPercent = calculatePercentFromEvent(upEvent.clientX);
      setIsScrubbing(false);
      setScrubPercent(null);

      const targetDuration = currentDuration || 1;
      const targetTime = finalPercent * targetDuration;

      if (!isCurrentTrack) {
        // 如果当前未播放该卡片，点击波形直接启动播放并跳转
        const trackInfo: AudioTrackInfo = {
          id: attachment.id,
          url: mediaUrl,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          duration: currentDuration,
        };
        togglePlay(trackInfo);
        // 微延迟以确保音频实例准备就绪
        setTimeout(() => {
          seek(targetTime);
        }, 50);
      } else {
        seek(targetTime);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // 4. 倍速切换 (1.0x -> 1.25x -> 1.5x -> 2.0x)
  const cyclePlaybackRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  // 5. 下载文件
  const handleDownload = () => {
    void openAttachmentDownload(attachment).catch((cause: unknown) => {
      setLoadError(
        cause instanceof Error ? cause.message : t("lightbox.downloadFailed"),
      );
    });
  };

  const displayTime = isCurrentTrack ? formatAudioTime(currentTime) : "00:00";
  const displayTotalDuration = formatAudioTime(currentDuration);

  return (
    <div
      data-testid="audio-attachment-player"
      className={`group/player relative flex flex-col gap-2.5 bg-[#2b2d31] p-3 rounded-xl border transition-all duration-200 w-full max-w-md text-discord-textNormal shadow-sm ${
        isCurrentTrack
          ? "border-discord-brand/60 shadow-discord-brand/10 shadow-md ring-1 ring-discord-brand/30"
          : "border-[#383a40] hover:border-[#4e5058]"
      }`}
    >
      {/* 顶部：音频元信息与操作栏 */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={`p-1.5 rounded-lg shrink-0 transition-colors ${
              isCurrentlyPlaying
                ? "bg-discord-brand text-white animate-pulse"
                : "bg-discord-brand/20 text-discord-brand"
            }`}
          >
            <Music className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-xs font-semibold text-white truncate"
              title={attachment.fileName}
            >
              {attachment.fileName}
            </div>
            <div className="text-[10px] text-discord-textMuted flex items-center gap-1.5 mt-0.5">
              <span>{(attachment.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
              <span>·</span>
              <span className="font-mono text-gray-300">
                {displayTime} / {displayTotalDuration}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧轻量控制区：倍速、音量滑块与下载 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 倍速胶囊 */}
          <button
            type="button"
            onClick={cyclePlaybackRate}
            title={t("audioPlayer.playbackRate", { rate: playbackRate })}
            aria-label={t("audioPlayer.playbackRate", { rate: playbackRate })}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1e1f22] text-discord-interactiveNormal hover:text-white hover:bg-[#35373c] transition-colors"
          >
            {playbackRate}x
          </button>

          {/* 音量控制按钮与悬停浮动滑块 */}
          <div
            className="relative flex items-center"
            onMouseEnter={() => setShowVolumeSlider(true)}
            onMouseLeave={() => setShowVolumeSlider(false)}
          >
            <button
              type="button"
              onClick={toggleMute}
              title={isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")}
              aria-label={
                isMuted ? t("audioPlayer.unmute") : t("audioPlayer.mute")
              }
              className="p-1 text-discord-textMuted hover:text-white transition-colors rounded hover:bg-[#35373c]"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>

            {/* 悬停音量滑块小弹出窗 */}
            {showVolumeSlider && (
              <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-2 shadow-xl flex items-center gap-1.5 z-20">
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
                <span className="text-[10px] font-mono text-gray-300 w-6 text-right">
                  {Math.round((isMuted ? 0 : volume) * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* 下载按钮 */}
          <button
            type="button"
            onClick={handleDownload}
            title={`${t("audioPlayer.download")}: ${attachment.fileName}`}
            aria-label={`${t("audioPlayer.download")}: ${attachment.fileName}`}
            className="p-1 text-discord-textMuted hover:text-white transition-colors rounded hover:bg-[#35373c]"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* 失败重试按钮 */}
          {loadError && (
            <button
              type="button"
              onClick={() => loadMedia(true)}
              title={t("audioPlayer.retry")}
              aria-label={t("audioPlayer.retry")}
              className="p-1 text-red-400 hover:text-red-300 transition-colors rounded hover:bg-[#35373c]"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 中部核心：播放按钮与波形条交互区 */}
      <div className="flex items-center gap-3">
        {/* 播放/暂停圆形大按钮 */}
        <button
          type="button"
          onClick={handleTogglePlay}
          disabled={!mediaUrl || !!loadError}
          title={
            isCurrentlyPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")
          }
          aria-label={
            isCurrentlyPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")
          }
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-md ${
            isCurrentlyPlaying
              ? "bg-discord-brand text-white hover:brightness-110"
              : "bg-[#5865F2] hover:bg-[#4752C4] text-white"
          } ${!mediaUrl ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {isCurrentlyBuffering ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isCurrentlyPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current translate-x-0.5" />
          )}
        </button>

        {/* 纯波形条进度轨（类似 SoundCloud / Discord 语音条，静态波形染色推进） */}
        <div
          ref={waveformRef}
          role="slider"
          tabIndex={0}
          aria-label={t("audioPlayer.seekTooltip")}
          aria-valuemin={0}
          aria-valuemax={currentDuration}
          aria-valuenow={currentProgressSeconds}
          onMouseDown={handleWaveformMouseDown}
          className={`flex-1 h-9 flex items-center justify-between gap-[2.5px] px-1.5 py-1 bg-[#1e1f22]/70 rounded-lg cursor-pointer select-none group/waveform transition-colors border border-transparent hover:border-[#4e5058]/50 ${
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
                  className={`w-full max-w-[4px] rounded-full transition-all duration-75 ${
                    isPlayed
                      ? "bg-discord-brand group-hover/waveform:brightness-110"
                      : "bg-[#4e5058] group-hover/waveform:bg-[#5c5e66]"
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 错误提示 */}
      {loadError && (
        <span role="alert" className="text-xs text-red-400">
          {loadError}
        </span>
      )}
    </div>
  );
};
