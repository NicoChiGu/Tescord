import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Guild } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import {
  useSettingsStore,
  DEFAULT_GUILD_NOTIFICATION_SETTINGS,
} from "../../stores/useSettingsStore.js";
import {
  GUILD_MUTE_DURATION_OPTIONS,
  GuildNotificationMode,
  isGuildMuted as checkIsGuildMuted,
} from "@tescord/types";
import {
  CheckCircle2,
  UserPlus,
  Settings,
  PlusCircle,
  FolderPlus,
  LogOut,
  Copy,
  Check,
  Bell,
  BellOff,
} from "lucide-react";
import { API_BASE } from "../../config.js";

interface ServerContextMenuProps {
  guild: Guild;
  children: React.ReactNode;
  onOpenCreateChannel?: (guild: Guild) => void;
  onOpenCreateCategory?: (guild: Guild) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkAsRead?: (guild: Guild) => void;
}

export const ServerContextMenu: React.FC<ServerContextMenuProps> = ({
  guild,
  children,
  onOpenCreateChannel,
  onOpenCreateCategory,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkAsRead,
}) => {
  const { t } = useTranslation(["contextMenu", "server", "common"]);
  const { isOwner, canManageChannels, canManageGuild, canCreateInvite } =
    usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const muteConfig = useSettingsStore((s) => s.mutedGuilds?.[guild.id]);
  const isMuted = checkIsGuildMuted(muteConfig);
  const setGuildMute = useSettingsStore((s) => s.setGuildMute);
  const unmuteGuild = useSettingsStore((s) => s.unmuteGuild);
  const notifSettings =
    useSettingsStore((s) => s.guildNotificationSettings?.[guild.id]) ||
    DEFAULT_GUILD_NOTIFICATION_SETTINGS;
  const setGuildNotificationSettings = useSettingsStore(
    (s) => s.setGuildNotificationSettings,
  );

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(guild.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy server id:", e);
    }
  };

  const handleOpenInvite = () => {
    window.dispatchEvent(
      new CustomEvent("tescord:open-invite-modal", { detail: { guild } }),
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {canCreateInvite && (
          <ContextMenuItem
            onClick={handleOpenInvite}
            className="text-discord-brand hover:text-white"
            data-testid="server-menu-invite-btn"
          >
            <div className="flex items-center space-x-2">
              <UserPlus className="w-4 h-4" />
              <span>{t("contextMenu:server.invite")}</span>
            </div>
          </ContextMenuItem>
        )}

        <ContextMenuItem
          onClick={() => onMarkAsRead?.(guild)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-discord-textMuted" />
            <span>{t("contextMenu:channel.markAsRead")}</span>
          </div>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* 将服务器静音 */}
        {isMuted ? (
          <ContextMenuItem
            onClick={() => unmuteGuild(guild.id)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <BellOff className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:server.unmuteServer")}</span>
            </div>
          </ContextMenuItem>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-discord-textMuted" />
                <span>{t("contextMenu:server.muteServer")}</span>
              </div>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {GUILD_MUTE_DURATION_OPTIONS.map((opt) => (
                <ContextMenuItem
                  key={opt.label}
                  onClick={() => setGuildMute(guild.id, opt.durationMs)}
                >
                  <span>{t(opt.i18nKey as any, opt.label)}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* 通知设定 */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <div className="flex items-center space-x-2">
              <Bell className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:server.notificationSettings")}</span>
            </div>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={notifSettings.mode || "ALL"}
              onValueChange={(val) =>
                setGuildNotificationSettings(guild.id, {
                  mode: val as GuildNotificationMode,
                })
              }
            >
              <ContextMenuRadioItem value="ALL">
                <span>{t("contextMenu:server.notifModeAll")}</span>
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="MENTIONS">
                <span>{t("contextMenu:server.notifModeMentions")}</span>
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="NOTHING">
                <span>{t("contextMenu:server.notifModeNothing")}</span>
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>

            <ContextMenuSeparator />

            <ContextMenuCheckboxItem
              checked={!!notifSettings.suppressEveryone}
              onCheckedChange={(checked) =>
                setGuildNotificationSettings(guild.id, {
                  suppressEveryone: checked,
                })
              }
            >
              <span>{t("contextMenu:server.suppressEveryone")}</span>
            </ContextMenuCheckboxItem>

            <ContextMenuCheckboxItem
              checked={!!notifSettings.suppressRoles}
              onCheckedChange={(checked) =>
                setGuildNotificationSettings(guild.id, {
                  suppressRoles: checked,
                })
              }
            >
              <span>{t("contextMenu:server.suppressRoles")}</span>
            </ContextMenuCheckboxItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {(canManageGuild || canManageChannels) && <ContextMenuSeparator />}

        {canManageChannels && (
          <>
            <ContextMenuItem
              onClick={() => onOpenCreateChannel?.(guild)}
              className="hover:bg-discord-brand"
            >
              <div className="flex items-center space-x-2">
                <PlusCircle className="w-4 h-4 text-discord-textMuted" />
                <span>{t("contextMenu:server.createChannel")}</span>
              </div>
            </ContextMenuItem>

            <ContextMenuItem
              onClick={() => onOpenCreateCategory?.(guild)}
              className="hover:bg-discord-brand"
              data-testid="server-menu-create-category-btn"
            >
              <div className="flex items-center space-x-2">
                <FolderPlus className="w-4 h-4 text-discord-textMuted" />
                <span>{t("contextMenu:server.createCategory")}</span>
              </div>
            </ContextMenuItem>
          </>
        )}

        {canManageGuild && (
          <ContextMenuItem
            onClick={() => onOpenServerSettings?.(guild)}
            className="hover:bg-discord-brand"
            data-testid="server-menu-settings-btn"
          >
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:server.settings")}</span>
            </div>
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {!isOwner && (
          <>
            <ContextMenuItem
              variant="danger"
              onClick={() => onLeaveGuild?.(guild)}
            >
              <div className="flex items-center space-x-2">
                <LogOut className="w-4 h-4" />
                <span>{t("contextMenu:server.leave")}</span>
              </div>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem onClick={handleCopyId}>
          <div className="flex items-center space-x-2">
            {copiedId ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <Copy className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>
              {copiedId ? t("common:copied") : t("contextMenu:copyGuildId")}
            </span>
          </div>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
