import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InvitePreviewDTO } from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";
import { GuildIcon } from "../ui/GuildIcon.js";
import { Loader2, AlertCircle } from "lucide-react";

interface ServerInviteEmbedProps {
  code: string;
  onJoinedServer?: (guildId: string) => void;
}

export const ServerInviteEmbed: React.FC<ServerInviteEmbedProps> = ({
  code,
  onJoinedServer,
}) => {
  const { t, i18n } = useTranslation(["chat", "common"]);
  const { getAuthHeaders } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InvitePreviewDTO | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const [joining, setJoining] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const fetchInvite = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/invites/${code}`, {
          headers: {
            ...getAuthHeaders(),
          },
        });
        if (!res.ok) {
          if (!isCancelled) setIsInvalid(true);
          return;
        }
        const data: InvitePreviewDTO = await res.json();
        if (!isCancelled) {
          setInvite(data);
          if (data.isMember) {
            setHasJoined(true);
          }
          setIsInvalid(false);
        }
      } catch (err) {
        if (!isCancelled) setIsInvalid(true);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    fetchInvite();
    return () => {
      isCancelled = true;
    };
  }, [code]);

  const isJoined = hasJoined || Boolean(invite?.isMember);

  const formattedCreatedDate = useMemo(() => {
    const createdAt = invite?.guild?.createdAt;
    if (!createdAt) return null;
    try {
      const d = new Date(createdAt);
      if (isNaN(d.getTime())) return null;
      return new Intl.DateTimeFormat(i18n.language || "zh-CN", {
        year: "numeric",
        month: "short",
      }).format(d);
    } catch {
      return null;
    }
  }, [invite?.guild?.createdAt, i18n.language]);

  const navigateToFirstChannel = (targetGuildId: string) => {
    window.dispatchEvent(
      new CustomEvent("tescord:switch-guild", {
        detail: { guildId: targetGuildId, preferFirst: true },
      }),
    );
    onJoinedServer?.(targetGuildId);
  };

  const handleGoToServer = () => {
    if (invite?.guild?.id) {
      navigateToFirstChannel(invite.guild.id);
    }
  };

  const handleJoin = async () => {
    if (joining) return;
    if (isJoined && invite?.guild?.id) {
      handleGoToServer();
      return;
    }

    try {
      setJoining(true);
      const res = await fetch(`${API_BASE}/api/invites/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
            t("chat:invite.joinFailed", { defaultValue: "加入服务器失败" }),
        );
      }

      const result = await res.json();
      setHasJoined(true);
      toast.success(
        t("chat:invite.joinSuccess", {
          name: invite?.guild.name || "",
          defaultValue: `成功加入服务器 ${invite?.guild.name || ""}！`,
        }),
      );

      const targetGuildId =
        result.guildId || result.guild?.id || invite?.guild.id;
      if (targetGuildId) {
        navigateToFirstChannel(targetGuildId);
      }
    } catch (err: any) {
      toast.error(
        err.message ||
          t("chat:invite.joinFailed", { defaultValue: "加入服务器失败" }),
      );
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="my-2 p-4 bg-[#2b2d31] border border-[#1f2023]/70 rounded-2xl max-w-[420px] w-full flex items-center space-x-3 text-[#949ba4] text-xs shadow-md">
        <Loader2 className="w-5 h-5 animate-spin text-discord-brand" />
        <span>
          {t("chat:invite.resolving", {
            defaultValue: "正在解析服务器邀请...",
          })}
        </span>
      </div>
    );
  }

  if (isInvalid || !invite) {
    return (
      <div className="my-2 p-4 bg-[#2b2d31] border border-[#1f2023]/70 rounded-2xl max-w-[420px] w-full flex items-center space-x-3 text-[#949ba4] shadow-md">
        <div className="w-10 h-10 rounded-full bg-[#1e1f22] flex items-center justify-center text-rose-400 shrink-0">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h5 className="text-white text-xs font-bold uppercase tracking-wider">
            {t("chat:invite.invalidTitle", { defaultValue: "邀请已失效" })}
          </h5>
          <p className="text-xs text-[#949ba4] mt-0.5">
            {t("chat:invite.invalidDesc", {
              defaultValue:
                "此邀请链接可能已过期，或者您没有加入此服务器的权限。",
            })}
          </p>
        </div>
      </div>
    );
  }

  const presenceCount =
    invite.guild.approximatePresenceCount ??
    invite.approximatePresenceCount ??
    0;
  const memberCount =
    invite.guild.approximateMemberCount ?? invite.approximateMemberCount ?? 0;

  return (
    <div
      className="my-3 w-full max-w-[420px] bg-[#2b2d31] border border-[#1f2023]/80 rounded-2xl shadow-xl overflow-hidden select-none transition-all hover:border-[#35373c]"
      data-testid="server-invite-card"
      onDragStart={(e) => e.preventDefault()}
    >
      {/* 顶部横幅 Banner */}
      <div className="relative w-full h-20 bg-[#1e1f22] overflow-hidden select-none pointer-events-none">
        {invite.guild.iconUrl ? (
          <img
            src={resolveServerUrl(invite.guild.iconUrl)}
            alt=""
            aria-hidden="true"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="absolute inset-0 w-full h-full object-cover blur-md scale-125 opacity-35 select-none pointer-events-none"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-pink-900/40" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#2b2d31]/30 to-[#2b2d31]" />
      </div>

      {/* 头像区域 (重叠在横幅下方与内容之间) */}
      <div className="relative px-4 flex items-end justify-between -mt-10 mb-2 select-none">
        <div className="w-[72px] h-[72px] rounded-[22px] ring-4 ring-[#2b2d31] bg-[#1e1f22] overflow-hidden shrink-0 shadow-lg flex items-center justify-center select-none pointer-events-none">
          {invite.guild.iconUrl ? (
            <GuildIcon
              src={resolveServerUrl(invite.guild.iconUrl)}
              alt={invite.guild.name}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="w-full h-full object-cover select-none pointer-events-none"
            />
          ) : (
            <div className="w-full h-full bg-[#5865F2] text-white font-bold text-2xl flex items-center justify-center select-none">
              {invite.guild.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* 主体信息区 */}
      <div className="px-4 pb-4 space-y-2.5">
        {/* 服务器名称与认证绿色徽章 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <h4
            className="text-white font-bold text-base leading-snug truncate max-w-[340px]"
            title={invite.guild.name}
          >
            {invite.guild.name}
          </h4>
          <span
            className="inline-flex items-center justify-center text-[#23a55a] shrink-0"
            title="Verified"
            aria-label={t("chat:invite.verified", { defaultValue: "Verified" })}
          >
            <svg
              className="w-4 h-4 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.2 15-4.3-4.3 1.4-1.4 2.9 2.9 6.9-6.9 1.4 1.4-8.3 8.3z" />
            </svg>
          </span>
        </div>

        {/* 在线人数与总成员统计 */}
        <div className="flex items-center gap-3 text-xs text-[#b5bac1] font-medium flex-wrap">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] inline-block shrink-0" />
            <span>
              {t("chat:invite.richOnlineCount", {
                count: presenceCount.toLocaleString(),
                defaultValue: `${presenceCount.toLocaleString()} 位在线`,
              })}
            </span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#80848e] inline-block shrink-0" />
            <span>
              {t("chat:invite.richMemberCount", {
                count: memberCount.toLocaleString(),
                defaultValue: `${memberCount.toLocaleString()} 位成员`,
              })}
            </span>
          </span>
        </div>

        {/* 建立日期 (按现有数据若返回了则展示) */}
        {formattedCreatedDate && (
          <div className="text-xs text-[#949ba4] font-normal">
            {t("chat:invite.createdDate", {
              date: formattedCreatedDate,
              defaultValue: `建立日期：${formattedCreatedDate}`,
            })}
          </div>
        )}

        {/* 服务器描述简介 */}
        {invite.guild.description ? (
          <p className="text-xs text-[#dbdee1] leading-relaxed line-clamp-3 break-words whitespace-pre-wrap">
            {invite.guild.description}
          </p>
        ) : null}

        {/* 附属归属小标 (小图标 + 服务器名称) */}
        <div className="flex items-center gap-2 pt-0.5 select-none">
          <div className="relative shrink-0 w-5 h-5 rounded-md overflow-hidden bg-[#1e1f22] flex items-center justify-center select-none pointer-events-none">
            {invite.guild.iconUrl ? (
              <GuildIcon
                src={resolveServerUrl(invite.guild.iconUrl)}
                alt={invite.guild.name}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="w-full h-full object-cover select-none pointer-events-none"
              />
            ) : (
              <span className="text-[10px] font-bold text-white select-none">
                {invite.guild.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="absolute -top-0.5 -right-0.5 text-[8px] leading-none select-none">
              🔥
            </span>
          </div>
          <span className="text-xs font-semibold text-white truncate max-w-[300px]">
            {invite.guild.name}
          </span>
        </div>

        {/* 底部全宽按钮：已加入为“前往服务器”，未加入为“加入” */}
        <div className="pt-1">
          <button
            type="button"
            onClick={isJoined ? handleGoToServer : handleJoin}
            disabled={joining}
            className="w-full py-2.5 px-4 bg-[#23a55a] hover:bg-[#209652] active:bg-[#1a7f45] disabled:opacity-75 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow cursor-pointer select-none"
            data-testid={
              isJoined ? "server-invite-joined-btn" : "server-invite-join-btn"
            }
          >
            {joining && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            <span>
              {isJoined
                ? t("chat:invite.goToGuild", { defaultValue: "前往服务器" })
                : t("chat:invite.join", { defaultValue: "加入" })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
