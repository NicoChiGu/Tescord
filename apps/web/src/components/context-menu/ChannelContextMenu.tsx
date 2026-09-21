import React, { useState } from "react";
import { Channel, Guild } from "@tescord/types";
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
  Edit3,
  Trash2,
  Copy,
  Check,
  Hash,
  Volume2,
  BellOff,
} from "lucide-react";

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
  const { canManageChannels } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(channel.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy channel id:", e);
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
            <span>{isVoice ? "连接语音频道" : "切换至该频道"}</span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => onMarkAsRead?.(channel)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-discord-textMuted" />
            <span>标记为已读</span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => setIsMuted(!isMuted)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <BellOff className="w-4 h-4 text-discord-textMuted" />
            <span>{isMuted ? "取消静音频道" : "静音频道"}</span>
          </div>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {canManageChannels && (
          <ContextMenuItem
            onClick={() => onEditChannel?.(channel)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Edit3 className="w-4 h-4 text-discord-textMuted" />
              <span>编辑频道</span>
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
            <span>{copiedId ? "已复制频道 ID" : "复制频道 ID"}</span>
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
                <span>删除频道</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
