import { create } from "zustand";

interface ChannelNavState {
  userId: string | null;
  lastVisitedChannels: Record<string, string>; // guildId -> channelId
  lastVisitedTextChannels: Record<string, string>; // guildId -> textChannelId

  setUserId: (userId: string | null) => void;
  recordChannelVisit: (guildId: string, channelId: string) => void;
  recordTextChannelVisit: (guildId: string, channelId: string) => void;
  getLastVisitedChannel: (guildId: string) => string | undefined;
  getLastVisitedTextChannel: (guildId: string) => string | undefined;
  removeGuildMemory: (guildId: string) => void;
  clearMemory: () => void;
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

// 尝试在模块装载时预取最后活跃用户的 ID
const getInitialUserId = (): string | null => {
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

  setUserId: (userId: string | null) => {
    const currentUserId = get().userId;
    if (currentUserId === userId) return;
    const loadedChannels = loadMemoryFromStorage(userId);
    const loadedTextChannels = loadMemoryFromStorage(
      userId,
      "tescord_text_channel_memory",
    );
    set({
      userId,
      lastVisitedChannels: loadedChannels,
      lastVisitedTextChannels: loadedTextChannels,
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
    set({
      lastVisitedChannels: currentMemory,
      lastVisitedTextChannels: currentTextMemory,
    });
  },

  clearMemory: () => {
    saveMemoryToStorage(get().userId, {});
    saveMemoryToStorage(get().userId, {}, "tescord_text_channel_memory");
    set({ lastVisitedChannels: {}, lastVisitedTextChannels: {} });
  },
}));
