import React, { useState, useEffect } from "react";
import { User, UserStatus, Activity } from "@tescord/types";
import { resolveServerUrl } from "../../config.js";
import {
  Gamepad2,
  Calendar,
  ShieldCheck,
  Sparkles,
  Clock,
  Radio,
} from "lucide-react";

interface ProfileCardPreviewProps {
  user: User;
  avatarUrl?: string | null;
  status: UserStatus;
  customStatus?: string | null;
  bio?: string | null;
  bannerColor?: string | null;
  bannerUrl?: string | null;
  themeColor?: string | null;
  showActivity?: boolean;
  activeGame?: Activity | null;
}

export const ProfileCardPreview: React.FC<ProfileCardPreviewProps> = ({
  user,
  avatarUrl,
  status,
  customStatus,
  bio,
  bannerColor,
  bannerUrl,
  themeColor,
  showActivity = true,
  activeGame,
}) => {
  // 实时游玩计时器
  const [elapsedMinutes, setElapsedMinutes] = useState(1);

  useEffect(() => {
    if (!activeGame?.timestamps?.start) return;
    const calculateElapsed = () => {
      const now = Date.now();
      const diff = Math.max(1, Math.floor((now - activeGame.timestamps!.start!) / 60000));
      setElapsedMinutes(diff);
    };
    calculateElapsed();
    const interval = setInterval(calculateElapsed, 30000);
    return () => clearInterval(interval);
  }, [activeGame]);

  // 状态灯辅助样式
  const renderStatusBadge = (s: UserStatus) => {
    switch (s) {
      case "ONLINE":
        return (
          <div
            className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#23a55a] ring-[4px] ring-[#232428] flex items-center justify-center shadow"
            title="在线"
          />
        );
      case "IDLE":
        return (
          <div
            className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#f0b232] ring-[4px] ring-[#232428] flex items-center justify-center shadow"
            title="闲置"
          >
            <div className="w-2.5 h-2.5 bg-[#232428] rounded-full -mt-0.5 -ml-0.5" />
          </div>
        );
      case "DND":
        return (
          <div
            className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#f23f43] ring-[4px] ring-[#232428] flex items-center justify-center shadow"
            title="请勿打扰"
          >
            <div className="w-3 h-0.5 bg-white rounded-full" />
          </div>
        );
      case "OFFLINE":
      case "INVISIBLE":
      default:
        return (
          <div
            className="absolute bottom-0 right-0 w-6 h-6 rounded-full border-2 border-[#80848e] bg-[#232428] ring-[4px] ring-[#232428] flex items-center justify-center shadow"
            title="隐身 / 离线"
          >
            <div className="w-2 h-2 bg-[#80848e] rounded-full" />
          </div>
        );
    }
  };

  // 横幅背景计算
  const effectiveBannerColor = bannerColor || "#5865f2";
  const effectiveBannerUrl = bannerUrl ? resolveServerUrl(bannerUrl) : null;

  return (
    <div className="w-full max-w-[340px] select-none text-[#dbdee1] font-sans">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center justify-between">
        <span>预览效果 (PREVIEW)</span>
        <span className="text-[10px] text-[#5865f2] lowercase font-normal">
          1:1 动态展示
        </span>
      </div>

      <div
        className="w-full bg-[#232428] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col transition-all duration-200"
        style={{
          boxShadow: themeColor
            ? `0 20px 25px -5px ${themeColor}20, 0 8px 10px -6px ${themeColor}20`
            : undefined,
        }}
      >
        {/* 1. 顶部自定义横幅 */}
        <div
          className="h-28 w-full relative flex items-start justify-end p-2.5 transition-all duration-200 overflow-hidden"
          style={{
            backgroundColor: effectiveBannerColor,
            backgroundImage: effectiveBannerUrl
              ? `url(${effectiveBannerUrl})`
              : !bannerColor
                ? "linear-gradient(135deg, #5865f2 0%, #2b3d68 100%)"
                : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* 右上角勋章装饰 */}
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
            <span title="Tescord 特别徽章" className="flex items-center text-amber-300">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <span title="已认证用户" className="flex items-center text-[#5865f2]">
              <ShieldCheck className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* 2. 头像与状态指示 */}
        <div className="relative -mt-12 px-4 flex items-end justify-between">
          <div className="relative inline-block flex-shrink-0">
            <img
              src={
                (avatarUrl && resolveServerUrl(avatarUrl)) ||
                resolveServerUrl(user.avatarUrl) ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=" + user.id
              }
              alt={user.username}
              className="w-20 h-20 rounded-full bg-[#1e1f22] object-cover ring-[6px] ring-[#232428] shadow-lg transition-transform duration-150"
            />
            {renderStatusBadge(status)}
          </div>
        </div>

        {/* 3. 个人基本信息与个性签名气泡 */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-1.5">
            <h4
              className="text-lg font-bold text-white leading-tight truncate"
              style={{ color: themeColor || undefined }}
            >
              {user.username}
            </h4>
          </div>

          <div className="text-xs text-[#949ba4] font-medium mt-0.5">
            @{user.username}
          </div>

          {/* 个性状态气泡 */}
          {customStatus && (
            <div className="mt-2.5 text-xs text-[#dbdee1] flex items-center gap-2 bg-[#111214]/70 px-3 py-2 rounded-xl border border-white/5 shadow-inner">
              <Radio className="w-3.5 h-3.5 text-[#5865f2] flex-shrink-0 animate-pulse" />
              <span className="truncate">{customStatus}</span>
            </div>
          )}
        </div>

        {/* 4. 详细内容区域 */}
        <div className="px-4 space-y-3 pb-4">
          {/* 正在玩游戏专属活动面板 */}
          {showActivity && activeGame && (
            <div
              data-testid="preview-playing-game-panel"
              className="p-3 rounded-xl bg-[#111214]/80 border border-emerald-500/20 shadow-md space-y-2 text-xs animate-in fade-in duration-150"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>正在游玩 (PLAYING A GAME)</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-[#2b2d31] flex items-center justify-center flex-shrink-0 border border-white/5 shadow-inner">
                  <Gamepad2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-white truncate text-xs">
                    {activeGame.name}
                  </div>
                  {activeGame.details && (
                    <div className="text-[11px] text-[#949ba4] truncate">
                      {activeGame.details}
                    </div>
                  )}
                  <div className="text-[10px] text-emerald-400/90 font-medium flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    <span>已游玩 {elapsedMinutes} 分钟</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 如果关闭了 showActivity 或未在玩游戏时的提示 */}
          {!showActivity && (
            <div className="p-2.5 rounded-lg bg-[#111214]/40 border border-white/5 text-[11px] text-[#80848e] italic text-center">
              游戏状态已设置为隐藏
            </div>
          )}

          {/* 关于我 (Bio) */}
          <div className="p-3 rounded-xl bg-[#111214]/60 border border-white/5 space-y-2 text-xs">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#b5bac1] mb-1">
                关于我 (ABOUT ME)
              </div>
              <div className="text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words min-h-[32px]">
                {bio ? (
                  bio
                ) : (
                  <span className="text-[#80848e] italic">这个人很神秘，什么都还没写...</span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-[#949ba4]">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#5865f2]" />
                <span>
                  注册于：{new Date(user.createdAt || Date.now()).toLocaleDateString("zh-CN")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
