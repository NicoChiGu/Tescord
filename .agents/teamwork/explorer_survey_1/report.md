# Tescord P2P 语音链路指标、Popover 拓扑与直连 IP 调研报告 (R1, R2, R4)

- **调研智能体**：Explorer 1 (Subagent)
- **目标需求**：R1 (局域网识别与公网 IPv6 过滤)、R2 (Voice Popover 与左下角状态区重构)、R4 (WebRTC 媒体引擎与网络健康看板直连 IP 呈现)
- **关联代码库**：`packages/types`, `apps/web/src/services/p2p`, `apps/web/src/components`, `apps/web/src/i18n`

---

## 1. 调研执行摘要与现状缺陷剖析

通过对 Tescord 代码库（WebRTC P2P Mesh 引擎、底层类型协议、状态栏与网络弹窗组件）的逐行只读静态推演，发现以下核心技术现状与缺陷：

1. **R1 局域网误判根因**：
   - 位置：`apps/web/src/services/p2p/VoiceMeshManager.ts:1756-1758`
   - 现状：代码仅通过 `else if (localType === "host" && remoteType === "host") { connectionType = "LAN"; }` 粗暴判定局域网。
   - 缺陷：在我国三大运营商网络环境下，物理设备网卡直接分配公网单播 IPv6 地址（电信 `240e::/16`、联通 `2408::/16`、移动 `2409::/16`）。WebRTC 在本机采集候选时，这些物理网卡绑定的 IPv6 会以 `candidateType: "host"` 暴露。当两端通过公网 IPv6 直连时，双方候选均为 `host`，导致跨广域网（WAN）的公网直连被全部误判为 `"LAN"`（局域网），UI 上错误显示“局域网”胶囊。

2. **R2 左下角状态栏与 Popover 现状缺陷**：
   - 位置：`apps/web/src/components/ChannelSidebar.tsx:1335-1456`
   - 现状一：当前左下角是一个单一的 `<button data-testid="voice-connection-status-btn">`，将信号图标、连接状态（“语音已连接”）、延迟胶囊（“P2P 24ms”）、频道名称以及“/ 全员中位数延迟”混在一个大按钮内，导致用户点击频道名称时仅能触发 Popover 展开/折叠，无法切换回语音主舞台。
   - 现状二：频道名称下方强制拼接了 `t("voice:medianLatency")`（全员中位数延迟）文案，占用横向宽度且视觉冗余。
   - 现状三：`VoiceConnectionStatusPopover.tsx:85-106` 目前在 P2P 模式下仅显示单点示波波形（通过 `getActiveSpeakerOrMedianLatency` 提取的伪单点），未展示全员平均 RTT、全员丢包率，更缺乏按成员排列的直连柱状图、用户头像（Avatar）以及悬停抖动/丢包率浮层。

3. **R4 直连 IP 未上报与看板未展示缺陷**：
   - 位置一：`packages/types/src/index.ts:1202-1210`，`PeerLatencyReport` 接口仅包含 `rtt`, `jitter`, `packetLoss`, `connectionType`, `status`, `updatedAt`，缺失 `localAddress`, `remoteAddress`, `candidateType` 字段。
   - 位置二：`VoiceMeshManager.ts:1762-1770`，在定时 `pc.getStats()` 时未将选中的本端与远端物理 IP 及端口保存到 `latencyReports`。
   - 位置三：`apps/web/src/components/modals/NetworkQualityModal.tsx:712-732`，P2P 节点卡片中仅展示 `Peer ID`、`RTT`、`connectionType` 及音频收发质量，没有呈现两端实际直连物理 IP 与端口。

---

## 2. R1 专项调研：P2P 局域网识别与严格 IP 分类算法

### 2.1 涉及文件与具体代码位置
- **`apps/web/src/services/p2p/VoiceMeshManager.ts`**
  - 行 1671-1770：`startStatsMonitoring()` 统计轮询定时器（每 1.5 秒采集一次）。
  - 行 1752-1759：当前缺陷代码：
    ```typescript
    const localType = localCandidate?.candidateType;
    const remoteType = remoteCandidate?.candidateType;
    if (localType === "relay" || remoteType === "relay") {
      connectionType = "RELAY";
    } else if (localType === "host" && remoteType === "host") {
      connectionType = "LAN"; // ❌ 严重缺陷：公网 IPv6 host 候选被误判为 LAN
    }
    ```
- **`apps/web/src/components/VoiceRoomArea.tsx`**
  - 行 740-801：根据 `peerLatency?.connectionType` 渲染网络指示胶囊：
    - `RELAY` -> 显示 `TURN`
    - `LAN` -> 显示 `局域网`
    - `P2P` -> 显示 `P2P`

### 2.2 严格网络协议 RFC 与 IP 边界界定

根据网络工程标准，合法的局域网直连必须同时满足：
1. **双方 ICE 候选类型均为 `"host"`**（排除 STUN 反射 `srflx`、对端反射 `prflx` 与 TURN 中继 `relay`）；
2. **双方物理 IP 必须全部位于私有/链路本地/回环地址块内**：
   - **RFC 1918 私网 IPv4**：
     - `10.0.0.0/8`：`10.0.0.0` ~ `10.255.255.255`
     - `172.16.0.0/12`：`172.16.0.0` ~ `172.31.255.255`
     - `192.168.0.0/16`：`192.168.0.0` ~ `192.168.255.255`
   - **RFC 1122 / RFC 5735 回环 IPv4**：`127.0.0.0/8`
   - **RFC 3927 链路本地 IPv4 (APIPA)**：`169.254.0.0/16`
   - **RFC 4193 唯一本地 IPv6 单播 (ULA, Unique Local Address)**：
     - 前缀 `fc00::/7`（涵盖 `fc00::/8` 与普遍使用的本地随机生成 `fd00::/8`）。二进制最高 7 位为 `1111 110`，即十六进制高位满足 `(hextet0 & 0xfe00) === 0xfc00`。
   - **RFC 4291 链路本地 IPv6 (Link-Local)**：
     - 前缀 `fe80::/10`。二进制最高 10 位为 `1111 1110 10`，即十六进制高位满足 `(hextet0 & 0xffc0) === 0xfe80`。
   - **RFC 4291 回环 IPv6**：`::1` (`[0, 0, 0, 0, 0, 0, 0, 1]`)。

3. **公网 IPv6 精准过滤 (RFC 3587 / RFC 4291 全局单播地址 GUA)**：
   - 前缀 `2000::/3`。二进制最高 3 位为 `001`，即十六进制高位满足 `(hextet0 & 0xe000) === 0x2000`（范围为 `0x2000` 到 `0x3fff`）。
   - **我国三大运营商公网单播分配完全处于该区间**：
     - 中国电信：`240e::/16` (`0x240e & 0xe000 === 0x2000`)
     - 中国联通：`2408::/16` (`0x2408 & 0xe000 === 0x2000`)
     - 中国移动：`2409::/16` (`0x2409 & 0xe000 === 0x2000`)
     - 教育网 CERNET：`2001:da8::/32` (`0x2001 & 0xe000 === 0x2000`)
   - 规则：一旦候选地址命中公网 IPv6，哪怕 candidateType 为 host，判定结果绝对为 `"P2P"`，严禁判定为 `"LAN"`！

### 2.3 纯函数 IP 工具集设计方案 (`apps/web/src/utils/ipClassifier.ts`)

为了保障零外部依赖、极致性能与 100% 可测性，建议新建 `apps/web/src/utils/ipClassifier.ts`：

```typescript
/**
 * 纯函数网络地址规范化与 IP 分类工具
 * 严格支持 RFC 1918、RFC 4193 (ULA)、RFC 4291 (Link-Local / Loopback) 与 RFC 3587 (Global Unicast IPv6)
 */

/** 从可能是带端口、括号或带作用域 ID 的地址字符串中清洗出纯 IP */
export function extractIpAddress(raw?: string | null): string {
  if (!raw) return "";
  let addr = raw.trim();
  // 匹配形如 [240e:...]:5000 或 [240e:...]
  const bracketMatch = addr.match(/^\[([a-fA-F0-9:.]+)\](?::\d+)?$/);
  if (bracketMatch) {
    addr = bracketMatch[1];
  } else {
    // 匹配形如 192.168.1.1:5000
    const ipv4PortMatch = addr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
    if (ipv4PortMatch) {
      addr = ipv4PortMatch[1];
    }
  }
  // 剔除 IPv6 Scope/Zone 索引（例如 fe80::1%12 或 fe80::1%eth0）
  const zoneIndex = addr.indexOf("%");
  if (zoneIndex !== -1) {
    addr = addr.slice(0, zoneIndex);
  }
  return addr.toLowerCase();
}

/** 解析 IPv4 为 4 个十进制数字组；非法返回 null */
export function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith("0")) return null; // 禁止无意义前导零
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/** 校验是否为合法 IPv4 */
export function isValidIpv4(ip: string): boolean {
  return parseIpv4(extractIpAddress(ip)) !== null;
}

/** 校验 RFC 1918 私网 IPv4 (10/8, 172.16/12, 192.168/16) */
export function isPrivateIpv4(ip: string): boolean {
  const oct = parseIpv4(extractIpAddress(ip));
  if (!oct) return false;
  const [a, b] = oct;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** 校验回环 IPv4 (127.0.0.0/8) */
export function isLoopbackIpv4(ip: string): boolean {
  const oct = parseIpv4(extractIpAddress(ip));
  return oct !== null && oct[0] === 127;
}

/** 校验链路本地 IPv4 (169.254.0.0/16) */
export function isLinkLocalIpv4(ip: string): boolean {
  const oct = parseIpv4(extractIpAddress(ip));
  return oct !== null && oct[0] === 169 && oct[1] === 254;
}

/** 将 IPv6 解析为 8 个 16 位整数数组；非法返回 null */
export function parseIpv6(ip: string): number[] | null {
  const cleaned = extractIpAddress(ip);
  if (!cleaned) return null;
  if (cleaned.startsWith(":") && !cleaned.startsWith("::")) return null;
  if (cleaned.endsWith(":") && !cleaned.endsWith("::")) return null;

  const doubleColons = (cleaned.match(/::/g) || []).length;
  if (doubleColons > 1) return null;

  const parseHextets = (list: string[]): number[] | null => {
    const res: number[] = [];
    for (const h of list) {
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
    if (rightParts.length > 0 && rightParts[rightParts.length - 1].includes(".")) {
      const v4 = parseIpv4(rightParts.pop()!);
      if (!v4) return null;
      embeddedIpv4 = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    }

    const totalProvided = leftParts.length + rightParts.length + embeddedIpv4.length;
    if (totalProvided > 7) return null;
    const zeros = new Array(8 - totalProvided).fill(0);

    const leftHex = parseHextets(leftParts);
    const rightHex = parseHextets(rightParts);
    if (!leftHex || !rightHex) return null;

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

/** 校验是否为合法 IPv6 */
export function isValidIpv6(ip: string): boolean {
  return parseIpv6(extractIpAddress(ip)) !== null;
}

/** 校验 RFC 4193 唯一本地 IPv6 (ULA: fc00::/7，包含 fc00::/8 与 fd00::/8) */
export function isUlaIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xfe00) === 0xfc00;
}

/** 校验 RFC 4291 链路本地 IPv6 (fe80::/10) */
export function isLinkLocalIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xffc0) === 0xfe80;
}

/** 校验回环 IPv6 (::1) */
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

/** 校验是否为任何回环 IP (127.0.0.0/8 或 ::1) */
export function isLoopback(ip: string): boolean {
  return isLoopbackIpv4(ip) || isLoopbackIpv6(ip);
}

/** 校验公网全局单播 IPv6 (RFC 3587 / 2000::/3，涵盖电信 240e、联通 2408、移动 2409、CERNET 2001:da8 等) */
export function isPublicIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return false;
  return (hextets[0] & 0xe000) === 0x2000;
}

/** 通用 IP 合法性检查 */
export function isValidIp(ip: string): boolean {
  const clean = extractIpAddress(ip);
  return isValidIpv4(clean) || isValidIpv6(clean);
}

/** 检查 IP 是否属于局域网或内网候选 */
export function isLanCandidateIp(ip?: string | null): boolean {
  if (!ip) return false;
  const clean = extractIpAddress(ip);
  if (!clean) return false;
  return (
    isPrivateIpv4(clean) ||
    isLoopbackIpv4(clean) ||
    isLinkLocalIpv4(clean) ||
    isUlaIpv6(clean) ||
    isLinkLocalIpv6(clean) ||
    isLoopbackIpv6(clean)
  );
}

/**
 * P2P 连接拓扑决策核心算法
 * 规则：
 * 1. 任意一端为 relay -> RELAY
 * 2. 双方均为 host，且双方 IP 均符合严格局域网地址（私网 IPv4 / ULA / Link-Local / Loopback） -> LAN
 * 3. 其余情况（包含公网 IPv6 2000::/3 直连、srflx、prflx 等） -> P2P
 */
export function determineP2PConnectionType(params: {
  localCandidateType?: string;
  remoteCandidateType?: string;
  localAddress?: string;
  remoteAddress?: string;
}): "LAN" | "P2P" | "RELAY" {
  const { localCandidateType, remoteCandidateType, localAddress, remoteAddress } = params;

  if (localCandidateType === "relay" || remoteCandidateType === "relay") {
    return "RELAY";
  }

  if (localCandidateType === "host" && remoteCandidateType === "host") {
    if (isLanCandidateIp(localAddress) && isLanCandidateIp(remoteAddress)) {
      return "LAN";
    }
  }

  return "P2P";
}
```

### 2.4 在 `VoiceMeshManager.ts` 中的调用集成方案
在 `startStatsMonitoring()`（行 1741-1770）中：
```typescript
if (selectedPair) {
  const pair = selectedPair as RTCStats & {
    localCandidateId?: string;
    remoteCandidateId?: string;
  };
  const localCandidate = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
  const remoteCandidate = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : undefined;
  const localType = localCandidate?.candidateType;
  const remoteType = remoteCandidate?.candidateType;
  const rawLocalAddr = localCandidate?.address || localCandidate?.ip;
  const rawRemoteAddr = remoteCandidate?.address || remoteCandidate?.ip;

  connectionType = determineP2PConnectionType({
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    localAddress: rawLocalAddr,
    remoteAddress: rawRemoteAddr,
  });
}
```
此改造确保了电信、联通、移动的全局单播 IPv6 即使作为物理网卡 host 接入，也绝对不会进入 `LAN` 分支，100% 准确显示为 `P2P`。

---

## 3. R2 专项调研：Voice Connection Popover 与左下角状态区 P2P 专属重构

### 3.1 左下角状态栏解耦改造分析 (`apps/web/src/components/ChannelSidebar.tsx`)

#### 当前代码调用链与结构现状
- 行 1334-1468：
  ```tsx
  <div className="flex items-center justify-between">
    <button
      type="button"
      data-testid="voice-connection-status-btn"
      aria-expanded={isConnectionPopoverOpen}
      onClick={voiceConnectionStatus === "connecting" ? undefined : () => setIsConnectionPopoverOpen((prev) => !prev)}
      className="flex items-center space-x-2 text-left p-1 -ml-1 rounded-lg transition group max-w-[calc(100%-36px)] ..."
    >
      {/* 信号图标 */}
      <Signal ... />
      <div className="min-w-0">
        <div className="flex items-center space-x-1.5 leading-tight">
          <span>{t("voice:voiceConnected")}</span>
          <span data-testid="voice-connection-latency">P2P 24ms</span>
        </div>
        <div className="text-[11px] text-discord-textMuted truncate max-w-[130px]">
          {activeVoiceChannel.name} / {t("voice:medianLatency")} {/* ❌ 需彻底移除此文案 */}
        </div>
      </div>
    </button>
    <button onClick={onLeaveVoiceChannel} ...>
      <PhoneOff ... />
    </button>
  </div>
  ```

#### 缺陷与 E2E 测试兼容性注意点
- **E2E 断言依赖**：
  - `e2e/live-streaming-and-connection-popover.spec.ts:25` 和 `e2e/voice-channel-topology-mode.spec.ts:192` 明确断言：
    `await expect(page.getByTestId("voice-connection-status-btn")).toContainText("语音已连接");`
    `await expect(page.getByTestId("voice-connection-latency")).toHaveText("24ms");`
    `await trigger.click();` 且断言 `aria-expanded="true"`。
- **解耦设计要求**：
  1. 必须保留 `data-testid="voice-connection-status-btn"` 作为触发 Popover 打开/折叠的按钮主体；
  2. 频道名称必须抽离为独立的交互区域（或内部带有 `e.stopPropagation()` 的导航按钮/标签），点击时直接调用 `onSelectChannel(activeVoiceChannel)` 导航回语音主舞台；
  3. 彻底移除 ` / {t("voice:medianLatency")}` 与 ` / {t("voice:activeSpeakerLatency")}` 后缀，仅保留纯净的频道名称 `{activeVoiceChannel.name}`。

#### 拟修改 TSX 结构设计
```tsx
<div className="flex items-center justify-between">
  <div className="flex flex-col min-w-0 max-w-[calc(100%-36px)]">
    {/* 信号与状态区域：点击展开/折叠 Popover */}
    <button
      type="button"
      data-testid="voice-connection-status-btn"
      aria-expanded={isConnectionPopoverOpen}
      onClick={
        voiceConnectionStatus === "connecting"
          ? undefined
          : () => setIsConnectionPopoverOpen((prev) => !prev)
      }
      className={`flex items-center space-x-2 text-left p-1 -ml-1 rounded-lg transition group ${
        voiceConnectionStatus === "connecting"
          ? "cursor-default opacity-90"
          : "hover:bg-[#35373c]/60 cursor-pointer"
      }`}
      title={...}
    >
      {/* 信号指示图标 */}
      {voiceConnectionStatus === "connecting" ? (
        <Loader2 className="w-4 h-4 text-[#faa61a] animate-spin flex-shrink-0" />
      ) : voiceConnectionStatus === "reconnecting" ? (
        <Loader2 className="w-4 h-4 text-discord-danger animate-spin flex-shrink-0" />
      ) : (
        <Signal className={`w-4 h-4 ${qualityColor} animate-pulse flex-shrink-0`} />
      )}
      <div className="flex items-center space-x-1.5 leading-tight min-w-0">
        <span
          className={`text-xs font-bold ${
            voiceConnectionStatus === "connecting"
              ? "text-[#faa61a]"
              : voiceConnectionStatus === "reconnecting"
                ? "text-discord-danger"
                : qualityColor
          }`}
        >
          {voiceConnectionStatus === "connecting"
            ? t("voice:voiceConnecting")
            : voiceConnectionStatus === "reconnecting"
              ? t("voice:voiceReconnecting")
              : t("voice:voiceConnected")}
        </span>
        <span
          data-testid="voice-connection-latency"
          className={`text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1e1f22] border border-[#2b2d31] ${
            voiceConnectionStatus === "connecting"
              ? "text-[#faa61a]"
              : qualityColor
          } group-hover:border-discord-brand transition-colors`}
        >
          {latencyBadgeStr}
        </span>
      </div>
    </button>

    {/* 语音频道名称：点击导航切换回语音主舞台 */}
    <button
      type="button"
      data-testid="voice-connection-channel-name"
      onClick={(e) => {
        e.stopPropagation();
        if (activeVoiceChannel) {
          onSelectChannel(activeVoiceChannel);
        }
      }}
      className="text-left text-[11px] text-discord-textMuted hover:text-white transition-colors truncate max-w-[150px] px-1 -ml-1 py-0.5 rounded hover:bg-[#35373c]/40 cursor-pointer"
      title={activeVoiceChannel.name}
    >
      {activeVoiceChannel.name}
    </button>
  </div>

  {/* 挂断按钮 */}
  <button
    onClick={onLeaveVoiceChannel}
    className="p-1.5 text-discord-textMuted hover:text-discord-danger hover:bg-[#35373c] rounded transition flex-shrink-0"
    title={t("voice:disconnect")}
  >
    <PhoneOff className="w-4 h-4" />
  </button>
</div>
```

---

### 3.2 Popover P2P 面板重构分析 (`apps/web/src/components/VoiceConnectionStatusPopover.tsx`)

#### 当前代码现状
- 目前无论 SFU 还是 P2P，都渲染同一个 Canvas 折线图（行 538-545）：
  `<canvas ref={canvasRef} className="w-full h-full block" />`
- 行 80-82：`const meshActive = !!channel?.id && mediaConnected && voiceMeshManager.getIsMeshActive();`
- 行 91-97：当前 P2P 下只取了单点中位数延迟构造时间序列曲线。

#### P2P 专属面板新需求拆解与架构设计
根据需求 R2，当 `meshActive === true` 时，应呈现专用 P2P 拓扑面板：
1. **顶部指标行**：
   - **全员平均 RTT 延迟**：
     ```typescript
     const connectedReports = Array.from(peerLatencies.values()).filter(
       (r) => r.status === "connected" && r.rtt > 0
     );
     const allPeersAvgRtt = connectedReports.length > 0
       ? Math.round(connectedReports.reduce((s, r) => s + r.rtt, 0) / connectedReports.length)
       : null;
     ```
   - **整体丢包率**：
     ```typescript
     const validLosses = connectedReports
       .filter((r) => typeof r.packetLoss === "number")
       .map((r) => r.packetLoss!);
     const overallPacketLoss = validLosses.length > 0
       ? (validLosses.reduce((s, l) => s + l, 0) / validLosses.length).toFixed(1)
       : packetLossPercent;
     ```
2. **直连节点柱状图 (Direct Peer Histogram)**：
   - 采用精致的 DOM/SVG 弹性布局（高质感 Discord 极客风），横轴按直连在线成员排列；
   - 柱高根据各成员的真实 RTT 映射（以 200ms 为基准自适应缩放）；
   - **柱身/柱条颜色**根据健康状态自适应：
     - `rtt < 100ms`：`#23a55a`（健康绿）
     - `100ms <= rtt <= 200ms`：`#f0b232`（警告黄）
     - `rtt > 200ms`：`#f23f43`（严重红）
   - **柱顶/柱底清晰展示对应用户的 Avatar 头像与毫秒标签**：
     - 头像规格：`20px * 20px` 圆形头像，带状态描边；
     - 延迟标签：`${report.rtt}ms` 等宽字体；
   - **鼠标悬停浮层（Hover Tooltip）**：
     - 鼠标悬停在柱子或头像上时，弹出悬浮卡片显示：
       - 用户名（DisplayName）
       - 直连 RTT 往返时延
       - 抖动 Jitter（毫秒）
       - 丢包率 Packet Loss（百分比）
       - 直连类型（LAN / P2P / RELAY）
       - 本端/远端 IP（若有）
3. **SFU 兼容性守护**：
   - 当 `meshActive === false`（即普通 SFU 模式）时，**无缝保留现有的 Canvas Spline 示波曲线与 SFU 状态**，确保 `e2e/live-streaming-and-connection-popover.spec.ts` 自动化回归测试 100% 通过。

---

## 4. R4 专项调研：WebRTC 媒体引擎与网络健康看板直连 IP 呈现

### 4.1 类型协议扩充 (`packages/types/src/index.ts`)
- **位置**：行 1202-1210
- **当前定义**：
  ```typescript
  export interface PeerLatencyReport {
    targetUserId: string;
    rtt: number;
    jitter?: number;
    packetLoss?: number;
    connectionType: "LAN" | "P2P" | "RELAY" | "SFU";
    status: "connecting" | "connected" | "failed";
    updatedAt: number;
  }
  ```
- **拟扩充方案**：
  ```typescript
  export interface PeerLatencyReport {
    targetUserId: string;
    rtt: number;
    jitter?: number;
    packetLoss?: number;
    connectionType: "LAN" | "P2P" | "RELAY" | "SFU";
    status: "connecting" | "connected" | "failed";
    localAddress?: string;      // 本端直连 IP 地址 (可能带端口，如 192.168.1.10:52341 或 [240e:...]:52341)
    remoteAddress?: string;     // 远端直连 IP 地址 (可能带端口)
    candidateType?: string;     // 候选类型 (host | srflx | prflx | relay)
    updatedAt: number;
  }
  ```

### 4.2 统计采集与上报 (`apps/web/src/services/p2p/VoiceMeshManager.ts`)
- **位置**：行 1670-1770 `startStatsMonitoring()`
- **采集逻辑**：
  WebRTC `RTCStatsReport` 中，选中的 `candidate-pair` 会关联 `localCandidateId` 和 `remoteCandidateId`。
  从 `stats.get(pair.localCandidateId)` 与 `stats.get(pair.remoteCandidateId)` 中提取：
  - `localCandidate.address || localCandidate.ip`
  - `localCandidate.port`
  - `remoteCandidate.address || remoteCandidate.ip`
  - `remoteCandidate.port`
  - `remoteCandidate.candidateType || localCandidate.candidateType`
- **格式化格式**：
  IPv6 地址带端口时遵循标准方括号语法：`[240e:xxx:...]:port`；IPv4 地址为 `192.168.1.xxx:port`。
- **状态存储**：
  写入 `this.latencyReports.set(peerId, { ... })`，通过 `notifyLatencyUpdate()` 实时广播。

### 4.3 看板 UI 展示 (`apps/web/src/components/modals/NetworkQualityModal.tsx`)
- **位置**：行 712-732
- **现状**：
  ```tsx
  {Array.from(peerLatencies.entries()).map(([peerId, rep]) => (
    <div key={peerId} className="bg-[#1e1f22] px-3 py-2 rounded-lg border border-[#2b2d31] space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-discord-textNormal font-mono text-[11px]">
          Peer: {peerId.slice(0, 8)}...
        </span>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-discord-green font-bold">
            {rep.rtt > 0 ? `${rep.rtt} ms` : t("voice:networkStats.unknown")}
          </span>
          <span className="text-discord-textMuted text-[10px]">{rep.connectionType}</span>
        </div>
      </div>
      ...
  ```
- **拟修改方案**：
  在每个 Peer 卡片顶部或收发指标上方，增加直连 IP/端口展示行：
  ```tsx
  {(rep.remoteAddress || rep.localAddress) && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-discord-textMuted bg-black/25 px-2 py-1 rounded border border-white/5">
      {rep.remoteAddress && (
        <span className="flex items-center space-x-1">
          <span className="text-white/60">{t("voice:networkStats.remoteIp")}:</span>
          <span className="text-emerald-400 select-all">{rep.remoteAddress}</span>
        </span>
      )}
      {rep.localAddress && (
        <span className="flex items-center space-x-1">
          <span className="text-white/60">{t("voice:networkStats.localIp")}:</span>
          <span className="text-white/90 select-all">{rep.localAddress}</span>
        </span>
      )}
      {rep.candidateType && (
        <span className="px-1 py-0.2 rounded bg-white/10 text-white/70 uppercase text-[9px]">
          {rep.candidateType}
        </span>
      )}
    </div>
  )}
  ```

---

## 5. 国际化与本地化规范 (i18n) 影响分析

遵循 `AGENTS.md` 规范，修改与新增文案必须**严格且对称地同步到 5 套语言包**（`zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`），绝对禁止硬编码中文。

### 涉及的多语言键值：
在 `apps/web/src/i18n/locales/*/voice.json` 中：
1. `connectionPopover.allPeersAvgRtt`:
   - `zh-CN`: "全员平均延迟"
   - `zh-TW`: "全員平均延遲"
   - `zh-HK`: "全員平均延遲"
   - `en-US`: "Average Peer Latency"
   - `ja-JP`: "全員の平均レイテンシ"
2. `connectionPopover.overallPacketLoss`:
   - `zh-CN`: "整体丢包率"
   - `zh-TW`: "整體丟包率"
   - `zh-HK`: "整體丟包率"
   - `en-US`: "Overall Packet Loss"
   - `ja-JP`: "全体のパケットロス率"
3. `connectionPopover.directPeerTopology`:
   - `zh-CN`: "直连节点拓扑"
   - `zh-TW`: "直連節點拓撲"
   - `zh-HK`: "直連節點拓撲"
   - `en-US`: "Direct Peer Topology"
   - `ja-JP`: "直接ピアトポロジ"
4. `networkStats.remoteIp`:
   - `zh-CN`: "远端 IP"
   - `zh-TW`: "遠端 IP"
   - `zh-HK`: "遠端 IP"
   - `en-US`: "Remote IP"
   - `ja-JP`: "リモート IP"
5. `networkStats.localIp`:
   - `zh-CN`: "本端 IP"
   - `zh-TW`: "本端 IP"
   - `zh-HK`: "本端 IP"
   - `en-US`: "Local IP"
   - `ja-JP`: "ローカル IP"

---

## 6. 测试与质量保证方案

### 6.1 单元测试方案 (`apps/web/src/utils/ipClassifier.spec.ts`)
编写专项单元测试，全面覆盖各类网络场景与边缘边界：
1. **RFC 1918 私网 IPv4**：
   - 断言 `10.0.0.1`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1` 为 `true`；
   - 断言 `172.15.255.255`, `172.32.0.1`, `8.8.8.8`, `1.1.1.1` 为 `false`。
2. **RFC 4193 ULA IPv6 (`fc00::/7`)**：
   - 断言 `fd12:3456:789a::1`, `fc00::1`, `fd00::1` 为 `true`；
   - 断言 `fe80::1`, `240e:398::1` 为 `false`。
3. **链路本地与回环**：
   - 断言 `127.0.0.1`, `::1` 在 `isLoopback` 中为 `true`；
   - 断言 `fe80::1ff:fe00:1`, `169.254.1.1` 属于内网/链路候选。
4. **公网 IPv6 (`2000::/3`) 精准判定**：
   - 中国电信：`240e:398:123:456::1` -> `isPublicIpv6` 为 `true`，`isLanCandidateIp` 为 `false`；
   - 中国联通：`2408:8207:123::1` -> `isPublicIpv6` 为 `true`，`isLanCandidateIp` 为 `false`；
   - 中国移动：`2409:8a00:123::1` -> `isPublicIpv6` 为 `true`，`isLanCandidateIp` 为 `false`；
   - CERNET：`2001:da8::1` -> `isPublicIpv6` 为 `true`，`isLanCandidateIp` 为 `false`。
5. **综合决策测试 `determineP2PConnectionType`**：
   - 场景 1：双方 host + 私网 IPv4 -> 断言 `"LAN"`；
   - 场景 2：双方 host + ULA IPv6 (`fd12::1`) -> 断言 `"LAN"`；
   - 场景 3：双方 host + 中国电信公网 IPv6 (`240e:...`) -> **严正断言 `"P2P"`**；
   - 场景 4：一方 host + 一方 srflx -> 断言 `"P2P"`；
   - 场景 5：一方为 relay -> 断言 `"RELAY"`。

### 6.2 端到端 (Playwright E2E) 测试方案
1. 验证左下角状态栏无“全员中位数延迟”文字残留，仅显示频道名称；
2. 验证点击左下角频道名称能正常触发切回语音频道主舞台；
3. 验证点击左下角信号图标能展开 Popover，且在 P2P 模式下渲染直连成员柱状图与头像；
4. 验证在 SFU 模式下现有测试 `e2e/live-streaming-and-connection-popover.spec.ts` 保持 100% 通过（PASS）；
5. 验证网络质量看板中直连节点卡片展示直连 IP/端口。

---

## 7. 下游实现执行路线图 (Action Plan)

1. **第 1 步 (协议层)**：修改 `packages/types/src/index.ts`，为 `PeerLatencyReport` 增加 `localAddress`, `remoteAddress`, `candidateType` 可选字段。
2. **第 2 步 (算法层)**：实现 `apps/web/src/utils/ipClassifier.ts` 并在配套单元测试中验证所有 RFC 规则。
3. **第 3 步 (引擎层)**：在 `VoiceMeshManager.ts` 中接入 `determineP2PConnectionType`，提取并持久化候选 IP/端口到 `latencyReports`。
4. **第 4 步 (UI 层 - 状态栏)**：重构 `ChannelSidebar.tsx` 左下角状态栏，彻底解耦频道导航与 Popover 展开，消除中位数延迟文案。
5. **第 5 步 (UI 层 - Popover)**：重构 `VoiceConnectionStatusPopover.tsx`，加入 P2P 全员平均 RTT、丢包率与直连柱状图及头像渲染，保留 SFU 示波器回退。
6. **第 6 步 (UI 层 - 看板)**：在 `NetworkQualityModal.tsx` 直连节点卡片中渲染本端与远端直连 IP/端口。
7. **第 7 步 (i18n & 门禁)**：补充 5 国语言包，运行全仓库 `pnpm build` 与 Playwright 测试验证。
