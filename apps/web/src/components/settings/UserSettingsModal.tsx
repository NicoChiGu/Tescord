import React, { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { UserStatus } from "@tescord/types";
import {
  X,
  Check,
  Dices,
  LogOut,
  Save,
  User as UserIcon,
  Shield,
  Monitor,
  Volume2,
  Sparkles,
} from "lucide-react";
import { AudioSettingsTab } from "./AudioSettingsTab.js";

export type UserSettingsTabType = "profile" | "audio";

interface UserSettingsModalProps {
  isOpen: boolean;
  initialTab?: UserSettingsTabType;
  initialSubSection?: "voice" | "video";
  onClose: () => void;
  isInCall?: boolean;
}

const STATUS_OPTIONS: {
  value: UserStatus;
  label: string;
  color: string;
  desc: string;
}[] = [
  {
    value: "ONLINE",
    label: "在线",
    color: "bg-emerald-500",
    desc: "正常接收所有通知",
  },
  {
    value: "IDLE",
    label: "离开",
    color: "bg-amber-500",
    desc: "短时间内离开电脑",
  },
  {
    value: "DND",
    label: "请勿打扰",
    color: "bg-rose-500",
    desc: "静音所有桌面通知",
  },
  {
    value: "OFFLINE",
    label: "隐身",
    color: "bg-gray-400",
    desc: "显示为离线但仍可使用全部功能",
  },
];

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  initialTab = "profile",
  initialSubSection,
  onClose,
  isInCall = false,
}) => {
  const { user, updateProfile, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<UserSettingsTabType>(initialTab);

  // 资料表单状态
  const [status, setStatus] = useState<UserStatus>(user?.status || "ONLINE");
  const [customStatus, setCustomStatus] = useState(user?.customStatus || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 桌面端状态
  const [isAutoLaunch, setIsAutoLaunch] = useState(false);
  const isElectron = !!window.electronAPI;

  // 同步打开时的 tab 与用户信息
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      if (user) {
        setStatus(user.status || "ONLINE");
        setCustomStatus(user.customStatus || "");
        setBio(user.bio || "");
        setAvatarUrl(user.avatarUrl || "");
      }
    }
  }, [isOpen, initialTab, user]);

  useEffect(() => {
    if (isElectron) {
      window.electronAPI?.getAutoLaunch().then((val) => setIsAutoLaunch(val));
    }
  }, [isElectron]);

  // 全局 ESC 按键监听关闭设置中心
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !user) return null;

  const handleRandomAvatar = () => {
    const seed = Math.random().toString(36).substring(2, 9);
    setAvatarUrl(`https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateProfile({
        status,
        customStatus: customStatus.trim() || null,
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      });
      if (isElectron) {
        window.electronAPI?.syncUserStatus(status);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      alert("保存个人资料失败，请重试");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm("确定要退出当前账号吗？")) {
      logout();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-0 sm:p-4 md:p-6 lg:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="user-settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full h-full sm:h-[88vh] sm:max-h-[850px] sm:max-w-4xl md:max-w-5xl bg-[#313338] text-white sm:rounded-2xl shadow-2xl overflow-hidden border border-transparent sm:border-[#3f4147] animate-in zoom-in-95 duration-150"
      >
      {/* 左侧：分类导航栏 */}
      <div className="w-60 bg-[#2b2d31] p-6 flex flex-col justify-between shrink-0 select-none border-r border-[#1f2023]">
        <div className="space-y-6">
          <div className="px-2">
            <h3 className="text-sm font-bold text-white truncate">
              {user.username}
            </h3>
            <span className="text-[10px] uppercase font-extrabold tracking-wider text-gray-400">
              个人设置中心
            </span>
          </div>

          <div className="space-y-4">
            {/* 分组 1：用户设置 */}
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                用户设置
              </div>
              <button
                type="button"
                data-testid="tab-profile-btn"
                onClick={() => setActiveTab("profile")}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === "profile"
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <UserIcon className="w-4 h-4 text-[#5865f2]" />
                <span>个人资料</span>
              </button>
            </div>

            {/* 分组 2：应用设置 */}
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                应用设置
              </div>
              <button
                type="button"
                data-testid="tab-audio-btn"
                onClick={() => setActiveTab("audio")}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === "audio"
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Volume2 className="w-4 h-4 text-discord-brand" />
                <span>语音与视频</span>
              </button>
            </div>

            {/* 分组 3：桌面客户端原生 (若运行在 Electron 下) */}
            {isElectron && (
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  桌面应用
                </div>
                <div className="px-2.5 py-2 rounded-lg text-xs text-gray-300 bg-[#1e1f22]/50 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]">开机自启</span>
                    <input
                      type="checkbox"
                      checked={isAutoLaunch}
                      onChange={async (e) => {
                        const val = e.target.checked;
                        setIsAutoLaunch(val);
                        await window.electronAPI?.setAutoLaunch(val);
                      }}
                      className="accent-discord-brand cursor-pointer"
                    />
                  </div>
                  <div className="text-[10px] text-discord-textMuted flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-discord-green" />
                    <span>托盘常驻守护已激活</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部危险区：退出登录 */}
        <div className="pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>退出账号</span>
          </button>
        </div>
      </div>

      {/* 右侧：主配置画布 */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#313338] relative">
        {/* 右上角固定关闭按钮与 ESC 提示 */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-8 flex flex-col items-center z-40">
          <button
            type="button"
            data-testid="close-user-settings-btn"
            onClick={onClose}
            aria-label="关闭"
            className="w-9 h-9 rounded-full border-2 border-white/20 hover:border-white flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            title="关闭设置 (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-[10px] font-bold text-gray-400 mt-1 select-none">
            ESC
          </span>
        </div>

        {/* 内容画布容器 */}
        <div className="flex-1 overflow-y-auto px-10 py-10 max-w-4xl custom-scrollbar">
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <UserIcon className="w-6 h-6 text-[#5865f2]" />
                  <span>我的个人资料</span>
                </h2>
                <p className="text-xs text-discord-textMuted mt-1">
                  管理您的头像、用户名展示、自定义个性签名及在线状态。
                </p>
              </div>

              {/* 用户基础卡片 */}
              <div className="relative rounded-2xl bg-[#2b2d31] p-6 border border-white/5 flex flex-col sm:flex-row items-center gap-5 shadow-sm">
                <div className="relative group">
                  <img
                    src={
                      avatarUrl ||
                      user.avatarUrl ||
                      "https://api.dicebear.com/7.x/bottts/svg?seed=fallback"
                    }
                    alt={user.username}
                    className="w-20 h-20 rounded-full bg-[#1e1f22] object-cover ring-4 ring-[#313338] shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={handleRandomAvatar}
                    title="随机换一个头像"
                    className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-[#5865f2] hover:bg-[#4752c4] text-white shadow-md transition-transform hover:scale-110"
                  >
                    <Dices className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <h4 className="text-xl font-bold text-white">
                      {user.username}
                    </h4>
                    <span className="flex items-center gap-1 text-[11px] font-bold bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-full">
                      <Shield className="w-3 h-3" />
                      已鉴权
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    注册时间：{new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* 在线状态单选 */}
              <div className="space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                  在线状态 (Presence)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {STATUS_OPTIONS.map((opt) => {
                    const isSelected = status === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatus(opt.value)}
                        className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                            : "bg-[#2b2d31] border-white/5 hover:bg-white/5"
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full ${opt.color} shrink-0`}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {opt.label}
                          </div>
                          <div className="text-[10px] text-gray-400 truncate">
                            {opt.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 自定义状态与签名 */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                  自定义个性签名 (Custom Status)
                </label>
                <input
                  type="text"
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                  placeholder="分享你现在在做什么... (例如: 正在开黑 🎮)"
                  className="w-full rounded-xl bg-[#2b2d31] border border-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
                />
              </div>

              {/* 自我介绍 / Bio */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                  自我介绍 (About Me)
                </label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="写一小段介绍展示在个人资料卡片上..."
                  className="w-full rounded-xl bg-[#2b2d31] border border-white/5 p-3.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] resize-none"
                />
              </div>

              {/* 自定义头像链接 */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                  自定义头像 URL
                </label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://... (支持外部图片直链或 DiceBear SVG)"
                  className="w-full rounded-xl bg-[#2b2d31] border border-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
                />
              </div>

              {/* 保存操作栏 */}
              <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                {saveSuccess ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 animate-in fade-in">
                    <Check className="w-4 h-4" /> 个人资料已成功保存
                  </span>
                ) : (
                  <span className="text-xs text-discord-textMuted">
                    修改后请点击右侧按钮保存生效
                  </span>
                )}

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="flex items-center gap-2 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] px-6 py-2.5 text-xs font-semibold text-white shadow-md shadow-[#5865f2]/25 transition-all disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>保存修改</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {activeTab === "audio" && (
            <AudioSettingsTab
              isInCall={isInCall}
              initialSubSection={initialSubSection}
            />
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
