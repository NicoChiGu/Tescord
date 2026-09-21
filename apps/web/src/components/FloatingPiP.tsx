import React, { useEffect, useRef, useState } from "react";
import { ActiveScreenShare } from "../services/livekit.js";
import { Maximize2, X, Volume2, ScreenShare } from "lucide-react";

interface FloatingPiPProps {
  share: ActiveScreenShare;
  streamerName: string;
  onReturnToChannel: () => void;
  onClose: () => void;
}

export const FloatingPiP: React.FC<FloatingPiPProps> = ({
  share,
  streamerName,
  onReturnToChannel,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !share.track) return;
    try {
      if (typeof share.track.attach === "function") {
        share.track.attach(videoRef.current);
      } else if (share.track instanceof MediaStreamTrack) {
        videoRef.current.srcObject = new MediaStream([share.track]);
      }
    } catch (err) {
      console.warn("FloatingPiP attach error:", err);
    }
  }, [share.track]);

  return (
    <div
      onClick={() => setShowControls((prev) => !prev)}
      className="fixed bottom-20 right-3 sm:bottom-6 sm:right-6 z-40 w-44 h-28 sm:w-72 sm:h-44 bg-black/95 rounded-xl border border-[#3f4147] shadow-2xl overflow-hidden group flex flex-col animate-fadeIn"
    >
      {/* 顶部悬浮工具条 */}
      <div
        className={`absolute top-0 left-0 right-0 p-2 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between z-10 transition ${
          showControls ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <div className="flex items-center space-x-1.5 text-[11px] text-white font-bold truncate">
          <span className="w-2 h-2 rounded-full bg-discord-danger animate-ping" />
          <span className="truncate">{streamerName} 的直播</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={onReturnToChannel}
            className="p-1 rounded hover:bg-white/20 text-white transition"
            title="回到直播语音房"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/20 text-white transition"
            title="关闭小窗"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 真实视频标签 */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={share.isLocal}
        className="w-full h-full object-cover cursor-pointer"
        onClick={onReturnToChannel}
      />

      {/* 底部悬浮指示胶囊 */}
      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-discord-textMuted flex items-center space-x-1 pointer-events-none">
        <ScreenShare className="w-3 h-3 text-discord-brand" />
        <span>画中画浮窗</span>
        {share.codec && (
          <span className="font-mono text-[9px] bg-discord-brand/30 text-discord-brand px-1 rounded font-bold">
            {share.codec}
          </span>
        )}
      </div>
    </div>
  );
};
