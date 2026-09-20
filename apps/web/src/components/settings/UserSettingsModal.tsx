import React, { useState } from "react";
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
} from "lucide-react";

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  onClose,
}) => {
  const { user, updateProfile, logout } = useAuthStore();

  const [status, setStatus] = useState<UserStatus>(user?.status || "ONLINE");
  const [customStatus, setCustomStatus] = useState(user?.customStatus || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isAutoLaunch, setIsAutoLaunch] = useState(false);
  const isElectron = !!window.electronAPI;

  React.useEffect(() => {
    if (isElectron) {
      window.electronAPI?.getAutoLaunch().then((val) => setIsAutoLaunch(val));
    }
  }, [isElectron]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-[#313338] shadow-2xl border border-white/5 flex flex-col max-h-[90vh]">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#2b2d31]">
          <div className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-[#5865f2]" />
            <h3 className="text-lg font-bold text-white">用户个人中心与设置</h3>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-[#1e1f22] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
            <span className="font-semibold">ESC</span>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 用户基础卡片 */}
          <div className="relative rounded-xl bg-[#1e1f22] p-5 border border-white/5 flex flex-col sm:flex-row items-center gap-5">
            <div className="relative group">
              <img
                src={
                  avatarUrl ||
                  user.avatarUrl ||
                  "https://api.dicebear.com/7.x/bottts/svg?seed=fallback"
                }
                alt={user.username}
                className="w-20 h-20 rounded-full bg-[#2b2d31] object-cover ring-4 ring-[#313338] shadow-inner"
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
                加入时间：{new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* 在线状态指示灯选择 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2.5">
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
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                        : "bg-[#2b2d31] border-white/5 hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-full ${opt.color} flex-shrink-0`}
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

          {/* 自定义状态与心情 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              自定义个性签名 (Custom Status)
            </label>
            <input
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="分享你现在在做什么... (例如: 正在开黑 🎮)"
              className="w-full rounded-lg bg-[#1e1f22] px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
            />
          </div>

          {/* 自我介绍 / Bio */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              自我介绍 (About Me)
            </label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="写一小段介绍展示在个人资料卡片上..."
              className="w-full rounded-lg bg-[#1e1f22] p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2] resize-none"
            />
          </div>

          {/* 自定义头像链接 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
              自定义头像 URL
            </label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://... (支持外部图片直链或 DiceBear SVG)"
              className="w-full rounded-lg bg-[#1e1f22] px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
            />
          </div>

          {/* 4.3 桌面端独占原生设置 */}
          {isElectron && (
            <div className="rounded-xl bg-[#2b2d31] p-4 border border-white/5 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-gray-300">
                <Monitor className="w-4 h-4 text-discord-brand" />
                <span>桌面原生特性 (Desktop Native)</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">
                    开机自动启动 (Auto-Launch)
                  </div>
                  <div className="text-xs text-discord-textMuted">
                    开机时自动在后台静默启动 Tescord 并最小化至托盘
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAutoLaunch}
                    onChange={async (e) => {
                      const val = e.target.checked;
                      setIsAutoLaunch(val);
                      await window.electronAPI?.setAutoLaunch(val);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#1e1f22] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-brand"></div>
                </label>
              </div>

              <div className="text-xs text-discord-textMuted flex items-center space-x-1.5 pt-1 border-t border-white/5">
                <span className="w-2 h-2 rounded-full bg-discord-green" />
                <span>系统托盘常驻已就绪 (关闭窗口自动隐藏至托盘)</span>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#2b2d31]">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-3 py-2 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>退出账号</span>
          </button>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 animate-in fade-in">
                <Check className="w-4 h-4" /> 已保存
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] active:scale-[0.98] px-5 py-2 text-xs font-semibold text-white shadow-md shadow-[#5865f2]/25 transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>保存修改</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
