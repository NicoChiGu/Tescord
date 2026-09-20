import React, { useState, useRef, useEffect } from "react";
import { Channel, Message, User, Attachment, Guild } from "@tescord/types";
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
} from "lucide-react";
import { MarkdownRenderer } from "./chat/MarkdownRenderer.js";
import { EmojiPickerPopover } from "./chat/EmojiPickerPopover.js";
import { LightboxModal } from "./chat/LightboxModal.js";
import { MobileActionSheet } from "./chat/MobileActionSheet.js";
import { MessageContextMenu } from "./context-menu/MessageContextMenu.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { InputContextMenu } from "./context-menu/InputContextMenu.js";
import { API_BASE, resolveServerUrl } from "../config.js";
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
        {...longPressProps}
        className={`relative flex flex-col group -mx-2 sm:-mx-4 px-2 sm:px-4 py-1.5 rounded transition ${
          msg.isPinned
            ? "bg-discord-brand/5 border-l-2 border-yellow-500/80"
            : "hover:bg-[#2e3035]"
        }`}
      >
        {/* 引用回复提示条 */}
        {msg.replyTo && (
          <div className="flex items-center space-x-2 text-xs text-discord-textMuted mb-1 ml-10 pl-2 border-l-2 border-[#4e5058]">
            <Reply className="w-3 h-3 text-discord-textMuted transform rotate-180" />
            <span className="font-semibold text-discord-brand">
              @{msg.replyTo.authorName}
            </span>
            <span className="truncate max-w-md text-discord-textNormal opacity-80">
              {msg.replyTo.content}
            </span>
          </div>
        )}

        <div className="flex space-x-3 items-start">
          <UserContextMenu
            targetUser={msg.author}
            guild={guild}
            onMention={(username) =>
              setInputText((prev) => `${prev}@${username} `)
            }
          >
            <img
              src={
                msg.author.avatarUrl ||
                "https://api.dicebear.com/7.x/bottts/svg?seed=user"
              }
              alt={msg.author.username}
              className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer hover:opacity-80 transition mt-0.5"
            />
          </UserContextMenu>
          <div className="flex-1 overflow-hidden">
            {/* 用户信息与时间栏 */}
            <div className="flex items-center space-x-2">
              <UserContextMenu
                targetUser={msg.author}
                guild={guild}
                onMention={(username) =>
                  setInputText((prev) => `${prev}@${username} `)
                }
              >
                <span className="font-semibold text-discord-textHeader text-sm cursor-pointer hover:underline">
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
                  className="flex items-center space-x-0.5 text-[10px] text-yellow-400 bg-yellow-400/10 px-1 rounded border border-yellow-400/30"
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
  const { isMobile } = useViewport();
  const [mobileActionMessage, setMobileActionMessage] = useState<Message | null>(null);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && pendingAttachments.length === 0) return;

    let contentToSend = inputText.trim();
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
    setReplyingTo(null);
    setPendingAttachments([]);
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
    <div className="flex-1 flex flex-col h-full bg-discord-chat relative">
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
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-discord-textMuted hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Search className="w-3.5 h-3.5 absolute right-2 top-2 text-discord-textMuted" />
            )}
          </div>
          <button
            onClick={() => {
              if (isMobile && onToggleMobileMemberList) {
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

      {/* 聊天内容流 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
          />
        ))}
        <div ref={messagesEndRef} />
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
            className="text-discord-textMuted hover:text-discord-textHeader transition disabled:opacity-50"
            title="上传文件或图片 (支持 MinIO 直传)"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-discord-brand" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </button>

          <div className="flex-1 flex">
            <InputContextMenu
              inputRef={inputRef}
              value={inputText}
              onChange={setInputText}
            >
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={handlePaste}
                placeholder={
                  isMobile
                    ? `发送到 #${channel.name}`
                    : `发送消息到 #${channel.name} (支持 Markdown、剧透 ||文字|| 与 Ctrl+V 截图粘贴)`
                }
                className="w-full bg-transparent text-sm text-discord-textHeader placeholder-discord-textMuted focus:outline-none"
              />
            </InputContextMenu>
          </div>

          {/* 输入框表情选择器 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsInputEmojiOpen(!isInputEmojiOpen)}
              className="text-discord-textMuted hover:text-discord-textHeader transition"
              title="选择常用 Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
            <EmojiPickerPopover
              isOpen={isInputEmojiOpen}
              onClose={() => setIsInputEmojiOpen(false)}
              onSelectEmoji={(emoji: string) =>
                setInputText((prev) => prev + emoji)
              }
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() && pendingAttachments.length === 0}
            className={`p-1.5 rounded-full transition ${
              inputText.trim() || pendingAttachments.length > 0
                ? "bg-discord-brand text-white hover:bg-discord-brandHover"
                : "text-discord-textMuted opacity-40 cursor-not-allowed"
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
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
    </div>
  );
};
