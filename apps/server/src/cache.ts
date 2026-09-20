import { UserStatus } from "@tescord/types";

export interface ICacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  setUserPresence(userId: string, status: UserStatus): Promise<void>;
  getUserPresence(userId: string): Promise<UserStatus | null>;
}

/**
 * 内存缓存实现（用于无 Redis 环境下的无感优雅降级）
 */
class MemoryCacheStore implements ICacheStore {
  private store = new Map<string, { value: string; expireAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expireAt && item.expireAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expireAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expireAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async setUserPresence(userId: string, status: UserStatus): Promise<void> {
    await this.set(`presence:${userId}`, status, 3600); // 1小时默认缓存
  }

  async getUserPresence(userId: string): Promise<UserStatus | null> {
    const status = await this.get(`presence:${userId}`);
    return (status as UserStatus) || null;
  }
}

// 导出单例缓存存储器
export const cacheStore: ICacheStore = new MemoryCacheStore();
