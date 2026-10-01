import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  X,
  Hash,
  Lock,
  ArrowRight,
  FileText,
  Image as ImageIcon,
  Calendar,
  User as UserIcon,
  Filter,
  Loader2,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Channel, Guild, SearchMessageItem, User } from "@tescord/types";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { clientFtsStorage } from "../../services/e2eeStorage.js";

export interface SearchResultsDrawerProps {
  isOpen: boolean;
  channel: Channel;
  guild?: Guild | null;
  currentUser: User;
  onClose: () => void;
  onJumpToMessage: (channelId: string, messageId: string) => void;
  initialQuery?: string;
  decryptedContents?: Record<string, { text: string; fingerprint?: string }>;
}

export const SearchResultsDrawer: React.FC<SearchResultsDrawerProps> = ({
  isOpen,
  channel,
  guild,
  currentUser,
  onClose,
  onJumpToMessage,
  initialQuery = "",
  decryptedContents = {},
}) => {
  const { t } = useTranslation(["chat", "common"]);
  const { getAuthHeaders } = useAuthStore();
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [searchScope, setSearchScope] = useState<"channel" | "guild">(
    channel.type === "DM" || channel.isE2EE ? "channel" : "guild",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchMessageItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialQuery) {
      setSearchInput(initialQuery);
      performSearch(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 解析类 Discord 搜索语法 (from:, in:, has:, pinned:)
  const parsedQuery = useMemo(() => {
    const raw = searchInput.trim();
    let queryText = raw;
    let fromUser: string | undefined;
    let inChannel: string | undefined;
    let hasType: "link" | "file" | "image" | "video" | "sound" | undefined;
    let isPinned: boolean | undefined;

    // 匹配 from:xxx
    const fromMatch = raw.match(/from:([^\s]+)/i);
    if (fromMatch) {
      fromUser = fromMatch[1];
      queryText = queryText.replace(fromMatch[0], "").trim();
    }

    // 匹配 in:xxx
    const inMatch = raw.match(/in:([^\s]+)/i);
    if (inMatch) {
      inChannel = inMatch[1].replace(/^#/, "");
      queryText = queryText.replace(inMatch[0], "").trim();
    }

    // 匹配 has:xxx
    const hasMatch = raw.match(/has:(link|file|image|video|sound)/i);
    if (hasMatch) {
      hasType = hasMatch[1].toLowerCase() as any;
      queryText = queryText.replace(hasMatch[0], "").trim();
    }

    // 匹配 pinned:true
    const pinnedMatch = raw.match(/pinned:(true|yes|1)/i);
    if (pinnedMatch) {
      isPinned = true;
      queryText = queryText.replace(pinnedMatch[0], "").trim();
    }

    return {
      cleanQuery: queryText,
      fromUser,
      inChannel,
      hasType,
      isPinned,
    };
  }, [searchInput]);

  const performSearch = async (textToSearch?: string) => {
    const targetText = textToSearch !== undefined ? textToSearch : searchInput;
    if (!targetText.trim() && !parsedQuery.fromUser && !parsedQuery.hasType && !parsedQuery.isPinned) {
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      if (channel.isE2EE) {
        // E2EE 密文频道：调用客户端倒排索引本地 FTS
        const rawIds = await clientFtsStorage.search(
          parsedQuery.cleanQuery || targetText.trim(),
          channel.id,
        );
        // 本地聚合匹配消息
        const localItems: SearchMessageItem[] = rawIds.map((item) => {
          const dec = decryptedContents[item.id];
          return {
            id: item.id,
            channelId: channel.id,
            channelName: channel.name,
            authorId: item.authorId,
            author: {
              id: item.authorId,
              username: item.authorId === currentUser.id ? currentUser.username : "User",
              displayName: item.authorId === currentUser.id ? currentUser.displayName : undefined,
              avatarUrl: item.authorId === currentUser.id ? currentUser.avatarUrl : undefined,
            },
            content: dec ? dec.text : item.content,
            isEncrypted: true,
            createdAt: item.createdAt || new Date().toISOString(),
          };
        });
        setResults(localItems);
        setTotalCount(localItems.length);
      } else {
        // 普通频道 / 公会：调用服务端搜索接口
        const params = new URLSearchParams();
        if (parsedQuery.cleanQuery) params.set("query", parsedQuery.cleanQuery);
        if (parsedQuery.fromUser) params.set("from", parsedQuery.fromUser);
        if (parsedQuery.hasType) params.set("has", parsedQuery.hasType);
        if (parsedQuery.isPinned) params.set("pinned", "true");

        let endpoint = "";
        if (searchScope === "channel" || !guild) {
          endpoint = `${API_BASE}/api/channels/${channel.id}/messages/search?${params.toString()}`;
        } else {
          if (parsedQuery.inChannel && guild) {
            const foundCh = guild.channels?.find(
              (c) => c.name.toLowerCase() === parsedQuery.inChannel?.toLowerCase(),
            );
            if (foundCh) params.set("channelId", foundCh.id);
          }
          endpoint = `${API_BASE}/api/guilds/${guild.id}/messages/search?${params.toString()}`;
        }

        const res = await fetch(endpoint, {
          headers: {
            ...getAuthHeaders(),
          },
        });

        if (res.ok) {
          const data = await res.json();
          setResults(data.messages || []);
          setTotalCount(data.total || 0);
        } else {
          setResults([]);
          setTotalCount(0);
        }
      }
    } catch (err) {
      console.error("Failed to perform message search:", err);
      setResults([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
    }
  };

  const handleAppendFilter = (filterPrefix: string) => {
    setSearchInput((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${filterPrefix}` : filterPrefix;
    });
    inputRef.current?.focus();
  };

  const highlightKeyword = (content: string, keyword: string) => {
    if (!keyword.trim()) return content;
    const parts = content.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase() ? (
        <mark key={i} className="bg-amber-400/30 text-amber-200 px-0.5 rounded font-semibold">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="search-results-drawer"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-discord-sidebar border-l border-[#232428] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
    >
      {/* 顶部标题栏 */}
      <div className="h-12 border-b border-[#232428] px-4 flex items-center justify-between flex-shrink-0 bg-[#2b2d31]">
        <div className="flex items-center space-x-2 text-discord-textHeader font-semibold min-w-0">
          <Search className="w-4 h-4 text-discord-textMuted flex-shrink-0" />
          <span className="text-sm truncate">
            {t("chat:search.resultsTitle", { defaultValue: "搜索结果" })}
          </span>
          {hasSearched && (
            <span className="text-xs text-discord-textMuted font-normal">
              ({totalCount})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-discord-textMuted hover:text-white hover:bg-[#35373c] transition active:scale-95 flex-shrink-0"
          title={t("common:close", { defaultValue: "关闭" })}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 搜索输入与范围选择 */}
      <div className="p-3 border-b border-[#232428] bg-[#2b2d31]/50 space-y-2">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              channel.isE2EE
                ? t("chat:search.e2eePlaceholder", { defaultValue: "在端加密频道中检索..." })
                : t("chat:search.placeholder", { defaultValue: "输入关键词或过滤语法..." })
            }
            className="w-full bg-[#1e1f22] text-sm text-discord-textNormal rounded-md px-3 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-discord-brand placeholder-discord-textMuted"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setResults([]);
                setHasSearched(false);
              }}
              className="absolute right-2 text-discord-textMuted hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 作用域选择与快捷过滤器标签 */}
        {!channel.isE2EE && guild && (
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-discord-textMuted flex-shrink-0">
              {t("chat:search.scope", { defaultValue: "范围:" })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchScope("guild");
                if (hasSearched) performSearch();
              }}
              className={`px-2 py-0.5 rounded transition ${
                searchScope === "guild"
                  ? "bg-discord-brand text-white font-medium"
                  : "text-discord-textMuted hover:text-white hover:bg-[#35373c]"
              }`}
            >
              {guild.name}
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchScope("channel");
                if (hasSearched) performSearch();
              }}
              className={`px-2 py-0.5 rounded transition ${
                searchScope === "channel"
                  ? "bg-discord-brand text-white font-medium"
                  : "text-discord-textMuted hover:text-white hover:bg-[#35373c]"
              }`}
            >
              #{channel.name}
            </button>
          </div>
        )}

        {/* 快捷过滤药丸建议标签 */}
        {!channel.isE2EE && (
          <div className="flex items-center space-x-1.5 overflow-x-auto py-1 scrollbar-none text-[11px] text-discord-textMuted">
            <Filter className="w-3 h-3 flex-shrink-0 opacity-60" />
            <button
              type="button"
              onClick={() => handleAppendFilter("from:")}
              className="px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] hover:text-white transition flex-shrink-0"
            >
              from:
            </button>
            {searchScope === "guild" && (
              <button
                type="button"
                onClick={() => handleAppendFilter("in:")}
                className="px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] hover:text-white transition flex-shrink-0"
              >
                in:
              </button>
            )}
            <button
              type="button"
              onClick={() => handleAppendFilter("has:image")}
              className="px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] hover:text-white transition flex-shrink-0"
            >
              has:image
            </button>
            <button
              type="button"
              onClick={() => handleAppendFilter("has:file")}
              className="px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] hover:text-white transition flex-shrink-0"
            >
              has:file
            </button>
            <button
              type="button"
              onClick={() => handleAppendFilter("pinned:true")}
              className="px-1.5 py-0.5 rounded bg-[#1e1f22] hover:bg-[#35373c] hover:text-white transition flex-shrink-0"
            >
              pinned:true
            </button>
          </div>
        )}
      </div>

      {/* 搜索结果列表区域 */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#232428] p-2 space-y-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-discord-textMuted space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-discord-brand" />
            <span className="text-xs">
              {t("common:loading", { defaultValue: "正在检索..." })}
            </span>
          </div>
        ) : hasSearched && results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-discord-textMuted space-y-3 px-6 text-center">
            <Search className="w-10 h-10 opacity-30" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                {t("chat:search.noResults", { defaultValue: "找不到相符的消息" })}
              </p>
              <p className="text-xs text-discord-textMuted">
                {t("chat:search.noResultsDesc", {
                  defaultValue: "请尝试缩短搜索词，或检查过滤标签拼写。",
                })}
              </p>
            </div>
          </div>
        ) : !hasSearched ? (
          <div className="flex flex-col items-center justify-center py-16 text-discord-textMuted space-y-3 px-6 text-center">
            <Search className="w-10 h-10 opacity-30" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                {t("chat:search.welcomeTitle", { defaultValue: "Discord 消息搜索" })}
              </p>
              <p className="text-xs text-discord-textMuted">
                {t("chat:search.welcomeDesc", {
                  defaultValue: "支持关键词全文搜索及 from:、has: 等高级语法过滤。",
                })}
              </p>
            </div>
          </div>
        ) : (
          results.map((msg) => {
            const authorName = msg.author.displayName || msg.author.username;
            const timeStr = new Date(msg.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const dateStr = new Date(msg.createdAt).toLocaleDateString([], {
              month: "numeric",
              day: "numeric",
            });

            return (
              <div
                key={msg.id}
                onClick={() => onJumpToMessage(msg.channelId, msg.id)}
                className="group p-3 rounded-lg bg-[#2b2d31]/40 hover:bg-[#35373c]/70 transition cursor-pointer border border-transparent hover:border-[#3f4147] space-y-1.5"
              >
                {/* 频道名称与发送日期 */}
                <div className="flex items-center justify-between text-xs text-discord-textMuted">
                  <div className="flex items-center space-x-1 truncate font-medium text-discord-textNormal">
                    {msg.isEncrypted ? (
                      <Lock className="w-3 h-3 text-discord-green shrink-0" />
                    ) : (
                      <Hash className="w-3 h-3 shrink-0" />
                    )}
                    <span className="truncate">{msg.channelName || channel.name}</span>
                  </div>
                  <span className="text-[11px] shrink-0">
                    {dateStr} {timeStr}
                  </span>
                </div>

                {/* 作者信息与正文 */}
                <div className="flex items-start space-x-2.5">
                  {msg.author.avatarUrl ? (
                    <img
                      src={msg.author.avatarUrl}
                      alt={authorName}
                      className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-discord-brand text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      {authorName.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0 space-y-1">
                    <span className="text-xs font-semibold text-white truncate block">
                      {authorName}
                    </span>
                    <p className="text-xs text-discord-textNormal break-words line-clamp-3">
                      {highlightKeyword(msg.content, parsedQuery.cleanQuery)}
                    </p>

                    {/* 附件简略预览 */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex items-center space-x-2 pt-1 text-[11px] text-discord-textMuted">
                        {msg.attachments.some((a) => a.mimeType?.startsWith("image/")) ? (
                          <div className="flex items-center space-x-1">
                            <ImageIcon className="w-3.5 h-3.5 text-discord-brand" />
                            <span>{t("chat:search.imageAttachment", { defaultValue: "图片附件" })}</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1">
                            <FileText className="w-3.5 h-3.5 text-discord-brand" />
                            <span>{t("chat:search.fileAttachment", { defaultValue: "文件附件" })}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 跳转按钮图标 */}
                  <div className="opacity-0 group-hover:opacity-100 transition shrink-0 p-1 rounded bg-[#1e1f22] text-discord-textMuted hover:text-white">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
