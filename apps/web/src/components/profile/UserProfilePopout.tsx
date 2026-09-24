import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";
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
  Pencil,
  X,
  Radio,
  MessageSquare,
  MoreHorizontal,
  Smile,
  Server,
  FileText,
  Plus,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Clock,
} from "lucide-react";
import { resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { usePresenceStore } from "../../stores/usePresenceStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { gatewayClient } from "../../services/gateway.js";
import { getUserDisplayName, formatUserTag } from "../../utils/userDisplay.js";

interface UserProfilePopoutProps {
  isOpen: boolean;
  onClose: () => void;
  targetRect: DOMRect | null;
  user: User;
  member?: GuildMember | null;
  guild?: Guild | null;
  allGuilds?: Guild[] | null;
  currentUser: User;
  roles?: Role[];
  isOwner?: boolean;
  onOpenSettings?: () => void;
  onMention?: (username: string) => void;
  onSendMessage?: (content: string) => void;
  onStartDM?: (userId: string) => void;
  onSendQuickDM?: (targetUserId: string, content: string) => void;
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
  allGuilds = [],
  currentUser,
  roles = [],
  isOwner = false,
  onOpenSettings,
  onMention,
  onSendMessage,
  onStartDM,
  onSendQuickDM,
  onKickMember,
  onBanMember,
}) => {
  const { t, i18n } = useTranslation(["common", "settings"]);
  const popoutRef = useRef<HTMLDivElement>(null);
  const statusInputRef = useRef<HTMLInputElement>(null);

  const [copied, setCopied] = useState(false);
  const [quickMessage, setQuickMessage] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isRolesExpanded, setIsRolesExpanded] = useState(false);

  // 查看自己时的内联状态编辑状态
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(
    currentUser.customStatus || "",
  );
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  const isSelf = user.id === currentUser.id;

  // 用户私有备注 (Discord 规范：仅在查看他人时生效)
  const userNotes = useSettingsStore((s) => s.userNotes);
  const setUserNote = useSettingsStore((s) => s.setUserNote);
  const currentUserNote =
    (!isSelf && userNotes ? userNotes[user.id] : "") || "";

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(currentUserNote);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const presences = usePresenceStore((s) => s.presences);
  const targetPresence = presences[user.id];
  const effectiveStatus = isSelf
    ? currentUser.status
    : targetPresence?.status || user.status || "OFFLINE";
  const effectiveCustomStatus = isSelf
    ? currentUser.customStatus
    : targetPresence?.customStatus !== undefined
      ? targetPresence.customStatus
      : user.customStatus;

  // 桌面端弹出卡片坐标与指向箭头垂直位置（自适应目标元素的左侧或右侧）
  const calculatePosition = (rect: DOMRect | null, measuredHeight?: number) => {
    if (!rect)
      return {
        top: 0,
        left: 0,
        arrowTop: 24,
        arrowSide: "right" as const,
        isReady: false,
      };
    const popoutWidth = 320;
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
  }, [targetRect, isMobile, isRolesExpanded, isEditingStatus, isEditingNote]);

  // 切换目标成员时，重置快捷消息输入、复制反馈及备注编辑状态
  useEffect(() => {
    setQuickMessage("");
    setCopied(false);
    setIsMoreMenuOpen(false);
    setIsRolesExpanded(false);
    setIsEditingStatus(false);
    setCustomStatusInput(currentUser.customStatus || "");
    setIsEditingNote(false);
    setNoteInput(currentUserNote);
  }, [user.id, currentUser.customStatus, currentUserNote]);

  // 进入状态编辑时自动聚焦输入框
  useEffect(() => {
    if (isEditingStatus) {
      setTimeout(() => statusInputRef.current?.focus(), 50);
    }
  }, [isEditingStatus]);

  // 进入备注编辑时自动聚焦输入框并将光标移至末尾
  useEffect(() => {
    if (isEditingNote) {
      setTimeout(() => {
        if (noteInputRef.current) {
          noteInputRef.current.focus();
          const len = noteInputRef.current.value.length;
          noteInputRef.current.setSelectionRange(len, len);
        }
      }, 50);
    }
  }, [isEditingNote]);

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

      // 如果点击的是触发器元素（带有 data-profile-trigger 或 data-member-item），由其本身的 onClick/toggle 处理
      if (
        (target as Element).closest?.("[data-profile-trigger]") ||
        (target as Element).closest?.("[data-member-item]")
      ) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditingStatus) {
          setIsEditingStatus(false);
          setCustomStatusInput(currentUser.customStatus || "");
        } else if (isEditingNote) {
          setIsEditingNote(false);
          setNoteInput(currentUserNote);
        } else if (isMoreMenuOpen) {
          setIsMoreMenuOpen(false);
        } else {
          onClose();
        }
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
  }, [
    isOpen,
    onClose,
    isEditingStatus,
    isEditingNote,
    currentUserNote,
    isMoreMenuOpen,
    currentUser.customStatus,
  ]);

  // 保存用户私有备注
  const handleSaveNote = () => {
    if (isSelf) return;
    setUserNote(user.id, noteInput);
    setIsEditingNote(false);
  };

  // 复制用户 ID
  const handleCopyId = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setIsMoreMenuOpen(false);
  };

  // @提及
  const handleMention = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMention?.(user.username);
    setIsMoreMenuOpen(false);
    onClose();
  };

  // 保存自身自定义个性状态
  const handleSaveCustomStatus = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingStatus(true);
    try {
      const nextStatus = customStatusInput.trim() || null;
      gatewayClient.updateStatus(currentUser.status || "ONLINE", nextStatus);
      await useAuthStore.getState().updateProfile({ customStatus: nextStatus });
    } catch (err) {
      console.error("Failed to save custom status:", err);
    } finally {
      setIsEditingStatus(false);
      setIsSavingStatus(false);
    }
  };

  // 发送快捷私信并自动跳转至私信聊天 (图2底部回车触发)
  const handleSendQuickDMSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = quickMessage.trim();
    if (!text) return;

    if (onSendQuickDM) {
      onSendQuickDM(user.id, text);
    } else if (onStartDM) {
      onStartDM(user.id);
    } else if (onSendMessage) {
      onSendMessage(`@${user.username} ${text}`);
    }

    setQuickMessage("");
    onClose();
  };

  if (!isOpen) return null;

  // 最高角色颜色（用于横幅与名字强调）
  const highestColoredRole = roles.find((r) => !!r.color);
  const highestColor = highestColoredRole?.color;

  // Banner 背景色：若无用户自定义横幅与角色颜色，图1为深蓝色 (#233863)，图2为棕褐色 (#4e3636)
  const defaultBannerGradient = isSelf
    ? "linear-gradient(135deg, #2b4570, #1c2d50)"
    : "linear-gradient(135deg, #4d3636, #362525)";
  const bannerBackground = user.bannerColor
    ? user.bannerColor
    : highestColor
      ? `linear-gradient(135deg, ${highestColor}cc, ${highestColor}66)`
      : defaultBannerGradient;

  // 智能计算共同服务器数量
  const mutualGuildsCount = Math.max(
    1,
    (allGuilds || []).filter((g) =>
      g.members?.some((m) => m.userId === user.id || m.user?.id === user.id),
    ).length,
  );

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
      case "INVISIBLE":
        return isSelf
          ? "border-2 border-[#80848e] bg-transparent"
          : "bg-[#80848e]";
      default:
        return "bg-[#80848e]";
    }
  };

  // 状态灯辅助图标
  const renderStatusBadge = (status?: string) => {
    const isSelfInvisible = isSelf && status === "INVISIBLE";
    const colorClass = getStatusColor(status);
    return (
      <div
        className={`absolute bottom-0 right-0 w-6 h-6 rounded-full ring-[4px] ring-[#232428] flex items-center justify-center ${colorClass}`}
        title={
          status === "ONLINE"
            ? "在线"
            : status === "IDLE"
              ? "离开"
              : status === "DND"
                ? "请勿打扰"
                : isSelfInvisible
                  ? "隐身 (仅自己可见)"
                  : "离线"
        }
      >
        {status === "DND" && (
          <div className="w-3 h-0.5 bg-white rounded-full" />
        )}
        {status === "IDLE" && (
          <div className="w-2.5 h-2.5 bg-[#232428] rounded-full -mt-0.5 -ml-0.5" />
        )}
        {isSelfInvisible && (
          <div className="w-2.5 h-2.5 bg-[#232428] rounded-full" />
        )}
      </div>
    );
  };

  // 是否在顶部横幅区域内（Banner 高度为 76px）
  const isArrowInBanner = pos.arrowTop + 6 < 76;

  // 身份组多行折叠计算 (默认显示前4个)
  const visibleRoles = isRolesExpanded ? roles : roles.slice(0, 4);
  const hiddenRolesCount = Math.max(0, roles.length - 4);

  // 卡片主体内容
  const popoutContent = (
    <div
      ref={popoutRef}
      data-testid="user-profile-popout"
      style={
        !isMobile ? { top: `${pos.top}px`, left: `${pos.left}px` } : undefined
      }
      className={`${
        isMobile
          ? "relative w-full max-w-[330px] mx-4"
          : "fixed z-50 w-[320px] transition-[top,left] duration-150 ease-out"
      } select-none text-[#dbdee1] animate-in fade-in zoom-in-95 duration-100 font-sans`}
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
              ? highestColor || (isSelf ? "#2b4570" : "#4d3636")
              : "#232428",
          }}
        />
      )}

      {/* 卡片主体：带 rounded-2xl、border 与 overflow-hidden */}
      <div className="w-full bg-[#232428] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col">
        {/* 1. 顶部 Banner */}
        <div
          className="h-20 w-full relative flex items-start justify-end p-2.5 transition-all duration-150 ease-out overflow-hidden"
          style={{
            background: bannerBackground,
            backgroundColor: user.bannerColor || undefined,
            backgroundImage: user.bannerUrl
              ? `url(${resolveServerUrl(user.bannerUrl)})`
              : user.bannerColor
                ? undefined
                : bannerBackground,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* 右上角按钮组 */}
          <div className="flex items-center gap-1.5 relative">
            {!isSelf && (
              /* 图2：复制用户 ID 快捷按钮 */
              <button
                type="button"
                onClick={handleCopyId}
                className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-gray-300 hover:text-white flex items-center justify-center transition"
                title={
                  copied
                    ? t("common:copied", "已复制")
                    : t("common:user.copyUserId", "复制用户 ID")
                }
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {/* 更多操作菜单按钮 (...) */}
            <div className="relative">
              <button
                type="button"
                data-testid="user-profile-more-btn"
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-gray-300 hover:text-white flex items-center justify-center transition"
                title={t("common:moreActions", "更多操作")}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {/* 下拉菜单浮层 */}
              {isMoreMenuOpen && (
                <div className="absolute right-0 top-8 z-30 w-44 bg-[#111214] border border-white/10 rounded-lg shadow-xl p-1 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="w-full px-2.5 py-1.5 rounded hover:bg-[#35373c] text-left text-gray-200 flex items-center gap-2 transition"
                  >
                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                    <span>
                      {copied
                        ? t("common:copied", "已复制")
                        : t("common:user.copyUserId", "复制用户 ID")}
                    </span>
                  </button>

                  {!isSelf && (
                    <>
                      <button
                        type="button"
                        onClick={handleMention}
                        className="w-full px-2.5 py-1.5 rounded hover:bg-[#35373c] text-left text-gray-200 flex items-center gap-2 transition"
                      >
                        <AtSign className="w-3.5 h-3.5 text-[#5865f2]" />
                        <span>{t("contextMenu:mentionUser", "提及用户")}</span>
                      </button>

                      {onStartDM && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            onStartDM(user.id);
                            onClose();
                          }}
                          className="w-full px-2.5 py-1.5 rounded hover:bg-[#35373c] text-left text-gray-200 flex items-center gap-2 transition"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                          <span>
                            {t("contextMenu:sendMessage", "发送私信")}
                          </span>
                        </button>
                      )}

                      {canModerate && (
                        <>
                          <div className="h-[1px] bg-white/10 my-1" />
                          {onKickMember && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsMoreMenuOpen(false);
                                onKickMember(user.id, user.username);
                                onClose();
                              }}
                              className="w-full px-2.5 py-1.5 rounded hover:bg-rose-500/20 text-left text-rose-400 flex items-center gap-2 transition"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>
                                {t("contextMenu:kickUser", "踢出成员")}
                              </span>
                            </button>
                          )}
                          {onBanMember && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsMoreMenuOpen(false);
                                onBanMember(user.id, user.username);
                                onClose();
                              }}
                              className="w-full px-2.5 py-1.5 rounded hover:bg-rose-500/20 text-left text-rose-400 flex items-center gap-2 transition"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>
                                {t("contextMenu:banUser", "封禁成员")}
                              </span>
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {isSelf && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onClose();
                        onOpenSettings?.();
                      }}
                      className="w-full px-2.5 py-1.5 rounded hover:bg-[#35373c] text-left text-gray-200 flex items-center gap-2 transition"
                    >
                      <Pencil className="w-3.5 h-3.5 text-[#5865f2]" />
                      <span>{t("settings:profile", "编辑个人资料")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {isMobile && (
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-gray-300 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 2. 头像与状态气泡区 (图1：右侧带气泡状态；图2：独立头像) */}
        <div className="relative -mt-10 px-4 flex items-end justify-between">
          <div className="relative inline-block flex-shrink-0">
            <img
              src={
                resolveServerUrl(user.avatarUrl) ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=" + user.id
              }
              alt={user.username}
              className="w-[78px] h-[78px] rounded-full bg-[#1e1f22] object-cover ring-[6px] ring-[#232428] shadow-md transition-all duration-150"
            />
            {renderStatusBadge(effectiveStatus)}
          </div>

          {/* 图1专属：头像右侧气泡式自定义状态 (带就地内联编辑) */}
          {isSelf && (
            <div className="flex-1 ml-3 mb-1.5 min-w-0">
              {isEditingStatus ? (
                <form
                  onSubmit={handleSaveCustomStatus}
                  className="relative bg-[#111214] border border-[#5865f2] rounded-xl px-2.5 py-1.5 shadow-inner"
                >
                  <input
                    ref={statusInputRef}
                    type="text"
                    maxLength={100}
                    value={customStatusInput}
                    onChange={(e) => setCustomStatusInput(e.target.value)}
                    placeholder="设定状态..."
                    className="w-full bg-transparent text-xs text-white placeholder-[#80848e] focus:outline-none pr-11"
                  />
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="submit"
                      disabled={isSavingStatus}
                      className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                      title="保存状态 (Enter)"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingStatus(false);
                        setCustomStatusInput(currentUser.customStatus || "");
                      }}
                      className="p-1 text-gray-400 hover:text-gray-300"
                      title="取消 (Esc)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  onClick={() => setIsEditingStatus(true)}
                  className="group/bubble cursor-pointer bg-[#2b2d31] hover:bg-[#313338] border border-white/5 rounded-2xl px-3 py-1.5 shadow transition-all flex items-center gap-1.5 max-w-full"
                  title="点击即时设定/修改个性状态"
                >
                  <Plus className="w-3 h-3 text-[#949ba4] group-hover/bubble:text-white flex-shrink-0" />
                  <span className="text-xs text-[#dbdee1] group-hover/bubble:text-white truncate">
                    {currentUser.customStatus || "刚刚读完..."}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. 昵称、用户名、徽章区 */}
        <div className="px-4 pt-3 pb-2">
          {/* 显示昵称 + 记事小图标 */}
          <div className="flex items-center gap-1.5">
            <h4
              className="text-lg font-bold text-white leading-tight truncate hover:underline cursor-pointer"
              style={{ color: highestColor || undefined }}
            >
              {getUserDisplayName(user, member)}
            </h4>
            {!isSelf && (
              <button
                type="button"
                data-testid="user-profile-note-btn"
                className={`transition flex-shrink-0 p-0.5 rounded hover:bg-white/10 ${
                  currentUserNote
                    ? "text-[#5865f2] hover:text-[#7983f5]"
                    : "text-[#949ba4] hover:text-white"
                }`}
                title={
                  currentUserNote
                    ? `备注: ${currentUserNote} (点击编辑)`
                    : "添加备注"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingNote(true);
                }}
              >
                <FileText className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* 用户名 + 徽章 */}
          <div className="flex items-center gap-1.5 text-xs text-[#949ba4] font-medium mt-0.5">
            <span>{formatUserTag(user.username)}</span>

            {/* 徽章集合 */}
            <div className="flex items-center gap-1 ml-0.5">
              {isOwner && (
                <span
                  title="服务器所有者"
                  className="text-amber-400 flex items-center"
                >
                  <Crown className="w-3.5 h-3.5 fill-amber-400/30" />
                </span>
              )}
              {user.role === "SUPER_ADMIN" && (
                <span
                  title="系统超级管理员"
                  className="text-rose-400 flex items-center"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </span>
              )}
              {user.role === "ADMIN" && (
                <span
                  title="平台管理员"
                  className="text-[#5865f2] flex items-center"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          </div>

          {/* 图2查看他人时：若他人有 customStatus，在此处展示 */}
          {!isSelf && effectiveCustomStatus && (
            <div className="mt-2 text-xs text-[#dbdee1] flex items-center gap-1.5 bg-[#111214]/60 px-2.5 py-1.5 rounded-lg border border-white/5">
              <Radio className="w-3 h-3 text-[#5865f2] flex-shrink-0 animate-pulse" />
              <span className="truncate">{effectiveCustomStatus}</span>
            </div>
          )}
        </div>

        {/* 4. 中间详细信息区 */}
        <div className="px-4 space-y-2.5 pb-2">
          {/* 正在玩游戏 (PLAYING A GAME) 专属面板 */}
          {user.activities &&
            user.activities.length > 0 &&
            user.showActivity !== false && (
              <div
                data-testid="user-playing-game-panel"
                className="p-3 rounded-xl bg-[#111214]/80 border border-emerald-500/20 text-xs space-y-2 shadow-inner"
              >
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5" />
                  <span>正在游玩 (PLAYING A GAME)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#2b2d31] flex items-center justify-center flex-shrink-0 border border-white/5">
                    <Gamepad2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white truncate text-xs">
                      {user.activities[0].name}
                    </div>
                    {user.activities[0].details && (
                      <div className="text-[11px] text-[#949ba4] truncate">
                        {user.activities[0].details}
                      </div>
                    )}
                    {user.activities[0].timestamps?.start && (
                      <div className="text-[10px] text-emerald-400/90 font-medium flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>
                          已游玩{" "}
                          {Math.max(
                            1,
                            Math.floor(
                              (Date.now() -
                                user.activities[0].timestamps.start) /
                                60000,
                            ),
                          )}{" "}
                          分钟
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          {/* 共同服务器 */}
          {!isSelf && (
            <div className="flex items-center gap-2 text-xs text-[#dbdee1] py-0.5 font-medium">
              <Server className="w-4 h-4 text-[#949ba4] flex-shrink-0" />
              <span>
                {mutualGuildsCount}{" "}
                {t("common:profilePopout.mutualServers", "共同所在的服务器")}
              </span>
            </div>
          )}

          {/* 身份组列表 (Roles Pills) */}
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {visibleRoles.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1.5 bg-[#2b2d31] hover:bg-[#35373c] text-xs px-2.5 py-1 rounded-full text-[#dbdee1] border border-white/5 transition"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: r.color || "#e67e22" }}
                  />
                  <span className="truncate font-medium">{r.name}</span>
                </span>
              ))}

              {/* 超过4个角色时的 +N 折叠/展开胶囊 (图2设计) */}
              {hiddenRolesCount > 0 && (
                <button
                  type="button"
                  onClick={() => setIsRolesExpanded(!isRolesExpanded)}
                  className="inline-flex items-center gap-1 bg-[#2b2d31] hover:bg-[#35373c] text-xs px-2 py-1 rounded-full text-[#949ba4] hover:text-white border border-white/5 transition font-semibold"
                  title={
                    isRolesExpanded
                      ? t("common:back", "收起")
                      : t("common:next", "展开")
                  }
                >
                  {isRolesExpanded ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      <span>{t("common:back", "收起")}</span>
                    </>
                  ) : (
                    <span>+{hiddenRolesCount}</span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* 关于我 (Bio) & 入服时间 (Member Since) 紧凑展示 */}
          <div className="p-2.5 rounded-lg bg-[#111214]/60 border border-white/5 space-y-2 text-xs">
            {user.bio && (
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] mb-0.5">
                  {t("settings:bio", "个人简介")}
                </div>
                <div className="text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words">
                  {user.bio}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-[#949ba4]">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-[#5865f2]" />
                <span>
                  {t("common:profilePopout.registered", "注册时间：")}{" "}
                  {new Date(user.createdAt).toLocaleDateString(i18n.language)}
                </span>
              </div>
              {member?.joinedAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-emerald-400" />
                  <span>
                    {t("server:members.table.joined", "加入时间：")}{" "}
                    {new Date(member.joinedAt).toLocaleDateString(
                      i18n.language,
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 图2专属：用户私密备注 (NOTE) 区块 */}
          {!isSelf && (
            <div
              data-testid="user-profile-note-section"
              className="p-2.5 rounded-lg bg-[#111214]/60 border border-white/5 space-y-1.5 text-xs transition"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] flex items-center justify-between">
                <span>{t("common:profilePopout.addNote", "备注")}</span>
                {currentUserNote && !isEditingNote && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditingNote(true);
                    }}
                    className="text-[10px] text-[#949ba4] hover:text-white transition font-medium"
                  >
                    {t("common:edit", "编辑")}
                  </button>
                )}
              </div>

              {isEditingNote ? (
                <div className="space-y-1">
                  <textarea
                    ref={noteInputRef}
                    data-testid="user-profile-note-textarea"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onBlur={handleSaveNote}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveNote();
                      } else if (e.key === "Escape") {
                        setIsEditingNote(false);
                        setNoteInput(currentUserNote);
                      }
                    }}
                    maxLength={256}
                    placeholder={t(
                      "common:profilePopout.clickToAddNote",
                      "点击添加备注",
                    )}
                    className="w-full bg-[#1e1f22] text-xs text-[#dbdee1] placeholder-[#80848e] rounded-md p-2 border border-[#5865f2] focus:outline-none resize-none leading-relaxed shadow-inner"
                    rows={2}
                  />
                  <div className="flex items-center justify-between text-[10px] text-[#80848e]">
                    <span>
                      Enter: {t("common:save", "保存")} / Esc:{" "}
                      {t("common:cancel", "取消")}
                    </span>
                    <span>{noteInput.length}/256</span>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="user-profile-note-display"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingNote(true);
                  }}
                  className="cursor-pointer group/note hover:bg-white/5 p-1.5 rounded-md transition min-h-[28px] flex items-center"
                  title={t(
                    "common:profilePopout.clickToAddNote",
                    "点击添加备注",
                  )}
                >
                  {currentUserNote ? (
                    <div className="text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words">
                      {currentUserNote}
                    </div>
                  ) : (
                    <span className="text-[#80848e] italic group-hover/note:text-[#949ba4] transition">
                      {t("common:profilePopout.clickToAddNote", "点击添加备注")}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 5. 底部操作区 (图1：编辑个人资料大按钮；图2：傳訊息給 @用户 快捷私信输入框) */}
        <div className="px-4 pb-3.5 pt-1">
          {isSelf ? (
            /* 【图1】编辑个人资料大按钮 */
            <button
              type="button"
              data-testid="user-profile-edit-btn"
              onClick={() => {
                onClose();
                onOpenSettings?.();
              }}
              className="w-full py-2.5 px-3 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold flex items-center justify-center gap-2 transition shadow shadow-indigo-500/20 active:scale-[0.99]"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>
                {t("common:profilePopout.editProfile", "编辑个人资料")}
              </span>
            </button>
          ) : (
            /* 【图2】傳訊息給 @用户 快捷私信输入框 (回车发送并自动跳转私信会话) */
            <form
              onSubmit={handleSendQuickDMSubmit}
              className="relative flex items-center bg-[#1e1f22] rounded-lg border border-white/5 focus-within:border-[#5865f2] transition px-3 py-1.5"
            >
              <input
                type="text"
                value={quickMessage}
                onChange={(e) => setQuickMessage(e.target.value)}
                placeholder={t("common:profilePopout.sendDM", {
                  name: member?.nickname || user.username,
                })}
                className="w-full bg-transparent text-xs text-white placeholder-[#80848e] focus:outline-none pr-14"
              />
              <div className="absolute right-2.5 flex items-center gap-1.5 text-[#949ba4]">
                <button
                  type="button"
                  onClick={() => setQuickMessage((prev) => prev + " 😵‍💫")}
                  className="hover:text-white transition p-0.5"
                  title={t("chat:selectEmoji", "选择表情")}
                >
                  <Smile className="w-4 h-4" />
                </button>
                <button
                  type="submit"
                  disabled={!quickMessage.trim()}
                  className="hover:text-[#5865f2] disabled:opacity-30 disabled:hover:text-[#949ba4] transition p-0.5"
                  title={t("contextMenu:sendMessage", "发送私信")}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
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
