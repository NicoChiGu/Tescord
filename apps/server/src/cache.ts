import { UserStatus, UserPresence } from "@tescord/types";
import Redis, { Redis as RedisClient } from "ioredis";

export interface ICacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  setUserPresence(
    userId: string,
    presence: UserPresence | UserStatus,
    ttlSeconds?: number,
  ): Promise<void>;
  getUserPresence(userId: string): Promise<UserPresence | null>;
  removeUserPresence(userId: string): Promise<void>;
  batchGetPresences(userIds: string[]): Promise<Map<string, UserPresence>>;
  getAllOnlineUsers(): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;
}

function normalizePresence(
  userId: string,
  presenceOrStatus: UserPresence | UserStatus,
): UserPresence {
  if (typeof presenceOrStatus === "string") {
    return {
      userId,
      status: presenceOrStatus,
      lastActiveAt: new Date().toISOString(),
    };
  }
  return presenceOrStatus;
}

/**
 * 内存缓存实现（用于无 Redis 环境下的无感优雅降级与单机自治）
 */
export class MemoryCacheStore implements ICacheStore {
  private store = new Map<string, { value: string; expireAt?: number }>();
  private presences = new Map<string, UserPresence>();
  private subscribers = new Map<string, Set<(message: string) => void>>();

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

  async setUserPresence(
    userId: string,
    presenceOrStatus: UserPresence | UserStatus,
    ttlSeconds: number = 86400,
  ): Promise<void> {
    const presence = normalizePresence(userId, presenceOrStatus);
    this.presences.set(userId, presence);
    await this.set(`presence:${userId}`, JSON.stringify(presence), ttlSeconds);
  }

  async getUserPresence(userId: string): Promise<UserPresence | null> {
    const direct = this.presences.get(userId);
    if (direct) return direct;

    const raw = await this.get(`presence:${userId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as UserPresence;
      this.presences.set(userId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async removeUserPresence(userId: string): Promise<void> {
    this.presences.delete(userId);
    await this.del(`presence:${userId}`);
  }

  async batchGetPresences(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    for (const id of userIds) {
      const presence = await this.getUserPresence(id);
      if (presence) {
        result.set(id, presence);
      }
    }
    return result;
  }

  async getAllOnlineUsers(): Promise<string[]> {
    const onlineList: string[] = [];
    for (const [userId, presence] of this.presences.entries()) {
      if (presence.status !== "OFFLINE" && presence.status !== "INVISIBLE") {
        onlineList.push(userId);
      }
    }
    return onlineList;
  }

  async publish(channel: string, message: string): Promise<void> {
    const listeners = this.subscribers.get(channel);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(message);
        } catch (err) {
          console.error(`[MemoryCacheStore] Subscriber error on channel ${channel}:`, err);
        }
      }
    }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(callback);
  }
}

/**
 * Redis 优先 + 自动内存降级双模适配器
 */
export class DualCacheStore implements ICacheStore {
  private memory = new MemoryCacheStore();
  private redis: RedisClient | null = null;
  private isRedisAvailable = false;
  private redisInitAttempted = false;

  constructor() {
    this.initRedis();
  }

  private initRedis() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    try {
      const RedisCtor: any = (Redis as any).default || Redis;
      this.redis = new RedisCtor(redisUrl, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy(times: number) {
          if (times > 3) return null; // 超过3次不再重试，彻底降级内存
          return Math.min(times * 500, 2000);
        },
      });

      if (this.redis) {
        this.redis.on("connect", () => {
          this.isRedisAvailable = true;
          console.log(`[Cache] Successfully connected to Redis at ${redisUrl}`);
        });

        this.redis.on("error", (err: any) => {
          if (!this.isRedisAvailable && !this.redisInitAttempted) {
            console.warn(
              `[Cache] Redis unavailable (${err?.message || "connection error"}). Seamlessly falling back to in-memory store.`,
            );
            this.redisInitAttempted = true;
          }
          this.isRedisAvailable = false;
        });

        // 尝试建立轻量连接
        this.redis.connect().catch(() => {
          this.isRedisAvailable = false;
          if (!this.redisInitAttempted) {
            console.warn("[Cache] Redis initial connection failed. Using in-memory store.");
            this.redisInitAttempted = true;
          }
        });
      }
    } catch {
      this.isRedisAvailable = false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.isRedisAvailable && this.redis) {
      try {
        return await this.redis.get(key);
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isRedisAvailable && this.redis) {
      try {
        if (ttlSeconds) {
          await this.redis.set(key, value, "EX", ttlSeconds);
        } else {
          await this.redis.set(key, value);
        }
        return;
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.del(key);
  }

  async setUserPresence(
    userId: string,
    presenceOrStatus: UserPresence | UserStatus,
    ttlSeconds: number = 86400,
  ): Promise<void> {
    const presence = normalizePresence(userId, presenceOrStatus);
    const raw = JSON.stringify(presence);
    await this.memory.setUserPresence(userId, presence, ttlSeconds);

    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.set(`presence:${userId}`, raw, "EX", ttlSeconds);
        if (presence.status !== "OFFLINE" && presence.status !== "INVISIBLE") {
          await this.redis.sadd("online_users", userId);
        } else {
          await this.redis.srem("online_users", userId);
        }
      } catch {
        this.isRedisAvailable = false;
      }
    }
  }

  async getUserPresence(userId: string): Promise<UserPresence | null> {
    if (this.isRedisAvailable && this.redis) {
      try {
        const raw = await this.redis.get(`presence:${userId}`);
        if (raw) {
          return JSON.parse(raw) as UserPresence;
        }
        return null;
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.getUserPresence(userId);
  }

  async removeUserPresence(userId: string): Promise<void> {
    await this.memory.removeUserPresence(userId);
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.del(`presence:${userId}`);
        await this.redis.srem("online_users", userId);
      } catch {
        this.isRedisAvailable = false;
      }
    }
  }

  async batchGetPresences(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    if (userIds.length === 0) return result;

    if (this.isRedisAvailable && this.redis) {
      try {
        const keys = userIds.map((id) => `presence:${id}`);
        const values = await this.redis.mget(keys);
        for (let i = 0; i < userIds.length; i++) {
          const raw = values[i];
          if (raw) {
            try {
              result.set(userIds[i], JSON.parse(raw) as UserPresence);
            } catch {
              // ignore parse error
            }
          }
        }
        return result;
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.batchGetPresences(userIds);
  }

  async getAllOnlineUsers(): Promise<string[]> {
    if (this.isRedisAvailable && this.redis) {
      try {
        return await this.redis.smembers("online_users");
      } catch {
        this.isRedisAvailable = false;
      }
    }
    return this.memory.getAllOnlineUsers();
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.memory.publish(channel, message);
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.publish(channel, message);
      } catch {
        this.isRedisAvailable = false;
      }
    }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    await this.memory.subscribe(channel, callback);
  }
}

// 导出单例双模缓存存储器
export const cacheStore: ICacheStore = new DualCacheStore();
