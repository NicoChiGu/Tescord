import { openDB, DBSchema, IDBPDatabase } from "idb";
import { Message, ChannelMetaRecord } from "@tescord/types";

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
const MAX_MESSAGES_PER_CHANNEL = 300;

class MessageDbService {
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

  public async close(): Promise<void> {
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        db.close();
      } catch {}
      this.dbPromise = null;
    }
  }

  private async getDB(): Promise<IDBPDatabase<TescordDB>> {
    if (!this.dbPromise) {
      const dbName = this.currentUserId
        ? `tescord-client-db-${this.currentUserId}`
        : "tescord-client-db-guest";

      this.dbPromise = openDB<TescordDB>(dbName, DB_VERSION, {
        upgrade(db) {
          // 消息存储仓库
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

          // 频道元数据存储仓库 (记录已读游标、滚动坐标等)
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

  /**
   * 批量保存或更新频道消息，并自动执行单频道 300 条 LRU 淘汰
   */
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

      // 异步执行容量超额淘汰（保留最新 MAX_MESSAGES_PER_CHANNEL 条）
      this.pruneChannelMessages(channelId).catch((err) =>
        console.warn("[MessageDB] Prune failed:", err),
      );
    } catch (err) {
      console.error("[MessageDB] Failed to save messages:", err);
    }
  }

  /**
   * 单条保存或覆盖消息（如网关实时到达的新消息）
   */
  async saveMessage(msg: Message): Promise<void> {
    if (!msg || !msg.channelId) return;
    try {
      const db = await this.getDB();
      await db.put("messages", msg);
    } catch (err) {
      console.error("[MessageDB] Failed to save single message:", err);
    }
  }

  /**
   * 从本地 IndexedDB 取出该频道最新的 N 条消息（默认 100 条，升序排列）
   */
  async getLatestMessages(channelId: string, limit = 100): Promise<Message[]> {
    try {
      const db = await this.getDB();
      const index = db
        .transaction("messages", "readonly")
        .objectStore("messages")
        .index("by_channel");

      const allChannelMessages = await index.getAll(channelId);
      if (!allChannelMessages || allChannelMessages.length === 0) {
        return [];
      }

      // 按 sequence 升序排序
      allChannelMessages.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

      // 若超出 limit，截取最新的 limit 条
      if (allChannelMessages.length > limit) {
        return allChannelMessages.slice(allChannelMessages.length - limit);
      }
      return allChannelMessages;
    } catch (err) {
      console.error("[MessageDB] Failed to read messages:", err);
      return [];
    }
  }

  /**
   * 在单一只读事务中原子化获取频道的离线消息快照与元数据
   */
  async getChannelSnapshot(
    channelId: string,
    limit = 100,
  ): Promise<{
    messages: Message[];
    meta: ChannelMetaRecord;
  }> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(["messages", "channel_meta"], "readonly");
      const msgStore = tx.objectStore("messages");
      const metaStore = tx.objectStore("channel_meta");

      const [allChannelMessages, meta] = await Promise.all([
        msgStore.index("by_channel").getAll(channelId),
        metaStore.get(channelId),
      ]);

      await tx.done;

      const sortedMessages = [...(allChannelMessages || [])].sort(
        (a, b) => (a.sequence || 0) - (b.sequence || 0),
      );

      const messages =
        sortedMessages.length > limit
          ? sortedMessages.slice(sortedMessages.length - limit)
          : sortedMessages;

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
      console.error("[MessageDB] getChannelSnapshot failed:", err);
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

  /**
   * 删除本地单条消息（如撤回/删除）
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete("messages", messageId);
    } catch (err) {
      console.error("[MessageDB] Failed to delete message:", err);
    }
  }

  /**
   * 保存频道元数据（已读游标、滚动坐标等）
   */
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
    // 1. 同步即时写入内存字典，防范 React 18 Unmount 周期 DOM 置空时的微任务丢失
    this.metaCache.set(channelId, updated);

    try {
      const db = await this.getDB();
      await db.put("channel_meta", updated);
    } catch (err) {
      console.error("[MessageDB] Failed to save channel meta:", err);
    }
  }

  /**
   * 获取指定频道的元数据
   */
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
      console.error("[MessageDB] Failed to get channel meta:", err);
      return null;
    }
  }

  /**
   * 清理淘汰单频道旧数据，保留最新 300 条
   */
  private async pruneChannelMessages(channelId: string): Promise<void> {
    const db = await this.getDB();
    const index = db
      .transaction("messages", "readonly")
      .objectStore("messages")
      .index("by_channel");

    const all = await index.getAll(channelId);
    if (all.length <= MAX_MESSAGES_PER_CHANNEL) return;

    // 按 sequence 升序排序
    all.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    // 计算超出需要清理的数量
    const toDeleteCount = all.length - MAX_MESSAGES_PER_CHANNEL;
    const toDeleteIds = all.slice(0, toDeleteCount).map((m) => m.id);

    const tx = db.transaction("messages", "readwrite");
    for (const id of toDeleteIds) {
      await tx.objectStore("messages").delete(id);
    }
    await tx.done;
  }

  /**
   * 清空指定频道的本地缓存
   */
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
      console.error("[MessageDB] Failed to clear channel messages:", err);
    }
  }

  /**
   * 清空全部本地消息与元数据仓库
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(["messages", "channel_meta"], "readwrite");
      await tx.objectStore("messages").clear();
      await tx.objectStore("channel_meta").clear();
      await tx.done;
    } catch (err) {
      console.error("[MessageDB] Failed to clear all:", err);
    }
  }
}

export const messageDb = new MessageDbService();

if (typeof window !== "undefined") {
  (window as any).__tescord_messageDb = messageDb;
}
