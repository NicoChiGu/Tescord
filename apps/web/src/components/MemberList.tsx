import React from "react";
import { useTranslation } from "react-i18next";
import { Guild, User, GuildMember, Role, parseRoleIds } from "@tescord/types";
import { Crown, ShieldCheck, Gamepad2 } from "lucide-react";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { useUserProfilePopoutStore } from "../stores/useUserProfilePopoutStore.js";
import { usePresenceStore } from "../stores/usePresenceStore.js";
import { resolveServerUrl } from "../config.js";
import { getUserDisplayName } from "../utils/userDisplay.js";

interface MemberListProps {
  guild: Guild | null;
  currentUser: User;
  className?: string;
  onMention?: (username: string) => void;
  onSendMessage?: (content: string) => void;
  onStartDM?: (userId: string) => void;
  onStartCall?: (userId: string) => void;
  onOpenUserSettings?: () => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

interface MemberDisplayItem {
  id: string;
  username: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  status: string;
  customStatus?: string | null;
  bio?: string | null;
  isOwner: boolean;
  color?: string | null;
  highestHoistedRole?: Role | null;
  rawUser: User;
  rawMember?: GuildMember | null;
  roles: Role[];
  joinedAt?: string;
  createdAt?: string;
}

interface MemberGroup {
  id: string;
  name: string;
  members: MemberDisplayItem[];
}

export const MemberList: React.FC<MemberListProps> = ({
  guild,
  currentUser,
  className,
  onMention,
  onSendMessage,
  onStartDM,
  onStartCall,
  onOpenUserSettings,
  onKickMember,
  onBanMember,
}) => {
  const { t } = useTranslation("common");
  const { isOpen, activeTriggerId, togglePopout, closePopout } =
    useUserProfilePopoutStore();
  const presences = usePresenceStore((s) => s.presences);

  // 切换服务器时自动关闭已打开的卡片
  React.useEffect(() => {
    closePopout();
  }, [guild?.id, closePopout]);

  // 从真实公会成员中提取展示列表并按 Hoist 角色分组
  const groups = React.useMemo<MemberGroup[]>(() => {
    if (!guild?.members || guild.members.length === 0) {
      return [
        {
          id: "online",
          name: t("common:memberList.online", "在线"),
          members: [
            {
              id: currentUser.id,
              username: currentUser.username,
              avatarUrl: currentUser.avatarUrl,
              status: currentUser.status,
              customStatus:
                currentUser.customStatus ||
                t("common:memberList.defaultBio", "正在体验 Tescord 🚀"),
              bio: currentUser.bio,
              isOwner: true,
              rawUser: currentUser,
              rawMember: null,
              roles: [],
              createdAt: currentUser.createdAt,
            },
          ],
        },
      ];
    }

    const roleMap = new Map<string, Role>(
      (guild.roles || []).map((r) => [r.id, r]),
    );

    // 解析每个成员的角色与最高显示属性
    const items: MemberDisplayItem[] = guild.members.map((m) => {
      const u = m.user || (m.userId === currentUser.id ? currentUser : null);
      const isOwner = guild.ownerId === m.userId;

      // 提取成员的所有角色并按权重降序排列
      const roleIds = parseRoleIds(m.roleIds);
      const userRoles = roleIds
        .map((id) => roleMap.get(id))
        .filter(Boolean) as Role[];
      userRoles.sort((a, b) => b.position - a.position);

      // 寻找最高且有颜色的角色
      const coloredRole = userRoles.find((r) => !!r.color);
      // 寻找最高且开启 hoist 分栏的角色
      const hoistedRole = userRoles.find((r) => r.hoist);

      const rawUser: User = u || {
        id: m.userId,
        username: "未知成员",
        email: "",
        avatarUrl: undefined,
        status: "ONLINE",
        createdAt: m.joinedAt || new Date().toISOString(),
      };

      const realtimePresence = presences[m.userId];
      const memberStatus =
        m.userId === currentUser.id
          ? currentUser.status
          : realtimePresence?.status || rawUser.status || "OFFLINE";
      const customStatus =
        m.userId === currentUser.id
          ? currentUser.customStatus
          : realtimePresence?.customStatus !== undefined
            ? realtimePresence.customStatus
            : rawUser.customStatus;

      return {
        id: m.userId,
        username: rawUser.username,
        nickname: m.nickname,
        avatarUrl: rawUser.avatarUrl,
        status: memberStatus,
        customStatus,
        bio: rawUser.bio,
        isOwner,
        color: coloredRole?.color || null,
        highestHoistedRole: hoistedRole || null,
        rawUser: {
          ...rawUser,
          status: memberStatus,
          customStatus,
          activities: realtimePresence?.activities || rawUser.activities,
        },
        rawMember: m,
        roles: userRoles,
        joinedAt: m.joinedAt,
        createdAt: rawUser.createdAt,
      };
    });

    // 收集所有开启了 hoist 的角色
    const hoistedRoles = (guild.roles || [])
      .filter((r) => r.hoist)
      .sort((a, b) => b.position - a.position);

    const groupMap = new Map<string, MemberGroup>();

    // 为每个开启 hoist 的角色初始化一个分组
    for (const r of hoistedRoles) {
      groupMap.set(r.id, {
        id: r.id,
        name: r.name,
        members: [],
      });
    }

    const defaultOnlineGroup: MemberGroup = {
      id: "online",
      name: t("common:memberList.online", "在线"),
      members: [],
    };

    const defaultOfflineGroup: MemberGroup = {
      id: "offline",
      name: t("common:memberList.offline", "离线"),
      members: [],
    };

    // 将成员分发到对应的分组
    for (const item of items) {
      const isItemOffline =
        item.status === "OFFLINE" ||
        (item.status === "INVISIBLE" && item.id !== currentUser.id);

      if (isItemOffline) {
        defaultOfflineGroup.members.push(item);
      } else if (
        item.highestHoistedRole &&
        groupMap.has(item.highestHoistedRole.id)
      ) {
        groupMap.get(item.highestHoistedRole.id)!.members.push(item);
      } else {
        defaultOnlineGroup.members.push(item);
      }
    }

    // 组装最终呈现的分组列表（只展示非空分组）
    const result: MemberGroup[] = [];
    for (const r of hoistedRoles) {
      const g = groupMap.get(r.id);
      if (g && g.members.length > 0) {
        result.push(g);
      }
    }

    if (defaultOnlineGroup.members.length > 0) {
      result.push(defaultOnlineGroup);
    }
    if (defaultOfflineGroup.members.length > 0) {
      result.push(defaultOfflineGroup);
    }

    return result;
  }, [guild, currentUser, presences]);

  return (
    <div
      className={`w-60 bg-discord-channelList h-full flex flex-col p-3 overflow-y-auto select-none border-l border-[#232428] space-y-4 ${
        className || ""
      }`}
    >
      {groups.map((grp) => (
        <div key={grp.id} className="space-y-1">
          {/* 分组标题与人数 */}
          <div className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider px-1">
            {grp.name} — {grp.members.length}
          </div>

          {/* 成员项目 */}
          <div className="space-y-0.5">
            {grp.members.map((m) => (
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
                onSendMessage={onStartDM ? (uid) => onStartDM(uid) : undefined}
                onStartCall={onStartCall ? (uid) => onStartCall(uid) : undefined}
                onKickMember={onKickMember}
                onBanMember={onBanMember}
              >
                <div
                  data-member-item={m.id}
                  data-profile-trigger={`member-${m.id}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    togglePopout({
                      user: m.rawUser,
                      member: m.rawMember,
                      guild: guild,
                      targetRect: rect,
                      roles: m.roles,
                      isOwner: m.isOwner,
                      triggerId: `member-${m.id}`,
                    });
                  }}
                  className={`flex items-center space-x-2.5 p-1.5 rounded transition cursor-pointer group ${
                    isOpen && activeTriggerId === `member-${m.id}`
                      ? "bg-discord-hover text-white"
                      : "hover:bg-discord-hover"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <img
                      src={
                        resolveServerUrl(m.avatarUrl) ||
                        "https://api.dicebear.com/7.x/bottts/svg?seed=" + m.id
                      }
                      alt={m.username}
                      className="w-8 h-8 rounded-full bg-[#1e1f22] object-cover"
                    />
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-discord-channelList ${
                        m.status === "ONLINE"
                          ? "bg-emerald-500"
                          : m.status === "IDLE"
                            ? "bg-amber-500"
                            : m.status === "DND"
                              ? "bg-rose-500"
                              : m.status === "INVISIBLE" &&
                                  m.id === currentUser.id
                                ? "border-gray-400 bg-transparent"
                                : "bg-gray-400"
                      }`}
                      title={
                        m.status === "INVISIBLE" && m.id === currentUser.id
                          ? t(
                              "common:memberList.invisibleSelf",
                              "隐身 (仅自己可见)",
                            )
                          : m.status
                      }
                    />
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex items-center space-x-1">
                      <span
                        className="text-xs font-semibold truncate group-hover:text-white transition-colors"
                        style={{ color: m.color || undefined }}
                      >
                        {getUserDisplayName(m.rawUser, m)}
                      </span>
                      {m.isOwner && (
                        <span
                          title={t("common:memberList.owner", "服务器所有者")}
                          className="flex-shrink-0"
                        >
                          <Crown className="w-3.5 h-3.5 text-amber-400" />
                        </span>
                      )}
                    </div>
                    {m.rawUser.activities &&
                    m.rawUser.activities.length > 0 &&
                    m.rawUser.showActivity !== false ? (
                      <div className="flex items-center space-x-1 text-[10px] text-discord-textMuted truncate">
                        <Gamepad2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span className="truncate">
                          正在玩 {m.rawUser.activities[0].name}
                        </span>
                      </div>
                    ) : m.customStatus ? (
                      <span className="text-[10px] text-discord-textMuted truncate">
                        {m.customStatus}
                      </span>
                    ) : null}
                  </div>
                </div>
              </UserContextMenu>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
