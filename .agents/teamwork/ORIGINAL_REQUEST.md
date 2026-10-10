# Original User Request

## 2026-10-09T21:22:15Z

修复与优化 Tescord 的 P2P 语音链路指标（延迟/局域网判断/IP展示/直连信息弹窗）、视频聚焦纵横比、移除伴音混音器，并重塑图片加载与原图预览 UI。

Working directory: e:\nodejs_project\Tescord
Integrity mode: development

## Requirements

### R1. P2P 局域网识别算法修复与公网 IPv6 精准过滤
- **现状缺陷**：`apps/web/src/services/p2p/VoiceMeshManager.ts` 仅使用 `localType === "host" && remoteType === "host"` 判定连接为 LAN。由于国内三大运营商公网单播 IPv6（如 `240e::/16`、`2408::/16`、`2409::/16`）直接绑定在设备物理网卡上，WebRTC 作为 host 候选暴露，导致跨公网直连被全部误判为局域网。
- **算法要求**：
  - 提取选中的 local 与 remote candidate 的物理 IP 地址；
  - 编写严格的 IP 分类工具函数：仅当双方 IP 均符合 RFC 1918 私网 IPv4（`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`）或 RFC 4193 ULA IPv6（`fc00::/7`）/ Link-Local IPv6（`fe80::/10`）/ Loopback 时，且双方为 host 候选，方可判定为 `"LAN"`；
  - 所有全局单播公网 IPv6（如 `2000::/3`，包含 `240e/2408/2409` 等）直连一律判定为 `"P2P"`；中继仍为 `"RELAY"`。

### R2. Voice Connection Popover 与左下角状态区 P2P 专属重构
- **Popover P2P 面板**：在 P2P 模式下，左下角 `VoiceConnectionStatusPopover.tsx` 动态展示全员平均 RTT 延迟、整体丢包率以及直连节点拓扑；
- **成员延迟柱状图与头像呈现**：
  - 横轴按在线 P2P 成员排列，柱子高度映射该成员的真实 RTT（ms）；
  - 柱顶或柱身清晰展示对应用户的 Avatar 头像与延迟数值标签，柱条颜色根据健康状态（<100ms 绿，100~200ms 黄，>200ms 红）自适应渲染；
  - 鼠标悬停支持查看抖动与丢包率详情；
- **左下角状态栏重构**：
  - 彻底移除“全员中位数延迟”文案；仅展示语音频道名称；
  - **交互解耦**：点击语音频道名称直接导航切换回语音主舞台界面；点击左侧网络信号状态图标/右侧状态区展开连接详情 Popover 浮层。

### R3. 语音频道聚焦模式宽高比自适应与黑边消除
- **现状缺陷**：`VoiceRoomArea.tsx` 的聚焦模式硬编码 `aspect-video` 和 `md:h-[62vh]`，且视频标签采用 `object-contain bg-black`，导致非标准 16:9（如 16:10、21:9、9:16 或自选应用窗口）四周产生大黑边。
- **容器与流自适应**：
  - 监听推流视频的物理分辨率（`videoWidth` / `videoHeight`），获取真实纵横比；
  - 聚焦卡片外框宽高比根据推流视频真实比例动态贴合，搭配 `max-h-[72vh] max-w-full` 视口弹性约束；
  - 移除固定冲突样式与多余黑底，让推流画面完全铺满容器无裁切、无多余黑边缝隙。

### R4. WebRTC 媒体引擎与网络健康看板直连 IP 呈现
- **类型协议扩充**：在 `packages/types/src/index.ts` 的 `PeerLatencyReport` 接口中扩充 `localAddress?: string; remoteAddress?: string; candidateType?: string;`；
- **统计采集上报**：在 `VoiceMeshManager.ts` 的 `getStats()` 候选对解析中提取选中的本端与远端 IP 地址并存入状态；
- **看板 UI 展示**：在 `NetworkQualityModal.tsx` 的直连成员节点卡片中，展示与该远端成员的具体直连 IP 和端口（例如 `远端 IP: 240e:xxx:xxxx:port`）。

### R5. 彻底移除伴音混音器功能
- 彻底移除 `apps/web/src/services/audioMixer.ts` 源码；
- 清理 `packages/types` 中 `AudioMixerConfig` 与 `computeMixGains`；
- 清理 `VoiceRoomArea.tsx` 顶部的“伴音混音器”按钮及其控制台弹窗代码，消除硬编码中文与残留；
- 保留 WebRTC 标准原生的屏幕共享音频流（`getDisplayMedia({ audio: true })` 独立轨），不受任何干扰。

### R6. 图片加载动效与原图查看器体验升级
- **聊天图片加载动效**：在 `ImageAttachment.tsx` 中使用平滑呼吸扫光骨架屏，图片载入完成后采用丝滑淡入（Fade-in）过渡；
- **原图预览（LightboxModal.tsx）体验升级**：
  - 将原图加载反馈从底部角落重构为画面中心高质感磨砂毛玻璃环形进度环（Radial Progress），展示百分比与已下载/总大小；
  - 原图下载解码完成后，采用交叉渐隐无缝替换缩略图，并点亮 HD 高清徽章。

### R7. 国际化与代码整洁度红线
- 严格遵循 `AGENTS.md`：所有新增/修改的用户可见文案与错误码必须同时且对称同步到 `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP` 5 套语言包中；严禁在 TSX 中出现硬编码中文；无冗余多余注释。

## Acceptance Criteria

### 1. P2P 局域网与 IPv6 判定
- [ ] 针对 IP 检测编写单元测试：公网 IPv6（如 `240e:398:xxx`, `2001:da8:xxx`）即使候选类型为 `host`，一律断言为 `P2P`；私网 IPv4（`192.168.1.1`）与 ULA IPv6（`fd12:3456::1`）且双方为 `host` 断言为 `LAN`；中继断言为 `RELAY`。
- [ ] 语音房间中，中国电信等 IPv6 直连用户网络胶囊展示为 `P2P` 而非 `局域网`。

### 2. Voice Popover 与左下角状态栏
- [ ] P2P 模式下打开 Popover，顶部指标展示在线全员平均延迟与丢包率。
- [ ] Popover 中延迟图表呈现按成员排列的直连柱状图，各柱顶/柱身展示成员 Avatar 头像和毫秒值。
- [ ] 左下角状态栏无“全员中位数延迟”文案；仅显示语音频道名称。
- [ ] 点击左下角语音频道名称可快速导航切回语音房间主视图；点击左侧信号图标可展开/折叠 Popover。

### 3. 聚焦模式比例自适应
- [ ] 聚焦模式下，视频卡片依据推流视频分辨率动态调整长宽比，消除画面四周不必要的黑边。

### 4. 网络健康看板直连 IP
- [ ] 打开网络健康看板，P2P 成员节点列表正确显示本端/远端直连 IP 地址。

### 5. 伴音混音器清理
- [ ] 全项目检索无 `audioMixer.ts` 引用，无伴音混音控制台弹窗残留。
- [ ] 屏幕共享原生系统音频推流功能保持完好可用。

### 6. 图片加载与原图预览
- [ ] 聊天图片加载过程具有呼吸扫光骨架与载入淡入过渡。
- [ ] 原图 Lightbox 查看器在加载原图时居中呈现毛玻璃环形进度，加载完毕平滑过渡并显示 HD 状态。

### 7. 全局工程门禁
- [ ] `pnpm build` 全模块编译通过，TypeScript 零错误。
- [ ] 5 种语言区域（zh-CN, zh-TW, zh-HK, en-US, ja-JP）键名完全对称，无硬编码中文。
