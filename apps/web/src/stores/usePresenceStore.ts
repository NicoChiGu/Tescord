import { create } from "zustand";
import { UserPresence, UserStatus } from "@tescord/types";

export interface UserPresenceState {
  status: UserStatus;
  customStatus?: string | null;
  activities?: UserPresence["activities"];
  clientStatus?: UserPresence["clientStatus"];
  lastActiveAt?: string;
}

interface PresenceStore {
  /** 核心字典：userId -> UserPresenceState */
  presences: Record<string, UserPresenceState>;

  /** 单个用户状态更新 */
  setPresence: (userId: string, presence: Partial<UserPresenceState>) => void;

  /** 批量更新用户状态 */
  batchSetPresences: (
    items:
      | Record<string, Partial<UserPresenceState>>
      | Map<string, Partial<UserPresenceState>>
      | Array<{ userId: string } & Partial<UserPresenceState>>,
  ) => void;

  /** 获取特定用户的实时在线状态（带降级兜底） */
  getUserStatus: (userId: string, fallback?: UserStatus) => UserStatus;

  /** 获取特定用户的完整瞬时状态 */
  getUserPresence: (userId: string) => UserPresenceState | undefined;

  /** 清空所有状态（退出登录时使用） */
  clearPresences: () => void;
}

function mergePresence(
  prev?: UserPresenceState,
  incoming: Partial<UserPresenceState> = {},
): UserPresenceState {
  return {
    status: incoming.status ?? prev?.status ?? "OFFLINE",
    customStatus:
      incoming.customStatus !== undefined
        ? incoming.customStatus
        : prev?.customStatus,
    activities:
      incoming.activities !== undefined
        ? incoming.activities
        : prev?.activities,
    clientStatus: incoming.clientStatus ?? prev?.clientStatus,
    lastActiveAt: incoming.lastActiveAt ?? prev?.lastActiveAt,
  };
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  presences: {},

  setPresence: (userId, partialPresence) => {
    if (!userId) return;
    set((state) => {
      const prev = state.presences[userId];
      return {
        presences: {
          ...state.presences,
          [userId]: mergePresence(prev, partialPresence),
        },
      };
    });
  },

  batchSetPresences: (items) => {
    set((state) => {
      const next = { ...state.presences };
      if (items instanceof Map) {
        for (const [userId, p] of items.entries()) {
          if (!userId) continue;
          next[userId] = mergePresence(next[userId], p);
        }
      } else if (Array.isArray(items)) {
        for (const item of items) {
          if (!item.userId) continue;
          const { userId, ...p } = item;
          next[userId] = mergePresence(next[userId], p);
        }
      } else if (typeof items === "object" && items !== null) {
        for (const [userId, p] of Object.entries(items)) {
          if (!userId) continue;
          next[userId] = mergePresence(next[userId], p);
        }
      }
      return { presences: next };
    });
  },

  getUserStatus: (userId, fallback = "OFFLINE") => {
    if (!userId) return fallback;
    const p = get().presences[userId];
    return p?.status || fallback;
  },

  getUserPresence: (userId) => {
    if (!userId) return undefined;
    return get().presences[userId];
  },

  clearPresences: () => set({ presences: {} }),
}));
