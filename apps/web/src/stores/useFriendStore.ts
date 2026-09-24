import { create } from "zustand";
import { Relationship, RelationshipType } from "@tescord/types";
import { API_BASE } from "../config.js";
import { apiFetch } from "../services/apiClient.js";
import { useAuthStore } from "./useAuthStore.js";

export type FriendTab = "online" | "all" | "pending" | "add_friend";

interface FriendState {
  relationships: Relationship[];
  activeTab: FriendTab;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;

  // Actions
  setActiveTab: (tab: FriendTab) => void;
  setSearchQuery: (query: string) => void;
  fetchRelationships: () => Promise<void>;
  sendFriendRequest: (identifier: string) => Promise<Relationship>;
  acceptFriendRequest: (targetUserId: string) => Promise<Relationship>;
  removeRelationship: (targetUserId: string) => Promise<void>;

  // Gateway event handlers
  onRelationshipAdd: (rel: Relationship) => void;
  onRelationshipUpdate: (rel: Relationship) => void;
  onRelationshipRemove: (data: {
    userId: string;
    targetUserId: string;
  }) => void;

  // Getters
  getPendingCount: () => number;
  getOnlineFriends: () => Relationship[];
  getAllFriends: () => Relationship[];
  getPendingIncoming: () => Relationship[];
  getPendingOutgoing: () => Relationship[];
}

export const useFriendStore = create<FriendState>((set, get) => ({
  relationships: [],
  activeTab: "online",
  isLoading: false,
  error: null,
  searchQuery: "",

  setActiveTab: (tab: FriendTab) => set({ activeTab: tab, error: null }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),

  fetchRelationships: async () => {
    set({ isLoading: true, error: null });
    try {
      const headers = useAuthStore.getState().getAuthHeaders();
      const res = await apiFetch(`${API_BASE}/api/users/@me/relationships`, {
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "获取好友列表失败");
      }
      const relationships = (await res.json()) as Relationship[];
      set({ relationships, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  sendFriendRequest: async (identifier: string) => {
    const headers = useAuthStore.getState().getAuthHeaders();
    const res = await apiFetch(`${API_BASE}/api/users/@me/relationships`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ identifier }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "发送好友申请失败");
    }

    const rel = data as Relationship;
    // 乐观/实时插入列表
    set((state) => {
      const existsIndex = state.relationships.findIndex(
        (r) => r.targetUserId === rel.targetUserId,
      );
      if (existsIndex >= 0) {
        const next = [...state.relationships];
        next[existsIndex] = rel;
        return { relationships: next };
      }
      return { relationships: [rel, ...state.relationships] };
    });

    return rel;
  },

  acceptFriendRequest: async (targetUserId: string) => {
    const headers = useAuthStore.getState().getAuthHeaders();
    const res = await apiFetch(
      `${API_BASE}/api/users/@me/relationships/${targetUserId}`,
      {
        method: "PUT",
        headers,
      },
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "接受好友申请失败");
    }

    const rel = data as Relationship;
    set((state) => ({
      relationships: state.relationships.map((r) =>
        r.targetUserId === targetUserId ? rel : r,
      ),
    }));
    return rel;
  },

  removeRelationship: async (targetUserId: string) => {
    const headers = useAuthStore.getState().getAuthHeaders();
    const res = await apiFetch(
      `${API_BASE}/api/users/@me/relationships/${targetUserId}`,
      {
        method: "DELETE",
        headers,
      },
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "操作失败");
    }

    set((state) => ({
      relationships: state.relationships.filter(
        (r) => r.targetUserId !== targetUserId,
      ),
    }));
  },

  onRelationshipAdd: (rel: Relationship) => {
    set((state) => {
      const exists = state.relationships.some(
        (r) => r.targetUserId === rel.targetUserId,
      );
      if (exists) {
        return {
          relationships: state.relationships.map((r) =>
            r.targetUserId === rel.targetUserId ? rel : r,
          ),
        };
      }
      return { relationships: [rel, ...state.relationships] };
    });
  },

  onRelationshipUpdate: (rel: Relationship) => {
    set((state) => ({
      relationships: state.relationships.map((r) =>
        r.targetUserId === rel.targetUserId ? rel : r,
      ),
    }));
  },

  onRelationshipRemove: (data: { userId: string; targetUserId: string }) => {
    set((state) => ({
      relationships: state.relationships.filter(
        (r) =>
          r.targetUserId !== data.targetUserId &&
          r.userId !== data.targetUserId,
      ),
    }));
  },

  getPendingCount: () => {
    return get().relationships.filter((r) => r.type === "PENDING_INCOMING")
      .length;
  },

  getOnlineFriends: () => {
    return get().relationships.filter(
      (r) => r.type === "FRIEND" && r.targetUser?.status !== "OFFLINE",
    );
  },

  getAllFriends: () => {
    return get().relationships.filter((r) => r.type === "FRIEND");
  },

  getPendingIncoming: () => {
    return get().relationships.filter((r) => r.type === "PENDING_INCOMING");
  },

  getPendingOutgoing: () => {
    return get().relationships.filter((r) => r.type === "PENDING_OUTGOING");
  },
}));
