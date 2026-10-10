# Handoff Report — Explorer 2 (R3 & R5 调研)

## 1. Observation (观测事实)

1. **`apps/web/src/components/VoiceRoomArea.tsx` 聚焦模式实现**：
   - 行 448：`isSpotlight ? "w-full max-w-5xl aspect-video md:h-[62vh] shadow-2xl"` 强行指定了 `aspect-video` (16:9) 与固定高度 `md:h-[62vh]`。
   - 行 377：`(hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera) ? "w-full h-full object-contain bg-black"`，非全屏推流视频仍然带有 `bg-black`。
   - 行 2251：`stageParticipants.length === 1 ? "grid-cols-1 max-w-4xl"`，外层舞台中央网格对单流聚焦施加了 `max-w-4xl`（896px）过紧宽度约束。
   - 行 87-134：`VideoTrackPlayer` 封装了原生 `<video>` 元素，目前未监听 `onLoadedMetadata` 或 `onResize`，也未向上层组件暴露实际物理分辨率。
   - 行 621：全屏切换按钮标题存在硬编码中文 `title={isFullscreen ? "退出全屏 (Esc / F)" : "全屏播放 (F)"}`。

2. **`apps/web/src/services/audioMixer.ts` 全仓库引用清单**：
   - `apps/web/src/services/audioMixer.ts:1-161`：定义 `AudioMixer` 类与全局单例 `audioMixer`。
   - `packages/types/src/index.ts:2055-2080`：定义接口 `AudioMixerConfig` 与增益函数 `computeMixGains`；第 2050 行定义 `mixedAudio?: boolean;`。
   - `apps/web/src/App.tsx:95`：`import { audioMixer } from "./services/audioMixer.js";`（未实际使用）。
   - `apps/web/src/services/livekit.ts:37, 2201`：`import { audioMixer } ...`，并在 `stopScreenShare()` 结尾调用 `audioMixer.cleanup()`。
   - `apps/web/src/components/VoiceRoomArea.tsx:32, 56, 1127, 1203-1206, 2067-2071, 2128-2143, 2944-3006`：包含导入、`Sliders` 图标、浮层状态与增益调节函数、顶部工具栏按钮、底部控制台模态浮层（含大量硬编码中文“声卡伴音混音控制台”、“麦克风人声增益”、“系统/游戏音频伴音”、“立体声推流状态”、“已合成立体声”）。
   - `apps/server/src/verify-phase4-full.ts:7, 250-286`：从 `@tescord/types` 导入并单元测试了 `computeMixGains`。若类型包直接删除该函数，`apps/server` 的 `tsc` 构建将直接报编译错误。
   - `apps/web/src/i18n/locales/*/voice.json:148`：`zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP` 5 份语言包中均包含 `"mixPanel"` 键名。
   - `README.md:70`：包含对 `audioMixer.ts` 的文字介绍。

3. **屏幕共享原生音频链路审计**：
   - `apps/web/src/services/displayCapture.ts:44, 181-184`：浏览器端使用 `navigator.mediaDevices.getDisplayMedia({ audio: true })` 原生音轨；桌面端使用 WASAPI loopback 经过 `displayAudioWorklet.js` 生成标准 AudioTrack。
   - `apps/web/src/services/livekit.ts:2078-2085`：独立发布 `Track.Source.ScreenShareAudio`，麦克风人声则独立保持发布 `Track.Source.Microphone`。
   - `apps/web/src/services/p2p/P2PStreamManager.ts:310-316`：遍历推流 MediaStream 的所有 tracks 并通过 `pc.addTrack` 加入连接。
   - 全仓库检索 `mixStreams`，仅在 `audioMixer.ts:38` 声明，全项目**从无任何调用**。

---

## 2. Logic Chain (推理链条)

1. **R3 宽高比与黑边推导**：
   - 观测 1 表明，`VoiceRoomArea.tsx` 的聚焦卡片容器被 `aspect-video` 和 `md:h-[62vh]` 双重死锁，视频元素又采用 `object-contain bg-black`。
   - 当主播分享非 16:9（如 16:10、21:9、9:16、4:3、窗口）流时，容器不能反映视频物理形状，内部黑底填满多余空间，导致四周出现厚重黑边。
   - 通过在 `<video>` 上监听 `onLoadedMetadata` 与原生 `onResize` 事件，能跨越 LiveKit / P2P / Cloudflare 全链路实时获取真实 `videoWidth` 与 `videoHeight`。
   - 将卡片外框样式重构为 `aspectRatio: videoAspectRatio`，配合 `width: min(100%, calc(72vh * ${videoAspectRatio}))` 与 `max-h-[72vh] max-w-full`，并在非全屏状态下移除 video 上的 `bg-black`，卡片外框将完全贴合视频物理比例，消除所有多余黑边。

2. **R5 混音器清理与原生音频完整性推导**：
   - 观测 2 与 3 表明，`audioMixer.ts` 是一个脱离实际媒体管线的单例类，其实际方法从未接入 LiveKit 或 P2P 推流；
   - 屏幕伴音一直由 WebRTC / Electron WASAPI 原生独立音轨推流，二者完全解耦；
   - 彻底删除 `audioMixer.ts`、清理 `@tescord/types` 接口、移除 `VoiceRoomArea.tsx` 对应按钮/状态/模态浮层，不仅不会对原生屏幕音频产生任何干扰，反而消除了 5 处严重硬编码中文违规与无用冗余逻辑；
   - 必须同步更新 `apps/server/src/verify-phase4-full.ts` 移除废弃测试，确保 `pnpm build` 顺利通过。

---

## 3. Caveats (注意事项与边界)

1. **构建依赖风险**：`apps/server/src/verify-phase4-full.ts` 直接从 `@tescord/types` 导入了 `computeMixGains`。若实现代理仅修改 types 和 web，会导致 `pnpm build` 在 server 模块报 TS 编译错误。必须同步清理 server 端验证代码。
2. **多语言对称性**：从 `voice.json` 移除 `"mixPanel"` 时，必须同时在全部 5 套语言包中删除，不得遗漏。
3. **初始化闪烁防御**：推流视频刚挂载、首帧元数据尚未读取前，`videoAspectRatio` 为 `null`。此时卡片应优雅回退至默认 16:9 比例，避免出现 0 高度或布局跳跃。

---

## 4. Conclusion (结论与定案)

1. **R3 聚焦自适应方案**：
   - 在 `VideoTrackPlayer` 中通过 `onLoadedMetadata` + `onResize` 监听物理分辨率并上报 `onResolutionChange`；
   - 在 `ParticipantCard` 中通过 `videoAspectRatio` 动态计算 `style={{ aspectRatio, width: min(100%, calc(72vh * ratio)) }}`，替换固定 `aspect-video md:h-[62vh]`；移除 `bg-black`；
   - 舞台中央单流 Grid 放宽至 `max-w-7xl place-items-center`，完美消除黑边。
2. **R5 伴音混音器清理方案**：
   - 删除 `apps/web/src/services/audioMixer.ts`；
   - 从 `packages/types/src/index.ts` 中删除 `AudioMixerConfig`, `computeMixGains`, `ScreenShareOptions.mixedAudio`；
   - 从 `VoiceRoomArea.tsx` 中剔除混音器按钮、浮层及全部相关状态与硬编码文案；
   - 从 `App.tsx`, `livekit.ts`, `apps/server/src/verify-phase4-full.ts`, `voice.json` 5 语言包中彻底清理残留；
   - 屏幕共享原生音频流通过 `displayCapture.ts` 保持 100% 独立运作，不受任何破坏。

---

## 5. Verification Method (独立验证方法)

1. **代码构建检验**：
   ```bash
   pnpm build
   ```
   *预期结果*：零 TypeScript 错误，所有包（types, web, desktop, server）构建成功。
2. **死代码检索检验**：
   ```bash
   git grep -i "audioMixer"
   git grep -i "computeMixGains"
   ```
   *预期结果*：除 git 历史外，工作区代码中匹配为 0。
3. **E2E 屏幕分享原生音频与分辨率回归测试**：
   ```bash
   pnpm exec playwright test e2e/screen-share-audio-fallback.spec.ts e2e/screen-share-resolution-16x9.spec.ts
   ```
   *预期结果*：全部用例 PASS，证明原生伴音捕获与降级逻辑完好。
4. **多语言与硬编码扫描**：
   检查 `VoiceRoomArea.tsx` 确认无硬编码中文，且 5 套语言包中键名对称。
