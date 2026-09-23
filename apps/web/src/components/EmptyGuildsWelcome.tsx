import React from "react";
import {
  Compass,
  Plus,
  Sparkles,
  ShieldCheck,
  Headphones,
  MessageSquare,
} from "lucide-react";

interface EmptyGuildsWelcomeProps {
  onOpenDiscovery: () => void;
  onOpenCreateGuild: () => void;
}

export const EmptyGuildsWelcome: React.FC<EmptyGuildsWelcomeProps> = ({
  onOpenDiscovery,
  onOpenCreateGuild,
}) => {
  return (
    <div
      data-testid="empty-guilds-welcome"
      className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto bg-discord-chat relative select-none animate-fade-in"
    >
      {/* 顶部视觉区域 */}
      <div className="max-w-2xl w-full text-center space-y-4 mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-tr from-discord-brand to-indigo-500 text-white shadow-xl shadow-discord-brand/20 mb-2">
          <Sparkles className="w-10 h-10" />
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-discord-textHeader tracking-tight">
          欢迎来到 Tescord
        </h1>
        <p className="text-sm md:text-base text-discord-textMuted max-w-lg mx-auto leading-relaxed">
          纯粹离线自治、高保真实时音视频与端到端加密的私密协作空间。您目前尚未加入任何服务器，请选择下方的开始方式：
        </p>
      </div>

      {/* 两大行动卡片 */}
      <div className="max-w-2xl w-full grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* 卡片 1：探索公开社区 */}
        <div
          data-testid="welcome-discovery-card"
          onClick={onOpenDiscovery}
          className="group relative bg-[#2b2d31] hover:bg-[#313338] border border-white/5 hover:border-discord-brand/40 rounded-2xl p-6 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-lg hover:shadow-xl hover:-translate-y-1"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Compass className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-discord-textHeader group-hover:text-white">
              探索公开社区
            </h2>
            <p className="text-xs text-discord-textMuted leading-relaxed">
              浏览平台现存的公开服务器大厅，发现并一键直达技术交流、开源讨论与极客闲聊空间。
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/5">
            <span className="text-xs font-semibold text-emerald-400 group-hover:underline">
              前往探索大厅 &rarr;
            </span>
            <div className="flex gap-1.5 text-gray-500">
              <Headphones className="w-4 h-4" />
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 卡片 2：创建专属服务器 */}
        <div
          data-testid="welcome-create-card"
          onClick={onOpenCreateGuild}
          className="group relative bg-[#2b2d31] hover:bg-[#313338] border border-white/5 hover:border-discord-brand/40 rounded-2xl p-6 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-lg hover:shadow-xl hover:-translate-y-1"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-discord-brand/10 text-discord-brand flex items-center justify-center group-hover:scale-110 transition-transform">
              <Plus className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-discord-textHeader group-hover:text-white">
              创建我的服务器
            </h2>
            <p className="text-xs text-discord-textMuted leading-relaxed">
              为您的好友、团队或项目自定义频道结构、角色体系与私密权限，随时开启超低延迟连麦。
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/5">
            <span className="text-xs font-semibold text-discord-brand group-hover:underline">
              立即创建服务器 &rarr;
            </span>
            <ShieldCheck className="w-4 h-4 text-gray-500" />
          </div>
        </div>
      </div>

      {/* 底部特性提示 */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-[11px] text-gray-500 max-w-lg text-center">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>本地数据自治</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5 text-blue-500" />
          <span>RNNoise 神经网络降噪</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-purple-500" />
          <span>端到端加密保障</span>
        </div>
      </div>
    </div>
  );
};
