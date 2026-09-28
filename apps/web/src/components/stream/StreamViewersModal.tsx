import React, { useState, useEffect, useRef } from "react";
import { User, GuildMember } from "@tescord/types";
import {
  X,
  Users,
  UserX,
  GripHorizontal,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export interface StreamViewerItem {
  userId: string;
  user?: Partial<User>;
  member?: GuildMember;
  displayName: string;
  avatarUrl?: string;
}

interface StreamViewersModalProps {
  viewers: StreamViewerItem[];
  onKickViewer: (userId: string) => void;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export const StreamViewersModal: React.FC<StreamViewersModalProps> = ({
  viewers,
  onKickViewer,
  onClose,
  containerRef,
}) => {
  const { t } = useTranslation(["voice", "common"]);
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const isDraggingRef = useRef(false);

  // 点击外部与 ESC 键监听
  useEffect(() => {
    const handleDocumentPointerDown = (e: PointerEvent) => {
      if (isDraggingRef.current) return;
      if (modalRef.current && modalRef.current.contains(e.target as Node)) {
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest?.('[data-testid="stream-viewers-badge-btn"]')) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // 窗口调整时防止越界
  useEffect(() => {
    if (!position || !modalRef.current) return;

    const handleResize = () => {
      if (!modalRef.current) return;
      const parentEl =
        containerRef?.current || (modalRef.current.offsetParent as HTMLElement);
      if (!parentEl) return;

      const parentRect = parentEl.getBoundingClientRect();
      const modalRect = modalRef.current.getBoundingClientRect();
      const padding = 8;
      const maxX = Math.max(
        padding,
        parentRect.width - modalRect.width - padding,
      );
      const maxY = Math.max(
        padding,
        parentRect.height - modalRect.height - padding,
      );

      setPosition((prev) => {
        if (!prev) return null;
        return {
          x: Math.min(Math.max(padding, prev.x), maxX),
          y: Math.min(Math.max(padding, prev.y), maxY),
        };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position, containerRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!modalRef.current) return;

    const modalEl = modalRef.current;
    const parentEl =
      containerRef?.current || (modalEl.offsetParent as HTMLElement);
    if (!parentEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    const modalRect = modalEl.getBoundingClientRect();

    const currentX =
      position !== null ? position.x : modalRect.left - parentRect.left;
    const currentY =
      position !== null ? position.y : modalRect.top - parentRect.top;

    if (!position) {
      setPosition({ x: currentX, y: currentY });
    }

    isDraggingRef.current = true;
    const startData = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      modalX: currentX,
      modalY: currentY,
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current || !modalRef.current) return;

      const deltaX = ev.clientX - startData.pointerX;
      const deltaY = ev.clientY - startData.pointerY;

      const rawX = startData.modalX + deltaX;
      const rawY = startData.modalY + deltaY;

      const padding = 8;
      const minX = padding;
      const maxX = Math.max(minX, parentRect.width - modalRect.width - padding);
      const minY = padding;
      const maxY = Math.max(minY, parentRect.height - modalRect.height - padding);

      const clampedX = Math.min(Math.max(minX, rawX), maxX);
      const clampedY = Math.min(Math.max(minY, rawY), maxY);

      setPosition({ x: clampedX, y: clampedY });
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={
        position
          ? {
              transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
              left: 0,
              top: 0,
            }
          : undefined
      }
      className={`absolute z-40 w-72 sm:w-80 bg-[#111214]/94 backdrop-blur-md border border-[#3f4147] rounded-xl shadow-2xl p-3.5 text-xs text-gray-200 select-text animate-fade-in ${
        !position ? "top-12 right-4" : ""
      }`}
    >
      {/* 顶部标题与操作栏 */}
      <div
        data-testid="stream-viewers-drag-handle"
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between pb-2 border-b border-[#2b2d31] mb-2.5 cursor-grab active:cursor-grabbing select-none"
        title="按住标题栏可在卡片内自由拖拽"
      >
        <div className="flex items-center space-x-2">
          <GripHorizontal className="w-3.5 h-3.5 text-gray-400 opacity-70 hover:opacity-100 transition" />
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="font-bold text-white text-[13px] tracking-wide">
            {t("voice:viewers.title")}
          </span>
          <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.2 rounded font-mono font-semibold">
            {viewers.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-discord-danger/20 hover:text-discord-danger text-gray-400 transition cursor-pointer"
          title={t("common:close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 观众列表 */}
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
        {viewers.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center text-gray-400 text-center">
            <Eye className="w-8 h-8 opacity-40 mb-1.5" />
            <p className="text-xs">{t("voice:viewers.noViewers")}</p>
          </div>
        ) : (
          viewers.map((viewer) => (
            <div
              key={viewer.userId}
              data-testid={`viewer-item-${viewer.userId}`}
              className="flex items-center justify-between p-2 rounded-lg bg-[#1e1f22]/60 hover:bg-[#1e1f22] border border-white/5 transition"
            >
              <div className="flex items-center space-x-2 min-w-0 mr-2">
                {viewer.avatarUrl ? (
                  <img
                    src={viewer.avatarUrl}
                    alt={viewer.displayName}
                    className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-discord-brand/30 text-discord-brand flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {viewer.displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-white text-xs font-medium truncate">
                  {viewer.displayName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onKickViewer(viewer.userId)}
                data-testid={`kick-viewer-btn-${viewer.userId}`}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-discord-danger/15 hover:bg-discord-danger text-red-400 hover:text-white transition text-[11px] font-medium flex-shrink-0 cursor-pointer"
                title={t("voice:viewers.kick")}
              >
                <UserX className="w-3.5 h-3.5" />
                <span>{t("voice:viewers.kick")}</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
