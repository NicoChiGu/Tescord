import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";
import { User, UserStatus } from "@tescord/types";
import {
  Pencil,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Plus,
  X,
  UserCircle2,
  Shield,
  Sparkles,
  Gamepad2,
} from "lucide-react";
import { resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { gatewayClient } from "../../services/gateway.js";
import { getUserDisplayName, formatUserTag } from "../../utils/userDisplay.js";
import { StatusBadge } from "../ui/StatusBadge.js";

interface CurrentUserPopoutProps {
  isOpen: boolean;
  onClose: () => void;
  targetRect: DOMRect | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
  currentUser: User;
  onOpenUserSettings?: (tab?: string) => void;
  onSwitchAccount?: () => void;
}

const STATUS_META: Record<
  Exclude<UserStatus, "OFFLINE">,
  {
    labelKey: string;
    descKey: string;
    defaultLabel: string;
    defaultDesc: string;
    color: string;
  }
> = {
  ONLINE: {
    labelKey: "common:status.online",
    descKey: "common:status.onlineDesc",
    defaultLabel: "在线",
    defaultDesc: "正常接收通知与消息",
    color: "bg-[#23a55a]",
  },
  IDLE: {
    labelKey: "common:status.idle",
    descKey: "common:status.idleDesc",
    defaultLabel: "闲置",
    defaultDesc: "离开座位或暂未操作",
    color: "bg-[#f0b232]",
  },
  DND: {
    labelKey: "common:status.dnd",
    descKey: "common:status.dndDesc",
    defaultLabel: "请勿打扰",
    defaultDesc: "不会收到任何桌面弹窗与通知",
    color: "bg-[#f23f43]",
  },
  INVISIBLE: {
    labelKey: "common:status.invisible",
    descKey: "common:status.invisibleDesc",
    defaultLabel: "隐身",
    defaultDesc: "对外显示为离线，可正常使用所有功能",
    color: "border-2 border-[#80848e] bg-[#232428]",
  },
};

const STATUS_KEYS: Exclude<UserStatus, "OFFLINE">[] = [
  "ONLINE",
  "IDLE",
  "DND",
  "INVISIBLE",
];

export const CurrentUserPopout: React.FC<CurrentUserPopoutProps> = ({
  isOpen,
  onClose,
  targetRect,
  triggerRef,
  currentUser,
  onOpenUserSettings,
  onSwitchAccount,
}) => {
  const { t } = useTranslation(["common", "contextMenu"]);
  const popoutRef = useRef<HTMLDivElement>(null);
  const statusInputRef = useRef<HTMLInputElement>(null);

  const { updateProfile, switchAccount: storeSwitchAccount } = useAuthStore();

  const [copiedId, setCopiedId] = useState(false);
  const [isStatusSubmenuOpen, setIsStatusSubmenuOpen] = useState(false);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(
    currentUser.customStatus || "",
  );
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  // 同步外部状态更新
  useEffect(() => {
    setCustomStatusInput(currentUser.customStatus || "");
  }, [currentUser.customStatus]);

  // 计算定位坐标（固定在左下角用户信息条正上方）
  const calculatePosition = () => {
    if (!targetRect) {
      return { bottom: 60, left: 8 };
    }
    const popoutWidth = 310;
    const margin = 8;
    const bottom = window.innerHeight - targetRect.top + margin;

    let left = targetRect.left;
    if (left + popoutWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popoutWidth - margin);
    }

    return { bottom, left };
  };

  const [pos, setPos] = useState(calculatePosition);

  useLayoutEffect(() => {
    if (isOpen && targetRect) {
      setPos(calculatePosition());
    }
  }, [isOpen, targetRect]);

  // 监听在卡片外部操作（点击外部区域或按下 ESC）时自动关闭
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // 如果点击在当前弹窗卡片内部，忽略
      if (popoutRef.current && popoutRef.current.contains(target)) {
        return;
      }

      // 如果点击的是左下角触发器本身，由其自身的 onClick/toggle 逻辑处理
      if (
        (triggerRef?.current && triggerRef.current.contains(target)) ||
        (target as Element).closest?.("[data-testid='current-user-panel-btn']")
      ) {
        return;
      }

      // 卡片外部操作：关闭卡片
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditingStatus) {
          setIsEditingStatus(false);
          setCustomStatusInput(currentUser.customStatus || "");
        } else if (isStatusSubmenuOpen) {
          setIsStatusSubmenuOpen(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isOpen,
    onClose,
    triggerRef,
    isEditingStatus,
    isStatusSubmenuOpen,
    currentUser.customStatus,
  ]);

  // 进入自定义状态编辑时自动聚焦输入框
  useEffect(() => {
    if (isEditingStatus) {
      setTimeout(() => statusInputRef.current?.focus(), 50);
    }
  }, [isEditingStatus]);

  if (!isOpen) return null;

  // 状态切换处理
  const handleStatusChange = async (newStatus: UserStatus) => {
    try {
      gatewayClient.updateStatus(
        newStatus,
        currentUser.customStatus,
        undefined,
        true,
      );
      await updateProfile({ status: newStatus });
      window.electronAPI?.syncUserStatus(newStatus);
      setIsStatusSubmenuOpen(false);
    } catch (e) {
      console.error("Failed to update status:", e);
    }
  };

  // 保存自定义个性签名
  const handleSaveCustomStatus = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingStatus(true);
    try {
      const nextStatus = customStatusInput.trim() || null;
      gatewayClient.updateStatus(
        (currentUser.status as UserStatus) || "ONLINE",
        nextStatus,
      );
      await updateProfile({ customStatus: nextStatus });
      setIsEditingStatus(false);
    } catch (err) {
      console.error("Failed to save custom status:", err);
    } finally {
      setIsSavingStatus(false);
    }
  };

  // 清除自定义签名
  const handleClearCustomStatus = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSavingStatus(true);
    try {
      gatewayClient.updateStatus(
        (currentUser.status as UserStatus) || "ONLINE",
        null,
      );
      await updateProfile({ customStatus: null });
      setCustomStatusInput("");
      setIsEditingStatus(false);
    } catch (err) {
      console.error("Failed to clear custom status:", err);
    } finally {
      setIsSavingStatus(false);
    }
  };

  // 复制用户 ID
  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(currentUser.id);
    } catch (err) {
      console.warn("Clipboard writeText failed:", err);
    }
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // 切换账号
  const handleSwitchAccountClick = () => {
    onClose();
    if (onSwitchAccount) {
      onSwitchAccount();
    } else {
      storeSwitchAccount();
    }
  };

  // 打开编辑个人资料
  const handleEditProfileClick = () => {
    onClose();
    onOpenUserSettings?.("profile");
  };

  // 渲染头像状态指示图标
  const renderStatusBadge = (status?: string) => {
    return (
      <div className="absolute bottom-0 right-0 z-10">
        <StatusBadge status={status} size={20} borderColor="#232428" />
      </div>
    );
  };

  const currentStatusKey = (
    currentUser.status === "OFFLINE"
      ? "INVISIBLE"
      : currentUser.status || "ONLINE"
  ) as Exclude<UserStatus, "OFFLINE">;

  const currentStatusInfo = {
    label: t(
      STATUS_META[currentStatusKey]?.labelKey || "common:status.online",
      STATUS_META[currentStatusKey]?.defaultLabel || "在线",
    ),
    color: STATUS_META[currentStatusKey]?.color || STATUS_META.ONLINE.color,
  };

  return ReactDOM.createPortal(
    <div
      ref={popoutRef}
      data-testid="current-user-popout"
      style={{
        bottom: `${pos.bottom}px`,
        left: `${pos.left}px`,
      }}
      className="fixed z-50 w-[310px] select-none text-[#dbdee1] animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full bg-[#232428] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col">
        {/* 1. 顶部深蓝/主题横幅 */}
        <div
          className="h-16 w-full relative flex items-start justify-end p-2.5 overflow-hidden"
          style={{
            backgroundColor: currentUser.bannerColor || "#2b3d68",
            backgroundImage: currentUser.bannerUrl
              ? `url(${resolveServerUrl(currentUser.bannerUrl)})`
              : currentUser.bannerColor
                ? undefined
                : "linear-gradient(135deg, #2b3d68 0%, #1e2942 100%)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* 右上角系统微章装饰 */}
          <div className="flex items-center gap-1 text-white/50 hover:text-white/80 transition">
            <span
              title={t("common:badges.verifiedClient", "Tescord 已验证客户端")}
              className="p-1 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
            >
              <Shield className="w-3.5 h-3.5 text-[#5865f2]" />
            </span>
          </div>
        </div>

        {/* 2. 头像、状态环与右侧个性状态气泡 */}
        <div className="relative -mt-9 px-4 flex items-end justify-between">
          {/* 大头像与状态点 */}
          <div className="relative inline-block flex-shrink-0">
            <img
              src={
                resolveServerUrl(currentUser.avatarUrl) ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=" + currentUser.id
              }
              alt={currentUser.username}
              className="w-[74px] h-[74px] rounded-full bg-[#1e1f22] object-cover ring-[5px] ring-[#232428] shadow-md transition-all duration-150"
            />
            {renderStatusBadge(currentUser.status)}
          </div>

          {/* 头像右侧：仿 Discord 气泡式个性状态展示与快捷设定 */}
          <div className="flex-1 ml-3 mb-1 min-w-0">
            {isEditingStatus ? (
              <form
                onSubmit={handleSaveCustomStatus}
                className="relative bg-[#111214] border border-[#5865f2] rounded-xl px-2 py-1.5 shadow-inner"
              >
                <input
                  ref={statusInputRef}
                  type="text"
                  maxLength={100}
                  value={customStatusInput}
                  onChange={(e) => setCustomStatusInput(e.target.value)}
                  placeholder={t(
                    "common:profilePopout.setStatusPlaceholder",
                    "设定状态...",
                  )}
                  className="w-full bg-transparent text-xs text-white placeholder-[#80848e] focus:outline-none pr-10"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="submit"
                    disabled={isSavingStatus}
                    className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                    title={t(
                      "common:profilePopout.saveStatus",
                      "保存状态 (Enter)",
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingStatus(false);
                      setCustomStatusInput(currentUser.customStatus || "");
                    }}
                    className="p-1 text-gray-400 hover:text-white"
                    title={t("common:profilePopout.cancelStatus", "取消 (Esc)")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </form>
            ) : (
              <div
                onClick={() => setIsEditingStatus(true)}
                data-testid="user-popout-custom-status-bubble"
                title={
                  currentUser.customStatus
                    ? t("common:profilePopout.customStatusTooltip", {
                        status: currentUser.customStatus,
                        defaultValue: `个性状态：${currentUser.customStatus} (点击修改)`,
                      })
                    : t(
                        "common:profilePopout.setCustomStatus",
                        "点击设定自定义状态",
                      )
                }
                className="group relative bg-[#111214]/90 hover:bg-[#111214] border border-white/10 hover:border-white/20 rounded-2xl px-3 py-1.5 cursor-pointer text-xs text-[#dbdee1] flex items-center gap-1.5 transition shadow-sm max-w-full"
              >
                {/* 气泡左侧指向头像的小三角尾巴 */}
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[6px] border-r-[#111214]/90 group-hover:border-r-[#111214]" />

                {currentUser.customStatus ? (
                  <>
                    <span className="truncate flex-1 font-normal text-white">
                      {currentUser.customStatus}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearCustomStatus}
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 transition flex-shrink-0"
                      title={t(
                        "common:profilePopout.clearStatus",
                        "清除此状态",
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <Plus className="w-3 h-3 text-[#949ba4] flex-shrink-0" />
                    <span className="truncate text-[#949ba4] group-hover:text-[#dbdee1] transition">
                      {t(
                        "common:profilePopout.emptyStatusPrompt",
                        "分享你的新鲜事...",
                      )}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3. 昵称、用户名与徽章 */}
        <div className="px-4 pt-3 pb-2">
          <div className="text-[17px] font-bold text-white leading-tight truncate">
            {getUserDisplayName(currentUser)}
          </div>
          <div className="text-xs text-[#949ba4] font-medium mt-0.5 flex items-center gap-1.5">
            <span className="truncate">
              {formatUserTag(currentUser.username)}
            </span>
            {/* Discord 风格身份标识小图标 */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <span
                title={t("common:badges.member", "Tescord 会员徽章")}
                className="w-3.5 h-3.5 bg-emerald-500/20 text-emerald-400 rounded flex items-center justify-center p-0.5"
              >
                <div className="w-2 h-2 rotate-45 bg-emerald-400" />
              </span>
              <span
                title={t("common:badges.earlyExplorer", "早期探索者")}
                className="w-3.5 h-3.5 bg-[#5865f2]/20 text-[#5865f2] rounded flex items-center justify-center p-0.5 font-mono text-[9px] font-bold"
              >
                #
              </span>
              <span
                title={t("common:badges.geekPioneer", "极客先锋")}
                className="w-3.5 h-3.5 bg-purple-500/20 text-purple-300 rounded-full flex items-center justify-center p-0.5"
              >
                <Sparkles className="w-2.5 h-2.5" />
              </span>
            </div>
          </div>
        </div>

        {/* 正在玩游戏专属活动面板 */}
        {currentUser.showActivity !== false &&
          currentUser.activities &&
          currentUser.activities.length > 0 && (
            <div
              data-testid="current-user-playing-game-panel"
              className="mx-3 mb-2 p-2.5 rounded-xl bg-[#111214]/80 border border-emerald-500/20 text-xs space-y-1"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>{t("common:activity.playing", "正在游玩")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#2b2d31] flex items-center justify-center flex-shrink-0 border border-white/5">
                  <Gamepad2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white truncate text-xs">
                    {currentUser.activities[0].name}
                  </div>
                  {currentUser.activities[0].details && (
                    <div className="text-[10px] text-gray-400 truncate">
                      {currentUser.activities[0].details}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        {/* 4. 操作菜单组 1：编辑个人资料 + 在线状态切换 */}
        <div className="mx-3 mt-1.5 bg-[#111214]/60 border border-white/5 rounded-xl p-1 space-y-0.5">
          {/* 编辑个人资料 */}
          <button
            type="button"
            data-testid="popout-edit-profile-btn"
            onClick={handleEditProfileClick}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#35373c] text-xs font-medium text-white transition group cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              <Pencil className="w-4 h-4 text-discord-textMuted group-hover:text-white transition" />
              <span>
                {t("common:profilePopout.editProfile", "编辑个人资料")}
              </span>
            </div>
            <span
              data-testid="popout-badge-new"
              className="bg-[#f23f43] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shadow-sm"
            >
              {t("common:new", "新的")}
            </span>
          </button>

          {/* 在线状态项（带展开子菜单） */}
          <button
            type="button"
            data-testid="popout-status-menu-btn"
            onClick={() => setIsStatusSubmenuOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#35373c] text-xs font-medium text-white transition group cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              <span
                className={`w-3 h-3 rounded-full flex-shrink-0 ${currentStatusInfo.color}`}
              />
              <span>{currentStatusInfo.label}</span>
            </div>
            {isStatusSubmenuOpen ? (
              <ChevronDown className="w-4 h-4 text-discord-textMuted group-hover:text-white transition" />
            ) : (
              <ChevronRight className="w-4 h-4 text-discord-textMuted group-hover:text-white transition" />
            )}
          </button>

          {/* 展开的状态选择列表 */}
          {isStatusSubmenuOpen && (
            <div className="pt-1 pb-0.5 px-1 space-y-1 bg-[#18191c]/80 rounded-lg border border-white/5 animate-in fade-in duration-100">
              {STATUS_KEYS.map((statusKey) => {
                const meta = STATUS_META[statusKey];
                const isSelected = currentStatusKey === statusKey;
                const label = t(meta.labelKey, meta.defaultLabel);
                const desc = t(meta.descKey, meta.defaultDesc);
                return (
                  <button
                    key={statusKey}
                    type="button"
                    data-testid={`popout-status-item-${statusKey}`}
                    onClick={() => handleStatusChange(statusKey)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition ${
                      isSelected
                        ? "bg-[#5865f2] text-white font-medium"
                        : "text-[#dbdee1] hover:bg-[#35373c] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.color}`}
                      />
                      <div className="flex flex-col text-left">
                        <span className="font-medium leading-none">
                          {label}
                        </span>
                        <span
                          className={`text-[10px] mt-0.5 ${
                            isSelected ? "text-white/80" : "text-[#949ba4]"
                          }`}
                        >
                          {desc}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. 操作菜单组 2：切换账号 + 复制使用者 ID */}
        <div className="mx-3 mt-2 mb-3 bg-[#111214]/60 border border-white/5 rounded-xl p-1 space-y-0.5">
          {/* 切换账号 */}
          <button
            type="button"
            data-testid="popout-switch-account-btn"
            onClick={handleSwitchAccountClick}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#35373c] text-xs font-medium text-white transition group cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              <UserCircle2 className="w-4 h-4 text-discord-textMuted group-hover:text-white transition" />
              <span>{t("common:user.switchAccount", "切换账号")}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-discord-textMuted group-hover:text-white transition" />
          </button>

          {/* 复制使用者 ID */}
          <button
            type="button"
            data-testid="popout-copy-id-btn"
            onClick={handleCopyId}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#35373c] text-xs font-medium text-white transition group cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              {/* 类似截图中的 [ID] 矩形图标 */}
              <div className="w-4 h-4 rounded border border-discord-textMuted group-hover:border-white flex items-center justify-center text-[8px] font-black text-discord-textMuted group-hover:text-white tracking-tighter transition">
                ID
              </div>
              <span>{t("common:user.copyUserId", "复制使用者 ID")}</span>
            </div>
            {copiedId ? (
              <span
                data-testid="popout-copy-feedback"
                className="text-emerald-400 text-xs font-semibold flex items-center gap-1 animate-in fade-in duration-100"
              >
                <Check className="w-3.5 h-3.5" />
                {t("common:copied", "已复制")}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
