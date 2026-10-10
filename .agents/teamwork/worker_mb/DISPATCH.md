## 2026-10-09T21:56:56Z
你是由 Project Orchestrator 派发的专职实施代理（Worker MB）。
你的工作目录：e:\nodejs_project\Tescord\.agents\teamwork\worker_mb\
原始需求说明：e:\nodejs_project\Tescord\.agents\teamwork\ORIGINAL_REQUEST.md
项目总纲与架构：e:\nodejs_project\Tescord\PROJECT.md
前序调研与交付成果：
- Explorer 1 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_1\report.md
- Explorer 2 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_2\report.md
- Explorer 3 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_3\report.md
- Worker MA 交付报告：e:\nodejs_project\Tescord\.agents\teamwork\worker_ma\handoff.md

请强制以最高思考等级（High Thinking Level）进行深度推演和前端代码实现。

【独占写入边界】：
- apps/web/src/components/voice/VoiceConnectionStatusPopover.tsx
- apps/web/src/components/ChannelSidebar.tsx
- apps/web/src/components/VoiceRoomArea.tsx
- apps/web/src/components/modals/NetworkQualityModal.tsx
- apps/web/src/components/chat/ImageAttachment.tsx
- apps/web/src/components/chat/LightboxModal.tsx
- apps/web/src/App.tsx (仅清理 audioMixer 导入与残留)
- apps/web/src/services/livekit.ts (仅清理 audioMixer 导入与残留，如有)

【任务详述与实施要点】：
1. **R2: Voice Connection Popover 与左下角状态区 P2P 专属重构**：
   - 在 `VoiceConnectionStatusPopover.tsx` 中：
     - 在 P2P 模式（meshActive 为 true）下，动态展示全员平均 RTT 延迟、整体丢包率以及直连节点拓扑；
     - 成员延迟柱状图与头像呈现：
       - 横轴按在线 P2P 成员排列，柱子高度映射该成员真实 RTT（ms）；
       - 柱顶或柱身清晰展示对应用户的 Avatar 头像与延迟数值标签（如 45ms）；
       - 柱条颜色根据健康状态自适应渲染（<100ms 绿，100~200ms 黄，>200ms 红）；
       - 鼠标悬停 Tooltip 支持查看该成员的抖动（jitter）与丢包率详情；
     - SFU 模式下保留既有图表功能。
   - 在 `ChannelSidebar.tsx` 中：
     - 彻底移除“全员中位数延迟”文案与拼接；仅展示语音频道名称；
     - 交互解耦：将频道名称提取为独立可点击区域（点击调用 onSelectChannel 切回语音主舞台，带 e.stopPropagation()）；保留点击外部/信号图标展开 Popover；保留 data-testid="voice-connection-status-btn" 等测试属性确保 E2E 测试兼容。
2. **R3: 语音频道聚焦模式宽高比自适应与黑边消除**：
   - 在 `VoiceRoomArea.tsx` 中：
     - 移除聚焦模式硬编码的 `aspect-video` 和 `md:h-[62vh]` 以及 `object-contain bg-black` 冲突样式；
     - 监听推流视频（屏幕共享或摄像头）真实物理分辨率（videoWidth / videoHeight，结合 onLoadedMetadata / onResize），计算真实纵横比（aspectRatio = videoWidth / videoHeight）；
     - 聚焦卡片外框宽高比根据真实比例动态贴合（如 `style={{ aspectRatio, width: ... }}`），结合 `max-h-[72vh] max-w-full` 视口弹性约束；
     - 消除固定冲突样式与多余黑底，让推流画面完全铺满容器无裁切、无多余黑边缝隙。
3. **R4 (UI): 网络健康看板直连 IP 呈现**：
   - 在 `NetworkQualityModal.tsx` 中：
     - 直连成员节点卡片中展示与该远端成员的具体直连 IP 和端口（例如 `远端 IP: 240e:xxx:xxxx:port`，以及本端 IP）。从 PeerLatencyReport 的 localAddress / remoteAddress 字段获取。
4. **R5 (UI): 伴音混音器 UI 清理与原生音频保全**：
   - 在 `VoiceRoomArea.tsx` 中彻底移除顶部的“伴音混音器”按钮及其控制台弹窗代码；
   - 在 `App.tsx` 与 `livekit.ts`（若有）中清理对已被删除的 `audioMixer` 的 import 和残留调用；
   - 确保 WebRTC 标准原生的屏幕共享音频流（`getDisplayMedia({ audio: true })` 独立轨）不受任何影响。
5. **R6: 图片加载动效与原图查看器体验升级**：
   - 在 `ImageAttachment.tsx` 中：
     - 采用精致的呼吸扫光骨架屏（Shimmer skeleton）；
     - 图片加载完成后，采用丝滑淡入（Fade-in，opacity-0 -> opacity-100 transition）平滑呈现；保留 `data-testid="image-skeleton"` 确保已有 E2E 测试通过。
   - 在 `LightboxModal.tsx` 中：
     - 原图加载反馈重构为画面正中心高质感磨砂毛玻璃环形进度环（Radial Progress），清晰展示百分比与已下载/总大小；保留 `data-testid="lightbox-load-status"`；
     - 原图下载解码完成后，采用交叉渐隐（cross-fade）无缝替换缩略图，并点亮 HD 高清徽章（发光绿微标）。
6. **验证与构建**：
   - 运行前端编译校验：`pnpm --filter @tescord/web build`，确认无 TS 编译报错。
