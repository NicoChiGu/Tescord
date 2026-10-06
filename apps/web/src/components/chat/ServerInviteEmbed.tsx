import { GuildIcon } from "../ui/GuildIcon.js";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { InvitePreviewDTO } from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";
import { Loader2, Users, AlertCircle, Check } from "lucide-react";

interface ServerInviteEmbedProps {
  code: string;
  onJoinedServer?: (guildId: string) => void;
}

export const ServerInviteEmbed: React.FC<ServerInviteEmbedProps> = ({
  code,
  onJoinedServer,
}) => {
  const { t } = useTranslation(["chat", "common"]);
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

  const handleJoin = async () => {
    if (joining || hasJoined || invite?.isMember) return;
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

      // 通知上层切换至该服务器
      const targetGuildId =
        result.guildId || result.guild?.id || invite?.guild.id;
      if (targetGuildId) {
        window.dispatchEvent(
          new CustomEvent("tescord:switch-guild", {
            detail: { guildId: targetGuildId },
          }),
        );
        onJoinedServer?.(targetGuildId);
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
      <div className="my-2 p-4 bg-[#2b2d31] border border-[#1f2023] rounded-lg max-w-md flex items-center space-x-3 text-discord-textMuted text-xs">
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
      <div className="my-2 p-4 bg-[#2b2d31] border border-[#1f2023] rounded-lg max-w-md flex items-center space-x-3 text-discord-textMuted">
        <div className="w-10 h-10 rounded-full bg-[#1e1f22] flex items-center justify-center text-rose-400 shrink-0">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h5 className="text-white text-xs font-bold uppercase tracking-wider">
            {t("chat:invite.invalidTitle", { defaultValue: "邀请已失效" })}
          </h5>
          <p className="text-xs text-discord-textMuted mt-0.5">
            {t("chat:invite.invalidDesc", {
              defaultValue:
                "此邀请链接可能已过期，或者您没有加入此服务器的权限。",
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 p-4 bg-[#2b2d31] border border-[#1f2023] rounded-lg max-w-md shadow-md select-none transition hover:border-[#35373c]">
      {/* 顶部标签 */}
      <div className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider mb-3">
        {invite.inviter
          ? t("chat:invite.invitedByUser", {
              user: invite.inviter.displayName || invite.inviter.username,
              defaultValue: `${invite.inviter.displayName || invite.inviter.username} 邀请你加入服务器`,
            })
          : t("chat:invite.invitedPrompt", {
              defaultValue: "你受邀加入此服务器",
            })}
      </div>

      <div className="flex items-center justify-between gap-3">
        {/* 服务器图标与信息 */}
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {invite.guild.iconUrl ? (
            <GuildIcon
              src={resolveServerUrl(invite.guild.iconUrl)}
              alt={invite.guild.name}
              className="w-12 h-12 rounded-2xl object-cover shrink-0 bg-[#1e1f22]"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-discord-brand text-white font-bold text-base flex items-center justify-center shrink-0">
              {invite.guild.name.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h4 className="text-white font-bold text-sm truncate">
              {invite.guild.name}
            </h4>
            <div className="flex items-center space-x-3 mt-1 text-xs text-discord-textMuted">
              {/* 在线人数 */}
              <span className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-discord-green inline-block shrink-0" />
                <span>
                  {t("chat:invite.onlineCount", {
                    count:
                      invite.guild.approximatePresenceCount ??
                      invite.approximatePresenceCount ??
                      0,
                    defaultValue: `${invite.guild.approximatePresenceCount ?? invite.approximatePresenceCount ?? 0} 在线`,
                  })}
                </span>
              </span>
              {/* 总成员数 */}
              <span className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block shrink-0" />
                <span>
                  {t("chat:invite.memberCount", {
                    count:
                      invite.guild.approximateMemberCount ??
                      invite.approximateMemberCount ??
                      0,
                    defaultValue: `${invite.guild.approximateMemberCount ?? invite.approximateMemberCount ?? 0} 成员`,
                  })}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 加入按钮 */}
        <div className="shrink-0">
          {hasJoined || invite.isMember ? (
            <button
              type="button"
              onClick={() => {
                if (invite.guild?.id) {
                  window.dispatchEvent(
                    new CustomEvent("tescord:switch-guild", {
                      detail: { guildId: invite.guild.id },
                    }),
                  );
                  onJoinedServer?.(invite.guild.id);
                }
              }}
              className="px-4 py-2 bg-[#23a55a]/20 hover:bg-[#23a55a]/30 text-[#23a55a] rounded font-semibold text-xs flex items-center space-x-1 cursor-pointer transition"
              data-testid="server-invite-joined-btn"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t("chat:invite.joined", { defaultValue: "已加入" })}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="px-5 py-2 bg-discord-green hover:bg-discord-greenHover text-white rounded font-semibold text-xs transition flex items-center space-x-1.5 shadow cursor-pointer"
              data-testid="server-invite-join-btn"
            >
              {joining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t("chat:invite.join", { defaultValue: "加入" })}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
