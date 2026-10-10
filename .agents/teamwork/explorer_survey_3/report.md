# Tescord 调研报告：R6、R7、国际化多语言与测试工程全貌

> **调研员**：Explorer 3 (qa-verification / research)  
> **日期**：2026-10-09  
> **工作目录**：`e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_3\`  
> **目标需求**：R6（图片加载与原图查看器体验升级）、R7（国际化全域对齐与代码整洁度红线）及测试工程现状（Vitest / Playwright）

---

## 目录
1. [重点项 1：聊天图片加载动效（ImageAttachment.tsx）现状与升级方案](#1-重点项-1聊天图片加载动效imageattachmenttsx现状与升级方案)
2. [重点项 2：原图预览 Lightbox（LightboxModal.tsx）现状与体验升级方案](#2-重点项-2原图预览-lightboxlightboxmodaltsx现状与体验升级方案)
3. [重点项 3：国际化多语言（5套语言包）全域对齐现状与改动词条规划](#3-重点项-3国际化多语言5套语言包全域对齐现状与改动词条规划)
4. [重点项 4：测试工程体系现状与单测／E2E 补充方案](#4-重点项-4测试工程体系现状与单测e2e-补充方案)
5. [综合架构建议与实施风险检查清单](#5-综合架构建议与实施风险检查清单)

---

## 1. 重点项 1：聊天图片加载动效（ImageAttachment.tsx）现状与升级方案

### 1.1 代码位置与当前实现分析
- **文件路径**：`apps/web/src/components/chat/ImageAttachment.tsx`
- **状态流转**：
  ```ts
  const [status, setStatus] = useState<"loading" | "renewing" | "loaded" | "error">("loading");
  const [imageUrl, setImageUrl] = useState<string>();
  ```
- **现有骨架屏逻辑**（L149-163）：
  ```tsx
  {status === "loading" && (
    <div
      data-testid="image-skeleton"
      style={{ width: "100%", height: "100%" }}
      className="relative bg-[#2b2d31] animate-pulse overflow-hidden flex flex-col items-center justify-center text-discord-textMuted/40"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none" />
      <div className="relative flex items-center justify-center">
        <ImageIcon className="w-8 h-8 opacity-40 animate-pulse" />
        <Loader2 className="absolute w-5 h-5 text-discord-brand/70 animate-spin" />
      </div>
    </div>
  )}
  ```
- **现有图片挂载与加载逻辑**（L205-251）：
  ```tsx
  {imageUrl && status !== "error" && (
    <button
      className={status === "loaded" ? "block w-full h-full" : "absolute opacity-0 pointer-events-none w-full h-full"}
      ...
    >
      <img
        src={imageUrl}
        onLoad={() => {
          setStatus("loaded");
          onLoadSuccess?.();
        }}
        className="block transition duration-200 group-hover/att:scale-105"
      />
    </button>
  )}
  ```

### 1.2 现状缺陷诊断
1. **突兀消失（Pop-in），缺乏淡入过渡**：
   - 当 `<img>` 触发 `onLoad` 时，`setStatus("loaded")`。
   - 条件 `{status === "loading" && <div ...>}` 在同一渲染帧内变为 `false`，骨架屏在 0ms 内瞬间卸载被销毁；
   - `<button>` 上的类由 `opacity-0` 瞬间变为 `block w-full h-full`，虽然有 `group-hover` 的缩放过渡，但**完全没有渐隐淡入（Fade-in）过渡效果**，产生视觉闪烁跳跃。
2. **扫光（Shimmer）几乎不可见**：
   - 现有的扫光渐变仅为 `via-white/5`，在 `#2b2d31` 深色底色上对比度极其微弱，且缺少自然的呼吸微光感。
3. **E2E 测试门禁约束**：
   - 现有测试 `e2e/chat-image-skeleton.spec.ts` 断言了：
     - `expect(skeleton).toBeVisible()` 且包含 `animate-pulse`；
     - 加载完成后 `expect(skeleton).not.toBeVisible()`。
   - 方案必须保证在 CSS 淡出的同时，Playwright 能够正确判定骨架屏已离开视口或不可见（Playwright 会将 `opacity: 0` 判定为 `not.toBeVisible()`）。

### 1.3 改造方案设计与代码建议
1. **双层重叠 + 平滑淡入淡出机制**：
   - 骨架屏不再采用即时卸载，而是作为底层绝对定位容器，附加 `transition-opacity duration-300 ease-out`：
     ```tsx
     <div
       data-testid="image-skeleton"
       aria-hidden={status === "loaded"}
       className={`absolute inset-0 bg-[#2b2d31] overflow-hidden flex flex-col items-center justify-center transition-opacity duration-300 ease-out ${
         status === "loaded" ? "opacity-0 pointer-events-none" : "opacity-100 animate-pulse"
       }`}
     >
       {/* 增强质感平滑扫光 */}
       <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/[0.08] to-transparent pointer-events-none" />
       <div className="relative flex items-center justify-center">
         <ImageIcon className="w-8 h-8 text-discord-textMuted/30 animate-pulse" />
         <Loader2 className="absolute w-5 h-5 text-discord-brand/70 animate-spin" />
       </div>
     </div>
     ```
2. **图片层淡入进入**：
   - 图片容器始终挂载在顶层，`img` 具有 `transition-opacity duration-300 ease-out`：
     ```tsx
     <button
       type="button"
       className={`block w-full h-full transition-opacity duration-300 ease-out ${
         status === "loaded" ? "opacity-100" : "opacity-0 pointer-events-none"
       }`}
     >
       <img
         src={imageUrl}
         alt={fileName}
         loading="lazy"
         decoding="async"
         style={{ width: "100%", height: "100%", objectFit: "contain" }}
         onLoad={(e) => {
           if (!rawWidth || !rawHeight) {
             const nw = e.currentTarget.naturalWidth;
             const nh = e.currentTarget.naturalHeight;
             if (nw > 0 && nh > 0) {
               setNaturalDims({ width: nw, height: nh });
             }
           }
           setStatus("loaded");
           onLoadSuccess?.();
         }}
         onError={() => setStatus("error")}
         className="block transition-transform duration-200 group-hover/att:scale-105"
       />
     </button>
     ```
   - 这样在图片解码完成后，真实图片优雅淡入（0 -> 1），骨架屏在底层平滑淡出（1 -> 0），完全消除了突变跳跃感。

---

## 2. 重点项 2：原图预览 Lightbox（LightboxModal.tsx）现状与体验升级方案

### 2.1 代码真实位置纠偏
- **重要发现**：派发需求中提到的目标文件路径为 `apps/web/src/components/modals/LightboxModal.tsx`，但在代码库中，**实际真实路径为**：
  `apps/web/src/components/chat/LightboxModal.tsx`
  （`apps/web/src/components/modals/` 下并无此文件，实现时务必直接修改 `chat/LightboxModal.tsx`）。

### 2.2 现状实现与缺陷诊断
- **当前加载进度与反馈条**（L794-851）：
  - 位于视口底部边缘：`className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[90vw] bg-black/80 rounded-lg px-4 py-3 text-sm text-white flex flex-col gap-2"`；
  - 采用原生 HTML `<progress>` 标签搭配生硬的纯文本：`<span>{{loaded}} / {{total}} MB · XX%</span>`；
  - 视觉上粗糙突兀，被挤在底部角落，用户难以第一时间察觉原图下载加载状态。
- **当前缩略图替换机制**（L175-224）：
  - 当用户点击“原图”时，下载并解码 original Blob 后，直接调用 `setImageUrl(objectUrl)`；
  - 单一 `<img ref={imageRef} src={imageUrl} />` 瞬间切换 `src`，产生浏览器图片解码重绘时的闪烁与短暂空白；
- **当前 HD 徽章状态**（L701-707, L862）：
  - 仅在底部信息栏以弱文本展示 `· 原图`；
  - 右上角工具栏中的“查看原图”按钮在原图就绪后仅表现为 `disabled` 变灰状态，无高质感的高清点亮反馈。

### 2.3 升级设计方案

#### A. 画面中心高质感磨砂毛玻璃环形进度环（Radial Progress）
1. **居中覆盖定位**：
   - 脱离底部边界，使用绝对居中卡片：
     `absolute inset-0 flex items-center justify-center pointer-events-none z-30`；
   - 内部卡片使用高质感磨砂亚克力玻璃材质：
     `pointer-events-auto bg-[#1e1f22]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3 animate-fade-in`；
2. **SVG 环形进度条组件**：
   - 采用矢量 `<svg viewBox="0 0 80 80" className="w-20 h-20">`；
   - 底轨：`<circle cx="40" cy="40" r="32" stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="none" />`；
   - 动态进度轨：周长 $C = 2 \times \pi \times 32 \approx 201.06$；
     ```tsx
     const percent = loadProgress.total
       ? Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))
       : 0;
     const strokeDashoffset = 201.06 * (1 - percent / 100);
     ```
     `<circle cx="40" cy="40" r="32" stroke="#5865F2" strokeWidth="5" strokeLinecap="round" strokeDasharray="201.06" strokeDashoffset={strokeDashoffset} fill="none" className="transition-[stroke-dashoffset] duration-200" transform="rotate(-90 40 40)" />`
3. **中心数值与状态文本**：
   - 下载中（downloading）：环内展示粗体数字 `{percent}%`，环下方展示精致小字 `{{loaded}} / {{total}} MB`；
   - 解码中（decoding）：环内展示平滑旋转的 `<Loader2 className="w-6 h-6 animate-spin text-discord-brand" />`，环下方提示 `t("lightbox.decoding")`；
4. **测试选择器保持**：
   - 外层依然标记 `data-testid="lightbox-load-status"` 和 `role="status"`，确保 E2E 测试兼容。

#### B. 交叉渐隐（Cross-fade）无缝替换缩略图
1. **双图层重叠渲染**：
   - 底层（缩略图预览层）：展示已有本地 `fallbackUrl` 或首帧 preview，保持缩放变换；
   - 顶层（原图高清层）：原图解码前设置 `opacity-0`，解码就绪（`originalReady === true`）后切换为 `opacity-100 transition-opacity duration-300 ease-in-out`；
   - 两张图片共享完全一致的 `transform: translate3d(...) scale(...)` 视口矩阵，确保无论在缩放或平移状态下，原图与缩略图绝对重合，无缝平滑渐隐替换。

#### C. 点亮 HD 高清徽章
1. **右上角工具栏点亮**：
   - 当 `originalReady === true` 时，将原有的“查看原图”普通按钮升级为点亮的高清徽章：
     ```tsx
     <div
       data-testid="lightbox-hd-badge"
       className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-1.5 text-xs font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-fadeIn select-none"
     >
       <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
       <span>HD</span>
     </div>
     ```
2. **底部信息胶囊同步指示**：
   - 底部 `data-testid="lightbox-image-info"` 中，原图状态点亮绿色药丸徽章：
     `<span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30">HD</span>`。

---

## 3. 重点项 3：国际化多语言（5套语言包）全域对齐现状与改动词条规划

### 3.1 语言包架构现状审查
- **受控语言目录**：`apps/web/src/i18n/locales/` 下共有且仅有 5 个标准子目录：
  1. `zh-CN`（简体中文）
  2. `zh-TW`（繁體中文・台灣）
  3. `zh-HK`（繁體中文・香港）
  4. `en-US`（English）
  5. `ja-JP`（日本語）
- **命名空间对称性检查**：
  经检索，每个语言目录均完整包含以下 10 个业务域 JSON 文件，文件结构 100% 对齐：
  - `admin.json`, `auth.json`, `chat.json`, `common.json`, `contextMenu.json`
  - `errors.json`, `modals.json`, `server.json`, `settings.json`, `voice.json`

### 3.2 本次所有需求涉及的词条梳理与增删规划

下表详尽列出本次重构与优化中，涉及的所有需要**新增**、**清理**或**替换**的多语言词条规划（确保 5 套语言包键名严格 100% 对齐）：

| 命名空间 | 键路径 (`Key Path`) | 类型 | zh-CN | zh-TW | zh-HK | en-US | ja-JP | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`voice.json`** | `connectionPopover.p2pAvgPing` | **新增** | 全员平均延迟 | 全員平均延遲 | 全員平均延遲 | Average Mesh Latency | 全メンバー平均遅延 | R2：Popover P2P 面板全员延迟 |
| **`voice.json`** | `connectionPopover.directTopology` | **新增** | 直连节点拓扑 | 直連節點拓撲 | 直連節點拓撲 | Direct Node Topology | 直接接続ノードトポロジ | R2：直连拓扑指标标题 |
| **`voice.json`** | `connectionPopover.peerCount` | **已存在** | 直连成员节点数 | 直連成員節點數 | 直連成員節點數 | Connected Peers | 直接接続ピア数 | 节点计数 |
| **`voice.json`** | `connectionPopover.statsTooltip` | **已存在** | 往返时间：{{rtt}} \| 丢包：{{loss}} \| 抖动：{{jitter}} | 往返時間：{{rtt}} \| 丟包：{{loss}} \| 抖動：{{jitter}} | 往返時間：{{rtt}} \| 丟包：{{loss}} \| 抖動：{{jitter}} | Round trip: {{rtt}} \| Packet loss: {{loss}} \| Jitter: {{jitter}} | 往復時間：{{rtt}} \| パケット損失：{{loss}} \| ジッター：{{jitter}} | 柱状图悬停详情 |
| **`voice.json`** | `p2pIndependentRtt` | **新增** | 点对点独立 RTT | 點對點獨立 RTT | 點對點獨立 RTT | P2P Independent RTT | P2P 独立 RTT | R4：替换看板硬编码中文 |
| **`voice.json`** | `remoteAddress` | **新增** | 远端 IP: {{address}} | 遠端 IP: {{address}} | 遠端 IP: {{address}} | Remote IP: {{address}} | リモート IP: {{address}} | R4：直连远端 IP 地址 |
| **`voice.json`** | `localAddress` | **新增** | 本端 IP: {{address}} | 本端 IP: {{address}} | 本端 IP: {{address}} | Local IP: {{address}} | ローカル IP: {{address}} | R4：直连本端 IP 地址 |
| **`voice.json`** | `candidateType` | **新增** | 候选类型: {{type}} | 候選類型: {{type}} | 候選類型: {{type}} | Candidate: {{type}} | 候補タイプ: {{type}} | R4：候选类型展示 |
| **`voice.json`** | `nodeCount` | **新增** | {{count}} 节点 | {{count}} 節點 | {{count}} 節點 | {{count}} Nodes | {{count}} ノード | 替换看板硬编码“节点” |
| **`voice.json`** | `mediaTooltips.mixPanel` | **清理** | *(已废弃)* | *(已废弃)* | *(已废弃)* | *(已废弃)* | *(已废弃)* | R5：伴音混音器彻底清理 |
| **`chat.json`** | `lightbox.hdBadge` | **新增** | HD 高清 | HD 高畫質 | HD 高清 | HD | HD 高画質 | R6：点亮 HD 高清徽章标签 |
| **`chat.json`** | `lightbox.decoding` | **已存在** | 正在解码原图… | 正在解碼原圖… | 正在解碼原圖… | Decoding the original image… | 元画像をデコード中… | 居中毛玻璃环形解码状态 |
| **`chat.json`** | `lightbox.downloadProgress`| **已存在** | {{loaded}} / {{total}} MB | {{loaded}} / {{total}} MB | {{loaded}} / {{total}} MB | {{loaded}} / {{total}} MB | {{loaded}} / {{total}} MB | 居中毛玻璃环形下载数值 |

### 3.3 TSX 硬编码文本清理红线审查
经深入扫描，发现以下代码存在硬编码中文，必须在此次改动中一并彻底消除：
1. `apps/web/src/components/modals/NetworkQualityModal.tsx`：
   - L610：`${peerLatencies.size} 节点`（硬编码“节点”，改为 `t("voice:nodeCount", { count: peerLatencies.size })`）；
   - L708：`点对点独立 RTT`（硬编码中文，改为 `t("voice:p2pIndependentRtt")`）。
2. `apps/web/src/components/VoiceRoomArea.tsx`：
   - L497：`切换`（画中画 PiP 悬浮切换按钮硬编码中文，改为 `t("voice:mediaTooltips.swapView")` 或抽离词条）；
   - L2950, L2964, L2980：伴音混音器弹窗内的硬编码中文（伴音混音器功能按 R5 全量移除，弹窗代码直接彻底清理）。
3. `apps/web/src/components/ChannelSidebar.tsx`：
   - L1448：`return t("voice:medianLatency");`（按 R2 彻底移除中位数延迟展示，仅保留频道名称）。

---

## 4. 重点项 4：测试工程体系现状与单测／E2E 补充方案

### 4.1 Vitest 与单元测试体系调研
1. **现状发现**：
   - 虽然 `AGENTS.md` 提及了 Vitest，但主工程 `package.json` 的 `devDependencies` 中当前并**未安装 `vitest`**；
   - 现存单元逻辑测试采用两种高效的原生机制：
     - **TypeScript 快速脚本**：位于 `scripts/test-*.ts`，直接使用 `pnpm --filter @tescord/server exec tsx ../../scripts/<test-file>.ts` 配合 Node 内置 `node:assert/strict` 运行，执行极快（毫秒级）；
     - **Node 原生测试执行器**：例如 `scripts/test-dependency-security.mjs`，通过 `node --test` 运行。
2. **R1 IP 识别算法单测规划**：
   - **最佳目录**：`scripts/test-p2p-ip-classification.ts`（与 `scripts/test-user-display.ts`、`scripts/test-channel-nav-store.ts` 保持高度统一的架构规范）；
   - **执行命令**：`pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts`；
   - **测试覆盖矩阵**：
     - **断言为 P2P**：中国电信 IPv6（`240e:398:1234::1`）、中国联通 IPv6（`2408:8207::1`）、中国移动 IPv6（`2409:8a00::1`）、教育网 IPv6（`2001:da8::1`）等全局单播公网 IPv6（`2000::/3`），即便双方 candidate 类型为 `host`，断言结果必须为 `"P2P"`；
     - **断言为 LAN**：双方 IP 均为 RFC 1918 私网 IPv4（`192.168.1.10` / `10.0.0.5` / `172.16.0.2`）或 RFC 4193 ULA IPv6（`fd12:3456::1` / `fc00::1`）或 Link-Local（`fe80::1`）且双方均为 `host`，断言为 `"LAN"`；一方为公网一方为私网不可判为 LAN；
     - **断言为 RELAY**：Candidate 类型为 `relay`，断言为 `"RELAY"`。

### 4.2 Playwright E2E 测试体系调研
1. **架构与配置**（`playwright.config.ts`）：
   - 测试目录：`./e2e/`（现存 128 个自动化测试文件）；
   - 运行环境：Chromium 带模拟音视频参数（`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`）；
   - 串行 Worker：`workers: 1`，避免音视频单例状态竞态；
   - 自动化伴随 WebServer：自动拉起 `run-e2e-server.ts`（端口 3101）及 `vite preview`（端口 4173）。
2. **核心相关现存 E2E 用例**：
   - `e2e/chat-image-skeleton.spec.ts`：
     - 人工拦截图片请求注入 1200ms 延迟；
     - 断言加载期间 `[data-testid="image-skeleton"]` 处于可见状态且包含 `animate-pulse`；
     - 断言加载完成后骨架屏完全消失，图片正常展示；
     - 验证点击打开 Lightbox 与按 ESC 关闭。
   - `e2e/lightbox-interaction-and-download.spec.ts`：
     - 断言 Lightbox 模态框打开；
     - 验证双击缩放 1x ↔ 200%；
     - 拦截 `/api/attachments/access` 验证下载加载条（`animate-spin`）及下载失败 Toast；
     - 验证点击背景快速关闭。
   - `e2e/i18n-language-switch.spec.ts`：
     - 验证 5 种语言动态热切换与本地持久化。
3. **针对本次改动的 E2E 验收与扩展策略**：
   - **R6 Lightbox 居中环形进度与 HD 徽章验证**：
     - 在 `e2e/lightbox-interaction-and-download.spec.ts` 中拦截 original 原图下载，断言 `[data-testid="lightbox-load-status"]` 呈现且包含环形进度百分比；原图加载完成后断言 `[data-testid="lightbox-hd-badge"]` 可见；
   - **R2 Popover P2P 延迟柱状图验证**：
     - 可在现有的 `e2e/live-streaming-and-connection-popover.spec.ts` 或 `e2e/voice-channel-interaction.spec.ts` 中验证打开 Popover 包含 P2P 直连节点柱状图元素；
   - **验证执行指令**：
     ```bash
     npx playwright test e2e/chat-image-skeleton.spec.ts e2e/lightbox-interaction-and-download.spec.ts
     ```

---

## 5. 综合架构建议与实施风险检查清单

### 5.1 实施顺序与依赖拓扑
1. **阶段 1：类型先行（Contract-First）**
   - 修改 `packages/types/src/index.ts`：扩充 `PeerLatencyReport` 字段（`localAddress`, `remoteAddress`, `candidateType`），清理 `AudioMixerConfig` 与 `computeMixGains`；
   - 执行 `pnpm --filter @tescord/types build`。
2. **阶段 2：算法与单测（Algorithms & Unit Tests）**
   - 实现 IP 分类工具函数（`apps/web/src/utils/ipClassification.ts` 或 `services/p2p/`）；
   - 编写并运行 `scripts/test-p2p-ip-classification.ts` 单测，确保 100% 覆盖通过。
3. **阶段 3：国际化全域字典对称更新**
   - 同时更新 `apps/web/src/i18n/locales/` 下 5 个语言目录中的 `voice.json` 与 `chat.json`，确保无漏键。
4. **阶段 4：前端 UI/UX 与伴音清理**
   - `ImageAttachment.tsx`：实现 Shimmer 扫光与平滑淡入（Fade-in）；
   - `LightboxModal.tsx`（注意在 `chat/` 下）：重构毛玻璃居中环形进度、无缝交叉渐隐及 HD 点亮；
   - `VoiceRoomArea.tsx`：清理伴音混音器；实现聚焦模式视频物理分辨率自适应（移除 `aspect-video` 硬编码黑边）；
   - `VoiceConnectionStatusPopover.tsx` & `ChannelSidebar.tsx`：重构 P2P 专属柱状图与左下角解耦交互；
   - `NetworkQualityModal.tsx`：展示直连本远端 IP，清理硬编码中文。
5. **阶段 5：全量编译与 E2E 验收**
   - 执行 `pnpm build`（验证全仓库 TypeScript 零错误）；
   - 运行 Playwright E2E 专项测试。

### 5.2 避坑与防御要点
- **文件路径陷阱**：LightboxModal 实际位于 `apps/web/src/components/chat/LightboxModal.tsx`，不要在 `modals/` 下创建多余文件。
- **Playwright 选择器防碎**：`data-testid="image-skeleton"` 与 `data-testid="lightbox-load-status"` 是现存自动化用例的锚点，重构 UI 时必须完整保留这组属性。
- **i18n 严禁遗漏语言**：任何新增键名必须同步提交到 `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP` 所有 5 个文件，坚决遵守 AGENTS.md 红线。
