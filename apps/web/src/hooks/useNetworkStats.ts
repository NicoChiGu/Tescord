import { useState, useEffect } from "react";
import { NetworkStats } from "@tescord/types";
import { livekitService } from "../services/livekit.js";
import { cloudflareRealtimeService } from "../services/cloudflare_realtime/index.js";
import { VOICE_ENGINE } from "../config.js";
import { useAuthStore } from "../stores/useAuthStore.js";

/**
 * 实时获取当前客户端本人的 WebRTC 网络健康统计与 RTT 往返延迟
 */
export function useNetworkStats(): NetworkStats | null {
  const user = useAuthStore((state) => state.user);

  const [stats, setStats] = useState<NetworkStats | null>(() => {
    if (VOICE_ENGINE === "cloudflare_realtime")
      return cloudflareRealtimeService.getNetworkStats();
    return (
      (user?.id ? livekitService.getNetworkStats(user.id) : null) ||
      livekitService.getNetworkStats()
    );
  });

  useEffect(() => {
    if (VOICE_ENGINE === "cloudflare_realtime") {
      setStats(cloudflareRealtimeService.getNetworkStats());
      return cloudflareRealtimeService.onNetworkStatsUpdate((statsMap) => {
        setStats(
          (user?.id ? statsMap.get(user.id) : null) ||
            statsMap.get("local-me") ||
            null,
        );
      });
    }
    const current =
      (user?.id ? livekitService.getNetworkStats(user.id) : null) ||
      livekitService.getNetworkStats();
    if (current) {
      setStats(current);
    }

    const unbind = livekitService.onNetworkStatsUpdate((statsMap) => {
      const local =
        (user?.id ? statsMap.get(user.id) : null) ||
        livekitService.getNetworkStats() ||
        Array.from(statsMap.values())[0] ||
        null;
      setStats(local);
    });

    return () => {
      unbind();
    };
  }, [user?.id]);

  return stats;
}
