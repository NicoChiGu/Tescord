import { openDB, DBSchema, IDBPDatabase } from "idb";
import {
  IStorageAdapter,
  Message,
  ChannelMetaRecord,
  SavedAccount,
  StoredActiveTokens,
  StorageChannelSnapshot,
  StorageSearchMessagesQuery,
  StorageStats,
  User,
} from "@tescord/types";

interface TescordDB extends DBSchema {
  messages: {
    key: string;
    value: Message;
    indexes: {
      by_channel: string;
      by_channel_sequence: [string, number];
      by_created_at: string;
    };
  };
  channel_meta: {
    key: string;
    value: ChannelMetaRecord;
  };
}

const DB_VERSION = 1;
const MAX_MESSAGES_PER_CHANNEL = 500;
const ACCESS_KEY = "tescord_access_token";
const REFRESH_KEY = "tescord_refresh_token";
const SAVED_ACCOUNTS_KEY = "tescord_saved_accounts";

export class IndexedDBStorageAdapter implements IStorageAdapter {
  private currentUserId: string | null = null;
  private dbPromise: Promise<IDBPDatabase<TescordDB>> | null = null;
  private metaCache = new Map<string, ChannelMetaRecord>();

  public async switchUser(userId: string | null): Promise<void> {
    this.metaCache.clear();
    if (this.currentUserId === userId && this.dbPromise) return;
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        db.close();
      } catch {}
      this.dbPromise = null;
    }
    this.currentUserId = userId;
  }

  private async getDB(): Promise<IDBPDatabase<TescordDB>> {
    if (!this.dbPromise) {
      const dbName = this.currentUserId
        ? `tescord-client-db-${this.currentUserId}`
        : "tescord-client-db-guest";

      this.dbPromise = openDB<TescordDB>(dbName, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("messages")) {
            const messageStore = db.createObjectStore("messages", {
              keyPath: "id",
            });
            messageStore.createIndex("by_channel", "channelId");
            messageStore.createIndex("by_channel_sequence", [
              "channelId",
              "sequence",
            ]);
            messageStore.createIndex("by_created_at", "createdAt");
          }
          if (!db.objectStoreNames.contains("channel_meta")) {
            db.createObjectStore("channel_meta", {
              keyPath: "channelId",
            });
          }
        },
      });
    }
    return this.dbPromise;
  }

  // 1. Preferences
  async getPreference<T = any>(key: string): Promise<T | null> {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  async setPreference<T = any>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn("[IndexedDBStorageAdapter] setPreference failed:", err);
    }
  }

  async removePreference(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  // 2. Accounts & Tokens
  async getSavedAccounts(): Promise<SavedAccount[]> {
    try {
      const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list;
      }
      return [];
    } catch {
      return [];
    }
  }

  async saveSavedAccounts(accounts: SavedAccount[]): Promise<void> {
    try {
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch (err) {
      console.warn("[IndexedDBStorageAdapter] saveSavedAccounts failed:", err);
    }
  }

  async getActiveTokens(): Promise<StoredActiveTokens | null> {
    try {
      const access =
        sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY);
      const refresh =
        sessionStorage.getItem(REFRESH_KEY) ||
        localStorage.getItem(REFRESH_KEY);
      const userRaw = localStorage.getItem("tescord_last_user");
      if (!access || !refresh) return null;
      return {
        accessToken: access,
        refreshToken: refresh,
        user: userRaw ? JSON.parse(userRaw) : ({} as User),
        remember: Boolean(localStorage.getItem(ACCESS_KEY)),
        updatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  async setActiveTokens(
    tokens: { accessToken: string; refreshToken: string; user: User },
    remember: boolean,
  ): Promise<void> {
    try {
      if (remember) {
        localStorage.setItem(ACCESS_KEY, tokens.accessToken);
        sessionStorage.removeItem(ACCESS_KEY);
        localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
        sessionStorage.removeItem(REFRESH_KEY);
      } else {
        sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
        localStorage.removeItem(ACCESS_KEY);
        sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
        localStorage.removeItem(REFRESH_KEY);
      }
      if (tokens.user) {
        localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));
      }
    } catch (err) {
      console.warn("[IndexedDBStorageAdapter] setActiveTokens failed:", err);
    }
  }

  async clearActiveTokens(): Promise<void> {
    try {
      localStorage.removeItem(ACCESS_KEY);
      sessionStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
    } catch {}
  }

  // 3. Messages & Meta
  async saveMessages(channelId: string, messages: Message[]): Promise<void> {
    if (!messages || messages.length === 0) return;
    try {
      const db = await this.getDB();
      const tx = db.transaction(["messages"], "readwrite");
      const store = tx.objectStore("messages");

      for (const msg of messages) {
        if (!msg.channelId) {
          msg.channelId = channelId;
        }
        await store.put(msg);
      }
      await tx.done;

      // 容量淘汰
      this.pruneChannelMessages(channelId).catch(() => {});
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] saveMessages failed:", err);
    }
  }

  async saveMessage(msg: Message): Promise<void> {
    if (!msg || !msg.channelId) return;
    try {
      const db = await this.getDB();
      await db.put("messages", msg);
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] saveMessage failed:", err);
    }
  }

  async getLatestMessages(channelId: string, limit = 100): Promise<Message[]> {
    try {
      const db = await this.getDB();
      const index = db
        .transaction("messages", "readonly")
        .objectStore("messages")
        .index("by_channel");

      const all = await index.getAll(channelId);
      if (!all || all.length === 0) return [];
      all.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      return all.length > limit ? all.slice(all.length - limit) : all;
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] getLatestMessages failed:", err);
      return [];
    }
  }

  async getChannelSnapshot(
    channelId: string,
    limit = 100,
  ): Promise<StorageChannelSnapshot> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(["messages", "channel_meta"], "readonly");
      const msgStore = tx.objectStore("messages");
      const metaStore = tx.objectStore("channel_meta");

      const [all, meta] = await Promise.all([
        msgStore.index("by_channel").getAll(channelId),
        metaStore.get(channelId),
      ]);
      await tx.done;

      const sorted = [...(all || [])].sort(
        (a, b) => (a.sequence || 0) - (b.sequence || 0),
      );
      const messages =
        sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;

      return {
        messages,
        meta: meta || {
          channelId,
          lastReadSequence: 0,
          scrollTop: 0,
          isNearBottom: true,
          lastVisitedAt: Date.now(),
        },
      };
    } catch (err) {
      console.error(
        "[IndexedDBStorageAdapter] getChannelSnapshot failed:",
        err,
      );
      return {
        messages: [],
        meta: {
          channelId,
          lastReadSequence: 0,
          scrollTop: 0,
          isNearBottom: true,
          lastVisitedAt: Date.now(),
        },
      };
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete("messages", messageId);
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] deleteMessage failed:", err);
    }
  }

  async saveChannelMeta(
    channelId: string,
    meta: Partial<ChannelMetaRecord>,
  ): Promise<void> {
    const cached = this.metaCache.get(channelId) || {
      channelId,
      lastReadSequence: 0,
      scrollTop: 0,
      isNearBottom: true,
      lastVisitedAt: Date.now(),
    };
    const updated: ChannelMetaRecord = {
      ...cached,
      ...meta,
      channelId,
      lastVisitedAt: Date.now(),
    };
    this.metaCache.set(channelId, updated);

    try {
      const db = await this.getDB();
      await db.put("channel_meta", updated);
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] saveChannelMeta failed:", err);
    }
  }

  async getChannelMeta(channelId: string): Promise<ChannelMetaRecord | null> {
    if (this.metaCache.has(channelId)) {
      return this.metaCache.get(channelId)!;
    }
    try {
      const db = await this.getDB();
      const data = await db.get("channel_meta", channelId);
      if (data) {
        this.metaCache.set(channelId, data);
      }
      return data || null;
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] getChannelMeta failed:", err);
      return null;
    }
  }

  async clearChannel(channelId: string): Promise<void> {
    try {
      const db = await this.getDB();
      const index = db
        .transaction("messages", "readonly")
        .objectStore("messages")
        .index("by_channel");
      const all = await index.getAll(channelId);
      const tx = db.transaction("messages", "readwrite");
      for (const m of all) {
        await tx.objectStore("messages").delete(m.id);
      }
      await tx.done;
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] clearChannel failed:", err);
    }
  }

  async clearAllMessages(): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(["messages", "channel_meta"], "readwrite");
      await tx.objectStore("messages").clear();
      await tx.objectStore("channel_meta").clear();
      await tx.done;
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] clearAllMessages failed:", err);
    }
  }

  async searchMessages(query: StorageSearchMessagesQuery): Promise<Message[]> {
    const { keyword, channelId, limit = 50 } = query;
    if (!keyword) return [];
    try {
      const db = await this.getDB();
      const all = await db.getAll("messages");
      const lower = keyword.toLowerCase();
      const filtered = all.filter((m) => {
        if (channelId && m.channelId !== channelId) return false;
        return m.content && m.content.toLowerCase().includes(lower);
      });
      return filtered.slice(0, limit);
    } catch (err) {
      console.error("[IndexedDBStorageAdapter] searchMessages failed:", err);
      return [];
    }
  }

  async getStorageStats(): Promise<StorageStats> {
    return {
      adapterType: "indexeddb",
      isEncryptionAvailable: false,
    };
  }

  private async pruneChannelMessages(channelId: string): Promise<void> {
    const db = await this.getDB();
    const index = db
      .transaction("messages", "readonly")
      .objectStore("messages")
      .index("by_channel");
    const all = await index.getAll(channelId);
    if (all.length <= MAX_MESSAGES_PER_CHANNEL) return;

    all.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const toDelete = all.slice(0, all.length - MAX_MESSAGES_PER_CHANNEL);
    const tx = db.transaction("messages", "readwrite");
    for (const m of toDelete) {
      await tx.objectStore("messages").delete(m.id);
    }
    await tx.done;
  }
}
