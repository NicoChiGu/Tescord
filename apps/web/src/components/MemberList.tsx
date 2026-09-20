import React from "react";
import { Guild, User } from "@tescord/types";
import { Crown, ShieldCheck } from "lucide-react";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";

interface MemberListProps {
  guild: Guild | null;
  currentUser: User;
  onMention?: (username: string) => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

export const MemberList: React.FC<MemberListProps> = ({
  guild,
  currentUser,
  onMention,
  onKickMember,
  onBanMember,
}) => {
  // 从真实公会成员中提取展示列表，若无则兜底显示当前用户
  const memberItems = React.useMemo(() => {
    if (guild?.members && guild.members.length > 0) {
      return guild.members.map((m) => {
        const u = m.user || (m.userId === currentUser.id ? currentUser : null);
        const isOwner = guild.ownerId === m.userId;
        return {
          id: m.userId,
          username: m.nickname || u?.username || "未知成员",
          avatarUrl: u?.avatarUrl,
          status: u?.status || "ONLINE",
          customStatus: u?.customStatus,
          isOwner,
        };
      });
    }

    return [
      {
        id: currentUser.id,
        username: currentUser.username,
        avatarUrl: currentUser.avatarUrl,
        status: currentUser.status,
        customStatus: currentUser.customStatus || "正在体验 Tescord 🚀",
        isOwner: true,
      },
    ];
  }, [guild, currentUser]);

  return (
    <div className="w-60 bg-discord-channelList h-full flex flex-col p-3 overflow-y-auto select-none border-l border-[#232428]">
      <div className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider mb-2">
        成员 — {memberItems.length}
      </div>

      <div className="space-y-1">
        {memberItems.map((m) => (
          <UserContextMenu
            key={m.id}
            targetUser={{
              id: m.id,
              username: m.username,
              avatarUrl: m.avatarUrl,
              status: m.status as any,
            }}
            guild={guild}
            onMention={onMention}
            onKickMember={onKickMember}
            onBanMember={onBanMember}
          >
            <div className="flex items-center space-x-2.5 p-1.5 rounded hover:bg-discord-hover transition cursor-pointer group">
              <div className="relative flex-shrink-0">
                <img
                  src={
                    m.avatarUrl ||
                    "https://api.dicebear.com/7.x/bottts/svg?seed=user"
                  }
                  alt={m.username}
                  className="w-8 h-8 rounded-full bg-[#1e1f22]"
                />
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-discord-channelList ${
                    m.status === "ONLINE"
                      ? "bg-emerald-500"
                      : m.status === "IDLE"
                        ? "bg-amber-500"
                        : m.status === "DND"
                          ? "bg-rose-500"
                          : "bg-gray-400"
                  }`}
                />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center space-x-1">
                  <span className="text-xs font-semibold text-discord-textHeader truncate">
                    {m.username}
                  </span>
                  {m.isOwner ? (
                    <span title="服务器拥有者">
                      <Crown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    </span>
                  ) : (
                    <span title="已认证成员">
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                    </span>
                  )}
                </div>
                {m.customStatus && (
                  <span className="text-[10px] text-discord-textMuted truncate">
                    {m.customStatus}
                  </span>
                )}
              </div>
            </div>
          </UserContextMenu>
        ))}
      </div>
    </div>
  );
};
