import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Channel,
  Message,
  User,
  Attachment,
  Guild,
  GuildMember,
  Role,
  parseRoleIds,
  GatewayEvents,
  TypingIndicatorPayload,
} from "@tescord/types";
import {
  Hash,
  Lock,
  Send,
  Paperclip,
  Smile,
  ShieldCheck,
  Users,
  Search,
  Bell,
  Reply,
  Pin,
  Trash2,
  X,
  ZoomIn,
  FileText,
  Download,
  Loader2,
  Key,
  ShieldAlert,
  Menu,
  ChevronDown,
  History,
  Phone,
  Video,
  PhoneOff,
  UploadCloud,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { messageDb } from "../services/messageDb.js";
import { MarkdownRenderer } from "./chat/MarkdownRenderer.js";
import { EmojiPickerPopover } from "./chat/EmojiPickerPopover.js";
import { LightboxModal } from "./chat/LightboxModal.js";
import { MobileActionSheet } from "./chat/MobileActionSheet.js";
import { MentionInput, MentionInputHandle } from "./chat/MentionInput.js";
import { TypingIndicator } from "./chat/TypingIndicator.js";
import { ImageAttachment } from "./chat/ImageAttachment.js";
import { FileAttachment } from "./chat/FileAttachment.js";
import { ServerInviteEmbed } from "./chat/ServerInviteEmbed.js";
import { PinnedMessagesPopover } from "./PinnedMessagesPopover.js";
import { useUserProfilePopoutStore } from "../stores/useUserProfilePopoutStore.js";
import { usePresenceStore } from "../stores/usePresenceStore.js";
import { useContextMenuStore } from "../stores/useContextMenuStore.js";
import { useMomentumScroll } from "../hooks/useMomentumScroll.js";
import { InputContextMenu } from "./context-menu/InputContextMenu.js";
import { API_BASE, resolveServerUrl } from "../config.js";
import { gatewayClient } from "../services/gateway.js";
import { doubleRatchetManager } from "../services/doubleRatchet.js";
import { clientFtsStorage } from "../services/e2eeStorage.js";
import { useViewport } from "../hooks/useViewport.js";
import { useLongPress } from "../hooks/useLongPress.js";
import { useAuthStore } from "../stores/useAuthStore.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";
import { getUserDisplayName } from "../utils/userDisplay.js";

// 频道草稿缓存字典（按频道隔离保留用户未发送的草稿，切回时自动恢复）
const channelDraftMap = new Map<string, string>();

interface ChatAreaProps {
  channel: Channel;
  guild?: Guild | null;
  messages: Message[];
  isLoadingMessages?: boolean;
  currentUser: User;
  onSendMessage: (
    content: string,
    isEncrypted?: boolean,
    replyToId?: string,
    attachments?: Attachment[],
  ) => void;
  onReactionAdd?: (messageId: string, emoji: string) => void;
  onReactionRemove?: (messageId: string, emoji: string) => void;
  onTogglePin?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  showMemberList: boolean;
  onToggleMemberList: () => void;
  onToggleMobileDrawer?: () => void;
  onToggleMobileMemberList?: () => void;
  onStartCall?: (channelId: string, hasVideo: boolean) => void;
  onStartDM?: (userId: string) => void;
  callEncryption?: {
    status: "idle" | "negotiating" | "tofu" | "trusted" | "failed";
    fingerprint?: string;
  };
  onMarkChannelAsRead?: (channelId: string, sequence: number) => void;
  onReloadLatestMessages?: () => Promise<void> | void;
}

interface ChatMessageItemProps {
  msg: Message;
  guild?: Guild | null;
  currentUser: User;
  decryptedContents: Record<string, { text: string; fingerprint?: string }>;
  isMobile: boolean;
  activeEmojiPickerMsgId: string | null;
  setActiveEmojiPickerMsgId: (id: string | null) => void;
  setReplyingTo: (msg: Message) => void;
  onTogglePin?: (id: string) => void;
  onDeleteMessage?: (id: string) => void;
  onReactionAdd?: (id: string, emoji: string) => void;
  onReactionRemove?: (id: string, emoji: string) => void;
  setLightboxImage: (attachment: Attachment | null) => void;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  onOpenMobileActions: (msg: Message) => void;
  onMentionUser?: (username: string) => void;
  onOpenProfile?: (author: Message["author"], rect: DOMRect) => void;
  onOpenProfileByName?: (username: string, rect: DOMRect) => void;
  isHighlighted?: boolean;
  onJumpToMessage?: (messageId: string) => void;
}

const isImageMime = (mime: string, name: string) => {
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
};

const ChatMessageItemComponent: React.FC<ChatMessageItemProps> = ({
  msg,
  guild,
  currentUser,
  decryptedContents,
  isMobile,
  activeEmojiPickerMsgId,
  setActiveEmojiPickerMsgId,
  setReplyingTo,
  onTogglePin,
  onDeleteMessage,
  onReactionAdd,
  onReactionRemove,
  setLightboxImage,
  setInputText,
  onOpenMobileActions,
  onMentionUser,
  onOpenProfile,
  onOpenProfileByName,
  isHighlighted,
  onJumpToMessage,
}) => {
  const isMe = msg.authorId === currentUser.id;
  const member = guild?.members?.find((m) => m.userId === msg.author.id);
  const authorName = getUserDisplayName(msg.author, member);
  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const isMsgEncrypted =
    msg.isEncrypted ||
    !!decryptedContents[msg.id] ||
    doubleRatchetManager.isEncryptedEnvelope(msg.content);

  const resolvedContent = isMsgEncrypted
    ? decryptedContents[msg.id]?.text || ""
    : msg.content || "";

  const inviteCodes = React.useMemo(() => {
    if (!resolvedContent) return [];
    const matches = resolvedContent.match(
      /(?:https?:\/\/[^\s/]+)?\/invite\/([a-zA-Z0-9_-]+)/gi,
    );
    if (!matches) return [];
    const codes: string[] = [];
    for (const m of matches) {
      const parts = m.split("/invite/");
      if (parts[1]) {
        const code = parts[1].split(/[?#\s]/)[0];
        if (code && !codes.includes(code)) {
          codes.push(code);
        }
      }
    }
    return codes;
  }, [resolvedContent]);

  // 清洗掉邀请链接，避免 url 裸露在消息正文中
  const displayContent = React.useMemo(() => {
    if (!resolvedContent) return "";
    if (inviteCodes.length === 0) return resolvedContent;
    return resolvedContent
      .replace(
        /(?:https?:\/\/[^\s/]+)?\/invite\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/gi,
        "",
      )
      .trim();
  }, [resolvedContent, inviteCodes]);

  const longPressProps = useLongPress(() => {
    if (isMobile) {
      onOpenMobileActions(msg);
    }
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, {
      type: "message",
      message: msg,
      guild,
      onReply: setReplyingTo,
      onTogglePin,
      onDelete: onDeleteMessage,
      onAddReaction: onReactionAdd,
    });
  };

  const handleAuthorContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, {
      type: "user",
      targetUser: msg.author,
      guild,
      onMention: onMentionUser,
      onOpenProfile: () => {
        onOpenProfile?.(
          msg.author,
          (e.currentTarget as HTMLElement).getBoundingClientRect(),
        );
      },
    });
  };

  return (
    <div
      id={`message-${msg.id}`}
      data-message-id={msg.id}
      {...longPressProps}
      onContextMenu={handleContextMenu}
      className={`relative flex flex-col group -mx-2 sm:-mx-4 px-2 sm:px-4 py-1.5 rounded transition ${
        isHighlighted ? "animate-message-highlight" : ""
      } ${
        msg.isPinned
          ? "bg-discord-brand/5 border-l-2 border-yellow-500/80"
          : isHighlighted
            ? ""
            : "hover:bg-[#2e3035]"
      }`}
    >
      {/* 引用回复提示条 */}
      {msg.replyTo && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (msg.replyTo?.id) {
              onJumpToMessage?.(msg.replyTo.id);
            }
          }}
          title="点击跳转至被引用的原文"
          className="flex items-center space-x-2 text-xs text-discord-textMuted mb-1 ml-10 pl-2 border-l-2 border-[#4e5058] cursor-pointer hover:opacity-100 hover:text-discord-textNormal transition-all duration-150 group/reply"
        >
          <Reply className="w-3 h-3 text-discord-textMuted group-hover/reply:text-discord-brand transform rotate-180 transition-colors" />
          <span className="font-semibold text-discord-brand group-hover/reply:underline">
            @{msg.replyTo.authorName}
          </span>
          <span className="truncate max-w-md text-discord-textNormal opacity-80 group-hover/reply:opacity-100">
            {msg.replyTo.content}
          </span>
        </div>
      )}

      <div className="flex space-x-3 items-start">
        <img
          src={
            msg.author.avatarUrl ||
            "https://api.dicebear.com/7.x/bottts/svg?seed=user"
          }
          alt={authorName}
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          data-profile-trigger={`chat-${msg.author.id}`}
          onContextMenu={handleAuthorContextMenu}
          onClick={(e) =>
            onOpenProfile?.(msg.author, e.currentTarget.getBoundingClientRect())
          }
          className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer hover:opacity-80 transition mt-0.5"
        />
        <div className="flex-1 overflow-hidden">
          {/* 用户信息与时间栏 */}
          <div className="flex items-center space-x-2">
            <span
              data-profile-trigger={`chat-${msg.author.id}`}
              onContextMenu={handleAuthorContextMenu}
              onClick={(e) =>
                onOpenProfile?.(
                  msg.author,
                  e.currentTarget.getBoundingClientRect(),
                )
              }
              className="font-semibold text-discord-textHeader text-sm cursor-pointer hover:underline"
            >
              {authorName}
            </span>
            {isMe && (
              <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-1 rounded font-medium">
                我
              </span>
            )}
            <span className="text-[11px] text-discord-textMuted">
              {formattedTime}
            </span>
            {msg.isPinned && (
              <span
                className="flex items-center space-x-0.5 text-[10px] text-yellow-500 bg-yellow-500/10 px-1 rounded border border-yellow-500/30"
                title="该消息已被置顶"
              >
                <Pin className="w-2.5 h-2.5 rotate-45" />
                <span>已置顶</span>
              </span>
            )}
          </div>

          {/* 消息正文 (支持 Markdown 与剧透) */}
          {displayContent ? (
            <div className="mt-1 selectable-text">
              <MarkdownRenderer
                content={displayContent}
                currentUsername={currentUser.username}
                onMentionClick={(username, rect) =>
                  onOpenProfileByName?.(username, rect)
                }
              />
            </div>
          ) : null}

          {/* 服务器邀请卡片 (Discord 风格) */}
          {inviteCodes.length > 0 && (
            <div className="mt-2 space-y-2">
              {inviteCodes.map((code) => (
                <ServerInviteEmbed key={code} code={code} />
              ))}
            </div>
          )}

          {/* 附件展示 (图片缩略图与普通文件卡片) */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {msg.attachments.map((att) => {
                const isImg = isImageMime(att.mimeType, att.fileName);
                if (isImg) {
                  return (
                    <ImageAttachment
                      key={att.id}
                      attachment={att}
                      onPreview={setLightboxImage}
                    />
                  );
                }

                return <FileAttachment key={att.id} attachment={att} />;
              })}
            </div>
          )}

          {/* Emoji Reaction 列表胶囊 */}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {msg.reactions.map((r) => {
                const isReactedByMe = r.me || false;
                return (
                  <button
                    key={r.emoji}
                    onClick={() => {
                      if (isReactedByMe) {
                        onReactionRemove?.(msg.id, r.emoji);
                      } else {
                        onReactionAdd?.(msg.id, r.emoji);
                      }
                    }}
                    className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-md text-xs font-medium border transition ${
                      isReactedByMe
                        ? "bg-discord-brand/20 border-discord-brand text-discord-brand"
                        : "bg-[#2b2d31] border-transparent hover:border-[#4e5058] text-discord-textNormal"
                    }`}
                    title={
                      isReactedByMe
                        ? `点击取消反应 ${r.emoji}`
                        : `添加反应 ${r.emoji}`
                    }
                  >
                    <span>{r.emoji}</span>
                    <span>{r.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 桌面端悬浮操作菜单条 (右上角浮出快捷工具栏) */}
      <div className="absolute right-4 -top-3 hidden md:group-hover:flex items-center bg-[#313338] border border-[#2b2d31] rounded-md shadow-md overflow-hidden z-10">
        {/* Emoji 表情快捷气泡 */}
        <div className="relative">
          <button
            onClick={() =>
              setActiveEmojiPickerMsgId(
                activeEmojiPickerMsgId === msg.id ? null : msg.id,
              )
            }
            className="p-1.5 hover:bg-discord-hover text-discord-textMuted hover:text-discord-textHeader transition"
            title="添加表情反应"
          >
            <Smile className="w-4 h-4" />
          </button>
          <EmojiPickerPopover
            isOpen={activeEmojiPickerMsgId === msg.id}
            onClose={() => setActiveEmojiPickerMsgId(null)}
            onSelectEmoji={(emoji: string) => onReactionAdd?.(msg.id, emoji)}
          />
        </div>

        {/* 引用回复按钮 */}
        <button
          onClick={() => setReplyingTo(msg)}
          className="p-1.5 hover:bg-discord-hover text-discord-textMuted hover:text-discord-textHeader transition"
          title="引用回复"
        >
          <Reply className="w-4 h-4" />
        </button>

        {/* 置顶/取消置顶按钮 */}
        <button
          onClick={() => onTogglePin?.(msg.id)}
          className={`p-1.5 hover:bg-discord-hover transition ${
            msg.isPinned
              ? "text-yellow-400 hover:text-yellow-300"
              : "text-discord-textMuted hover:text-discord-textHeader"
          }`}
          title={msg.isPinned ? "取消置顶" : "置顶消息"}
        >
          <Pin className="w-4 h-4" />
        </button>

        {(isMe ||
          currentUser.username === "admin" ||
          currentUser.username === "Jackey") && (
          <button
            onClick={() => onDeleteMessage?.(msg.id)}
            className="p-1.5 hover:bg-red-500/20 text-discord-textMuted hover:text-red-400 transition"
            title="撤回/删除消息"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 移动端专属：轻触快捷操作按钮 */}
      {isMobile && (
        <button
          type="button"
          onClick={() => onOpenMobileActions(msg)}
          className="md:hidden absolute right-2 top-2 p-1.5 text-discord-textMuted/50 hover:text-white rounded-lg active:bg-[#35373c] transition"
          title="快捷操作面板"
        >
          <Smile className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

const ChatMessageItem = React.memo(ChatMessageItemComponent);

// Discord 风格消息加载骨架屏组件 (波纹脉冲动画，消除切频道大片空白与突兀感)
export const MessageSkeletonList: React.FC = () => {
  return (
    <div
      className="space-y-4 py-2 animate-pulse animate-fade-in"
      data-testid="chat-message-skeleton-list"
    >
      {[1, 2, 3, 4, 5].map((idx) => {
        const widths = ["w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-4/5"];
        const extraWidths = ["w-1/3", "w-1/4", "w-2/5"];
        return (
          <div key={idx} className="flex items-start space-x-3 px-2">
            {/* 头像骨架 */}
            <div className="w-10 h-10 rounded-full bg-[#35373c]/70 flex-shrink-0" />
            {/* 消息骨架 */}
            <div className="flex-1 space-y-2 py-1">
              <div className="flex items-center space-x-2">
                {/* 名字占位 */}
                <div className="h-4 w-24 bg-[#35373c] rounded" />
                {/* 时间占位 */}
                <div className="h-3 w-14 bg-[#35373c]/60 rounded" />
              </div>
              {/* 正文行 1 */}
              <div
                className={`h-3.5 ${widths[idx % widths.length]} bg-[#35373c]/70 rounded`}
              />
              {/* 正文行 2 (部分显示) */}
              {idx % 2 === 0 && (
                <div
                  className={`h-3.5 ${extraWidths[idx % extraWidths.length]} bg-[#35373c]/50 rounded`}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({
  channel,
  guild,
  messages,
  isLoadingMessages = false,
  currentUser,
  onSendMessage,
  onReactionAdd,
  onReactionRemove,
  onTogglePin,
  onDeleteMessage,
  showMemberList,
  onToggleMemberList,
  onToggleMobileDrawer,
  onToggleMobileMemberList,
  onStartCall,
  onStartDM,
  callEncryption,
  onMarkChannelAsRead,
  onReloadLatestMessages,
}) => {
  const { t } = useTranslation(["chat", "common"]);
  const { isMobile, isDesktop } = useViewport();
  const isCompact = !isDesktop;
  const [mobileActionMessage, setMobileActionMessage] =
    useState<Message | null>(null);
  const [inputText, setInputText] = useState<string>(
    () => channelDraftMap.get(channel.id) || "",
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionInputRef = useRef<MentionInputHandle>(null);

  // 切换频道时：恢复当前频道的草稿文本，重置回复引用与待发附件（防止跨频道误发）
  useEffect(() => {
    setInputText(channelDraftMap.get(channel.id) || "");
    setReplyingTo(null);
    setPendingAttachments([]);
    setSearchQuery("");
  }, [channel.id]);
  const { togglePopout } = useUserProfilePopoutStore();
  const { userNotes } = useSettingsStore();

  const otherRecipient = React.useMemo(() => {
    if (channel.type !== "DM") return null;
    return channel.recipients?.find((r) => r.id !== currentUser.id) || null;
  }, [channel, currentUser.id]);

  const displayChannelName = React.useMemo(() => {
    if (channel.type !== "DM") return channel.name;
    if (otherRecipient) {
      const note = userNotes[otherRecipient.id];
      if (note && note.trim()) return note.trim();
      if (otherRecipient.displayName && otherRecipient.displayName.trim()) {
        return otherRecipient.displayName.trim();
      }
      if (otherRecipient.username) {
        const u = otherRecipient.username.trim();
        return u.includes("#") ? u.split("#")[0] : u;
      }
    }
    return channel.name;
  }, [channel, otherRecipient, userNotes]);

  const handleOpenProfile = useCallback(
    (author: Message["author"], rect: DOMRect) => {
      const member =
        guild?.members?.find(
          (m) => m.userId === author.id || m.user?.id === author.id,
        ) || null;
      const dmRecipient = channel.recipients?.find((r) => r.id === author.id);
      const userPresence = usePresenceStore
        .getState()
        .getUserPresence(author.id);
      const effectiveStatus =
        userPresence?.status ||
        dmRecipient?.status ||
        member?.user?.status ||
        "OFFLINE";
      const effectiveCustomStatus =
        userPresence?.customStatus !== undefined
          ? userPresence.customStatus
          : dmRecipient?.customStatus || member?.user?.customStatus;
      const effectiveActivities =
        userPresence?.activities ||
        dmRecipient?.activities ||
        member?.user?.activities;

      const fullUser: User = {
        ...(member?.user || dmRecipient || {}),
        id: author.id,
        username: author.username,
        displayName:
          author.displayName ||
          member?.user?.displayName ||
          dmRecipient?.displayName ||
          null,
        avatarUrl: author.avatarUrl,
        email: member?.user?.email || dmRecipient?.email || "",
        status: effectiveStatus,
        customStatus: effectiveCustomStatus,
        activities: effectiveActivities,
        createdAt:
          member?.user?.createdAt ||
          dmRecipient?.createdAt ||
          new Date().toISOString(),
      };

      const memberRoleIds = new Set(
        member?.roleIds
          ? Array.isArray(member.roleIds)
            ? member.roleIds
            : parseRoleIds(member.roleIds)
          : [],
      );
      const userRoles = (guild?.roles || [])
        .filter((r) => memberRoleIds.has(r.id))
        .sort((a, b) => b.position - a.position);

      togglePopout({
        user: fullUser,
        member,
        guild,
        targetRect: rect,
        roles: userRoles,
        isOwner: guild?.ownerId === fullUser.id,
        triggerId: `chat-${author.id}`,
      });
    },
    [guild, channel.recipients, togglePopout],
  );

  const handleOpenProfileByName = useCallback(
    (name: string, rect: DOMRect) => {
      const cleanName = name.trim().toLowerCase();
      const member = guild?.members?.find(
        (m) =>
          m.user?.username?.toLowerCase() === cleanName ||
          m.nickname?.toLowerCase() === cleanName,
      );
      if (member && member.user) {
        const userPresence = usePresenceStore
          .getState()
          .getUserPresence(member.user.id);
        const memberRoleIds = new Set(
          member?.roleIds
            ? Array.isArray(member.roleIds)
              ? member.roleIds
              : parseRoleIds(member.roleIds)
            : [],
        );
        const userRoles = (guild?.roles || [])
          .filter((r) => memberRoleIds.has(r.id))
          .sort((a, b) => b.position - a.position);

        togglePopout({
          user: {
            ...member.user,
            status: userPresence?.status || member.user.status,
            customStatus:
              userPresence?.customStatus !== undefined
                ? userPresence.customStatus
                : member.user.customStatus,
            activities: userPresence?.activities || member.user.activities,
          },
          member,
          guild,
          targetRect: rect,
          roles: userRoles,
          isOwner: guild?.ownerId === member.user.id,
          triggerId: `chat-${member.user.id}`,
        });
        return;
      }
      const msgAuthor = messages.find(
        (m) => m.author.username.toLowerCase() === cleanName,
      )?.author;
      if (msgAuthor) {
        const dmRecipient = channel.recipients?.find(
          (r) => r.id === msgAuthor.id,
        );
        const userPresence = usePresenceStore
          .getState()
          .getUserPresence(msgAuthor.id);
        const effectiveStatus =
          userPresence?.status || dmRecipient?.status || "OFFLINE";
        const effectiveCustomStatus =
          userPresence?.customStatus !== undefined
            ? userPresence.customStatus
            : dmRecipient?.customStatus;
        const effectiveActivities =
          userPresence?.activities || dmRecipient?.activities;

        togglePopout({
          user: {
            id: msgAuthor.id,
            username: msgAuthor.username,
            displayName:
              msgAuthor.displayName || dmRecipient?.displayName || null,
            avatarUrl: msgAuthor.avatarUrl,
            email: dmRecipient?.email || "",
            status: effectiveStatus,
            customStatus: effectiveCustomStatus,
            activities: effectiveActivities,
            createdAt: dmRecipient?.createdAt || new Date().toISOString(),
          },
          member: null,
          guild,
          targetRect: rect,
          roles: [],
          isOwner: guild?.ownerId === msgAuthor.id,
          triggerId: `chat-${msgAuthor.id}`,
        });
      }
    },
    [guild, channel.recipients, messages, togglePopout],
  );

  const handleSetReplyingTo = useCallback((m: Message) => {
    setReplyingTo(m);
  }, []);

  const handleOpenMobileActions = useCallback((m: Message) => {
    setMobileActionMessage(m);
  }, []);

  const handleMentionUser = useCallback((username: string) => {
    mentionInputRef.current?.insertMention(username, username);
  }, []);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
    [],
  );
  const [isUploading, setIsUploading] = useState(false);
  const [activeEmojiPickerMsgId, setActiveEmojiPickerMsgId] = useState<
    string | null
  >(null);
  const [isInputEmojiOpen, setIsInputEmojiOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<Attachment | null>(null);
  const [pendingImageUrls, setPendingImageUrls] = useState<
    Record<string, string>
  >({});
  const pendingImageUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    pendingImageUrlsRef.current = pendingImageUrls;
  }, [pendingImageUrls]);
  useEffect(
    () => () => {
      Object.values(pendingImageUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  // 阶段五：端到端双棘轮解密内容缓存与本地离线搜索状态
  const [decryptedContents, setDecryptedContents] = useState<
    Record<string, { text: string; fingerprint?: string }>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string>(
    "E2EE-A1B2-C3D4-E5F6-0001",
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  // 消息高亮与跳转定位状态
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 频道置顶消息面板状态与已固定消息备忘
  const [isPinnedPopoverOpen, setIsPinnedPopoverOpen] = useState(false);
  const pinnedMessages = React.useMemo(
    () => messages.filter((m) => m.isPinned),
    [messages],
  );

  // 视口距离底部与顶部状态（离开底部则显示顶部“跳到最新”横幅与底部渐变，离开顶部则显示顶部渐变）
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasScrolledTop, setHasScrolledTop] = useState(false);
  const isNearBottomRef = useRef<boolean>(true);
  isNearBottomRef.current = isNearBottom;

  // 滚动记忆状态缓存与持久化 Ref
  const currentScrollTopRef = useRef<number>(0);
  const currentScrollHeightRef = useRef<number>(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // 视口未读红线动态淡出与可见性检测状态
  const [isFadingDivider, setIsFadingDivider] = useState(false);
  const dividerVisibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // 文件拖拽上传状态
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef<number>(0);

  // 已读游标与滚动恢复状态
  const [initialUnreadSequence, setInitialUnreadSequence] = useState<
    number | null
  >(null);
  const lastReadSequenceRef = useRef<number>(0);
  const isInitialPositionedRef = useRef<boolean>(false);
  const lastMessageIdRef = useRef<string | null>(null);

  // 骨架屏防闪烁延迟（100ms 阈值）：若 100ms 内已读出本地 IndexedDB 缓存或完成加载，绝不闪现骨架屏
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isLoadingMessages && messages.length === 0) {
      timer = setTimeout(() => {
        setShowSkeleton(true);
      }, 100);
    } else {
      setShowSkeleton(false);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoadingMessages, messages.length]);

  // 端侧本地密文全文检索过滤
  const matchingMessageIds = React.useMemo(() => {
    if (!searchQuery.trim()) return null;
    const results = clientFtsStorage.search(searchQuery.trim(), channel.id);
    return new Set(results.map((r) => r.id));
  }, [searchQuery, channel.id, messages.length]);

  const displayedMessages = React.useMemo(() => {
    if (!matchingMessageIds) return messages;
    return messages.filter((m) => matchingMessageIds.has(m.id));
  }, [messages, matchingMessageIds]);

  // 计算未读红线分割条位置（采用 Frozen Unread Marker 视觉冻结机制，当前会话期间红线位置绝对静止）
  const firstUnreadMessageId = React.useMemo(() => {
    if (initialUnreadSequence === null || initialUnreadSequence <= 0)
      return null;
    const unread = displayedMessages.find(
      (m) => (m.sequence || 0) > initialUnreadSequence,
    );
    return unread ? unread.id : null;
  }, [displayedMessages, initialUnreadSequence]);

  // 基于 @tanstack/react-virtual 的动态高度虚拟视口计算
  // 必须显式指定 getItemKey 绑定真实消息 ID，彻底杜绝数据变化时高度缓存错位导致的卡片重叠 (Overlap)
  const rowVirtualizer = useVirtualizer({
    count: displayedMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index) => displayedMessages[index]?.id ?? index,
    estimateSize: () => 80,
    overscan: displayedMessages.length <= 40 ? 40 : 10,
  });

  // 接管滚轮平滑阻尼动效 (Discord 风格)
  useMomentumScroll(scrollContainerRef, {
    damping: 0.2,
    multiplier: 1.0,
    enabled: true,
  });

  // 轻量全局提示浮层
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const markDividerAsRead = useCallback(
    (maxSeq: number) => {
      if (
        lastReadSequenceRef.current >= maxSeq &&
        (initialUnreadSequence ?? 0) >= maxSeq
      )
        return;
      lastReadSequenceRef.current = Math.max(
        lastReadSequenceRef.current,
        maxSeq,
      );
      setIsFadingDivider(true);
      setTimeout(() => {
        setInitialUnreadSequence(lastReadSequenceRef.current);
        setIsFadingDivider(false);
      }, 300);
      messageDb.saveChannelMeta(channel.id, {
        lastReadSequence: lastReadSequenceRef.current,
      });
      onMarkChannelAsRead?.(channel.id, lastReadSequenceRef.current);
    },
    [channel.id, initialUnreadSequence, onMarkChannelAsRead],
  );

  const checkUnreadDividerVisibility = useCallback(() => {
    if (
      !firstUnreadMessageId ||
      isFadingDivider ||
      !isInitialPositionedRef.current
    )
      return;

    // 若当前已处于最底部，直接核销所有未读并退出，避免在底部挂起定时器或残留红线
    if (isNearBottomRef.current) {
      if (dividerVisibleTimerRef.current) {
        clearTimeout(dividerVisibleTimerRef.current);
        dividerVisibleTimerRef.current = null;
      }
      if (displayedMessages.length > 0) {
        const maxSeq =
          displayedMessages[displayedMessages.length - 1].sequence || 0;
        if (maxSeq > 0) {
          markDividerAsRead(maxSeq);
        }
      }
      return;
    }

    const unreadIdx = displayedMessages.findIndex(
      (m) => m.id === firstUnreadMessageId,
    );
    if (unreadIdx === -1) return;

    const virtualItems = rowVirtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;

    const firstVisibleIdx = virtualItems[0].index;
    const lastVisibleIdx = virtualItems[virtualItems.length - 1].index;

    // 1. 向上滚出可视区域：用户已向下滚动使红线脱离视口顶部
    if (firstVisibleIdx > unreadIdx) {
      if (dividerVisibleTimerRef.current) {
        clearTimeout(dividerVisibleTimerRef.current);
        dividerVisibleTimerRef.current = null;
      }
      const maxSeenSeq = Math.max(
        ...displayedMessages
          .slice(0, firstVisibleIdx + 1)
          .map((m) => m.sequence || 0),
      );
      markDividerAsRead(maxSeenSeq);
    }
    // 2. 红线位于可视区域内：启动 1 秒停留计时器
    else if (unreadIdx >= firstVisibleIdx && unreadIdx <= lastVisibleIdx) {
      if (!dividerVisibleTimerRef.current) {
        dividerVisibleTimerRef.current = setTimeout(() => {
          dividerVisibleTimerRef.current = null;
          const maxSeenSeq = Math.max(
            ...displayedMessages
              .slice(0, lastVisibleIdx + 1)
              .map((m) => m.sequence || 0),
          );
          markDividerAsRead(maxSeenSeq);
        }, 1000);
      }
    } else {
      // 滚回红线上方，取消计时器
      if (dividerVisibleTimerRef.current) {
        clearTimeout(dividerVisibleTimerRef.current);
        dividerVisibleTimerRef.current = null;
      }
    }
  }, [
    firstUnreadMessageId,
    isFadingDivider,
    displayedMessages,
    rowVirtualizer,
    markDividerAsRead,
  ]);

  useEffect(() => {
    if (isInitialPositionedRef.current && firstUnreadMessageId) {
      checkUnreadDividerVisibility();
    }
  }, [
    firstUnreadMessageId,
    displayedMessages.length,
    checkUnreadDividerVisibility,
  ]);

  const scrollRafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!scrollContainerRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
      currentScrollTopRef.current = scrollTop;
      currentScrollHeightRef.current = scrollHeight;
      const isScrollable = scrollHeight > clientHeight + 20;
      const nearBottom = isScrollable
        ? scrollHeight - scrollTop - clientHeight < 120 && scrollTop > 0
        : isNearBottomRef.current && scrollTop === 0;
      if (isNearBottomRef.current !== nearBottom) {
        setIsNearBottom(nearBottom);
        isNearBottomRef.current = nearBottom;
      }
      const scrolledTop = scrollTop > 16;
      setHasScrolledTop((prev) => (prev !== scrolledTop ? scrolledTop : prev));

      // 实时保存当前频道的滚动坐标（由 messageDb 内置的 metaCache 即时同步）
      messageDb.saveChannelMeta(channel.id, {
        scrollTop,
        isNearBottom: nearBottom,
      });

      // 核心优化：若滚动触底，说明用户已经浏览至最新内容，立即核销未读红线并同步已读状态
      if (
        isInitialPositionedRef.current &&
        nearBottom &&
        displayedMessages.length > 0
      ) {
        if (dividerVisibleTimerRef.current) {
          clearTimeout(dividerVisibleTimerRef.current);
          dividerVisibleTimerRef.current = null;
        }
        const maxSeq =
          displayedMessages[displayedMessages.length - 1].sequence || 0;
        if (
          maxSeq > 0 &&
          (lastReadSequenceRef.current < maxSeq ||
            (initialUnreadSequence ?? 0) < maxSeq)
        ) {
          markDividerAsRead(maxSeq);
        }
      }

      checkUnreadDividerVisibility();
    });
  }, [
    channel.id,
    displayedMessages,
    initialUnreadSequence,
    markDividerAsRead,
    checkUnreadDividerVisibility,
  ]);

  const scrollJumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToBottom = (smooth = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      // 延迟二次校准，彻底防止虚拟列表动态尺寸测量撑大导致的未完全触底
      if (scrollJumpTimeoutRef.current) clearTimeout(scrollJumpTimeoutRef.current);
      scrollJumpTimeoutRef.current = setTimeout(() => {
        scrollJumpTimeoutRef.current = null;
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
          setIsNearBottom(true);
          isNearBottomRef.current = true;
        }
      }, 150);
    } else {
      messagesEndRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
      });
    }
    setIsNearBottom(true);
    isNearBottomRef.current = true;
    if (displayedMessages.length > 0) {
      if (dividerVisibleTimerRef.current) {
        clearTimeout(dividerVisibleTimerRef.current);
        dividerVisibleTimerRef.current = null;
      }
      const maxSeq =
        displayedMessages[displayedMessages.length - 1].sequence || 0;
      if (maxSeq > 0) {
        markDividerAsRead(maxSeq);
      }
    }
  };

  // Virtual rows and image previews can grow after the message update. Keep
  // following only while the user is at the latest message.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const list = container?.querySelector(
      '[data-testid="virtual-message-list-container"]',
    );
    if (!container || !list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!isInitialPositionedRef.current || !isNearBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
      currentScrollTopRef.current = container.scrollTop;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [channel.id, displayedMessages.length]);

  const handleJumpToMessage = (targetMessageId: string) => {
    if (!targetMessageId) return;

    const targetMsg = messages.find((m) => m.id === targetMessageId);
    if (!targetMsg) {
      showToast("未找到被引用的原文，该消息可能已被删除");
      return;
    }

    // 若当前有搜索词且该消息被过滤隐藏，自动清除搜索过滤
    if (searchQuery.trim()) {
      const inSearch = displayedMessages.some((m) => m.id === targetMessageId);
      if (!inSearch) {
        setSearchQuery("");
      }
    }

    // 优先借助虚拟列表跳转至对应索引
    const targetIdx = displayedMessages.findIndex(
      (m) => m.id === targetMessageId,
    );
    if (targetIdx !== -1) {
      rowVirtualizer.scrollToIndex(targetIdx, { align: "center" });
    }

    setTimeout(() => {
      const el = document.getElementById(`message-${targetMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      setHighlightedMessageId(null);
      requestAnimationFrame(() => {
        setHighlightedMessageId(targetMessageId);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedMessageId(null);
        }, 1900);
      });
    }, 60);
  };

  const [isJumping, setIsJumping] = useState(false);

  // 智能跳转：若有未读消息优先跳转至未读消息分界；若无未读则请求拉取最新并贴底
  const handleSmartJumpToLatestOrUnread = async () => {
    if (isJumping) return;
    setIsJumping(true);
    try {
      if (firstUnreadMessageId) {
        if (searchQuery.trim()) {
          setSearchQuery("");
        }
        handleJumpToMessage(firstUnreadMessageId);
      } else {
        if (onReloadLatestMessages) {
          await onReloadLatestMessages();
        }
        scrollToBottom(true);
      }
    } finally {
      setIsJumping(false);
    }
  };

  // 打字指示器状态管理 (userId -> { username, timer })
  const [typingUsersMap, setTypingUsersMap] = useState<
    Map<string, { username: string; timer: any }>
  >(new Map());
  const lastTypingSentRef = useRef<number>(0);

  // 切换频道时重置本地打字定时器与输入节流
  useEffect(() => {
    setTypingUsersMap((prev) => {
      prev.forEach((val) => clearTimeout(val.timer));
      return new Map();
    });
    lastTypingSentRef.current = 0;
  }, [channel.id]);

  // 监听实时 TYPING_START 与 MESSAGE_CREATE 网关事件
  useEffect(() => {
    const unsubscribeTyping = gatewayClient.on(
      GatewayEvents.TYPING_START,
      (payload: TypingIndicatorPayload) => {
        if (!payload || payload.channelId !== channel.id) return;
        if (payload.userId === currentUser.id) return;

        setTypingUsersMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(payload.userId);
          if (existing) {
            clearTimeout(existing.timer);
          }
          const timer = setTimeout(() => {
            setTypingUsersMap((current) => {
              const updated = new Map(current);
              updated.delete(payload.userId);
              return updated;
            });
          }, 7000); // 7 秒 TTL 自动消除
          next.set(payload.userId, {
            username: payload.user?.username || "未知用户",
            timer,
          });
          return next;
        });
      },
    );

    const unsubscribeMessage = gatewayClient.on(
      GatewayEvents.MESSAGE_CREATE,
      (msg: Message) => {
        if (!msg || msg.channelId !== channel.id) return;
        setTypingUsersMap((prev) => {
          if (!prev.has(msg.authorId)) return prev;
          const existing = prev.get(msg.authorId);
          if (existing) clearTimeout(existing.timer);
          const next = new Map(prev);
          next.delete(msg.authorId);
          return next;
        });
      },
    );

    return () => {
      unsubscribeTyping();
      unsubscribeMessage();
    };
  }, [channel.id, currentUser.id]);

  // 当收到新消息时，若该作者正在打字，立即清除其打字状态
  useEffect(() => {
    if (messages.length === 0) return;
    const latestMsg = messages[messages.length - 1];
    setTypingUsersMap((prev) => {
      if (!prev.has(latestMsg.authorId)) return prev;
      const existing = prev.get(latestMsg.authorId);
      if (existing) clearTimeout(existing.timer);
      const next = new Map(prev);
      next.delete(latestMsg.authorId);
      return next;
    });
  }, [messages]);

  // 用户输入变动、草稿持久化与打字状态节流发送 (3.5 秒窗口)
  const handleInputChange = (text: string) => {
    setInputText(text);
    if (text.trim().length > 0) {
      channelDraftMap.set(channel.id, text);
      const now = Date.now();
      if (now - lastTypingSentRef.current > 3500) {
        lastTypingSentRef.current = now;
        gatewayClient.sendTyping(channel.id);
      }
    } else {
      channelDraftMap.delete(channel.id);
    }
  };

  // 切换频道时：从 IndexedDB/metaCache 读取滚动记忆与已读游标，离开时持久化保存最新游标与滚动坐标
  useEffect(() => {
    let isCancelled = false;
    if (scrollJumpTimeoutRef.current) {
      clearTimeout(scrollJumpTimeoutRef.current);
      scrollJumpTimeoutRef.current = null;
    }
    isInitialPositionedRef.current = false;
    lastMessageIdRef.current = null;
    setHighlightedMessageId(null);
    setIsPinnedPopoverOpen(false);

    messageDb.getChannelMeta(channel.id).then((meta) => {
      if (isCancelled) return;
      const savedLastRead = meta?.lastReadSequence || 0;
      setInitialUnreadSequence(savedLastRead);
      lastReadSequenceRef.current = savedLastRead;
      if (meta && meta.isNearBottom === false) {
        setIsNearBottom(false);
        isNearBottomRef.current = false;
      }
    });

    return () => {
      isCancelled = true;
      if (dividerVisibleTimerRef.current) {
        clearTimeout(dividerVisibleTimerRef.current);
        dividerVisibleTimerRef.current = null;
      }

      // 切换离开或卸载时，精确持久化保存当前频道的滚动坐标与已读状态
      // 核心修复：使用 Ref 记录的坐标，彻底解决 React 18 卸载时 DOM ref 已置空为 null 导致的丢失
      const currentScrollTop = currentScrollTopRef.current;
      const wasNearBottom = isNearBottomRef.current;
      const currentMessages = messagesRef.current;
      const maxSeq =
        currentMessages.length > 0
          ? currentMessages[currentMessages.length - 1].sequence || 0
          : lastReadSequenceRef.current;

      const finalLastReadSeq = wasNearBottom
        ? Math.max(lastReadSequenceRef.current, maxSeq)
        : lastReadSequenceRef.current;

      messageDb.saveChannelMeta(channel.id, {
        scrollTop: currentScrollTop,
        isNearBottom: wasNearBottom,
        lastReadSequence: finalLastReadSeq,
      });

      if (wasNearBottom && maxSeq > 0) {
        onMarkChannelAsRead?.(channel.id, finalLastReadSeq);
      }
    };
  }, [channel.id, onMarkChannelAsRead]);

  // 当初次加载消息到达时，执行纯物理位置恢复（无论是否有未读，始终精准还原上次离开时的 scrollTop）
  useEffect(() => {
    // The channel prop can change one render before App replaces the previous
    // channel's messages. Never position the new channel using stale rows.
    if (
      messages.length === 0 ||
      messages.some((message) => message.channelId !== channel.id) ||
      isInitialPositionedRef.current
    )
      return;

    let cancelled = false;
    messageDb.getChannelMeta(channel.id).then((meta) => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled || !scrollContainerRef.current) return;

        const isValidSavedScrollTop =
          meta && typeof meta.scrollTop === "number" && meta.scrollTop > 20;

        const isFarFromBottom =
          isValidSavedScrollTop &&
          scrollContainerRef.current.scrollHeight -
            meta.scrollTop -
            scrollContainerRef.current.clientHeight >=
            80;

        const restoreReadPosition =
          meta?.isNearBottom === false ||
          (isValidSavedScrollTop && isFarFromBottom);
        if (restoreReadPosition) {
          const savedScrollTop = meta?.scrollTop ?? 0;
          scrollContainerRef.current.scrollTop = savedScrollTop;
          rowVirtualizer.scrollToOffset(savedScrollTop);
          currentScrollTopRef.current = savedScrollTop;
          setIsNearBottom(false);
          isNearBottomRef.current = false;
        } else {
          // 默认贴底
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
          currentScrollTopRef.current = scrollContainerRef.current.scrollTop;
          setIsNearBottom(true);
          isNearBottomRef.current = true;

          // 核心优化：若初始状态即为贴底，说明用户直接处于最新消息底部，立即同步已读，杜绝红线残留
          const maxSeq =
            messages.length > 0
              ? messages[messages.length - 1].sequence || 0
              : 0;
          if (maxSeq > 0) {
            lastReadSequenceRef.current = Math.max(
              lastReadSequenceRef.current,
              maxSeq,
            );
            setInitialUnreadSequence(lastReadSequenceRef.current);
            messageDb.saveChannelMeta(channel.id, {
              lastReadSequence: lastReadSequenceRef.current,
            });
            onMarkChannelAsRead?.(channel.id, lastReadSequenceRef.current);
          }
        }

        isInitialPositionedRef.current = true;
        lastMessageIdRef.current = messages[messages.length - 1]?.id || null;
        checkUnreadDividerVisibility();

        // 延迟二次校准，解决虚拟列表子项在初次 DOM 测量高度完成后发生位移抖动
        setTimeout(() => {
          if (cancelled) return;
          if (scrollContainerRef.current && restoreReadPosition) {
            if (
              Math.abs(
                scrollContainerRef.current.scrollTop - (meta?.scrollTop ?? 0),
              ) > 5
            ) {
              scrollContainerRef.current.scrollTop = meta?.scrollTop ?? 0;
              rowVirtualizer.scrollToOffset(meta?.scrollTop ?? 0);
            }
          } else if (scrollContainerRef.current && isNearBottomRef.current) {
            // 贴底状态下的二次对齐
            scrollContainerRef.current.scrollTop =
              scrollContainerRef.current.scrollHeight;
            setIsNearBottom(true);
            isNearBottomRef.current = true;
          }
          checkUnreadDividerVisibility();
        }, 50);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    messages.length,
    displayedMessages,
    channel.id,
    onMarkChannelAsRead,
    checkUnreadDividerVisibility,
  ]);

  // 运行中的单条实时新消息到达：仅当自身发送或原本就在底部时平滑滚到底部
  useEffect(() => {
    if (messages.length === 0 || !isInitialPositionedRef.current) return;
    const latestMsg = messages[messages.length - 1];
    if (latestMsg && latestMsg.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = latestMsg.id;
      if (latestMsg.authorId === currentUser.id || isNearBottomRef.current) {
        // Sending a message always returns to the latest one. A measured image
        // or virtual row can grow after this render, so use the same follow-up
        // alignment as the explicit jump-to-latest action.
        scrollToBottom(latestMsg.authorId !== currentUser.id);
        // 核心优化：在最底部接收实时新消息，直接同步已读游标，避免在其上方误弹出红线
        if (latestMsg.sequence) {
          lastReadSequenceRef.current = Math.max(
            lastReadSequenceRef.current,
            latestMsg.sequence,
          );
          setInitialUnreadSequence(lastReadSequenceRef.current);
          messageDb.saveChannelMeta(channel.id, {
            lastReadSequence: lastReadSequenceRef.current,
          });
          onMarkChannelAsRead?.(channel.id, lastReadSequenceRef.current);
        }
      }
    }
  }, [messages, currentUser.id, channel.id, onMarkChannelAsRead]);

  // 监听全局 @提及 事件（来自右侧成员列表或用户浮层），追加至文本框并聚焦
  useEffect(() => {
    const handleMention = (e: Event) => {
      const customEvent = e as CustomEvent<{ username: string }>;
      if (customEvent.detail?.username) {
        setInputText((prev) => `${prev}@${customEvent.detail.username} `);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("tescord:mention", handleMention);
    return () => {
      window.removeEventListener("tescord:mention", handleMention);
    };
  }, []);

  // 切换频道时清理本地已处理集合并动态计算当前频道安全码
  useEffect(() => {
    processedMessageIdsRef.current.clear();
    if (channel.isE2EE) {
      doubleRatchetManager
        .getSafetyNumber(channel.id, currentUser.id)
        .then((sn) => setSafetyNumber(sn))
        .catch(() => {});
    }
  }, [channel.id, channel.isE2EE, currentUser.id]);

  // 异步解密端到端加密消息并建立端侧倒排索引 (严格单次解密，避免重复 Ratchet 消耗密钥)
  useEffect(() => {
    let isCancelled = false;
    const processMessages = async () => {
      const updates: Record<string, { text: string; fingerprint?: string }> =
        {};
      let hasUpdates = false;

      for (const msg of messages) {
        const isMsgEncrypted =
          msg.isEncrypted ||
          (channel.isE2EE &&
            doubleRatchetManager.isEncryptedEnvelope(msg.content));
        if (isMsgEncrypted) {
          if (!processedMessageIdsRef.current.has(msg.id)) {
            processedMessageIdsRef.current.add(msg.id);
            const res = await doubleRatchetManager.decryptMessage(
              channel.id,
              msg.content,
              currentUser.id,
            );
            updates[msg.id] = {
              text: res.decrypted,
              fingerprint: res.fingerprint,
            };
            hasUpdates = true;
            clientFtsStorage.indexDecryptedMessage(
              msg.id,
              msg.channelId,
              msg.authorId,
              res.decrypted,
              msg.createdAt,
            );
          }
        } else {
          clientFtsStorage.indexDecryptedMessage(
            msg.id,
            msg.channelId,
            msg.authorId,
            msg.content,
            msg.createdAt,
          );
        }
      }

      if (hasUpdates && !isCancelled) {
        setDecryptedContents((prev) => ({ ...prev, ...updates }));
      }
    };

    processMessages();
    return () => {
      isCancelled = true;
    };
  }, [messages, channel.id, currentUser.id]);

  // 上传文件并追加至附件列表
  const uploadAndAttachFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      showToast("文件大小超过 50MB 限制，无法上传");
      return;
    }
    const dangerousExts = [
      ".exe",
      ".bat",
      ".cmd",
      ".sh",
      ".vbs",
      ".msi",
      ".ps1",
      ".com",
      ".scr",
    ];
    const fileExt = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (dangerousExts.includes(fileExt)) {
      showToast("出于安全考虑，禁止上传可执行程序或脚本文件（.exe, .bat 等）");
      return;
    }

    setIsUploading(true);
    try {
      // 1. 获取预签名上传链接
      const presignRes = await fetch(
        `${API_BASE}/api/attachments/presigned-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...useAuthStore.getState().getAuthHeaders(),
          },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            channelId: channel.id,
          }),
        },
      );

      if (!presignRes.ok) {
        const errorData = await presignRes.json().catch(() => ({}));
        throw new Error(errorData.error || "获取上传凭证失败");
      }
      const presignData = await presignRes.json();

      // 2. 直传二进制数据 (通过 resolveServerUrl 转换为局域网/代理安全路径)
      const targetUploadUrl = resolveServerUrl(presignData.uploadUrl);
      const uploadRes = await fetch(targetUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(presignData.requiresAuth
            ? useAuthStore.getState().getAuthHeaders()
            : {}),
        },
        body: file,
      });

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json().catch(() => ({}));
        throw new Error(errorData.error || "附件直传失败");
      }

      const newAttachment: Attachment = {
        id: presignData.fileKey,
        url: presignData.fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      };

      if (isImageMime(newAttachment.mimeType, newAttachment.fileName)) {
        setPendingImageUrls((prev) => ({
          ...prev,
          [newAttachment.id]: URL.createObjectURL(file),
        }));
      }
      setPendingAttachments((prev) => [...prev, newAttachment]);
    } catch (err: any) {
      console.error("File upload error:", err);
      showToast(`上传失败: ${err.message || "未知错误"}`);
    } finally {
      setIsUploading(false);
    }
  };

  // 处理文件选择器
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await uploadAndAttachFile(files[i]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 处理剪贴板粘贴 (Ctrl+V 截图或文件即传)
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          await uploadAndAttachFile(file);
        }
      }
    }
  };

  const handleFilesSelected = async (files: File[]) => {
    for (let i = 0; i < files.length; i++) {
      await uploadAndAttachFile(files[i]);
    }
  };

  const executeSendMessage = async (customText?: string) => {
    const text =
      customText !== undefined
        ? customText
        : mentionInputRef.current?.getPlainText() || inputText;
    const content = text.trim();
    if (!content && pendingAttachments.length === 0) return;

    let contentToSend = content;
    if (channel.isE2EE && contentToSend) {
      // 阶段五：客户端本地双棘轮封装密文信封
      contentToSend = await doubleRatchetManager.encryptMessage(
        channel.id,
        contentToSend,
        currentUser.id,
      );
    }

    onSendMessage(
      contentToSend,
      channel.isE2EE,
      replyingTo?.id,
      pendingAttachments.length > 0 ? pendingAttachments : undefined,
    );

    setInputText("");
    channelDraftMap.delete(channel.id);
    mentionInputRef.current?.clear();
    setReplyingTo(null);
    setPendingAttachments([]);
    Object.values(pendingImageUrlsRef.current).forEach((url) =>
      URL.revokeObjectURL(url),
    );
    setPendingImageUrls({});
    lastTypingSentRef.current = 0;
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSendMessage();
  };

  const handleToggleReaction = (
    messageId: string,
    emoji: string,
    me?: boolean,
  ) => {
    if (me) {
      onReactionRemove?.(messageId, emoji);
    } else {
      onReactionAdd?.(messageId, emoji);
    }
  };

  const isImageMime = (mime: string, name: string) => {
    return (
      mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
    );
  };

  return (
    <div
      className="flex-1 flex flex-col h-full bg-discord-chat relative"
      data-channel-id={channel.id}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          dragCounterRef.current += 1;
          setIsDraggingFile(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          dragCounterRef.current -= 1;
          if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDraggingFile(false);
          }
        }
      }}
      onDrop={async (e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDraggingFile(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) {
            await handleFilesSelected(files);
          }
        }
      }}
    >
      {/* 拖拽文件进入聊天区域的高亮蒙层 (Discord 风格 Drag & Drop Overlay) */}
      {isDraggingFile && (
        <div
          data-testid="chat-drag-drop-overlay"
          className="absolute inset-0 z-50 bg-[#2b2d31]/95 border-4 border-dashed border-discord-brand flex flex-col items-center justify-center pointer-events-none rounded-lg backdrop-blur-sm transition-all"
        >
          <UploadCloud className="w-16 h-16 text-discord-brand animate-bounce mb-3" />
          <h3 className="text-xl font-bold text-white mb-1">
            拖放到此处即可上传
          </h3>
          <p className="text-sm text-discord-textMuted">
            支持上传最大 50MB 的任意图片、音视频及文档
          </p>
        </div>
      )}

      {/* 全局轻量提示浮层（如引用原消息未找到/已删除） */}
      {toastMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-[#111214]/95 border border-discord-danger/50 text-discord-danger px-4 py-2 rounded-lg shadow-2xl text-xs flex items-center space-x-2 animate-fade-in backdrop-blur-md">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 顶部标题栏 */}
      <div className="h-12 border-b border-[#232428] px-3 sm:px-4 flex items-center justify-between shadow-sm flex-shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          {onToggleMobileDrawer && (
            <button
              type="button"
              data-testid="toggle-mobile-drawer-btn"
              onClick={onToggleMobileDrawer}
              className="md:hidden p-1.5 -ml-1 text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition flex-shrink-0"
              title="打开频道与服务器抽屉"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          {channel.type === "DM" ? (
            <span className="text-discord-textMuted font-bold text-lg flex-shrink-0">
              @
            </span>
          ) : channel.isE2EE ? (
            <div className="relative flex-shrink-0">
              <Hash className="w-5 h-5 text-discord-textMuted" />
              <Lock className="w-3 h-3 text-discord-green absolute -top-0.5 -right-1" />
            </div>
          ) : (
            <Hash className="w-5 h-5 text-discord-textMuted flex-shrink-0" />
          )}
          <span
            data-testid="chat-header-title"
            className="font-bold text-discord-textHeader truncate max-w-[120px] xs:max-w-[160px] sm:max-w-xs md:max-w-none"
          >
            {displayChannelName}
          </span>
          {channel.isE2EE && (
            <button
              data-testid="chat-header-e2ee-badge"
              onClick={() => setShowFingerprintModal(true)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-discord-green/10 hover:bg-discord-green/20 border border-discord-green/30 text-[11px] text-discord-green transition cursor-pointer flex-shrink-0"
              title="点击查看端加密安全状态"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>端加密</span>
            </button>
          )}
          {channel.topic && (
            <>
              <div className="hidden lg:block w-[1px] h-4 bg-[#3f4147] mx-2" />
              <span className="hidden lg:inline text-xs text-discord-textMuted truncate max-w-md">
                {channel.topic}
              </span>
            </>
          )}
        </div>

        {/* 顶部右侧功能按钮 */}
        <div className="flex items-center space-x-2 sm:space-x-3 text-discord-textMuted flex-shrink-0">
          {/* 私信 1v1 呼叫按钮 */}
          {channel.type === "DM" && (
            <div className="flex items-center space-x-1 sm:space-x-2">
              {callEncryption && callEncryption.status !== "idle" && (
                <span
                  className={`hidden md:flex items-center gap-1 rounded border px-2 py-1 text-[10px] ${
                    callEncryption.status === "failed"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : callEncryption.status === "negotiating"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-discord-green/40 bg-discord-green/10 text-discord-green"
                  }`}
                  title={
                    callEncryption.fingerprint
                      ? `对端设备指纹：${callEncryption.fingerprint}`
                      : "正在协商设备密钥"
                  }
                  data-testid="dm-call-encryption-status"
                >
                  <ShieldCheck className="h-3 w-3" />
                  {callEncryption.status === "trusted"
                    ? "设备已验证"
                    : callEncryption.status === "tofu"
                      ? "首次信任 · E2EE"
                      : callEncryption.status === "failed"
                        ? "加密失败"
                        : "协商 E2EE"}
                </span>
              )}
              <button
                type="button"
                onClick={() => onStartCall?.(channel.id, false)}
                className="hover:text-discord-textHeader transition p-1.5 rounded hover:bg-[#35373c] text-discord-textMuted"
                title="发起语音呼叫"
                data-testid="dm-start-voice-call-btn"
              >
                <Phone className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => onStartCall?.(channel.id, true)}
                className="hover:text-discord-textHeader transition p-1.5 rounded hover:bg-[#35373c] text-discord-textMuted"
                title="发起视频呼叫"
                data-testid="dm-start-video-call-btn"
              >
                <Video className="w-5 h-5" />
              </button>
            </div>
          )}

          <button className="hidden sm:block hover:text-discord-textHeader transition">
            <Bell className="w-5 h-5" />
          </button>
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder={channel.isE2EE ? "密文搜索..." : "搜索..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-discord-sidebar text-xs text-discord-textNormal rounded px-2 py-1 pr-6 focus:outline-none focus:ring-1 focus:ring-discord-brand w-20 xs:w-28 sm:w-40 transition-all focus:w-36 sm:focus:w-52"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-discord-textMuted hover:text-white transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-discord-textMuted pointer-events-none" />
            )}
          </div>
          {/* 频道置顶消息入口 (Discord 原生图钉设计) */}
          <button
            type="button"
            onClick={() => setIsPinnedPopoverOpen((prev) => !prev)}
            className={`relative p-1 rounded hover:bg-[#35373c] transition ${
              isPinnedPopoverOpen || pinnedMessages.length > 0
                ? "text-discord-textHeader"
                : "text-discord-textMuted hover:text-discord-textHeader"
            }`}
            title={`已固定的消息 (${pinnedMessages.length})`}
          >
            <Pin
              className={`w-5 h-5 rotate-45 transition ${
                pinnedMessages.length > 0
                  ? "text-amber-400 fill-amber-400/20"
                  : ""
              }`}
            />
            {pinnedMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-discord-brand text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center border-2 border-discord-chat shadow">
                {pinnedMessages.length > 99 ? "99+" : pinnedMessages.length}
              </span>
            )}
          </button>

          {channel.type !== "DM" && (
            <button
              onClick={() => {
                if (isCompact && onToggleMobileMemberList) {
                  onToggleMobileMemberList();
                } else {
                  onToggleMemberList();
                }
              }}
              className={`hover:text-discord-textHeader transition p-1 rounded hover:bg-[#35373c] ${showMemberList ? "text-discord-textHeader" : ""}`}
              title="成员列表"
            >
              <Users className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 已固定的消息浮层面板 (Pinned Messages Popover) */}
        {isPinnedPopoverOpen && (
          <PinnedMessagesPopover
            channelName={channel.name}
            pinnedMessages={pinnedMessages}
            decryptedContents={decryptedContents}
            currentUser={currentUser}
            onClose={() => setIsPinnedPopoverOpen(false)}
            onJumpToMessage={handleJumpToMessage}
            onUnpinMessage={onTogglePin}
          />
        )}
      </div>

      {/* 端侧搜索结果提示条 */}
      {searchQuery && (
        <div className="bg-discord-brand/10 border-b border-discord-brand/30 px-4 py-1.5 flex items-center justify-between text-xs text-discord-brand">
          <span>
            🔍 端侧本地倒排索引全文匹配：找到 <b>{displayedMessages.length}</b>{" "}
            条匹配消息
          </span>
          <button
            onClick={() => setSearchQuery("")}
            className="hover:underline flex items-center space-x-1 text-[11px]"
          >
            <span>清除搜索过滤</span>
          </button>
        </div>
      )}

      {/* 消息视口区域主容器：包含吸顶历史提示横幅与上下边缘渐变模糊遮罩 */}
      <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
        {/* 顶部悬浮“正在查看较旧的消息” / “您有未读消息”横幅 (Discord 经典 Full-width Top Banner) */}
        {!isNearBottom &&
          isInitialPositionedRef.current &&
          messages.length > 0 && (
            <div
              onClick={() => void handleSmartJumpToLatestOrUnread()}
              className={`absolute top-0 inset-x-0 z-20 animate-slide-down backdrop-blur-md border-b px-4 py-2 flex items-center justify-between shadow-md cursor-pointer transition group ${
                firstUnreadMessageId
                  ? "bg-[#2b2d31]/95 border-red-500/30 hover:bg-[#313338]"
                  : "bg-[#2b2d31]/95 border-[#35373c] hover:bg-[#313338]"
              }`}
              title={firstUnreadMessageId ? "跳转至未读消息" : "跳到最新消息"}
              role="button"
            >
              <div className="flex items-center space-x-2 text-xs text-discord-textMuted">
                {firstUnreadMessageId ? (
                  <Bell className="w-4 h-4 text-red-400 flex-shrink-0 animate-pulse" />
                ) : (
                  <History className="w-4 h-4 text-discord-brand flex-shrink-0 group-hover:text-discord-brand-hover transition-colors" />
                )}
                <span
                  className={`font-medium ${
                    firstUnreadMessageId
                      ? "text-red-400 font-semibold"
                      : "text-discord-textHeader"
                  }`}
                >
                  {firstUnreadMessageId
                    ? "您有未读消息"
                    : "您正在查看较旧的消息"}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSmartJumpToLatestOrUnread();
                }}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded text-white text-xs font-semibold shadow transition transform active:scale-95 cursor-pointer ${
                  firstUnreadMessageId
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-discord-brand hover:bg-[#4752c4]"
                }`}
              >
                <span>{firstUnreadMessageId ? "跳转至未读" : "跳到最新"}</span>
                <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
              </button>
            </div>
          )}

        {/* 顶部纯色渐变遮罩 (Discord 风格纯色渐变，零 GPU 抓屏开销) */}
        <div
          className={`absolute top-0 inset-x-0 h-6 pointer-events-none z-10 transition-opacity duration-200 bg-gradient-to-b from-discord-chat/80 to-transparent ${
            hasScrolledTop ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* 聊天内容流 */}
        <div
          ref={scrollContainerRef}
          data-testid="chat-scroll-container"
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3"
          style={{
            transform: "translateZ(0)",
            willChange: "scroll-position",
          }}
        >
          {/* 欢迎卡片 */}
          {channel.type === "DM" ? (
            <div
              data-testid="dm-welcome-banner"
              className="pt-6 pb-4 border-b border-[#35373c] mb-4 select-none"
            >
              <div className="relative mb-3">
                {otherRecipient?.avatarUrl ? (
                  <img
                    src={otherRecipient.avatarUrl}
                    alt={displayChannelName}
                    className="w-20 h-20 rounded-full object-cover shadow-md"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-discord-brand text-white text-2xl font-bold flex items-center justify-center shadow-md">
                    {displayChannelName.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <h2
                data-testid="dm-welcome-displayname"
                className="text-2xl sm:text-3xl font-bold text-discord-textHeader"
              >
                {displayChannelName}
              </h2>
              {otherRecipient?.username && (
                <p className="text-sm font-medium text-discord-textMuted mt-0.5">
                  @{otherRecipient.username.replace(/^@/, "")}
                </p>
              )}
              <p className="text-sm text-discord-textMuted mt-2">
                {t("chat:dm.welcomePrompt", {
                  name: displayChannelName,
                  defaultValue: `这是你与 ${displayChannelName} 私信历史记录的起点。`,
                })}
              </p>
            </div>
          ) : (
            <div className="pt-4 pb-2 border-b border-[#35373c] mb-4">
              <div className="w-16 h-16 rounded-full bg-[#2b2d31] flex items-center justify-center mb-2">
                {channel.isE2EE ? (
                  <div className="relative">
                    <Hash className="w-8 h-8 text-discord-textHeader" />
                    <Lock className="w-4 h-4 text-discord-green absolute -top-1 -right-1" />
                  </div>
                ) : (
                  <Hash className="w-8 h-8 text-discord-textHeader" />
                )}
              </div>
              <h2 className="text-2xl font-bold text-discord-textHeader">
                欢迎来到 #{channel.name}!
              </h2>
              <p className="text-sm text-discord-textMuted mt-1">
                {channel.isE2EE
                  ? "这是一个实验性端到端双棘轮加密绝密频道 (Beta)。所有消息均在客户端本地密文封装，服务器仅充当盲中继，零明文存储。"
                  : `这是 #${channel.name} 频道的起点。畅所欲言吧！`}
              </p>
            </div>
          )}

          {/* 骨架屏加载状态 (延迟 100ms 显示防瞬闪) vs 虚拟化消息流 */}
          {showSkeleton && displayedMessages.length === 0 ? (
            <MessageSkeletonList />
          ) : (
            <div
              data-testid="virtual-message-list-container"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const msg = displayedMessages[virtualRow.index];
                if (!msg) return null;
                const isFirstUnread =
                  msg.id === firstUnreadMessageId &&
                  !(isInitialPositionedRef.current && isNearBottom);

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                      contain: "layout style",
                    }}
                    className="pb-2"
                  >
                    {isFirstUnread && (
                      <div
                        data-testid="unread-message-divider"
                        className={`flex items-center py-2 select-none transition-opacity duration-300 ${
                          isFadingDivider ? "opacity-0" : "opacity-100"
                        }`}
                      >
                        <div className="flex-1 h-[1px] bg-rose-500/80" />
                        <span className="px-2.5 py-0.5 text-[11px] font-bold text-white bg-rose-500 rounded-full shadow-sm mx-2">
                          {t("chat:historyDivider", "以下是新消息")}
                        </span>
                        <div className="flex-1 h-[1px] bg-rose-500/80" />
                      </div>
                    )}
                    <ChatMessageItem
                      msg={msg}
                      guild={guild}
                      currentUser={currentUser}
                      decryptedContents={decryptedContents}
                      isMobile={isMobile}
                      activeEmojiPickerMsgId={activeEmojiPickerMsgId}
                      setActiveEmojiPickerMsgId={setActiveEmojiPickerMsgId}
                      setReplyingTo={handleSetReplyingTo}
                      onTogglePin={onTogglePin}
                      onDeleteMessage={onDeleteMessage}
                      onReactionAdd={onReactionAdd}
                      onReactionRemove={onReactionRemove}
                      setLightboxImage={setLightboxImage}
                      setInputText={setInputText}
                      onOpenMobileActions={handleOpenMobileActions}
                      onMentionUser={handleMentionUser}
                      onOpenProfile={handleOpenProfile}
                      onOpenProfileByName={handleOpenProfileByName}
                      isHighlighted={highlightedMessageId === msg.id}
                      onJumpToMessage={handleJumpToMessage}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 底部纯色渐变遮罩 (Discord 风格纯色渐变，零 GPU 抓屏开销) */}
        <div
          className={`absolute bottom-0 inset-x-0 h-6 pointer-events-none z-10 transition-opacity duration-200 bg-gradient-to-t from-discord-chat/80 to-transparent ${
            !isNearBottom ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      {/* 底部输入与附件区 */}
      <div className="px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        {/* 正在回复状态栏 */}
        {replyingTo && (
          <div className="bg-[#2b2d31] px-3 py-1.5 rounded-t-lg border-t border-l border-r border-[#3f4147] flex items-center justify-between text-xs text-discord-textMuted animate-fade-in">
            <div className="flex items-center space-x-1.5 truncate">
              <Reply className="w-3.5 h-3.5 text-discord-brand" />
              <span>正在回复</span>
              <span className="font-semibold text-discord-textHeader">
                @
                {getUserDisplayName(
                  replyingTo.author,
                  guild?.members?.find(
                    (m) => m.userId === replyingTo.author.id,
                  ),
                )}
              </span>
              <span className="truncate opacity-75">
                : {replyingTo.content.slice(0, 40)}
              </span>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-discord-textMuted hover:text-white p-0.5 rounded transition"
              title="取消回复"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 待发送附件预览栏 */}
        {pendingAttachments.length > 0 && (
          <div className="bg-[#2b2d31] p-3 border-l border-r border-[#3f4147] flex flex-wrap gap-3 overflow-x-auto max-h-48">
            {pendingAttachments.map((att, idx) => {
              const isImg = isImageMime(att.mimeType, att.fileName);
              const previewUrl =
                pendingImageUrls[att.id] || resolveServerUrl(att.url);

              const handleRemove = () => {
                const url = pendingImageUrls[att.id];
                if (url) URL.revokeObjectURL(url);
                setPendingImageUrls((prev) => {
                  const next = { ...prev };
                  delete next[att.id];
                  return next;
                });
                setPendingAttachments((prev) =>
                  prev.filter((_, i) => i !== idx),
                );
              };

              if (isImg) {
                return (
                  <div
                    key={att.id || idx}
                    className="relative group/card rounded-lg overflow-hidden border border-[#3f4147] bg-[#1e1f22] w-28 h-28 flex-shrink-0 shadow-md transition hover:border-discord-brand/70"
                  >
                    {/* 图片缩略底图 */}
                    <img
                      src={previewUrl}
                      alt={att.fileName}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover/card:scale-105"
                    />

                    {/* 悬停半透明蒙层与快捷预览 */}
                    <button
                      type="button"
                      onClick={() => setLightboxImage(att)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 text-white z-10"
                      title="点击预览大图"
                      aria-label={`预览 ${att.fileName}`}
                    >
                      <ZoomIn className="w-5 h-5 drop-shadow" />
                      <span className="text-[10px] font-medium bg-black/60 px-1.5 py-0.5 rounded shadow">
                        预览
                      </span>
                    </button>

                    {/* 右上角删除按钮 */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove();
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-red-500/90 transition shadow z-20"
                      title="移除图片"
                      aria-label={`移除 ${att.fileName}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>

                    {/* 底部文件名与文件大小 */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-1.5 pt-3 pointer-events-none z-10">
                      <p className="text-[11px] text-white/95 truncate font-medium drop-shadow-sm">
                        {att.fileName}
                      </p>
                      {att.fileSize > 0 && (
                        <p className="text-[9px] text-white/70">
                          {att.fileSize < 1024
                            ? `${att.fileSize} B`
                            : att.fileSize < 1024 * 1024
                              ? `${(att.fileSize / 1024).toFixed(1)} KB`
                              : `${(att.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }

              // 非图片附件卡片
              return (
                <div
                  key={att.id || idx}
                  className="relative group/card bg-[#1e1f22] rounded-lg p-2.5 flex items-center space-x-2.5 border border-[#3f4147] hover:border-discord-brand/70 max-w-xs shadow-md transition"
                >
                  <div className="w-9 h-9 rounded bg-[#2b2d31] flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-discord-brand" />
                  </div>
                  <div className="min-w-0 pr-6">
                    <p className="text-xs text-discord-textNormal truncate max-w-[130px] font-medium">
                      {att.fileName}
                    </p>
                    {att.fileSize > 0 && (
                      <p className="text-[10px] text-discord-textMuted">
                        {att.fileSize < 1024
                          ? `${att.fileSize} B`
                          : att.fileSize < 1024 * 1024
                            ? `${(att.fileSize / 1024).toFixed(1)} KB`
                            : `${(att.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="absolute top-2 right-2 text-discord-textMuted hover:text-red-400 p-0.5 rounded transition"
                    title="移除附件"
                    aria-label={`移除 ${att.fileName}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 输入框与操作按钮条 */}
        <form
          onSubmit={handleSend}
          className={`bg-discord-channelList px-3 sm:px-4 py-2 flex items-center space-x-2 sm:space-x-3 border border-[#3f4147] focus-within:border-discord-brand transition ${
            replyingTo || pendingAttachments.length > 0
              ? "rounded-b-lg border-t-0"
              : "rounded-lg"
          }`}
        >
          {/* 隐藏原生文件上传输入 */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            className="hidden"
          />

          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center text-discord-textMuted hover:text-discord-textHeader transition disabled:opacity-50 shrink-0"
            title={t("chat:uploadFile")}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-discord-brand" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </button>

          {/* 富文本 @提及 Tag 输入框 */}
          <MentionInput
            ref={mentionInputRef}
            initialValue={inputText}
            placeholder={
              channel.type === "DM"
                ? `发送私信给 @${displayChannelName}`
                : isMobile
                  ? t("chat:sendToChannel", { name: channel.name })
                  : t("chat:sendToChannelPlaceholder", { name: channel.name })
            }
            members={guild?.members || []}
            roles={guild?.roles || []}
            onSendMessage={(text) => executeSendMessage(text)}
            onPasteFiles={(files) => handleFilesSelected(files)}
            onChangeText={(text) => handleInputChange(text)}
          />

          {/* 输入框表情选择器 */}
          <div className="relative flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setIsInputEmojiOpen(!isInputEmojiOpen)}
              className="flex items-center justify-center text-discord-textMuted hover:text-discord-textHeader transition shrink-0"
              title={t("chat:selectEmoji")}
            >
              <Smile className="w-5 h-5" />
            </button>
            <EmojiPickerPopover
              isOpen={isInputEmojiOpen}
              onClose={() => setIsInputEmojiOpen(false)}
              onSelectEmoji={(emoji: string) => {
                mentionInputRef.current?.insertText(emoji);
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() && pendingAttachments.length === 0}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition shrink-0 ${
              inputText.trim() || pendingAttachments.length > 0
                ? "bg-discord-brand text-white hover:bg-discord-brandHover"
                : "text-discord-textMuted opacity-40 cursor-not-allowed"
            }`}
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </form>

        {/* 输入框正下方的 Discord 经典原生风格打字指示器 (固定 20px 高度无回流) */}
        <TypingIndicator
          typingUsers={Array.from(typingUsersMap.entries()).map(
            ([id, val]) => ({ id, username: val.username }),
          )}
        />
      </div>

      {/* 阶段五：端到端双棘轮密钥安全码与加密指纹模态框 */}
      {showFingerprintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#313338] text-discord-textNormal w-full max-w-md rounded-lg shadow-2xl overflow-hidden border border-[#3f4147] p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#3f4147]">
              <div className="flex items-center space-x-2 text-discord-green">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-discord-textHeader text-base">
                  端到端双棘轮安全验证码
                </h3>
              </div>
              <button
                onClick={() => setShowFingerprintModal(false)}
                className="text-discord-textMuted hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs text-discord-textMuted">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2.5 text-[11px] text-amber-300">
                ⚠️ <strong>实验性功能提示 (Beta)</strong>
                ：当前频道采用双棘轮密文信封防网络嗅探与服务端直读；基于用户设备私钥的多方动态树状握手协议正在持续演进中。
              </div>
              <p>
                当前频道已激活{" "}
                <b className="text-discord-textHeader">
                  Signal Double Ratchet (双棘轮)
                </b>{" "}
                算法。消息由 ECDH P-256 临时公钥协商派生一次一密 (One-Time
                Message Key) 封装。
              </p>
              <div className="bg-[#1e1f22] p-3 rounded-lg border border-[#2b2d31]">
                <div className="text-[11px] text-discord-textMuted mb-1">
                  安全指纹校验码 (Safety Number / Key Fingerprint):
                </div>
                <div className="font-mono text-sm tracking-widest text-discord-green font-bold select-all">
                  {safetyNumber}
                </div>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li>
                  前向保密性 (Forward
                  Secrecy)：旧消息密钥阅后即焚，无法推演后续通信。
                </li>
                <li>
                  破后自愈 (Break-in Recovery)：每轮会话触发 DH
                  棘轮，密钥泄漏自动恢复安全。
                </li>
                <li>
                  服务端盲中继：数据库仅存 JSON
                  密文信封，管理员无法查看任何明文。
                </li>
              </ul>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowFingerprintModal(false)}
                className="bg-discord-brand hover:bg-discord-brandHover text-white px-4 py-1.5 rounded text-xs font-semibold"
              >
                确认并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片灯箱放大预览模态框 */}
      <LightboxModal
        attachment={lightboxImage}
        fallbackUrl={
          lightboxImage
            ? pendingImageUrls[lightboxImage.id] ||
              resolveServerUrl(lightboxImage.url)
            : undefined
        }
        onClose={() => setLightboxImage(null)}
      />

      {/* 移动端专属消息长按操作抽屉 (Mobile ActionSheet) */}
      <MobileActionSheet
        isOpen={!!mobileActionMessage}
        message={mobileActionMessage}
        guild={guild}
        onClose={() => setMobileActionMessage(null)}
        onReply={(m) => setReplyingTo(m)}
        onTogglePin={onTogglePin}
        onDelete={onDeleteMessage}
        onAddReaction={onReactionAdd}
      />
    </div>
  );
};
