import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";
import { UserStatus, Activity } from "@tescord/types";
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
  Globe,
  Palette,
  Gamepad2,
  Image as ImageIcon,
  RotateCcw,
  CheckCircle2,
  Download,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AudioSettingsTab } from "./AudioSettingsTab.js";
import { LanguageSettingsTab } from "./LanguageSettingsTab.js";
import { AboutUpdatesTab } from "./AboutUpdatesTab.js";
import { ProfileCardPreview } from "../profile/ProfileCardPreview.js";

export type UserSettingsTabType = "profile" | "audio" | "language" | "updates";


interface UserSettingsModalProps {
  isOpen: boolean;
  initialTab?: UserSettingsTabType;
  initialSubSection?: "voice" | "video";
  onClose: () => void;
  isInCall?: boolean;
}

const STATUS_OPTIONS: {
  value: UserStatus;
  labelKey: string;
  defaultLabel: string;
  color: string;
  descKey: string;
  defaultDesc: string;
}[] = [
  {
    value: "ONLINE",
    labelKey: "common:status.online",
    defaultLabel: "在线",
    color: "bg-emerald-500",
    descKey: "common:status.onlineDesc",
    defaultDesc: "正常接收所有通知",
  },
  {
    value: "IDLE",
    labelKey: "common:status.idle",
    defaultLabel: "离开",
    color: "bg-amber-500",
    descKey: "common:status.idleDesc",
    defaultDesc: "短时间内离开电脑",
  },
  {
    value: "DND",
    labelKey: "common:status.dnd",
    defaultLabel: "请勿打扰",
    color: "bg-rose-500",
    descKey: "common:status.dndDesc",
    defaultDesc: "静音所有桌面通知",
  },
  {
    value: "OFFLINE",
    labelKey: "common:status.invisible",
    defaultLabel: "隐身",
    color: "bg-gray-400",
    descKey: "common:status.invisibleDesc",
    defaultDesc: "显示为离线但仍可使用全部功能",
  },
];

const PRESET_BANNER_COLORS = [
  { name: "经典蓝紫", value: "#5865f2" },
  { name: "午夜深蓝", value: "#2b3d68" },
  { name: "翡翠暗绿", value: "#23a55a" },
  { name: "向日葵黄", value: "#f0b232" },
  { name: "珊瑚桃红", value: "#eb459e" },
  { name: "绯红赤炎", value: "#f23f43" },
  { name: "极客炭黑", value: "#1e1f22" },
  { name: "落日鎏金", value: "#e67e22" },
  { name: "神秘紫晶", value: "#9b59b6" },
];

const PRESET_THEME_COLORS = [
  { name: "默认", value: "" },
  { name: "蓝紫", value: "#5865f2" },
  { name: "碧绿", value: "#23a55a" },
  { name: "琥珀", value: "#f0b232" },
  { name: "玫红", value: "#eb459e" },
  { name: "天蓝", value: "#00b0f4" },
];

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  initialTab = "profile",
  initialSubSection,
  onClose,
  isInCall = false,
}) => {
  const { user, updateProfile, logout } = useAuthStore();
  const { t } = useTranslation(["settings", "common", "auth"]);
  const [activeTab, setActiveTab] = useState<UserSettingsTabType>(initialTab);

  // 资料与展示卡表单状态
  const userPrefix = user?.username.includes("#") ? user.username.split("#")[0] : user?.username || "";
  const userTag = user?.discriminator || (user?.username.includes("#") ? user.username.split("#")[1] : "00000");

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [usernamePrefix, setUsernamePrefix] = useState(userPrefix);
  const [status, setStatus] = useState<UserStatus>(user?.status || "ONLINE");
  const [customStatus, setCustomStatus] = useState(user?.customStatus || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [bannerColor, setBannerColor] = useState(user?.bannerColor || "");
  const [bannerUrl, setBannerUrl] = useState(user?.bannerUrl || "");
  const [themeColor, setThemeColor] = useState(user?.themeColor || "");
  const [showActivity, setShowActivity] = useState(user?.showActivity !== false);

  // 游戏侦测状态与活动
  const [detectedGame, setDetectedGame] = useState<Activity | null>(null);
  const [testGameActive, setTestGameActive] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 桌面端状态
  const [isAutoLaunch, setIsAutoLaunch] = useState(false);
  const isElectron = !!window.electronAPI;

  // 检查是否有未保存的更改
  const hasChanges = useMemo(() => {
    if (!user) return false;
    const initialDisplayName = user.displayName || "";
    const initialPrefix = user.username.includes("#") ? user.username.split("#")[0] : user.username;
    const initialStatus = user.status || "ONLINE";
    const initialCustomStatus = user.customStatus || "";
    const initialBio = user.bio || "";
    const initialAvatarUrl = user.avatarUrl || "";
    const initialBannerColor = user.bannerColor || "";
    const initialBannerUrl = user.bannerUrl || "";
    const initialThemeColor = user.themeColor || "";
    const initialShowActivity = user.showActivity !== false;

    return (
      displayName !== initialDisplayName ||
      usernamePrefix !== initialPrefix ||
      status !== initialStatus ||
      customStatus !== initialCustomStatus ||
      bio !== initialBio ||
      avatarUrl !== initialAvatarUrl ||
      bannerColor !== initialBannerColor ||
      bannerUrl !== initialBannerUrl ||
      themeColor !== initialThemeColor ||
      showActivity !== initialShowActivity
    );
  }, [
    user,
    displayName,
    usernamePrefix,
    status,
    customStatus,
    bio,
    avatarUrl,
    bannerColor,
    bannerUrl,
    themeColor,
    showActivity,
  ]);

  // 重置表单状态至当前已保存值
  const handleResetChanges = () => {
    if (!user) return;
    const currentPrefix = user.username.includes("#") ? user.username.split("#")[0] : user.username;
    setDisplayName(user.displayName || "");
    setUsernamePrefix(currentPrefix);
    setStatus(user.status || "ONLINE");
    setCustomStatus(user.customStatus || "");
    setBio(user.bio || "");
    setAvatarUrl(user.avatarUrl || "");
    setBannerColor(user.bannerColor || "");
    setBannerUrl(user.bannerUrl || "");
    setThemeColor(user.themeColor || "");
    setShowActivity(user.showActivity !== false);
  };

  // 仅在弹窗从关闭变为打开时同步初始 Tab 与表单状态，避免保存资料时被重置 Tab
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab(initialTab);
      handleResetChanges();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialTab]);

  // 获取桌面端原生配置与游戏状态监听
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.getAutoLaunch().then((val) => setIsAutoLaunch(val));
    window.electronAPI?.getDetectedGame?.().then((game) => setDetectedGame(game || null));

    const cleanup = window.electronAPI?.onGameActivityChanged?.((game) => {
      setDetectedGame(game);
    });

    return () => {
      cleanup?.();
    };
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
        displayName: displayName.trim() || null,
        username: usernamePrefix.trim(),
        status,
        customStatus: customStatus.trim() || null,
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        bannerColor: bannerColor.trim() || null,
        bannerUrl: bannerUrl.trim() || null,
        themeColor: themeColor.trim() || null,
        showActivity,
      });
      if (isElectron) {
        window.electronAPI?.syncUserStatus(status);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      toast.error(err?.message || t("settings:saveProfileError", "保存个人资料失败，请重试"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await dialog.confirm({
      title: t("auth:logoutConfirmTitle", "退出登录"),
      description: t("auth:logoutConfirmDesc", "确定要退出当前账号吗？退出后您需要重新验证身份并登录。"),
      variant: "warning",
      confirmText: t("auth:logoutConfirmTitle", "退出登录"),
    });
    if (confirmed) {
      logout();
      onClose();
    }
  };

  // 供预览展示的活跃游戏（优先真实侦测，若为测试模式则使用演示游戏）
  const activeGameForPreview: Activity | null = detectedGame
    ? detectedGame
    : testGameActive
      ? {
          name: "英雄联盟 (League of Legends)",
          type: "PLAYING",
          details: "召唤师峡谷 (排位赛)",
          timestamps: { start: Date.now() - 25 * 60 * 1000 },
        }
      : null;

  return (
    <div
      data-testid="user-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full h-full sm:h-[90vh] sm:max-w-6xl sm:rounded-2xl bg-[#313338] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-white/5">
        {/* 左侧：分类导航边栏 */}
        <div className="w-full md:w-60 bg-[#2b2d31] p-4 flex flex-col justify-between border-r border-[#1f2023] shrink-0">
          <div className="space-y-4">
            <div className="px-2 py-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                {t("settings:userSettings")}
              </h3>
            </div>

            <div className="space-y-1">
              {/* 个人资料与展示卡 (Profiles) */}
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
                <Palette className="w-4 h-4 text-[#5865f2]" />
                <span>{t("settings:profileTab", "个人资料与展示卡")}</span>
              </button>

              {/* 分组 2：应用设置 */}
              <div className="pt-2 space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  {t("settings:appSettings")}
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
                  <span>{t("settings:voiceAndVideo")}</span>
                </button>
                <button
                  type="button"
                  data-testid="tab-language-btn"
                  onClick={() => setActiveTab("language")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === "language"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Globe className="w-4 h-4 text-discord-brand" />
                  <span>{t("settings:language")}</span>
                </button>
                <button
                  type="button"
                  data-testid="tab-updates-btn"
                  onClick={() => setActiveTab("updates")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === "updates"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Download className="w-4 h-4 text-discord-brand" />
                  <span>{t("settings:updatesTab", "版本与更新")}</span>
                </button>
              </div>

              {/* 分组 3：桌面客户端原生 (若运行在 Electron 下) */}
              {isElectron && (
                <div className="space-y-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                    {t("settings:desktopApp")}
                  </div>
                  <div className="px-2.5 py-2 rounded-lg text-xs text-gray-300 bg-[#1e1f22]/50 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]">{t("settings:autoLaunch")}</span>
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
                      <span>{t("settings:trayRunning")}</span>
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
              data-testid="user-logout-btn"
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>{t("settings:logout")}</span>
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
          <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 custom-scrollbar">
            {activeTab === "profile" && (
              <div className="space-y-6 max-w-5xl">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Palette className="w-6 h-6 text-[#5865f2]" />
                    <span>展示卡与个人资料 (Profiles)</span>
                  </h2>
                  <p className="text-xs text-discord-textMuted mt-1">
                    在此个性化您的个人信息展示卡外观，设置游戏侦测状态，并随时通过右侧 1:1 卡片查看实时预览。
                  </p>
                </div>

                {/* 左右双栏：左侧配置表单，右侧 1:1 动态实时预览 */}
                <div className="flex flex-col lg:flex-row gap-8 items-start">
                  {/* 左侧：个性化属性配置 */}
                  <div className="flex-1 space-y-6 w-full min-w-0">
                    {/* 1. 头像与基本信息 */}
                    <div className="rounded-2xl bg-[#2b2d31] p-5 border border-white/5 flex flex-col sm:flex-row items-center gap-5 shadow-sm">
                      <div className="relative group">
                        <img
                          src={
                            avatarUrl ||
                            user.avatarUrl ||
                            "https://api.dicebear.com/7.x/bottts/svg?seed=fallback"
                          }
                          alt={user.username}
                          className="w-18 h-18 rounded-full bg-[#1e1f22] object-cover ring-4 ring-[#313338] shadow-inner"
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
                          <h4 className="text-lg font-bold text-white">
                            {displayName || userPrefix}
                          </h4>
                          <span className="flex items-center gap-1 text-[11px] font-bold bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-full">
                            <Shield className="w-3 h-3" />
                            已鉴权
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">
                          @{usernamePrefix}#{userTag}
                        </p>
                      </div>
                    </div>

                    {/* 1.1 显示昵称与用户识别码 (图1 核心功能) */}
                    <div className="space-y-4 p-4 rounded-xl bg-[#2b2d31] border border-white/5">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                          显示昵称 (Display Name)
                        </label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={userPrefix || "设置向大家展示的昵称"}
                          data-testid="profile-display-name-input"
                          className="w-full rounded-xl bg-[#1e1f22] border border-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
                        />
                        <p className="text-[11px] text-gray-400">
                          这是您在聊天、成员列表和个人卡片中展示的专属昵称。您可以随时调整，无修改次数限制。
                        </p>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                          用户识别码 (Unique Identifier)
                        </label>
                        <div className="flex items-center bg-[#1e1f22] rounded-xl border border-white/5 focus-within:ring-2 focus-within:ring-[#5865f2] px-3 py-2">
                          <span className="text-gray-400 text-sm font-mono mr-1 select-none">@</span>
                          <input
                            type="text"
                            value={usernamePrefix}
                            onChange={(e) => setUsernamePrefix(e.target.value.replace(/#/g, ""))}
                            data-testid="profile-username-prefix-input"
                            className="flex-1 bg-transparent text-white text-sm focus:outline-none"
                            placeholder="用户名"
                          />
                          <span
                            className="bg-[#2b2d31] text-gray-400 font-mono text-xs px-2.5 py-1 rounded-md border border-white/10 select-none ml-2"
                            title="数字标签终身唯一绑定不可修改"
                          >
                            #{userTag}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          识别码前缀可自由定制；后面的 5 位数字标签 <span className="font-mono text-zinc-300">#{userTag}</span> 为终身唯一绑定不可更改。
                        </p>
                      </div>
                    </div>

                    {/* 2. 在线状态单选 */}
                    <div className="space-y-2.5">
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                        {t("settings:presence", "在线状态 (Presence)")}
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {STATUS_OPTIONS.map((opt) => {
                          const isSelected = status === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setStatus(opt.value)}
                              className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                                isSelected
                                  ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                                  : "bg-[#2b2d31] border-white/5 hover:bg-white/5"
                              }`}
                            >
                              <span
                                className={`w-3 h-3 rounded-full ${opt.color} shrink-0`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {t(opt.labelKey, opt.defaultLabel)}
                                </div>
                                <div className="text-[10px] text-gray-400 truncate">
                                  {t(opt.descKey, opt.defaultDesc)}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3. 展示卡横幅个性化 (Profile Banner) */}
                    <div className="space-y-3 p-4 rounded-xl bg-[#2b2d31] border border-white/5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                          <Palette className="w-3.5 h-3.5 text-[#5865f2]" />
                          <span>展示卡横幅 (Profile Banner)</span>
                        </label>
                        {bannerColor && (
                          <button
                            type="button"
                            onClick={() => setBannerColor("")}
                            className="text-[11px] text-gray-400 hover:text-white underline"
                          >
                            重置为默认渐变
                          </button>
                        )}
                      </div>

                      {/* 经典预设色板 */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] text-gray-400">预设纯色主题：</div>
                        <div className="flex flex-wrap gap-2 items-center">
                          {PRESET_BANNER_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              title={c.name}
                              onClick={() => setBannerColor(c.value)}
                              className={`w-7 h-7 rounded-full transition-transform border-2 ${
                                bannerColor === c.value
                                  ? "scale-110 border-white ring-2 ring-[#5865f2]"
                                  : "border-transparent hover:scale-105"
                              }`}
                              style={{ backgroundColor: c.value }}
                            />
                          ))}
                          <div className="flex items-center gap-1.5 ml-1">
                            <input
                              type="color"
                              value={bannerColor || "#5865f2"}
                              onChange={(e) => setBannerColor(e.target.value)}
                              className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                              title="自定义取色器"
                            />
                            <span className="text-[11px] text-gray-400 font-mono">
                              {bannerColor || "默认"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 自定义横幅图片 URL */}
                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <div className="text-[11px] text-gray-400 flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>自定义横幅图片链接 (Banner Image URL)：</span>
                        </div>
                        <input
                          type="url"
                          data-testid="input-banner-url"
                          value={bannerUrl}
                          onChange={(e) => setBannerUrl(e.target.value)}
                          placeholder="https://... (粘贴外部图片直链，优先于纯色展示)"
                          className="w-full rounded-xl bg-[#1e1f22] border border-white/5 px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#5865f2]"
                        />
                      </div>
                    </div>

                    {/* 4. 卡片强调色 / 主题 (Theme Accent Color) */}
                    <div className="space-y-2.5 p-4 rounded-xl bg-[#2b2d31] border border-white/5">
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>卡片名称强调色 (Theme Accent)</span>
                      </label>
                      <div className="flex flex-wrap gap-2 items-center">
                        {PRESET_THEME_COLORS.map((tc) => (
                          <button
                            key={tc.name}
                            type="button"
                            onClick={() => setThemeColor(tc.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                              themeColor === tc.value
                                ? "bg-white/10 border-white text-white"
                                : "bg-[#1e1f22] border-white/5 text-gray-400 hover:text-white"
                            }`}
                          >
                            {tc.value && (
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle"
                                style={{ backgroundColor: tc.value }}
                              />
                            )}
                            <span>{tc.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 5. 游戏状态侦测与展示设置 (Game Activity Settings) */}
                    <div
                      data-testid="game-activity-settings-section"
                      className="space-y-3.5 p-4 rounded-xl bg-[#2b2d31] border border-white/5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Gamepad2 className="w-4 h-4 text-emerald-400" />
                          <div>
                            <span className="text-xs font-bold text-white">
                              在个人展示卡与状态中显示正在运行的游戏
                            </span>
                            <p className="text-[11px] text-gray-400">
                              开启后，系统侦测到您正在玩的游戏将自动同步展示给同服好友与频道成员。
                            </p>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="toggle-show-activity"
                          checked={showActivity}
                          onChange={(e) => setShowActivity(e.target.checked)}
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                      </div>

                      {/* 侦测状态卡片 */}
                      <div className="p-3 rounded-lg bg-[#1e1f22] border border-white/5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              detectedGame || testGameActive
                                ? "bg-emerald-500 animate-pulse"
                                : "bg-gray-500"
                            }`}
                          />
                          <div>
                            <div className="font-semibold text-white">
                              {detectedGame
                                ? `已侦测到游戏：${detectedGame.name}`
                                : testGameActive
                                  ? "正在模拟游戏：英雄联盟 (League of Legends)"
                                  : isElectron
                                    ? "当前未检测到支持的游戏进程"
                                    : "Web 端模式：自动侦测仅在桌面客户端生效"}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              {isElectron
                                ? "后台每 5 秒低开销扫描系统前台进程"
                                : "建议下载并使用 Tescord 桌面客户端获得全自动感知体验"}
                            </div>
                          </div>
                        </div>

                        {/* 提供快捷测试开关 (方便无客户端或调试预览) */}
                        <button
                          type="button"
                          onClick={() => setTestGameActive(!testGameActive)}
                          className="text-[11px] px-2.5 py-1 rounded bg-[#2b2d31] hover:bg-[#35373c] text-gray-300 hover:text-white border border-white/5 transition"
                        >
                          {testGameActive ? "停止测试游戏" : "模拟测试游戏"}
                        </button>
                      </div>
                    </div>

                    {/* 6. 自定义状态与签名 */}
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

                    {/* 7. 自我介绍 / Bio */}
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

                    {/* 8. 自定义头像链接 */}
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
                  </div>

                  {/* 右侧：1:1 动态实时卡片预览区 (Sticky 悬停) */}
                  <div className="w-full lg:w-80 shrink-0 flex justify-center sticky top-2">
                    <ProfileCardPreview
                      user={user}
                      displayName={displayName}
                      usernamePrefix={usernamePrefix}
                      avatarUrl={avatarUrl}
                      status={status}
                      customStatus={customStatus}
                      bio={bio}
                      bannerColor={bannerColor}
                      bannerUrl={bannerUrl}
                      themeColor={themeColor}
                      showActivity={showActivity}
                      activeGame={activeGameForPreview}
                    />
                  </div>
                </div>

                {/* 底部浮动“未保存更改提示条” (类似 Discord 经典条) */}
                {hasChanges && (
                  <div
                    data-testid="unsaved-changes-notice-bar"
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#111214] border border-white/10 rounded-2xl shadow-2xl px-6 py-3.5 flex items-center justify-between gap-6 animate-in slide-in-from-bottom-5 duration-200"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>注意 — 您有未保存的更改！</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        data-testid="reset-profile-changes-btn"
                        onClick={handleResetChanges}
                        className="text-xs text-gray-300 hover:text-white hover:underline px-2 py-1 flex items-center gap-1 transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重置</span>
                      </button>
                      <button
                        type="button"
                        data-testid="save-profile-changes-btn"
                        disabled={isSaving}
                        onClick={handleSave}
                        className="bg-[#23a55a] hover:bg-[#1a8044] active:scale-95 text-white text-xs font-semibold px-5 py-2 rounded-xl shadow-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isSaving ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        <span>{isSaving ? "保存中..." : "保存更改"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 保存成功提示 */}
                {saveSuccess && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-900/90 border border-emerald-500/30 text-white rounded-2xl shadow-2xl px-6 py-3 flex items-center gap-2 text-xs font-semibold animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>展示卡个性化设置已成功保存并全网同步！</span>
                  </div>
                )}
              </div>
            )}

            {activeTab === "audio" && (
              <AudioSettingsTab
                isInCall={isInCall}
                initialSubSection={initialSubSection}
              />
            )}

            {activeTab === "language" && <LanguageSettingsTab />}

            {activeTab === "updates" && <AboutUpdatesTab />}
          </div>
        </div>
      </div>
    </div>
  );
};
