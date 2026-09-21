import { NATType } from "@tescord/types";

export interface NATDetectionResult {
  natType: NATType;
  hasIPv6: boolean;
  publicIP?: string;
  publicPort?: number;
  localAddresses: string[];
}

export class NATDetector {
  private static cachedResult: NATDetectionResult | null = null;

  /**
   * 自动探测客户端 NAT 类型与 IPv6 连通性
   * 原理：通过向不同的 STUN 探针发起 ICE Candidate 收集，对比外部端口映射行为（RFC 3489 / 5389）
   */
  public static async detect(
    forceRefresh = false,
  ): Promise<NATDetectionResult> {
    if (!forceRefresh && this.cachedResult) {
      return this.cachedResult;
    }

    // 优先检查 Electron 原生网卡信息（若在桌面端）
    let hasNativeIPv6 = false;
    if (
      typeof window !== "undefined" &&
      window.electronAPI?.network?.detectLocalNetwork
    ) {
      try {
        const net = await window.electronAPI.network.detectLocalNetwork();
        hasNativeIPv6 = net.hasPublicIPv6;
      } catch (e) {
        console.warn("Electron network detection fallback to WebRTC:", e);
      }
    }

    const stunServers = [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.qq.com:3478" },
    ];

    try {
      const candidates = await this.gatherCandidates(stunServers, 2500);

      const hostCandidates = candidates.filter((c) => c.type === "host");
      const srflxCandidates = candidates.filter((c) => c.type === "srflx");

      const localAddresses = Array.from(
        new Set(hostCandidates.map((c) => c.address)),
      );
      let hasIPv6 =
        hasNativeIPv6 ||
        candidates.some(
          (c) => c.address.includes(":") && !c.address.startsWith("fe80:"),
        );

      if (srflxCandidates.length === 0) {
        // 无 STUN 映射响应，若有全球 IPv6 则为 IPv6Direct，否则为 Unknown
        const result: NATDetectionResult = {
          natType: hasIPv6 ? "IPv6Direct" : "Unknown",
          hasIPv6,
          localAddresses,
        };
        this.cachedResult = result;
        return result;
      }

      const primary = srflxCandidates[0];
      const ports = srflxCandidates.map((c) => c.port);
      const uniquePorts = Array.from(new Set(ports));

      let natType: NATType = "FullCone";

      if (uniquePorts.length > 1) {
        // 对不同 STUN 目标映射了不同端口，是对称型 NAT (哪怕有本地 IPv6，对 IPv4 peer 仍无法直连)
        natType = "Symmetric";
      } else if (hasIPv6) {
        natType = "IPv6Direct";
      } else {
        // 端口保持一致，为锥型 NAT（Full Cone / Restricted Cone）
        natType = "FullCone";
      }

      const result: NATDetectionResult = {
        natType,
        hasIPv6,
        publicIP: primary.address,
        publicPort: primary.port,
        localAddresses,
      };

      this.cachedResult = result;
      return result;
    } catch (err) {
      console.warn("NAT detection error, fallback to default:", err);
      const fallback: NATDetectionResult = {
        natType: hasNativeIPv6 ? "IPv6Direct" : "Unknown",
        hasIPv6: hasNativeIPv6,
        localAddresses: [],
      };
      this.cachedResult = fallback;
      return fallback;
    }
  }

  private static gatherCandidates(
    iceServers: RTCIceServer[],
    timeoutMs: number,
  ): Promise<
    Array<{ type: string; address: string; port: number; protocol: string }>
  > {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers });
      const candidates: Array<{
        type: string;
        address: string;
        port: number;
        protocol: string;
      }> = [];
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        try {
          pc.close();
        } catch {}
        resolve(candidates);
      };

      const timer = setTimeout(finish, timeoutMs);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const c = event.candidate;
          if (c.type && c.address && c.port) {
            candidates.push({
              type: c.type,
              address: c.address,
              port: c.port,
              protocol: c.protocol || "udp",
            });
          }
        } else {
          // ICE gathering completed
          clearTimeout(timer);
          finish();
        }
      };

      // 创建虚拟 DataChannel 触发 ICE Candidate 收集
      try {
        pc.createDataChannel("nat_probe");
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .catch(() => finish());
      } catch {
        finish();
      }
    });
  }
}
