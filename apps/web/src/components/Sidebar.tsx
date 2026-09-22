import React from "react";
import { Guild } from "@tescord/types";
import { MessageSquare, Plus, Compass, ShieldAlert } from "lucide-react";
import { ServerContextMenu } from "./context-menu/ServerContextMenu.js";

interface SidebarProps {
  guilds: Guild[];
  selectedGuildId: string | null;
  isSuperAdmin?: boolean;
  onOpenAdminDashboard?: () => void;
  onSelectGuild: (guildId: string | null) => void;
  onOpenCreateGuild: () => void;
  onOpenJoinGuild: () => void;
  onOpenCreateChannel?: (guild: Guild) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkGuildAsRead?: (guild: Guild) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  guilds,
  selectedGuildId,
  isSuperAdmin,
  onOpenAdminDashboard,
  onSelectGuild,
  onOpenCreateGuild,
  onOpenJoinGuild,
  onOpenCreateChannel,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkGuildAsRead,
}) => {
  return (
    <aside className="w-[72px] bg-discord-sidebar flex flex-col items-center py-3 space-y-2 select-none z-20">
      {/* 私信 / 首页 */}
      <button
        onClick={() => onSelectGuild(null)}
        className={`group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] transition-all duration-200 ${
          selectedGuildId === null
            ? "bg-discord-brand text-white !rounded-[16px]"
            : "bg-discord-channelList text-discord-textNormal hover:bg-discord-brand hover:text-white"
        }`}
        title="私信与主页"
      >
        <span
          className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
            selectedGuildId === null ? "h-10" : "h-0 group-hover:h-5"
          }`}
        />
        <MessageSquare className="w-6 h-6" />
      </button>

      {/* 超级管理员系统控制台 */}
      {isSuperAdmin && (
        <button
          onClick={onOpenAdminDashboard}
          className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-amber-400 hover:bg-amber-500 hover:text-white transition-all duration-200 shadow-md"
          title="系统管理控制台 (超级管理员)"
          data-testid="admin-dashboard-btn"
        >
          <ShieldAlert className="w-6 h-6" />
        </button>
      )}

      {/* 分隔线 */}
      <div className="w-8 h-[2px] bg-discord-channelList rounded-full my-1" />

      {/* 服务器列表 */}
      <div className="flex-1 w-full space-y-2 overflow-y-auto overflow-x-hidden flex flex-col items-center">
        {guilds.map((guild) => {
          const isSelected = selectedGuildId === guild.id;
          return (
            <ServerContextMenu
              key={guild.id}
              guild={guild}
              onOpenCreateChannel={onOpenCreateChannel}
              onOpenServerSettings={onOpenServerSettings}
              onLeaveGuild={onLeaveGuild}
              onMarkAsRead={onMarkGuildAsRead}
            >
              <button
                onClick={() => onSelectGuild(guild.id)}
                className={`group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] transition-all duration-200 overflow-hidden ${
                  isSelected ? "!rounded-[16px]" : ""
                }`}
                title={guild.name}
                aria-label={guild.name}
              >
                <span
                  className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                    isSelected ? "h-10" : "h-0 group-hover:h-5"
                  }`}
                />
                {guild.iconUrl ? (
                  <img
                    src={guild.iconUrl}
                    alt={guild.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-discord-channelList text-discord-textHeader flex items-center justify-center font-semibold text-sm">
                    {guild.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </button>
            </ServerContextMenu>
          );
        })}

        {/* 添加服务器 */}
        <button
          className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-discord-green hover:bg-discord-green hover:text-white transition-all duration-200"
          title="创建新服务器"
          onClick={onOpenCreateGuild}
        >
          <Plus className="w-6 h-6" />
        </button>

        {/* 加入公共社区 */}
        <button
          className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-discord-green hover:bg-discord-green hover:text-white transition-all duration-200"
          title="加入服务器 (使用邀请码)"
          onClick={onOpenJoinGuild}
        >
          <Compass className="w-6 h-6" />
        </button>
      </div>
    </aside>
  );
};
