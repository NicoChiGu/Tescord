import React, { useState } from "react";
import { Guild } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import {
  CheckCircle2,
  UserPlus,
  Settings,
  PlusCircle,
  LogOut,
  Copy,
  Check,
} from "lucide-react";
import { API_BASE } from "../../config.js";

interface ServerContextMenuProps {
  guild: Guild;
  children: React.ReactNode;
  onOpenCreateChannel?: (guild: Guild) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkAsRead?: (guild: Guild) => void;
}

export const ServerContextMenu: React.FC<ServerContextMenuProps> = ({
  guild,
  children,
  onOpenCreateChannel,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkAsRead,
}) => {
  const { isOwner, canManageChannels, canManageGuild } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(guild.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy server id:", e);
    }
  };

  const handleCreateAndCopyInvite = async () => {
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          onClick={handleCreateAndCopyInvite}
          className="text-discord-brand hover:text-white"
        >
          <div className="flex items-center space-x-2">
            {copiedInvite ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            <span>{copiedInvite ? "邀请码已复制" : "邀请其他人"}</span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => onMarkAsRead?.(guild)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-discord-textMuted" />
            <span>标记为已读</span>
          </div>
        </ContextMenuItem>

        {(canManageGuild || canManageChannels) && <ContextMenuSeparator />}

        {canManageChannels && (
          <ContextMenuItem
            onClick={() => onOpenCreateChannel?.(guild)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <PlusCircle className="w-4 h-4 text-discord-textMuted" />
              <span>创建频道</span>
            </div>
          </ContextMenuItem>
        )}

        {canManageGuild && (
          <ContextMenuItem
            onClick={() => onOpenServerSettings?.(guild)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-discord-textMuted" />
              <span>服务器设置</span>
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
                <span>退出服务器</span>
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
            <span>{copiedId ? "已复制服务器 ID" : "复制服务器 ID"}</span>
          </div>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
