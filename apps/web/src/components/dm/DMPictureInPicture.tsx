import React, { useState, useRef, useEffect } from "react";
import { User } from "@tescord/types";
import { Mic, MicOff, PhoneOff, Maximize2, Move } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DMPictureInPictureProps {
  targetUser: User;
  onReturnToCall: () => void;
  onHangup: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isSpeakingRemote: boolean;
  remoteVideoTrack?: any;
  callDuration: string;
}

export const DMPictureInPicture: React.FC<DMPictureInPictureProps> = ({
  targetUser,
  onReturnToCall,
  onHangup,
  isMuted,
  onToggleMute,
  isSpeakingRemote,
  remoteVideoTrack,
  callDuration,
}) => {
  const { t } = useTranslation(["voice", "common"]);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 绑定远端视频流
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !remoteVideoTrack) return;
    try {
      if (typeof remoteVideoTrack.attach === "function") {
        remoteVideoTrack.attach(el);
      } else if (remoteVideoTrack instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([remoteVideoTrack]);
      } else if (remoteVideoTrack instanceof MediaStream) {
        el.srcObject = remoteVideoTrack;
      }
    } catch {}
    return () => {
      try {
        if (typeof remoteVideoTrack?.detach === "function" && el) {
          remoteVideoTrack.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [remoteVideoTrack]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    const currentX = position ? position.x : window.innerWidth - 260;
    const currentY = position ? position.y : window.innerHeight - 180;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: currentX,
      posY: currentY,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    const nextX = Math.max(16, Math.min(window.innerWidth - 256, dragStartRef.current.posX + dx));
    const nextY = Math.max(16, Math.min(window.innerHeight - 170, dragStartRef.current.posY + dy));
    setPosition({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  const style: React.CSSProperties = position
    ? { left: `${position.x}px`, top: `${position.y}px` }
    : { right: "24px", bottom: "80px" };

  return (
    <div
      data-testid="dm-pip-window"
      style={style}
      className="fixed z-50 w-60 h-36 bg-[#1e1f22] rounded-2xl border border-[#35373c] shadow-2xl flex flex-col overflow-hidden select-none animate-slide-up group"
    >
      {/* 顶部轻量拖拽手柄与返回通话按钮 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="h-8 bg-black/60 backdrop-blur-md px-3 flex items-center justify-between cursor-move text-xs text-zinc-300"
      >
        <div className="flex items-center space-x-1.5 truncate max-w-[130px]">
          <Move className="w-3 h-3 text-zinc-400 flex-shrink-0" />
          <span className="font-semibold text-white truncate text-[11px]">
            {targetUser.username}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 rounded">
            {callDuration}
          </span>
          <button
            onClick={onReturnToCall}
            className="p-1 hover:text-white transition"
            title={t("voice:dmCall.returnToCall", "返回通话视窗")}
            data-testid="dm-pip-expand-btn"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 视频或头像居中渲染 */}
      <div
        onClick={onReturnToCall}
        className="flex-1 bg-[#111214] relative flex items-center justify-center cursor-pointer overflow-hidden"
      >
        {remoteVideoTrack ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="relative">
            {targetUser.avatarUrl ? (
              <img
                src={targetUser.avatarUrl}
                alt={targetUser.username}
                className="w-12 h-12 rounded-full object-cover shadow"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-sm">
                {targetUser.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            {isSpeakingRemote && (
              <div className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60" />
            )}
          </div>
        )}

        {/* 悬浮快捷控制操作 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 flex items-center space-x-1.5"
        >
          <button
            onClick={onToggleMute}
            className={`p-1.5 rounded-full transition ${
              isMuted
                ? "bg-rose-500/30 text-rose-400"
                : "bg-black/60 text-zinc-300 hover:bg-black/80"
            }`}
            title={isMuted ? t("voice:unmute", "取消静音") : t("voice:mute", "静音")}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onHangup}
            data-testid="dm-pip-hangup-btn"
            className="p-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition transform hover:scale-105"
            title={t("voice:disconnect", "挂断通话")}
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
