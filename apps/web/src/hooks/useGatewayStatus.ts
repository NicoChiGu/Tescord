import { useState, useEffect } from "react";
import { GatewayConnectionState, GatewayPingStats } from "@tescord/types";
import { gatewayClient } from "../services/gateway.js";

/**
 * 订阅并返回 WebSocket 网关的真实连接状态与 Ping 往返延迟
 */
export function useGatewayStatus(): {
  connectionState: GatewayConnectionState;
  pingStats: GatewayPingStats | null;
  ping: number | null;
} {
  const [connectionState, setConnectionState] =
    useState<GatewayConnectionState>(() => gatewayClient.getConnectionState());
  const [pingStats, setPingStats] = useState<GatewayPingStats | null>(() =>
    gatewayClient.getPingStats(),
  );

  useEffect(() => {
    // 同步初态
    setConnectionState(gatewayClient.getConnectionState());
    setPingStats(gatewayClient.getPingStats());

    const unbindState = gatewayClient.onConnectionStateChange((state) => {
      setConnectionState(state);
    });

    const unbindPing = gatewayClient.onPingChange((ping) => {
      setPingStats(ping);
    });

    return () => {
      unbindState();
      unbindPing();
    };
  }, []);

  return {
    connectionState,
    pingStats,
    ping: pingStats ? pingStats.ping : null,
  };
}
