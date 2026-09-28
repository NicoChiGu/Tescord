import { create } from "zustand";
import { Channel, Guild } from "@tescord/types";
import { resolveGuildChannel } from "../utils/channelNavigation";

export interface InitialNavigationState {
  selectedGuildId: string | null;
  selectedChannel: Channel | null;
  isFriendsTabActive: boolean;
}

interface ChannelNavState {
  userId: string | null;
  lastVisitedChannels: Record<string, string>; // guildId -> channelId
  lastVisitedTextChannels: Record<string, string>; // guildId -> textChannelId
  lastSelectedGuildId: string | null | undefined; // undefined: 无记忆, null: 好友/私信, string: 公会ID
  cachedGuilds: Guild[];

  setUserId: (userId: string | null) => void;
  recordChannelVisit: (guildId: string, channelId: string) => void;
  recordTextChannelVisit: (guildId: string, channelId: string) => void;
  getLastVisitedChannel: (guildId: string) => string | undefined;
  getLastVisitedTextChannel: (guildId: string) => string | undefined;
  removeGuildMemory: (guildId: string) => void;
  clearMemory: () => void;

  // 公会最后访问位置记忆与同步加载缓存
  recordLastSelectedGuild: (guildId: string | null) => void;
  getLastSelectedGuild: (userId?: string | null) => string | null | undefined;
  loadCachedGuilds: (userId?: string | null) => Guild[];
  saveCachedGuilds: (guilds: Guild[], userId?: string | null) => void;
  getInitialNavigation: (
    userId?: string | null,
    guilds?: Guild[],
  ) => InitialNavigationState;
}

function getStorageKey(
  userId: string | null,
  prefix = "tescord_channel_memory",
): string {
  return userId ? `${prefix}_${userId}` : `${prefix}_guest`;
}

function loadMemoryFromStorage(
  userId: string | null,
  prefix = "tescord_channel_memory",
): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(getStorageKey(userId, prefix));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch (e) {
    console.warn(
      `[useChannelNavStore] Failed to load channel memory for ${prefix}`,
      e,
    );
  }
  return {};
}

function saveMemoryToStorage(
  userId: string | null,
  memory: Record<string, string>,
  prefix = "tescord_channel_memory",
) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(getStorageKey(userId, prefix), JSON.stringify(memory));
  } catch (e) {
    console.warn(
      `[useChannelNavStore] Failed to save channel memory for ${prefix}`,
      e,
    );
  }
}

function loadLastSelectedGuildFromStorage(
  userId: string | null,
): string | null | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(
      getStorageKey(userId, "tescord_last_guild"),
    );
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed === "string") return parsed;
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to load last selected guild", e);
  }
  return undefined;
}

function saveLastSelectedGuildToStorage(
  userId: string | null,
  guildId: string | null,
) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      getStorageKey(userId, "tescord_last_guild"),
      JSON.stringify(guildId),
    );
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to save last selected guild", e);
  }
}

function loadCachedGuildsFromStorage(userId: string | null): Guild[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(
      getStorageKey(userId, "tescord_guilds_cache"),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as Guild[];
    }
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to load cached guilds", e);
  }
  return [];
}

function saveCachedGuildsToStorage(userId: string | null, guilds: Guild[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      getStorageKey(userId, "tescord_guilds_cache"),
      JSON.stringify(guilds),
    );
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to save cached guilds", e);
  }
}

export function computeInitialNavigation(
  userId: string | null,
  cachedGuilds: Guild[],
  lastSelectedGuildId: string | null | undefined,
  getLastVisitedChannel: (guildId: string) => string | undefined,
): InitialNavigationState {
  // 1. 若显式记录为 null，代表用户最后停留在私信/好友主页视图
  if (lastSelectedGuildId === null) {
    return {
      selectedGuildId: null,
      selectedChannel: null,
      isFriendsTabActive: true,
    };
  }

  // 2. 若记忆了具体的公会 ID，且本地缓存中依然存在该公会
  if (typeof lastSelectedGuildId === "string" && cachedGuilds.length > 0) {
    const targetGuild = cachedGuilds.find((g) => g.id === lastSelectedGuildId);
    if (targetGuild) {
      const lastChannelId = getLastVisitedChannel(targetGuild.id);
      const targetChannel = resolveGuildChannel(
        targetGuild,
        lastChannelId,
        true,
      );
      return {
        selectedGuildId: targetGuild.id,
        selectedChannel: targetChannel,
        isFriendsTabActive: false,
      };
    }
  }

  // 3. 首次启动或记忆的公会已被移除：若有公会则进入第 1 个公会，无公会则进入好友主页
  if (cachedGuilds.length > 0) {
    const firstGuild = cachedGuilds[0];
    const lastChannelId = getLastVisitedChannel(firstGuild.id);
    const targetChannel = resolveGuildChannel(firstGuild, lastChannelId, true);
    return {
      selectedGuildId: firstGuild.id,
      selectedChannel: targetChannel,
      isFriendsTabActive: false,
    };
  }

  return {
    selectedGuildId: null,
    selectedChannel: null,
    isFriendsTabActive: true,
  };
}

// 尝试在模块装载时预取最后活跃用户的 ID
export const getInitialUserId = (): string | null => {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("tescord_last_user");
      if (raw) {
        const u = JSON.parse(raw);
        if (u && typeof u.id === "string") {
          return u.id;
        }
      }
    }
  } catch {
    // 忽略异常
  }
  return null;
};

const initialUserId = getInitialUserId();

export const useChannelNavStore = create<ChannelNavState>((set, get) => ({
  userId: initialUserId,
  lastVisitedChannels: loadMemoryFromStorage(initialUserId),
  lastVisitedTextChannels: loadMemoryFromStorage(
    initialUserId,
    "tescord_text_channel_memory",
  ),
  lastSelectedGuildId: loadLastSelectedGuildFromStorage(initialUserId),
  cachedGuilds: loadCachedGuildsFromStorage(initialUserId),

  setUserId: (userId: string | null) => {
    const currentUserId = get().userId;
    if (currentUserId === userId) return;
    const loadedChannels = loadMemoryFromStorage(userId);
    const loadedTextChannels = loadMemoryFromStorage(
      userId,
      "tescord_text_channel_memory",
    );
    const loadedLastSelectedGuild = loadLastSelectedGuildFromStorage(userId);
    const loadedCachedGuilds = loadCachedGuildsFromStorage(userId);
    set({
      userId,
      lastVisitedChannels: loadedChannels,
      lastVisitedTextChannels: loadedTextChannels,
      lastSelectedGuildId: loadedLastSelectedGuild,
      cachedGuilds: loadedCachedGuilds,
    });
  },

  recordChannelVisit: (guildId: string, channelId: string) => {
    if (!guildId || !channelId) return;
    const currentMemory = get().lastVisitedChannels;
    if (currentMemory[guildId] === channelId) return;

    const updated = {
      ...currentMemory,
      [guildId]: channelId,
    };
    saveMemoryToStorage(get().userId, updated);
    set({ lastVisitedChannels: updated });
  },

  recordTextChannelVisit: (guildId: string, channelId: string) => {
    if (!guildId || !channelId) return;
    const currentMemory = get().lastVisitedTextChannels;
    if (currentMemory[guildId] === channelId) return;

    const updated = {
      ...currentMemory,
      [guildId]: channelId,
    };
    saveMemoryToStorage(get().userId, updated, "tescord_text_channel_memory");
    set({ lastVisitedTextChannels: updated });
  },

  getLastVisitedChannel: (guildId: string) => {
    if (!guildId) return undefined;
    return get().lastVisitedChannels[guildId];
  },

  getLastVisitedTextChannel: (guildId: string) => {
    if (!guildId) return undefined;
    return get().lastVisitedTextChannels[guildId];
  },

  recordLastSelectedGuild: (guildId: string | null) => {
    const userId = get().userId;
    saveLastSelectedGuildToStorage(userId, guildId);
    set({ lastSelectedGuildId: guildId });
  },

  getLastSelectedGuild: (userId?: string | null) => {
    const targetUserId = userId !== undefined ? userId : get().userId;
    return loadLastSelectedGuildFromStorage(targetUserId);
  },

  loadCachedGuilds: (userId?: string | null) => {
    const targetUserId = userId !== undefined ? userId : get().userId;
    return loadCachedGuildsFromStorage(targetUserId);
  },

  saveCachedGuilds: (guilds: Guild[], userId?: string | null) => {
    const targetUserId = userId !== undefined ? userId : get().userId;
    saveCachedGuildsToStorage(targetUserId, guilds);
    set({ cachedGuilds: guilds });
  },

  getInitialNavigation: (
    userId?: string | null,
    guilds?: Guild[],
  ): InitialNavigationState => {
    const targetUserId = userId !== undefined ? userId : get().userId;
    const effectiveGuilds =
      guilds !== undefined ? guilds : loadCachedGuildsFromStorage(targetUserId);
    const lastGuildId = loadLastSelectedGuildFromStorage(targetUserId);
    return computeInitialNavigation(
      targetUserId,
      effectiveGuilds,
      lastGuildId,
      (gId) => get().getLastVisitedChannel(gId),
    );
  },

  removeGuildMemory: (guildId: string) => {
    if (!guildId) return;
    const currentMemory = { ...get().lastVisitedChannels };
    const currentTextMemory = { ...get().lastVisitedTextChannels };
    if (guildId in currentMemory) {
      delete currentMemory[guildId];
      saveMemoryToStorage(get().userId, currentMemory);
    }
    if (guildId in currentTextMemory) {
      delete currentTextMemory[guildId];
      saveMemoryToStorage(
        get().userId,
        currentTextMemory,
        "tescord_text_channel_memory",
      );
    }
    const updatePayload: Partial<ChannelNavState> = {
      lastVisitedChannels: currentMemory,
      lastVisitedTextChannels: currentTextMemory,
    };
    if (get().lastSelectedGuildId === guildId) {
      saveLastSelectedGuildToStorage(get().userId, null);
      updatePayload.lastSelectedGuildId = null;
    }
    // 同步从缓存公会列表中移除该公会
    const currentCached = get().cachedGuilds;
    if (currentCached.some((g) => g.id === guildId)) {
      const updatedCached = currentCached.filter((g) => g.id !== guildId);
      saveCachedGuildsToStorage(get().userId, updatedCached);
      updatePayload.cachedGuilds = updatedCached;
    }
    set(updatePayload as ChannelNavState);
  },

  clearMemory: () => {
    const userId = get().userId;
    saveMemoryToStorage(userId, {});
    saveMemoryToStorage(userId, {}, "tescord_text_channel_memory");
    saveLastSelectedGuildToStorage(userId, null);
    saveCachedGuildsToStorage(userId, []);
    set({
      lastVisitedChannels: {},
      lastVisitedTextChannels: {},
      lastSelectedGuildId: null,
      cachedGuilds: [],
    });
  },
}));
