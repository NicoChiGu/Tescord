import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Channel, Guild, CHANNEL_MUTE_DURATION_OPTIONS } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import {
  CheckCircle2,
  Edit3,
  Trash2,
  Copy,
  Check,
  Hash,
  Volume2,
  Bell,
  BellOff,
  UserPlus,
} from "lucide-react";
import { API_BASE } from "../../config.js";

interface ChannelContextMenuProps {
  channel: Channel;
  guild?: Guild | null;
  children: React.ReactNode;
  onSelectChannel?: (channel: Channel) => void;
  onJoinVoiceChannel?: (channel: Channel) => void;
  onEditChannel?: (channel: Channel) => void;
  onDeleteChannel?: (channel: Channel) => void;
  onMarkAsRead?: (channel: Channel) => void;
}

export const ChannelContextMenu: React.FC<ChannelContextMenuProps> = ({
  channel,
  guild,
  children,
  onSelectChannel,
  onJoinVoiceChannel,
  onEditChannel,
  onDeleteChannel,
  onMarkAsRead,
}) => {
  const { t } = useTranslation(["contextMenu", "server", "common"]);
  const { canManageChannels, canCreateInvite } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const setChannelMute = useSettingsStore((state) => state.setChannelMute);
  const unmuteChannel = useSettingsStore((state) => state.unmuteChannel);
  const isMuted = useSettingsStore((state) => state.isChannelMuted(channel.id));

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(channel.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy channel id:", e);
    }
  };

  const handleCreateAndCopyInvite = async () => {
    if (!guild) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ maxUses: 10, expiresInHours: 24 }),
      });
      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.code);
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2000);
      }
    } catch (err) {
      console.error("Failed to create invite:", err);
    }
  };

  const isVoice = channel.type === "VOICE";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          onClick={() => {
            onSelectChannel?.(channel);
            if (isVoice) {
              onJoinVoiceChannel?.(channel);
            }
          }}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            {isVoice ? (
              <Volume2 className="w-4 h-4 text-discord-green" />
            ) : (
              <Hash className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>
              {isVoice
                ? t("server:roles.perm.connect")
                : t("contextMenu:channel.switchToChannel")}
            </span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => onMarkAsRead?.(channel)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-discord-textMuted" />
            <span>{t("contextMenu:channel.markAsRead")}</span>
          </div>
        </ContextMenuItem>

        {canCreateInvite && guild && (
          <ContextMenuItem
            onClick={handleCreateAndCopyInvite}
            className="text-discord-brand hover:text-white"
            data-testid="channel-context-menu-invite"
          >
            <div className="flex items-center space-x-2">
              {copiedInvite ? (
                <Check className="w-4 h-4 text-discord-green" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              <span>
                {copiedInvite
                  ? t("server:invites.copied")
                  : t("contextMenu:server.invite")}
              </span>
            </div>
          </ContextMenuItem>
        )}

        {isMuted ? (
          <ContextMenuItem
            data-testid="channel-context-menu-unmute"
            onClick={() => unmuteChannel(channel.id)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Bell className="w-4 h-4 text-discord-green" />
              <span>{t("contextMenu:channel.unmuteChannel")}</span>
            </div>
          </ContextMenuItem>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger
              data-testid="channel-context-menu-mute-trigger"
              className="hover:bg-discord-brand"
            >
              <div className="flex items-center space-x-2">
                <BellOff className="w-4 h-4 text-discord-textMuted" />
                <span>{t("contextMenu:channel.muteChannel")}</span>
              </div>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              {CHANNEL_MUTE_DURATION_OPTIONS.map((opt) => (
                <ContextMenuItem
                  key={opt.label}
                  data-testid={`mute-duration-option-${opt.label}`}
                  onClick={() => setChannelMute(channel.id, opt.durationMs)}
                  className="hover:bg-discord-brand text-xs"
                >
                  <span>{opt.i18nKey ? t(opt.i18nKey) : opt.label}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <ContextMenuSeparator />

        {canManageChannels && (
          <ContextMenuItem
            onClick={() => onEditChannel?.(channel)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Edit3 className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:channel.editChannel")}</span>
            </div>
          </ContextMenuItem>
        )}

        <ContextMenuItem onClick={handleCopyId}>
          <div className="flex items-center space-x-2">
            {copiedId ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <Copy className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>
              {copiedId ? t("common:copied") : t("contextMenu:copyChannelId")}
            </span>
          </div>
        </ContextMenuItem>

        {canManageChannels && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="danger"
              onClick={() => onDeleteChannel?.(channel)}
            >
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4" />
                <span>{t("contextMenu:channel.deleteChannel")}</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
