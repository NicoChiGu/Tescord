import {
  Message,
  ChannelMetaRecord,
  StorageChannelSnapshot,
  StorageSearchMessagesQuery,
  StorageStats,
} from "@tescord/types";
import { getStorageAdapter } from "./storage/index.js";

class MessageDbService {
  public async switchUser(userId: string | null): Promise<void> {
    await getStorageAdapter().switchUser(userId);
  }

  public async close(): Promise<void> {
    // 适配器统一管理连接生命周期
  }

  /**
   * 批量保存或更新频道消息，并自动执行单频道 LRU 淘汰
   */
  async saveMessages(channelId: string, messages: Message[]): Promise<void> {
    if (!messages || messages.length === 0) return;
    await getStorageAdapter().saveMessages(channelId, messages);
  }

  /**
   * 单条保存或覆盖消息（如网关实时到达的新消息）
   */
  async saveMessage(msg: Message): Promise<void> {
    if (!msg || !msg.channelId) return;
    await getStorageAdapter().saveMessage(msg);
  }

  /**
   * 从本地取出该频道最新的 N 条消息（默认 100 条，升序排列）
   */
  async getLatestMessages(channelId: string, limit = 100): Promise<Message[]> {
    return getStorageAdapter().getLatestMessages(channelId, limit);
  }

  /**
   * 在单一只读事务中原子化获取频道的离线消息快照与元数据
   */
  async getChannelSnapshot(
    channelId: string,
    limit = 100,
  ): Promise<StorageChannelSnapshot> {
    return getStorageAdapter().getChannelSnapshot(channelId, limit);
  }

  /**
   * 删除本地单条消息（如撤回/删除）
   */
  async deleteMessage(messageId: string): Promise<void> {
    await getStorageAdapter().deleteMessage(messageId);
  }

  /**
   * 保存频道元数据（已读游标、滚动坐标等）
   */
  async saveChannelMeta(
    channelId: string,
    meta: Partial<ChannelMetaRecord>,
  ): Promise<void> {
    await getStorageAdapter().saveChannelMeta(channelId, meta);
  }

  /**
   * 获取指定频道的元数据
   */
  async getChannelMeta(channelId: string): Promise<ChannelMetaRecord | null> {
    return getStorageAdapter().getChannelMeta(channelId);
  }

  /**
   * 清空指定频道的本地缓存
   */
  async clearChannel(channelId: string): Promise<void> {
    await getStorageAdapter().clearChannel(channelId);
  }

  /**
   * 清空全部本地消息与元数据仓库
   */
  async clearAll(): Promise<void> {
    await getStorageAdapter().clearAllMessages();
  }

  /**
   * 离线全文搜索消息 (在桌面端基于 SQLite FTS5 毫秒级分词引擎)
   */
  async searchMessages(query: StorageSearchMessagesQuery): Promise<Message[]> {
    return getStorageAdapter().searchMessages(query);
  }

  /**
   * 获取本地存储引擎统计
   */
  async getStats(): Promise<StorageStats | undefined> {
    if (getStorageAdapter().getStorageStats) {
      return getStorageAdapter().getStorageStats!();
    }
    return undefined;
  }
}

export const messageDb = new MessageDbService();

if (typeof window !== "undefined") {
  (window as any).__tescord_messageDb = messageDb;
}
