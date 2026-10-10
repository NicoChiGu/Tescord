# Handoff Report — Explorer 1 (R1, R2, R4 调研)

## 1. Observation (客观观察事实)

1. **R1 局域网错误判断逻辑**：
   - 文件：`apps/web/src/services/p2p/VoiceMeshManager.ts`
   - 行号：1752-1758
   - 代码原文：
     ```typescript
     const localType = localCandidate?.candidateType;
     const remoteType = remoteCandidate?.candidateType;
     if (localType === "relay" || remoteType === "relay") {
       connectionType = "RELAY";
     } else if (localType === "host" && remoteType === "host") {
       connectionType = "LAN";
     }
     ```
   - 观察：当国内电信、联通、移动用户通过绑定在物理网卡上的公网单播 IPv6（如 `240e::/16`、`2408::/16`、`2409::/16`）直连时，WebRTC 获取的双方 `candidateType` 均为 `"host"`。由于代码未检查 IP 地址，导致此类公网直连全部被判定为 `"LAN"`。
   - 影响组件：`apps/web/src/components/VoiceRoomArea.tsx:791-798` 将其渲染为 `"局域网"` 胶囊。

2. **R2 左下角状态栏与中位数文案**：
   - 文件：`apps/web/src/components/ChannelSidebar.tsx`
   - 行号：1335-1456
   - 代码原文（行 1427-1454）：
     ```tsx
     <div className="text-[11px] text-discord-textMuted truncate max-w-[130px]">
       {activeVoiceChannel.name} /{" "}
       {(() => {
         ...
         if (meshMetrics.isSpeaker) {
           return t("voice:activeSpeakerLatency");
         }
         if (peerLatencies.size > 0) {
           return t("voice:medianLatency");
         }
         ...
       })()}
     </div>
     ```
   - 观察：当前整个状态区域被包含在一个单一的 `<button data-testid="voice-connection-status-btn">` 内部，点击其任何位置（包括频道名称）均只执行 `setIsConnectionPopoverOpen((prev) => !prev)`，用户无法通过点击频道名称导航回语音房间主视图。

3. **R2 Popover P2P 模式渲染现状**：
   - 文件：`apps/web/src/components/VoiceConnectionStatusPopover.tsx`
   - 行号：538-545
   - 代码原文：
     ```tsx
     <div ref={containerRef} ... className="...">
       <canvas ref={canvasRef} className="w-full h-full block" />
     </div>
     ```
   - 观察：当前 Popover 在 P2P 模式下仍绘制单一的时间序列 Canvas 曲线，未呈现各在线直连成员的柱状图、未展示用户 Avatar 头像，亦无悬停抖动/丢包率浮层。

4. **R4 类型协议与 IP 上报**：
   - 文件：`packages/types/src/index.ts`
   - 行号：1202-1210
   - 代码原文：
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
   - 观察：缺少 `localAddress?: string; remoteAddress?: string; candidateType?: string;` 字段。
   - 文件：`apps/web/src/components/modals/NetworkQualityModal.tsx`
   - 行号：712-732
   - 观察：直连节点卡片仅显示 `Peer: {peerId}`、`rtt` 和 `connectionType`，未显示直连物理 IP 与端口。

---

## 2. Logic Chain (推理链条)

1. **针对 R1**：
   - 观察 1 证明当前局域网判定仅依据 `localType === "host" && remoteType === "host"`。
   - 根据 RFC 3587 与中国 IPv6 地址分配，电信（`240e::/16`）、联通（`2408::/16`）、移动（`2409::/16`）属于 `2000::/3` 全局公网单播，且直接分配到物理网卡。
   - 因此 WebRTC 将公网 IPv6 标记为 `host` 候选是标准行为；
   - 由此推导：必须提取双方 `candidate.address`，并使用严格分类纯函数：仅当双方均为 `host` 且双方 IP 均属于私网 IPv4（RFC 1918）或 ULA IPv6（RFC 4193 `fc00::/7`）或 Link-Local（RFC 4291 `fe80::/10`）或 Loopback 时，才判定为 `"LAN"`；其余所有公网直连一律判定为 `"P2P"`。

2. **针对 R2**：
   - 观察 2 证明左下角状态栏的包裹 `<button>` 阻止了独立的导航行为，并强行拼接了中位数文案。
   - 由此推导：
     a. 需彻底移除 ` / {t("voice:medianLatency")}`，仅呈现 `{activeVoiceChannel.name}`；
     b. 将频道名称拆为带有 `onClick={(e) => { e.stopPropagation(); onSelectChannel(activeVoiceChannel); }}` 的独立点击元素；
     c. 保留外部或信号区域的 `data-testid="voice-connection-status-btn"` 用于 Popover 展开，确保既有 Playwright E2E 测试兼容；
     d. 在 Popover 中判断 `meshActive`：若为 true，渲染按直连成员排列的柱状图、Avatar 头像与悬停浮层；若为 false，保留既有 Canvas 曲线满足 SFU 模式与现有 E2E 测试要求。

3. **针对 R4**：
   - 观察 4 证明底层协议与统计采集均未保留所选候选对的物理 IP 与端口。
   - 由此推导：在 `PeerLatencyReport` 中新增 `localAddress`, `remoteAddress`, `candidateType`，并在 `VoiceMeshManager.ts` 的 `pc.getStats()` 中提取选中的 `localCandidate` 与 `remoteCandidate` 地址和端口存入；最后在 `NetworkQualityModal.tsx` 的节点卡片中展示。

---

## 3. Caveats (局限与前提假设)

1. **R3、R5、R6 职责边界**：本调研专注于 R1、R2、R4。聚焦模式宽高比自适应（R3）、伴音混音器移除（R5）与图片预览动效（R6）由其他子代理负责，本报告未展开其具体实现。
2. **多语言对称性约束**：新增的展示字段（如“远端 IP”、“本端 IP”、“直连节点拓扑”）必须同步至 5 套语言包（`zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`），不可遗漏。
3. **SFU 回退兼容性前提**：在重构 Popover 时，必须以 `meshActive` 为分支开关；SFU 模式下的 Canvas 和结构不可破坏，以防破坏既有 E2E 测试。

---

## 4. Conclusion (最终结论与行动方案)

1. **核心产物**：已在工作目录下生成详尽调研报告 `e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_1\report.md`，内含纯函数算法源码、TSX 结构重构草案与测试用例设计。
2. **结论明确**：
   - R1：通过创建纯函数工具 `ipClassifier.ts`，基于位掩码与正则彻底解决公网 IPv6 误判问题。
   - R2：通过解耦 `ChannelSidebar.tsx` 点击事件并重构 `VoiceConnectionStatusPopover.tsx` P2P 分支，完美满足成员柱状图、头像展示与中位数文案移除要求。
   - R4：在 `packages/types` 扩充 3 个可选字段，在引擎采集并保存，并在 `NetworkQualityModal.tsx` 直连卡片中呈现。

---

## 5. Verification Method (独立验证方法)

1. **单元测试验证**：
   - 执行命令：`pnpm --filter @tescord/web exec vitest run src/utils/ipClassifier.spec.ts` 或运行配套 Node/Playwright 纯函数测试。
   - 预期结果：公网 IPv6（`240e:398:xxx`, `2001:da8:xxx`）直连断言为 `P2P`；私网 IPv4 与 ULA IPv6 直连断言为 `LAN`；TURN 断言为 `RELAY`。
2. **全模块构建与类型检查**：
   - 执行命令：`pnpm build`
   - 预期结果：TypeScript 零报错，全部模块编译通过。
3. **E2E 自动化回归验证**：
   - 执行命令：`pnpm exec playwright test e2e/live-streaming-and-connection-popover.spec.ts e2e/voice-channel-topology-mode.spec.ts`
   - 预期结果：既有测试全部 PASS。
