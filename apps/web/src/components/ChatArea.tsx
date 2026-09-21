import React, { useState, useRef, useEffect } from "react";
import {
  Channel,
  Message,
  User,
  Attachment,
  Guild,
  GuildMember,
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
  FileText,
  Download,
  Loader2,
  Key,
  ShieldAlert,
  Menu,
  ChevronDown,
  History,
} from "lucide-react";
import { MarkdownRenderer } from "./chat/MarkdownRenderer.js";
import { EmojiPickerPopover } from "./chat/EmojiPickerPopover.js";
import { LightboxModal } from "./chat/LightboxModal.js";
import { MobileActionSheet } from "./chat/MobileActionSheet.js";
import { MentionInput, MentionInputHandle } from "./chat/MentionInput.js";
import { TypingIndicator } from "./chat/TypingIndicator.js";
import { UserProfilePopout } from "./profile/UserProfilePopout.js";
import { MessageContextMenu } from "./context-menu/MessageContextMenu.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { InputContextMenu } from "./context-menu/InputContextMenu.js";
import { API_BASE, resolveServerUrl } from "../config.js";
import { gatewayClient } from "../services/gateway.js";
import { doubleRatchetManager } from "../services/doubleRatchet.js";
import { clientFtsStorage } from "../services/e2eeStorage.js";
import { useViewport } from "../hooks/useViewport.js";
import { useLongPress } from "../hooks/useLongPress.js";

interface ChatAreaProps {
  channel: Channel;
  guild?: Guild | null;
  messages: Message[];
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
  setLightboxImage: (img: { url: string; name: string } | null) => void;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  onOpenMobileActions: (msg: Message) => void;
  onMentionUser?: (username: string) => void;
  onOpenProfile?: (
    author: { id: string; username: string; avatarUrl?: string | null },
    rect: DOMRect
  ) => void;
  onOpenProfileByName?: (username: string, rect: DOMRect) => void;
  isHighlighted?: boolean;
  onJumpToMessage?: (messageId: string) => void;
}

const isImageMime = (mime: string, name: string) => {
  return (
    mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
  );
};

const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
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
  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const longPressProps = useLongPress(() => {
    if (isMobile) {
      onOpenMobileActions(msg);
    }
  });

  return (
    <MessageContextMenu
      message={msg}
      guild={guild}
      onReply={(m) => setReplyingTo(m)}
      onTogglePin={onTogglePin}
      onDelete={onDeleteMessage}
      onAddReaction={onReactionAdd}
    >
      <div
        id={`message-${msg.id}`}
        data-message-id={msg.id}
        {...longPressProps}
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
          <UserContextMenu
            targetUser={msg.author}
            guild={guild}
            onMention={(username) => onMentionUser?.(username)}
          >
            <img
              src={
                msg.author.avatarUrl ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=user"
              }
              alt={msg.author.username}
              onClick={(e) =>
                onOpenProfile?.(
                  msg.author,
                  e.currentTarget.getBoundingClientRect()
                )
              }
              className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer hover:opacity-80 transition mt-0.5"
            />
          </UserContextMenu>
          <div className="flex-1 overflow-hidden">
            {/* 用户信息与时间栏 */}
            <div className="flex items-center space-x-2">
              <UserContextMenu
                targetUser={msg.author}
                guild={guild}
                onMention={(username) => onMentionUser?.(username)}
              >
                <span
                  onClick={(e) =>
                    onOpenProfile?.(
                      msg.author,
                      e.currentTarget.getBoundingClientRect()
                    )
                  }
                  className="font-semibold text-discord-textHeader text-sm cursor-pointer hover:underline"
                >
                  {msg.author.username}
                </span>
              </UserContextMenu>
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
              {msg.isEncrypted && (
                <span
                  className="flex items-center space-x-0.5 text-[10px] text-discord-green bg-discord-green/10 px-1 rounded border border-discord-green/30"
                  title={
                    decryptedContents[msg.id]?.fingerprint
                      ? `安全码指纹: ${decryptedContents[msg.id]?.fingerprint}`
                      : "端到端加密消息"
                  }
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span>
                    Double Ratchet 已解密
                    {decryptedContents[msg.id]?.fingerprint
                      ? ` (${decryptedContents[msg.id]?.fingerprint?.slice(0, 6)})`
                      : ""}
                  </span>
                </span>
              )}
            </div>

            {/* 消息正文 (支持 Markdown 与剧透) */}
            {msg.content && (
              <div className="mt-1 selectable-text">
                <MarkdownRenderer
                  content={
                    msg.isEncrypted
                      ? decryptedContents[msg.id]?.text ||
                        "🔒 [端到端双棘轮密文解密中...]"
                      : msg.content
                  }
                  currentUsername={currentUser.username}
                  onMentionClick={(username, rect) =>
                    onOpenProfileByName?.(username, rect)
                  }
                />
              </div>
            )}

            {/* 附件展示 (图片缩略图与普通文件卡片) */}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {msg.attachments.map((att) => {
                  const isImg = isImageMime(att.mimeType, att.fileName);
                  if (isImg) {
                    return (
                      <div
                        key={att.id}
                        onClick={() =>
                          setLightboxImage({
                            url: att.url,
                            name: att.fileName,
                          })
                        }
                        className="relative group/att rounded-lg overflow-hidden border border-[#3f4147] cursor-pointer max-w-sm max-h-64 bg-[#1e1f22]"
                      >
                        <img
                          src={resolveServerUrl(att.url)}
                          alt={att.fileName}
                          className="w-full h-full object-cover transition group-hover/att:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/att:opacity-100 transition flex items-center justify-center text-white text-xs space-x-1 font-medium">
                          <span>点击放大预览</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <a
                      key={att.id}
                      href={resolveServerUrl(att.url)}
                      download={att.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-2 bg-[#2b2d31] hover:bg-[#35373c] p-2.5 rounded-lg border border-[#3f4147] max-w-xs transition group/file"
                    >
                      <FileText className="w-8 h-8 text-discord-brand flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-discord-textHeader truncate group-hover/file:underline">
                          {att.fileName}
                        </div>
                        <div className="text-[10px] text-discord-textMuted">
                          {(att.fileSize / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <Download className="w-4 h-4 text-discord-textMuted group-hover/file:text-white transition flex-shrink-0" />
                    </a>
                  );
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
              onSelectEmoji={(emoji: string) =>
                onReactionAdd?.(msg.id, emoji)
              }
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
    </MessageContextMenu>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({
  channel,
  guild,
  messages,
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
}) => {
  const { isMobile, isDesktop } = useViewport();
  const isCompact = !isDesktop;
  const [mobileActionMessage, setMobileActionMessage] = useState<Message | null>(null);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionInputRef = useRef<MentionInputHandle>(null);
  const [selectedUserPopout, setSelectedUserPopout] = useState<{
    user: User;
    member?: GuildMember | null;
    targetRect: DOMRect;
  } | null>(null);

  const handleOpenProfile = (
    author: { id: string; username: string; avatarUrl?: string | null },
    rect: DOMRect
  ) => {
    const member =
      guild?.members?.find(
        (m) => m.userId === author.id || m.user?.id === author.id
      ) || null;
    const fullUser: User = member?.user || {
      id: author.id,
      username: author.username,
      avatarUrl: author.avatarUrl,
      email: "",
      status: "OFFLINE",
      createdAt: new Date().toISOString(),
    };
    setSelectedUserPopout({
      user: fullUser,
      member,
      targetRect: rect,
    });
  };

  const handleOpenProfileByName = (name: string, rect: DOMRect) => {
    const cleanName = name.trim().toLowerCase();
    const member = guild?.members?.find(
      (m) =>
        m.user?.username?.toLowerCase() === cleanName ||
        m.nickname?.toLowerCase() === cleanName
    );
    if (member && member.user) {
      setSelectedUserPopout({
        user: member.user,
        member,
        targetRect: rect,
      });
      return;
    }
    const msgAuthor = messages.find(
      (m) => m.author.username.toLowerCase() === cleanName
    )?.author;
    if (msgAuthor) {
      setSelectedUserPopout({
        user: {
          id: msgAuthor.id,
          username: msgAuthor.username,
          avatarUrl: msgAuthor.avatarUrl,
          email: "",
          status: "OFFLINE",
          createdAt: new Date().toISOString(),
        },
        member: null,
        targetRect: rect,
      });
    }
  };

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
    [],
  );
  const [isUploading, setIsUploading] = useState(false);
  const [activeEmojiPickerMsgId, setActiveEmojiPickerMsgId] = useState<
    string | null
  >(null);
  const [isInputEmojiOpen, setIsInputEmojiOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    name: string;
  } | null>(null);

  // 阶段五：端到端双棘轮解密内容缓存与本地离线搜索状态
  const [decryptedContents, setDecryptedContents] = useState<
    Record<string, { text: string; fingerprint?: string }>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string>("E2EE-A1B2-C3D4-E5F6-0001");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  // 消息高亮与跳转定位状态
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 视口距离底部与顶部状态（离开底部则显示顶部“跳到最新”横幅与底部渐变，离开顶部则显示顶部渐变）
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasScrolledTop, setHasScrolledTop] = useState(false);

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

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 120;
    setIsNearBottom(nearBottom);
    setHasScrolledTop(scrollTop > 16);
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
    setIsNearBottom(true);
  };

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

    setTimeout(() => {
      const el = document.getElementById(`message-${targetMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });

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
      } else {
        showToast("未找到被引用的原文，该消息可能已被删除");
      }
    }, 60);
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

  // 用户输入变动与打字状态节流发送 (3.5 秒窗口)
  const handleInputChange = (text: string) => {
    setInputText(text);
    if (text.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 3500) {
        lastTypingSentRef.current = now;
        gatewayClient.sendTyping(channel.id);
      }
    }
  };

  // 切换频道时重置滚动到底部，并重置高亮与离开状态
  useEffect(() => {
    scrollToBottom(false);
    setIsNearBottom(true);
    setHighlightedMessageId(null);
  }, [channel.id]);

  // 新消息到达时：如果原本就在底部，或者发送者是当前用户自己，自动平滑滚到底部
  useEffect(() => {
    if (messages.length === 0) return;
    const latestMsg = messages[messages.length - 1];
    const isMyMessage = latestMsg?.authorId === currentUser.id;
    if (isNearBottom || isMyMessage) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

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
      const updates: Record<string, { text: string; fingerprint?: string }> = {};
      let hasUpdates = false;

      for (const msg of messages) {
        if (msg.isEncrypted) {
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

  // 上传文件并追加至附件列表
  const uploadAndAttachFile = async (file: File) => {
    setIsUploading(true);
    try {
      // 1. 获取预签名上传链接
      const presignRes = await fetch(
        `${API_BASE}/api/attachments/presigned-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
          }),
        },
      );

      if (!presignRes.ok) throw new Error("获取上传凭证失败");
      const presignData = await presignRes.json();

      // 2. 直传二进制数据 (通过 resolveServerUrl 转换为局域网/代理安全路径)
      const targetUploadUrl = resolveServerUrl(presignData.uploadUrl);
      const uploadRes = await fetch(targetUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("附件直传失败");

      const newAttachment: Attachment = {
        id: presignData.fileKey,
        url: resolveServerUrl(presignData.fileUrl),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      };

      setPendingAttachments((prev) => [...prev, newAttachment]);
    } catch (err: any) {
      console.error("File upload error:", err);
      alert(`上传失败: ${err.message || "未知错误"}`);
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

  // 处理剪贴板粘贴 (Ctrl+V 截图即传)
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
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
    mentionInputRef.current?.clear();
    setReplyingTo(null);
    setPendingAttachments([]);
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
    >
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
              onClick={onToggleMobileDrawer}
              className="md:hidden p-1.5 -ml-1 text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition flex-shrink-0"
              title="打开频道与服务器抽屉"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          {channel.isE2EE ? (
            <Lock className="w-5 h-5 text-discord-green flex-shrink-0" />
          ) : (
            <Hash className="w-5 h-5 text-discord-textMuted flex-shrink-0" />
          )}
          <span className="font-bold text-discord-textHeader truncate max-w-[120px] xs:max-w-[160px] sm:max-w-xs md:max-w-none">
            {channel.name}
          </span>
          {channel.isE2EE && (
            <button
              onClick={() => setShowFingerprintModal(true)}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-discord-green/10 hover:bg-discord-green/20 border border-discord-green/30 text-[11px] text-discord-green transition cursor-pointer flex-shrink-0"
              title="点击查看端到端双棘轮密钥安全码与加密状态"
            >
              <ShieldCheck className="w-3 h-3" />
              <span className="hidden sm:inline">Double Ratchet </span>
              <span>E2EE</span>
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
          <button className="hidden sm:block hover:text-discord-textHeader transition">
            <Bell className="w-5 h-5" />
          </button>
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder={
                channel.isE2EE
                  ? "密文搜索..."
                  : "搜索..."
              }
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
        </div>
      </div>

      {/* 端侧搜索结果提示条 */}
      {searchQuery && (
        <div className="bg-discord-brand/10 border-b border-discord-brand/30 px-4 py-1.5 flex items-center justify-between text-xs text-discord-brand">
          <span>
            🔍 端侧本地倒排索引全文匹配：找到 <b>{displayedMessages.length}</b> 条匹配消息
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
        {/* 顶部悬浮“正在查看较旧的消息”横幅 (Discord 经典 Full-width Top Banner) */}
        {!isNearBottom && (
          <div
            onClick={() => scrollToBottom(true)}
            className="absolute top-0 inset-x-0 z-20 animate-slide-down bg-[#2b2d31]/95 backdrop-blur-md border-b border-[#35373c] px-4 py-2 flex items-center justify-between shadow-md cursor-pointer hover:bg-[#313338] transition group"
            title="跳到最新消息"
            role="button"
          >
            <div className="flex items-center space-x-2 text-xs text-discord-textMuted">
              <History className="w-4 h-4 text-discord-brand flex-shrink-0 group-hover:text-discord-brand-hover transition-colors" />
              <span className="text-discord-textHeader font-medium">您正在查看较旧的消息</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                scrollToBottom(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-1 rounded bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold shadow transition transform active:scale-95 cursor-pointer"
            >
              <span>跳到最新</span>
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>
        )}

        {/* 顶部渐变模糊遮罩 (Gradient + Backdrop Blur + Mask, 滚动离开最顶部时平滑淡入) */}
        <div
          className={`absolute top-0 inset-x-0 h-7 pointer-events-none z-10 transition-opacity duration-300 ${
            hasScrolledTop ? "opacity-100" : "opacity-0"
          }`}
          style={{
            backdropFilter: "blur(4px)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          }}
        >
          <div className="w-full h-full bg-gradient-to-b from-discord-chat/80 to-transparent" />
        </div>

        {/* 聊天内容流 */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {/* 欢迎卡片 */}
          <div className="pt-4 pb-2 border-b border-[#35373c] mb-4">
            <div className="w-16 h-16 rounded-full bg-[#2b2d31] flex items-center justify-center mb-2">
              {channel.isE2EE ? (
                <Lock className="w-8 h-8 text-discord-green" />
              ) : (
                <Hash className="w-8 h-8 text-discord-textHeader" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-discord-textHeader">
              欢迎来到 #{channel.name}!
            </h2>
            <p className="text-sm text-discord-textMuted mt-1">
              {channel.isE2EE
                ? "这是一个端到端双棘轮加密绝密频道，所有消息均在客户端本地密文封装，服务器仅充当盲中继，零明文存储。"
                : `这是 #${channel.name} 频道的起点。畅所欲言吧！`}
            </p>
          </div>

          {/* 消息项 */}
          {displayedMessages.map((msg) => (
            <ChatMessageItem
              key={msg.id}
              msg={msg}
              guild={guild}
              currentUser={currentUser}
              decryptedContents={decryptedContents}
              isMobile={isMobile}
              activeEmojiPickerMsgId={activeEmojiPickerMsgId}
              setActiveEmojiPickerMsgId={setActiveEmojiPickerMsgId}
              setReplyingTo={(m: Message) => setReplyingTo(m)}
              onTogglePin={onTogglePin}
              onDeleteMessage={onDeleteMessage}
              onReactionAdd={onReactionAdd}
              onReactionRemove={onReactionRemove}
              setLightboxImage={setLightboxImage}
              setInputText={setInputText}
              onOpenMobileActions={(m: Message) => setMobileActionMessage(m)}
              onMentionUser={(username) =>
                mentionInputRef.current?.insertMention(username, username)
              }
              onOpenProfile={(author, rect) => handleOpenProfile(author, rect)}
              onOpenProfileByName={(name, rect) =>
                handleOpenProfileByName(name, rect)
              }
              isHighlighted={highlightedMessageId === msg.id}
              onJumpToMessage={handleJumpToMessage}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 底部渐变模糊遮罩 (Gradient + Backdrop Blur + Mask, 离开底部时平滑淡入) */}
        <div
          className={`absolute bottom-0 inset-x-0 h-7 pointer-events-none z-10 transition-opacity duration-300 ${
            !isNearBottom ? "opacity-100" : "opacity-0"
          }`}
          style={{
            backdropFilter: "blur(4px)",
            WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 100%)",
            maskImage: "linear-gradient(to top, black 0%, transparent 100%)",
          }}
        >
          <div className="w-full h-full bg-gradient-to-t from-discord-chat/80 to-transparent" />
        </div>
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
                @{replyingTo.author.username}
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
          <div className="bg-[#2b2d31] p-2 border-l border-r border-[#3f4147] flex flex-wrap gap-2">
            {pendingAttachments.map((att, idx) => (
              <div
                key={att.id || idx}
                className="relative bg-[#1e1f22] rounded p-1.5 flex items-center space-x-2 border border-[#3f4147] max-w-xs"
              >
                {isImageMime(att.mimeType, att.fileName) ? (
                  <img
                    src={att.url}
                    alt={att.fileName}
                    className="w-8 h-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="w-6 h-6 text-discord-brand" />
                )}
                <span className="text-xs text-discord-textNormal truncate max-w-[120px]">
                  {att.fileName}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingAttachments((prev) =>
                      prev.filter((_, i) => i !== idx),
                    )
                  }
                  className="text-discord-textMuted hover:text-red-400 p-0.5 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
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
            title="上传文件或图片 (支持 MinIO 直传)"
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
            placeholder={
              isMobile
                ? `发送到 #${channel.name}`
                : `发送消息到 #${channel.name} (键入 @ 快捷提及，支持 Markdown、剧透 ||文字|| 与截图粘贴)`
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
              title="选择常用 Emoji"
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
              <p>
                当前频道已激活{" "}
                <b className="text-discord-textHeader">
                  Signal Double Ratchet (双棘轮)
                </b>{" "}
                算法。消息由 ECDH P-256 临时公钥协商派生一次一密 (One-Time Message Key) 封装。
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
                <li>前向保密性 (Forward Secrecy)：旧消息密钥阅后即焚，无法推演后续通信。</li>
                <li>破后自愈 (Break-in Recovery)：每轮会话触发 DH 棘轮，密钥泄漏自动恢复安全。</li>
                <li>服务端盲中继：数据库仅存 JSON 密文信封，管理员无法查看任何明文。</li>
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
        isOpen={!!lightboxImage}
        imageUrl={lightboxImage ? resolveServerUrl(lightboxImage.url) : null}
        fileName={lightboxImage?.name}
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

      {/* 用户资料卡片浮层 (支持点击头像、用户名及正文 @Tag 唤出) */}
      {selectedUserPopout && (
        <UserProfilePopout
          isOpen={true}
          onClose={() => setSelectedUserPopout(null)}
          targetRect={selectedUserPopout.targetRect}
          user={selectedUserPopout.user}
          member={selectedUserPopout.member}
          guild={guild}
          currentUser={currentUser}
          roles={guild?.roles || []}
          onMention={(username) => {
            mentionInputRef.current?.insertMention(username, username);
            setSelectedUserPopout(null);
          }}
          onSendMessage={() => {
            setSelectedUserPopout(null);
          }}
        />
      )}
    </div>
  );
};
