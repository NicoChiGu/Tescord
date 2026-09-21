import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { User, Guild, GuildMember, Role } from "@tescord/types";
import {
  Crown,
  ShieldCheck,
  Calendar,
  Copy,
  Check,
  Send,
  AtSign,
  UserMinus,
  Ban,
  Settings,
  X,
  Radio,
} from "lucide-react";
import { resolveServerUrl } from "../../config.js";

interface UserProfilePopoutProps {
  isOpen: boolean;
  onClose: () => void;
  targetRect: DOMRect | null;
  user: User;
  member?: GuildMember | null;
  guild?: Guild | null;
  currentUser: User;
  roles?: Role[];
  isOwner?: boolean;
  onOpenSettings?: () => void;
  onMention?: (username: string) => void;
  onSendMessage?: (content: string) => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

export const UserProfilePopout: React.FC<UserProfilePopoutProps> = ({
  isOpen,
  onClose,
  targetRect,
  user,
  member,
  guild,
  currentUser,
  roles = [],
  isOwner = false,
  onOpenSettings,
  onMention,
  onSendMessage,
  onKickMember,
  onBanMember,
}) => {
  const popoutRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [quickMessage, setQuickMessage] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  // 计算桌面端弹出卡片坐标与指向箭头垂直位置（自适应目标元素的左侧或右侧）
  const calculatePosition = (rect: DOMRect | null, measuredHeight?: number) => {
    if (!rect) return { top: 0, left: 0, arrowTop: 24, arrowSide: "right" as const, isReady: false };
    const popoutWidth = 310;
    const margin = 12;
    const popoutHeight = measuredHeight || 440;
    const screenW = window.innerWidth;

    // 水平位置判断：若目标右侧空间足够容纳卡片，优先向右弹出（适用于聊天区域）；否则向左弹出（适用于右侧成员列表）
    let left = 0;
    let arrowSide: "left" | "right" = "right";

    if (rect.right + popoutWidth + margin <= screenW) {
      left = rect.right + 12;
      arrowSide = "left";
    } else {
      left = Math.max(margin, rect.left - popoutWidth - 12);
      arrowSide = "right";
    }

    // 垂直位置：优先与目标行顶部对齐，若溢出视口底部则向上平移
    let top = rect.top;
    if (top + popoutHeight > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - popoutHeight - margin);
    }

    // 箭头垂直居中对齐目标项中心
    const targetCenter = rect.top + rect.height / 2;
    const arrowTop = Math.max(
      16,
      Math.min(popoutHeight - 24, targetCenter - top - 6),
    );

    return { top, left, arrowTop, arrowSide, isReady: true };
  };

  const [pos, setPos] = useState(() => calculatePosition(targetRect));

  const isSelf = user.id === currentUser.id;

  // 检测是否为移动端屏幕宽度
  useEffect(() => {
    const checkIsMobile = () => {
      const screenW = window.innerWidth;
      setIsMobile(screenW < 768);
    };
    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);
    return () => window.removeEventListener("resize", checkIsMobile);
  }, [targetRect]);

  // 计算桌面端弹出卡片坐标并防止视口溢出（在 DOM 绘制前精确校准）
  useLayoutEffect(() => {
    if (!targetRect || isMobile) return;
    const measuredHeight = popoutRef.current?.offsetHeight;
    const newPos = calculatePosition(targetRect, measuredHeight);
    setPos(newPos);
  }, [targetRect, isMobile]);

  // 切换目标成员时，重置快捷消息输入与复制反馈状态
  useEffect(() => {
    setQuickMessage("");
    setCopied(false);
  }, [user.id]);

  // 监听点击外部 (Click Outside) 与 ESC 快捷键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // 如果点击在当前弹窗内部，不做任何关闭处理
      if (popoutRef.current && popoutRef.current.contains(target)) {
        return;
      }

      // 如果点击的是成员列表项，由成员列表的 onClick 自行处理无缝切换或关闭，避免 pointerdown 抢先销毁弹窗
      if ((target as Element).closest?.("[data-member-item]")) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // 延迟一帧绑定事件，防止触发展开的当前点击事件冒泡立即关闭
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 复制用户 ID
  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // @提及
  const handleMention = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMention?.(user.username);
    onClose();
  };

  // 发送快捷消息
  const handleSendQuickMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = quickMessage.trim();
    if (!text) return;

    if (onSendMessage) {
      onSendMessage(`@${user.username} ${text}`);
    } else if (onMention) {
      onMention(user.username);
    }
    setQuickMessage("");
    onClose();
  };

  if (!isOpen) return null;

  // 最高角色颜色（用于横幅与名字强调）
  const highestColoredRole = roles.find((r) => !!r.color);
  const highestColor = highestColoredRole?.color;

  // 权限检查：是否可以踢出/封禁该成员
  const isGuildOwner = guild?.ownerId === currentUser.id;
  const canModerate = !isSelf && !isOwner && isGuildOwner;

  // 状态灯颜色
  const getStatusColor = (status?: string) => {
    switch (status) {
      case "ONLINE":
        return "bg-[#23a55a]";
      case "IDLE":
        return "bg-[#f0b232]";
      case "DND":
        return "bg-[#f23f43]";
      default:
        return "bg-[#80848e]";
    }
  };

  // 状态灯辅助图标
  const renderStatusBadge = (status?: string) => {
    const colorClass = getStatusColor(status);
    return (
      <div
        className={`absolute bottom-0 right-0 w-5 h-5 rounded-full ring-[3.5px] ring-[#232428] flex items-center justify-center ${colorClass}`}
        title={
          status === "ONLINE"
            ? "在线"
            : status === "IDLE"
            ? "离开"
            : status === "DND"
            ? "请勿打扰"
            : "离线"
        }
      >
        {status === "DND" && (
          <div className="w-2.5 h-0.5 bg-white rounded-full" />
        )}
        {status === "IDLE" && (
          <div className="w-2 h-2 bg-[#232428] rounded-full -mt-0.5 -ml-0.5" />
        )}
      </div>
    );
  };

  // 是否在顶部横幅区域内（Banner 高度为 64px，即 h-16）
  const isArrowInBanner = pos.arrowTop + 6 < 64;

  // 卡片主体内容
  const popoutContent = (
    <div
      ref={popoutRef}
      style={!isMobile ? { top: `${pos.top}px`, left: `${pos.left}px` } : undefined}
      className={`${
        isMobile
          ? "relative w-full max-w-[320px] mx-4"
          : "fixed z-50 w-[310px] transition-[top,left] duration-150 ease-out"
      } select-none text-[#dbdee1] animate-in fade-in zoom-in-95 duration-100`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 突出箭头：精确指向目标用户项，不被卡片内部 overflow-hidden 裁切 */}
      {!isMobile && (
        <div
          className={`absolute w-3 h-3 rotate-45 z-20 pointer-events-none transition-[top,background-color] duration-150 ease-out ${
            pos.arrowSide === "left"
              ? "-left-[6px] border-b border-l border-white/10"
              : "-right-[6px] border-t border-r border-white/10"
          }`}
          style={{
            top: `${pos.arrowTop}px`,
            backgroundColor: isArrowInBanner
              ? highestColor || "#5865f2"
              : "#232428",
          }}
        />
      )}

      {/* 卡片主体：带 rounded-2xl、border 与 overflow-hidden */}
      <div className="w-full bg-[#232428] rounded-2xl shadow-2xl border border-white/5 overflow-hidden flex flex-col">
        {/* 1. 顶部 Banner */}
        <div
          className="h-16 w-full relative flex items-start justify-end p-2.5 transition-all duration-150 ease-out"
          style={{
            background: highestColor
              ? `linear-gradient(135deg, ${highestColor}dd, ${highestColor}88)`
              : "linear-gradient(135deg, #5865f2, #4752c4)",
          }}
        >
          {/* 右上角徽章与移动端关闭按钮 */}
          <div className="flex items-center gap-1.5">
            {isOwner && (
              <span
                title="服务器所有者"
                className="p-1 rounded-full bg-black/40 backdrop-blur-sm text-amber-400 flex items-center justify-center"
              >
                <Crown className="w-3.5 h-3.5 fill-amber-400/40" />
              </span>
            )}
            {!isOwner && (
              <span
                title="已验证成员"
                className="p-1 rounded-full bg-black/40 backdrop-blur-sm text-[#5865f2] flex items-center justify-center"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </span>
            )}
            {isMobile && (
              <button
                onClick={onClose}
                className="p-1 rounded-full bg-black/40 backdrop-blur-sm text-gray-300 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 2. 头像与 Presence 状态灯 */}
        <div className="relative -mt-9 px-4 flex items-end justify-between">
          <div className="relative inline-block">
            <img
              src={
                resolveServerUrl(user.avatarUrl) ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=" + user.id
              }
              alt={user.username}
              className="w-20 h-20 rounded-full bg-[#1e1f22] object-cover ring-[6px] ring-[#232428] shadow-md transition-all duration-150"
            />
          {renderStatusBadge(user.status)}
        </div>
      </div>

      {/* 3. 昵称、用户名与自定义个性签名 */}
      <div className="px-4 pt-2 pb-2">
        <h4
          className="text-lg font-bold text-white leading-tight truncate hover:underline cursor-pointer"
          style={{ color: highestColor || undefined }}
        >
          {member?.nickname || user.username}
        </h4>
        <div className="text-xs text-[#949ba4] font-medium mt-0.5">
          @{user.username}
        </div>

        {user.customStatus && (
          <div className="mt-2 text-xs text-[#dbdee1] flex items-center gap-1.5 bg-[#111214]/50 px-2.5 py-1.5 rounded-md border border-white/5">
            <Radio className="w-3 h-3 text-[#5865f2] flex-shrink-0 animate-pulse" />
            <span className="truncate">{user.customStatus}</span>
          </div>
        )}
      </div>

      {/* 分隔细线 */}
      <div className="h-[1px] bg-white/5 mx-4 my-1" />

      {/* 4. 内嵌深色详细信息面板 */}
      <div className="mx-4 mb-3 p-3 rounded-lg bg-[#111214]/70 border border-white/5 space-y-3 max-h-56 overflow-y-auto custom-scrollbar">
        {/* 关于我 (About Me) */}
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] mb-1">
            关于我
          </div>
          <div className="text-xs text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words">
            {user.bio || "该成员暂未填写自我介绍。"}
          </div>
        </div>

        {/* 成员起于 (Member Since) */}
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] mb-1.5">
            成员起于
          </div>
          <div className="space-y-1 text-xs text-[#949ba4]">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-[#5865f2] flex-shrink-0" />
              <span>
                注册时间：
                {new Date(user.createdAt).toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            {member?.joinedAt && (
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>
                  加入本服：
                  {new Date(member.joinedAt).toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 身份组 (Roles) */}
        {roles.length > 0 && (
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] mb-1.5">
              身份组 — {roles.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1.5 bg-[#2b2d31] hover:bg-[#35373c] text-xs px-2 py-1 rounded-md text-[#dbdee1] border border-white/5 transition max-w-full"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: r.color || "#99aab5" }}
                  />
                  <span className="truncate">{r.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. 底部快捷操作与消息输入栏 */}
      <div className="px-4 pb-3.5 space-y-2">
        {!isSelf ? (
          <>
            {/* 仿 Discord 快捷输入框 */}
            <form
              onSubmit={handleSendQuickMessage}
              className="relative flex items-center"
            >
              <input
                type="text"
                placeholder={`给 @${user.username} 发送消息`}
                value={quickMessage}
                onChange={(e) => setQuickMessage(e.target.value)}
                className="w-full bg-[#383a40] text-xs text-white placeholder-[#949ba4] rounded-md px-3 py-2 pr-9 focus:outline-none focus:ring-1 focus:ring-[#5865f2] border-none"
              />
              <button
                type="submit"
                disabled={!quickMessage.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-[#949ba4] hover:text-white disabled:opacity-30 disabled:hover:text-[#949ba4] transition"
                title="发送消息"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* 快捷按钮组 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMention}
                className="flex-1 py-1.5 px-2 rounded bg-[#2b2d31] hover:bg-[#35373c] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition"
                title="在当前输入框中 @提及"
              >
                <AtSign className="w-3.5 h-3.5 text-[#5865f2]" />
                <span>@提及</span>
              </button>

              <button
                type="button"
                onClick={handleCopyId}
                className="flex-1 py-1.5 px-2 rounded bg-[#2b2d31] hover:bg-[#35373c] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition"
                title="复制唯一用户 ID"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
                <span>{copied ? "已复制" : "复制 ID"}</span>
              </button>
            </div>

            {/* 管理员快捷操作栏 */}
            {canModerate && (
              <div className="flex items-center gap-2 pt-1">
                {onKickMember && (
                  <button
                    type="button"
                    onClick={() => {
                      onKickMember(user.id, user.username);
                      onClose();
                    }}
                    className="flex-1 py-1 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 text-[11px] font-medium flex items-center justify-center gap-1 transition"
                  >
                    <UserMinus className="w-3 h-3" />
                    <span>踢出成员</span>
                  </button>
                )}
                {onBanMember && (
                  <button
                    type="button"
                    onClick={() => {
                      onBanMember(user.id, user.username);
                      onClose();
                    }}
                    className="flex-1 py-1 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 text-[11px] font-medium flex items-center justify-center gap-1 transition"
                  >
                    <Ban className="w-3 h-3" />
                    <span>封禁成员</span>
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          /* 查看自己时展示“编辑个人资料”入口 */
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings?.();
            }}
            className="w-full py-2 px-3 rounded-md bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold flex items-center justify-center gap-2 transition shadow"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>编辑个人资料</span>
          </button>
        )}
      </div>
    </div>
  </div>
);

  // 移动端挂载带模糊背景的弹窗容器；桌面端直接通过 Portal 挂载到 body
  if (isMobile) {
    return ReactDOM.createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        onClick={onClose}
      >
        {popoutContent}
      </div>,
      document.body,
    );
  }

  return ReactDOM.createPortal(popoutContent, document.body);
};
