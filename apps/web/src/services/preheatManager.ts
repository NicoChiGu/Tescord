import { Message } from "@tescord/types";
import { API_BASE } from "../config.js";
import { messageDb } from "./messageDb.js";

interface PreheatTask {
  channelId: string;
  type: string;
}

class PreheatManager {
  private queue: PreheatTask[] = [];
  private activeCount = 0;
  private readonly maxConcurrency = 3;
  private preheatedChannelIds = new Set<string>();
  private authToken: string | null = null;

  /**
   * 启动数据预热管线
   * @param candidateChannels 优先预热的候选频道列表（如当前公会前2个文字频道、活跃私信等）
   */
  startPreheat(
    candidateChannels: { id: string; type: string }[],
    token?: string | null,
  ): void {
    if (token) {
      this.authToken = token;
    } else {
      this.authToken = localStorage.getItem("tescord_access_token");
    }

    for (const ch of candidateChannels) {
      if (ch.type === "VOICE") continue;
      if (this.preheatedChannelIds.has(ch.id)) continue;
      this.preheatedChannelIds.add(ch.id);
      this.queue.push({ channelId: ch.id, type: ch.type });
    }

    this.processQueue();
  }

  /**
   * 重置预热状态（在用户切换或登出时调用）
   */
  reset(): void {
    this.queue = [];
    this.activeCount = 0;
    this.preheatedChannelIds.clear();
    this.authToken = null;
  }

  /**
   * 网关实时新消息旁路持久化 (Passive Write-through)
   * 无论该消息属于前台还是后台频道，同步沉淀入 IndexedDB，保障用户切过去时为最新内容
   */
  async onGatewayMessage(msg: Message): Promise<void> {
    if (!msg || !msg.channelId) return;
    await messageDb.saveMessage(msg);
  }

  /**
   * 网关消息删除旁路处理
   */
  async onGatewayMessageDelete(messageId: string): Promise<void> {
    if (!messageId) return;
    await messageDb.deleteMessage(messageId);
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeCount++;
      this.fetchAndCacheChannel(task.channelId)
        .catch((err) =>
          console.warn(`[PreheatManager] Failed to preheat #${task.channelId}:`, err),
        )
        .finally(() => {
          this.activeCount--;
          this.processQueue();
        });
    }
  }

  private async fetchAndCacheChannel(channelId: string): Promise<void> {
    const token =
      this.authToken || localStorage.getItem("tescord_access_token");

    const res = await fetch(
      `${API_BASE}/api/channels/${channelId}/messages?limit=100`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const messages = (await res.json()) as Message[];
    if (messages && messages.length > 0) {
      await messageDb.saveMessages(channelId, messages);
    }
  }
}

export const preheatManager = new PreheatManager();
