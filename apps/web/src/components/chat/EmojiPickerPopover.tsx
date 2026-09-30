import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Clock,
  Smile,
  Trees,
  Utensils,
  Gamepad2,
  Plane,
  Lightbulb,
  Hash,
  Flag,
  Server,
  User,
  X,
} from "lucide-react";
import { UNICODE_EMOJIS, EmojiItem } from "../../utils/emojiData.js";
import { useEmojiStore } from "../../stores/useEmojiStore.js";
import { resolveServerUrl } from "../../config.js";
import { CustomEmoji } from "@tescord/types";

interface EmojiPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  guildId?: string;
}

type HoveredEmoji =
  | { type: "unicode"; item: EmojiItem }
  | { type: "custom"; item: CustomEmoji }
  | null;

export const EmojiPickerPopover: React.FC<EmojiPickerPopoverProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  guildId,
}) => {
  const { t } = useTranslation(["chat", "common", "contextMenu"]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredEmoji, setHoveredEmoji] = useState<HoveredEmoji>(null);

  const {
    guildEmojis,
    userEmojis,
    recentEmojis,
    fetchGuildEmojis,
    fetchUserEmojis,
    addRecentEmoji,
  } = useEmojiStore();

  const currentGuildEmojis = guildId ? guildEmojis[guildId] || [] : [];

  // 打开时聚焦搜索框并按需拉取自定义表情
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setHoveredEmoji(null);
      return;
    }
    if (guildId) {
      void fetchGuildEmojis(guildId);
    }
    void fetchUserEmojis();

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, guildId, fetchGuildEmojis, fetchUserEmojis]);

  // 点击外部和 ESC 关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 搜索过滤
  const filteredUnicodeEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return UNICODE_EMOJIS;
    return UNICODE_EMOJIS.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  const filteredGuildEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentGuildEmojis;
    return currentGuildEmojis.filter((item) =>
      item.name.toLowerCase().includes(q),
    );
  }, [currentGuildEmojis, searchQuery]);

  const filteredUserEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return userEmojis;
    return userEmojis.filter((item) => item.name.toLowerCase().includes(q));
  }, [userEmojis, searchQuery]);

  // 最近使用的表情对应实体
  const recentEmojiItems = useMemo(() => {
    if (searchQuery) return [];
    return recentEmojis
      .map((code) => {
        // 尝试匹配自定义表情 <a?:name:id>
        const customMatch = code.match(/^<a?:([a-zA-Z0-9_]+):([a-zA-Z0-9_-]+)>/);
        if (customMatch) {
          const id = customMatch[2];
          const found =
            currentGuildEmojis.find((e) => e.id === id) ||
            userEmojis.find((e) => e.id === id);
          if (found) {
            return { type: "custom" as const, item: found, raw: code };
          }
        }
        // 匹配 Unicode 表情
        const unicodeFound = UNICODE_EMOJIS.find((e) => e.emoji === code);
        if (unicodeFound) {
          return { type: "unicode" as const, item: unicodeFound, raw: code };
        }
        return {
          type: "unicode" as const,
          item: { emoji: code, name: code, category: "people" as const, keywords: [] },
          raw: code,
        };
      })
      .slice(0, 18);
  }, [recentEmojis, searchQuery, currentGuildEmojis, userEmojis]);

  // 类别映射
  const categoryGroups = useMemo(() => {
    const map: Record<string, EmojiItem[]> = {
      people: [],
      nature: [],
      food: [],
      activities: [],
      travel: [],
      objects: [],
      symbols: [],
      flags: [],
    };
    filteredUnicodeEmojis.forEach((emoji) => {
      if (map[emoji.category]) {
        map[emoji.category].push(emoji);
      }
    });
    return map;
  }, [filteredUnicodeEmojis]);

  // 点击选择表情
  const handleSelect = (code: string) => {
    addRecentEmoji(code);
    onSelectEmoji(code);
    onClose();
  };

  // 滚动定位到指定分类锚点
  const scrollToCategory = (categoryId: string) => {
    const el = document.getElementById(`emoji-cat-${categoryId}`);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      data-testid="emoji-picker-popover"
      className="absolute bottom-full right-0 mb-2 z-50 bg-[#2b2d31] border border-[#383a40] rounded-2xl shadow-2xl w-[23.5rem] sm:w-[27rem] max-w-[95vw] h-[30rem] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-none text-gray-200"
    >
      {/* 顶部搜索框 */}
      <div className="p-3 border-b border-[#1f2023] bg-[#232428] shrink-0">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("chat:searchEmoji", { defaultValue: "搜索表情..." })}
            className="w-full bg-[#1e1f22] text-sm text-white placeholder-gray-400 pl-9 pr-8 py-1.5 rounded-lg border border-[#3f4147] focus:outline-none focus:border-[#5865f2] transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 分类快捷导航栏 */}
      {!searchQuery && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#232428] border-b border-[#1f2023] shrink-0 text-gray-400 overflow-x-auto no-scrollbar gap-1">
          {recentEmojiItems.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory("recent")}
              title={t("chat:emojiCategoryRecent", { defaultValue: "常用" })}
              className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
            >
              <Clock className="w-4 h-4" />
            </button>
          )}
          {currentGuildEmojis.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory("server")}
              title={t("chat:emojiCategoryServer", { defaultValue: "服务器表情" })}
              className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
            >
              <Server className="w-4 h-4" />
            </button>
          )}
          {userEmojis.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory("user")}
              title={t("chat:emojiCategoryUser", { defaultValue: "个人表情" })}
              className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
            >
              <User className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollToCategory("people")}
            title={t("chat:emojiCategoryPeople", { defaultValue: "人物与笑脸" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Smile className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("nature")}
            title={t("chat:emojiCategoryNature", { defaultValue: "动物与自然" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Trees className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("food")}
            title={t("chat:emojiCategoryFood", { defaultValue: "食物与饮料" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Utensils className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("activities")}
            title={t("chat:emojiCategoryActivities", { defaultValue: "活动与运动" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Gamepad2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("travel")}
            title={t("chat:emojiCategoryTravel", { defaultValue: "旅行与地点" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Plane className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("objects")}
            title={t("chat:emojiCategoryObjects", { defaultValue: "物体与工具" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Lightbulb className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("symbols")}
            title={t("chat:emojiCategorySymbols", { defaultValue: "符号与标记" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Hash className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToCategory("flags")}
            title={t("chat:emojiCategoryFlags", { defaultValue: "旗帜" })}
            className="p-1 hover:text-white hover:bg-white/10 rounded-md transition"
          >
            <Flag className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 表情滚动展示列表 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-4 custom-scrollbar min-h-0"
      >
        {/* 1. 最近使用 */}
        {!searchQuery && recentEmojiItems.length > 0 && (
          <div id="emoji-cat-recent">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{t("chat:emojiCategoryRecent", { defaultValue: "常用" })}</span>
            </div>
            <div className="grid grid-cols-8 sm:grid-cols-9 gap-1">
              {recentEmojiItems.map((item, idx) => {
                if (item.type === "custom") {
                  return (
                    <button
                      key={`recent-c-${item.item.id}-${idx}`}
                      onClick={() => handleSelect(item.raw)}
                      onMouseEnter={() =>
                        setHoveredEmoji({ type: "custom", item: item.item })
                      }
                      onMouseLeave={() => setHoveredEmoji(null)}
                      className="aspect-square w-full flex items-center justify-center hover:bg-white/10 rounded-lg transition active:scale-95"
                    >
                      <img
                        src={resolveServerUrl(item.item.imageUrl)}
                        alt={item.item.name}
                        className="w-6 h-6 object-contain"
                        loading="lazy"
                      />
                    </button>
                  );
                }
                return (
                  <button
                    key={`recent-u-${item.item.emoji}-${idx}`}
                    onClick={() => handleSelect(item.item.emoji)}
                    onMouseEnter={() =>
                      setHoveredEmoji({ type: "unicode", item: item.item })
                    }
                    onMouseLeave={() => setHoveredEmoji(null)}
                    className="aspect-square w-full flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition hover:scale-125 active:scale-95"
                  >
                    {item.item.emoji}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 当前服务器自定义表情 */}
        {filteredGuildEmojis.length > 0 && (
          <div id="emoji-cat-server">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" />
              <span>
                {t("chat:emojiCategoryServer", { defaultValue: "服务器表情" })}
              </span>
              <span className="text-[10px] text-gray-400">
                ({filteredGuildEmojis.length})
              </span>
            </div>
            <div className="grid grid-cols-8 sm:grid-cols-9 gap-1">
              {filteredGuildEmojis.map((emoji) => {
                const tag = emoji.animated
                  ? `<a:${emoji.name}:${emoji.id}>`
                  : `<:${emoji.name}:${emoji.id}>`;
                return (
                  <button
                    key={emoji.id}
                    onClick={() => handleSelect(tag)}
                    onMouseEnter={() =>
                      setHoveredEmoji({ type: "custom", item: emoji })
                    }
                    onMouseLeave={() => setHoveredEmoji(null)}
                    className="aspect-square w-full flex items-center justify-center hover:bg-white/10 rounded-lg transition active:scale-95"
                  >
                    <img
                      src={resolveServerUrl(emoji.imageUrl)}
                      alt={emoji.name}
                      className="w-6 h-6 object-contain"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. 用户个人自定义表情 */}
        {filteredUserEmojis.length > 0 && (
          <div id="emoji-cat-user">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              <span>
                {t("chat:emojiCategoryUser", { defaultValue: "个人表情" })}
              </span>
              <span className="text-[10px] text-gray-400">
                ({filteredUserEmojis.length})
              </span>
            </div>
            <div className="grid grid-cols-8 sm:grid-cols-9 gap-1">
              {filteredUserEmojis.map((emoji) => {
                const tag = emoji.animated
                  ? `<a:${emoji.name}:${emoji.id}>`
                  : `<:${emoji.name}:${emoji.id}>`;
                return (
                  <button
                    key={emoji.id}
                    onClick={() => handleSelect(tag)}
                    onMouseEnter={() =>
                      setHoveredEmoji({ type: "custom", item: emoji })
                    }
                    onMouseLeave={() => setHoveredEmoji(null)}
                    className="aspect-square w-full flex items-center justify-center hover:bg-white/10 rounded-lg transition active:scale-95"
                  >
                    <img
                      src={resolveServerUrl(emoji.imageUrl)}
                      alt={emoji.name}
                      className="w-6 h-6 object-contain"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Unicode 表情分类展示 */}
        {[
          { id: "people", labelKey: "chat:emojiCategoryPeople", label: "人物与笑脸" },
          { id: "nature", labelKey: "chat:emojiCategoryNature", label: "动物与自然" },
          { id: "food", labelKey: "chat:emojiCategoryFood", label: "食物与饮料" },
          { id: "activities", labelKey: "chat:emojiCategoryActivities", label: "活动与运动" },
          { id: "travel", labelKey: "chat:emojiCategoryTravel", label: "旅行与地点" },
          { id: "objects", labelKey: "chat:emojiCategoryObjects", label: "物体与工具" },
          { id: "symbols", labelKey: "chat:emojiCategorySymbols", label: "符号与标记" },
          { id: "flags", labelKey: "chat:emojiCategoryFlags", label: "旗帜" },
        ].map((cat) => {
          const list = categoryGroups[cat.id] || [];
          if (list.length === 0) return null;
          return (
            <div key={cat.id} id={`emoji-cat-${cat.id}`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                {t(cat.labelKey, { defaultValue: cat.label })}
              </div>
              <div className="grid grid-cols-8 sm:grid-cols-9 gap-1">
                {list.map((emoji) => (
                  <button
                    key={emoji.emoji}
                    onClick={() => handleSelect(emoji.emoji)}
                    onMouseEnter={() =>
                      setHoveredEmoji({ type: "unicode", item: emoji })
                    }
                    onMouseLeave={() => setHoveredEmoji(null)}
                    className="aspect-square w-full flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition hover:scale-125 active:scale-95"
                  >
                    {emoji.emoji}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* 空搜索结果 */}
        {searchQuery &&
          filteredUnicodeEmojis.length === 0 &&
          filteredGuildEmojis.length === 0 &&
          filteredUserEmojis.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <span className="text-3xl mb-2">🔍</span>
              <p className="text-xs">
                {t("chat:noEmojisFound", { defaultValue: "未找到匹配的表情" })}
              </p>
            </div>
          )}
      </div>

      {/* 底部悬浮信息与大图预览栏 (类 Discord 经典底部) */}
      <div className="h-12 border-t border-[#1f2023] bg-[#232428] px-3 flex items-center gap-3 shrink-0">
        {hoveredEmoji ? (
          <>
            <div className="w-8 h-8 flex items-center justify-center bg-[#1e1f22] rounded-lg shrink-0 border border-[#383a40]">
              {hoveredEmoji.type === "unicode" ? (
                <span className="text-2xl">{hoveredEmoji.item.emoji}</span>
              ) : (
                <img
                  src={resolveServerUrl(hoveredEmoji.item.imageUrl)}
                  alt={hoveredEmoji.item.name}
                  className="w-7 h-7 object-contain"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">
                :{hoveredEmoji.item.name}:
              </div>
              <div className="text-[10px] text-gray-400 truncate">
                {hoveredEmoji.type === "unicode"
                  ? hoveredEmoji.item.category
                  : hoveredEmoji.item.animated
                    ? "GIF 动图表情"
                    : t("chat:customEmojiDesc", { defaultValue: "自定义表情" })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <Smile className="w-4 h-4" />
            <span>{t("chat:selectEmoji", { defaultValue: "选择表情" })}</span>
          </div>
        )}
      </div>
    </div>
  );
};
