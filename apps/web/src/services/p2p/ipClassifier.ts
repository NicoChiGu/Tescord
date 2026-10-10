/**
 * IP 分类与 P2P / 局域网拓扑判定算法模块
 * 严格遵循 RFC 1918、RFC 4193 (ULA)、RFC 4291 (Link-Local / Loopback) 与 RFC 3587 (Global Unicast IPv6)
 */

export type IpCategory =
  | "private-v4"
  | "public-v4"
  | "ula-v6"
  | "link-local-v6"
  | "loopback"
  | "public-v6"
  | "unknown";

/** 从可能带端口、方括号或 Zone ID 的输入中提取纯 IP */
export function extractIpAddress(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  let addr = raw.trim();

  // 匹配形如 [240e:...]:5000 或 [240e:...]，支持内含 %zone
  const bracketMatch = addr.match(/^\[([a-fA-F0-9:.%_\-]+)\](?::\d+)?$/);
  if (bracketMatch) {
    addr = bracketMatch[1];
  } else {
    // 匹配形如 192.168.1.1:5000
    const ipv4PortMatch = addr.match(
      /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/,
    );
    if (ipv4PortMatch) {
      addr = ipv4PortMatch[1];
    }
  }

  // 剔除 IPv6 Scope/Zone 标识（如 fe80::1%eth0 或 fe80::1%12），仅对合法 IPv6 (包含 :: 或至少 2 个冒号) 执行
  const colonCount = (addr.match(/:/g) || []).length;
  if (addr.includes("::") || colonCount >= 2) {
    const zoneIndex = addr.indexOf("%");
    if (zoneIndex !== -1) {
      const preZone = addr.slice(0, zoneIndex);
      const preColons = (preZone.match(/:/g) || []).length;
      if (preZone.includes("::") || preColons >= 2) {
        addr = preZone;
      }
    }
  }

  addr = addr.replace(/^\[+|\]+$/g, "");

  return addr.toLowerCase();
}

/** 格式化候选物理地址与端口，用于日志与网络质量面板呈现 */
export function formatCandidateAddress(
  ip?: string,
  port?: number,
): string | undefined {
  if (!ip) return undefined;
  const clean = extractIpAddress(ip);
  if (!clean) return undefined;

  if (typeof port === "number" && port > 0) {
    if (clean.includes(":")) {
      return `[${clean}]:${port}`;
    }
    return `${clean}:${port}`;
  }

  const trimmed = ip.trim();
  if (trimmed.startsWith("[") && trimmed.includes("]:")) {
    return trimmed;
  }
  if (!trimmed.includes("::") && /^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(trimmed)) {
    return trimmed;
  }

  return clean;
}

/** 解析 IPv4 为 4 个十进制数值元组；非法格式返回 null */
export function parseIpv4(ip: string): [number, number, number, number] | null {
  const clean = extractIpAddress(ip);
  const parts = clean.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith("0")) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }

  return octets as [number, number, number, number];
}

/** 校验是否为合法 IPv4 地址 */
export function isValidIpv4(ip: string): boolean {
  return parseIpv4(ip) !== null;
}

/** RFC 1918 私网 IPv4：10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 */
export function isPrivateIpv4(ip: string): boolean {
  const oct = parseIpv4(ip);
  if (!oct) return false;
  const [a, b] = oct;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** RFC 1122 回环 IPv4：127.0.0.0/8 */
export function isLoopbackIpv4(ip: string): boolean {
  const oct = parseIpv4(ip);
  return oct !== null && oct[0] === 127;
}

/** RFC 3927 链路本地 IPv4 (APIPA)：169.254.0.0/16 */
export function isLinkLocalIpv4(ip: string): boolean {
  const oct = parseIpv4(ip);
  return oct !== null && oct[0] === 169 && oct[1] === 254;
}

/** 公网 IPv4：非私网、非回环、非链路本地、非组播保留 */
export function isPublicIpv4(ip: string): boolean {
  const oct = parseIpv4(ip);
  if (!oct) return false;
  if (isPrivateIpv4(ip) || isLoopbackIpv4(ip) || isLinkLocalIpv4(ip))
    return false;
  const [a] = oct;
  if (a === 0 || a >= 224) return false;
  return true;
}

/** 解析 IPv6 地址为 8 个 16 位整型元组；非法格式返回 null */
export function parseIpv6(ip: string): number[] | null {
  const cleaned = extractIpAddress(ip);
  if (!cleaned) return null;
  if (cleaned.includes(":::")) return null;
  if (cleaned.startsWith(":") && !cleaned.startsWith("::")) return null;
  if (cleaned.endsWith(":") && !cleaned.endsWith("::")) return null;

  const doubleColons = (cleaned.match(/::/g) || []).length;
  if (doubleColons > 1) return null;

  const parseHextets = (list: string[]): number[] | null => {
    const res: number[] = [];
    for (const h of list) {
      if (h === "") return null;
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      res.push(parseInt(h, 16));
    }
    return res;
  };

  if (doubleColons === 1) {
    const [left, right] = cleaned.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];

    let embeddedIpv4: number[] = [];
    if (
      rightParts.length > 0 &&
      rightParts[rightParts.length - 1].includes(".")
    ) {
      const v4 = parseIpv4(rightParts.pop()!);
      if (!v4) return null;
      embeddedIpv4 = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    }

    const leftHex = parseHextets(leftParts);
    const rightHex = parseHextets(rightParts);
    if (!leftHex || !rightHex) return null;

    const totalProvided =
      leftHex.length + rightHex.length + embeddedIpv4.length;
    if (totalProvided > 7) return null;
    const zeros = new Array(8 - totalProvided).fill(0);

    return [...leftHex, ...zeros, ...rightHex, ...embeddedIpv4];
  } else {
    const parts = cleaned.split(":");
    let embeddedIpv4: number[] = [];
    if (parts.length > 0 && parts[parts.length - 1].includes(".")) {
      const v4 = parseIpv4(parts.pop()!);
      if (!v4) return null;
      embeddedIpv4 = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    }
    if (parts.length + embeddedIpv4.length !== 8) return null;
    const hex = parseHextets(parts);
    if (!hex) return null;
    return [...hex, ...embeddedIpv4];
  }
}

/** 校验是否为合法 IPv6 地址 */
export function isValidIpv6(ip: string): boolean {
  return parseIpv6(ip) !== null;
}

/** RFC 4193 唯一本地 IPv6 (ULA: fc00::/7，包含 fc00::/8 与 fd00::/8) */
export function isUlaIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xfe00) === 0xfc00;
}

/** RFC 4291 链路本地 IPv6 (Link-Local: fe80::/10) */
export function isLinkLocalIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xffc0) === 0xfe80;
}

/** RFC 4291 回环 IPv6 (::1) */
export function isLoopbackIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0 &&
    hextets[6] === 0 &&
    hextets[7] === 1
  );
}

/** RFC 3587 / RFC 4291 全局单播公网 IPv6 (2000::/3，涵盖 240e/2408/2409/2001:da8 等) */
export function isPublicIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xe000) === 0x2000;
}

/** 回环 IP 地址 (127.0.0.0/8 或 ::1) */
export function isLoopback(ip: string): boolean {
  return isLoopbackIpv4(ip) || isLoopbackIpv6(ip);
}

/** 通用 IP 地址合法性判定 */
export function isValidIp(ip: string): boolean {
  const clean = extractIpAddress(ip);
  return isValidIpv4(clean) || isValidIpv6(clean);
}

/** 分类 IP 地址类型 */
export function classifyIp(raw: string): IpCategory {
  if (!raw) return "unknown";
  const clean = extractIpAddress(raw);
  if (!clean) return "unknown";

  if (clean.includes(".") && !clean.includes(":")) {
    if (isLoopbackIpv4(clean)) return "loopback";
    if (isPrivateIpv4(clean) || isLinkLocalIpv4(clean)) return "private-v4";
    if (isPublicIpv4(clean)) return "public-v4";
    return "unknown";
  }

  if (clean.includes(":")) {
    if (isLoopbackIpv6(clean)) return "loopback";
    if (isUlaIpv6(clean)) return "ula-v6";
    if (isLinkLocalIpv6(clean)) return "link-local-v6";
    if (isPublicIpv6(clean)) return "public-v6";

    // IPv4-mapped IPv6 (::ffff:192.168.1.1)
    const hextets = parseIpv6(clean);
    if (hextets) {
      if (
        hextets[0] === 0 &&
        hextets[1] === 0 &&
        hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0xffff
      ) {
        const v4 = `${(hextets[6] >> 8) & 0xff}.${hextets[6] & 0xff}.${(hextets[7] >> 8) & 0xff}.${hextets[7] & 0xff}`;
        return classifyIp(v4);
      }
    }
    return "unknown";
  }

  return "unknown";
}

/** 判定 IP 是否属于局域网或内网候选 */
export function isLanCandidateIp(ip?: string | null): boolean {
  if (!ip) return false;
  const category = classifyIp(ip);
  return (
    category === "private-v4" ||
    category === "ula-v6" ||
    category === "link-local-v6" ||
    category === "loopback"
  );
}

/**
 * P2P 连接拓扑决策算法
 *
 * 判定规则：
 * 1. 任意一端为 relay -> "RELAY"
 * 2. 双方候选类型均为 host，且双方物理 IP 均判定为局域网候选（私网 IPv4 / ULA / Link-Local / Loopback） -> "LAN"
 * 3. 其余情况（包含公网 IPv6 直连、公网 IPv4 直连、srflx、prflx 等） -> "P2P"
 */
export function determineP2PConnectionType(
  localIpOrParams?:
    | string
    | {
        localIp?: string;
        remoteIp?: string;
        localCandidateType?: string;
        remoteCandidateType?: string;
        localAddress?: string;
        remoteAddress?: string;
      },
  remoteIp?: string,
  localCandidateType?: string,
  remoteCandidateType?: string,
): "LAN" | "P2P" | "RELAY" {
  let lIp: string | undefined;
  let rIp: string | undefined;
  let lType: string | undefined;
  let rType: string | undefined;

  if (typeof localIpOrParams === "object" && localIpOrParams !== null) {
    lIp = localIpOrParams.localIp ?? localIpOrParams.localAddress;
    rIp = localIpOrParams.remoteIp ?? localIpOrParams.remoteAddress;
    lType = localIpOrParams.localCandidateType;
    rType = localIpOrParams.remoteCandidateType;
  } else {
    lIp = localIpOrParams;
    rIp = remoteIp;
    lType = localCandidateType;
    rType = remoteCandidateType;
  }

  const normLType = typeof lType === "string" ? lType.toLowerCase() : "";
  const normRType = typeof rType === "string" ? rType.toLowerCase() : "";

  if (normLType === "relay" || normRType === "relay") {
    return "RELAY";
  }

  if (normLType === "host" && normRType === "host") {
    if (isLanCandidateIp(lIp) && isLanCandidateIp(rIp)) {
      return "LAN";
    }
  }

  return "P2P";
}
