import { create } from "zustand";

interface ChannelNavState {
  userId: string | null;
  lastVisitedChannels: Record<string, string>; // guildId -> channelId

  setUserId: (userId: string | null) => void;
  recordChannelVisit: (guildId: string, channelId: string) => void;
  getLastVisitedChannel: (guildId: string) => string | undefined;
  removeGuildMemory: (guildId: string) => void;
  clearMemory: () => void;
}

function getStorageKey(userId: string | null): string {
  return userId ? `tescord_channel_memory_${userId}` : "tescord_channel_memory_guest";
}

function loadMemoryFromStorage(userId: string | null): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to load channel memory", e);
  }
  return {};
}

function saveMemoryToStorage(userId: string | null, memory: Record<string, string>) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(getStorageKey(userId), JSON.stringify(memory));
  } catch (e) {
    console.warn("[useChannelNavStore] Failed to save channel memory", e);
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

  setUserId: (userId: string | null) => {
    const currentUserId = get().userId;
    if (currentUserId === userId) return;
    const loaded = loadMemoryFromStorage(userId);
    set({ userId, lastVisitedChannels: loaded });
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

  getLastVisitedChannel: (guildId: string) => {
    if (!guildId) return undefined;
    return get().lastVisitedChannels[guildId];
  },

  removeGuildMemory: (guildId: string) => {
    if (!guildId) return;
    const currentMemory = { ...get().lastVisitedChannels };
    if (guildId in currentMemory) {
      delete currentMemory[guildId];
      saveMemoryToStorage(get().userId, currentMemory);
      set({ lastVisitedChannels: currentMemory });
    }
  },

  clearMemory: () => {
    saveMemoryToStorage(get().userId, {});
    set({ lastVisitedChannels: {} });
  },
}));
