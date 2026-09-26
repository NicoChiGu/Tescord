import { StreamDetailedStats } from "@tescord/types";
import { livekitService } from "../livekit.js";
import { voiceMeshManager } from "../p2p/VoiceMeshManager.js";
import { p2pStreamManager } from "../p2p/P2PStreamManager.js";
import { cloudflareRealtimeService } from "../cloudflare_realtime/CloudflareRealtimeService.js";

/**
 * 统一媒体统计集线器 (Unified Media Stats Service)
 * 智能路由并聚合 LiveKit SFU、VoiceMesh P2P 网状直连、P2P 直播等不同底层传输架构的实时属性
 */
export class MediaStatsService {
  /**
   * 获取指定成员的当前实时媒体属性与网络质量报告
   * @param participantIdentity 目标成员 ID (缺省时为当前本地用户)
   */
  public async getDetailedStats(
    participantIdentity?: string,
  ): Promise<StreamDetailedStats> {
    if (cloudflareRealtimeService.status === "connected") {
      return cloudflareRealtimeService.getDetailedStats(participantIdentity);
    }
    // 1. 优先检查 P2P 屏幕直播流
    const streamOwnerId = p2pStreamManager.getStreamOwnerId();
    const hasLocalP2P = Boolean(p2pStreamManager.getLocalStream());
    const hasRemoteP2P = Boolean(p2pStreamManager.getRemoteStream());

    if (
      (hasLocalP2P || hasRemoteP2P) &&
      (!participantIdentity || participantIdentity === streamOwnerId)
    ) {
      try {
        const p2pStats =
          await p2pStreamManager.getP2PStreamDetailedStats(participantIdentity);
        if (p2pStats) {
          return p2pStats;
        }
      } catch (err) {
        console.warn("[MediaStats] P2PStreamManager getStats failed:", err);
      }
    }

    // 2. 检查纯语音 P2P Mesh 链路
    if (voiceMeshManager.getIsMeshActive()) {
      if (participantIdentity) {
        try {
          const meshStats =
            await voiceMeshManager.getVoiceMeshStats(participantIdentity);
          if (meshStats) {
            return meshStats;
          }
        } catch (err) {
          console.warn("[MediaStats] VoiceMeshManager getStats failed:", err);
        }
      }
    }

    // 3. 缺省回退至 LiveKit SFU 引擎获取统计
    return await livekitService.getStreamDetailedStats(participantIdentity);
  }
}

export const mediaStatsService = new MediaStatsService();
