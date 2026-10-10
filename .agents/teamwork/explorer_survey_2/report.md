# Tescord 需求 R3 与 R5 深度调研与技术方案报告 (Explorer 2)

**调研代理**：Explorer 2 (Subagent `explorer_survey_2`)  
**调研日期**：2026-10-10  
**目标需求**：
- **R3**：语音频道聚焦模式宽高比自适应与黑边消除
- **R5**：彻底移除伴音混音器功能并核查屏幕共享原生音频完整性

---

## 一、需求 R3：聚焦模式视频宽高比自适应与黑边消除调研

### 1.1 现状缺陷与具体代码定位

代码文件实际路径：`apps/web/src/components/VoiceRoomArea.tsx`

#### 缺陷 1：聚焦卡片硬编码固定 16:9 纵横比与高度（`VoiceRoomArea.tsx:448`）
```tsx
// VoiceRoomArea.tsx 行 442-458
className={`bg-[#2b2d31] rounded-xl flex flex-col items-center justify-center relative border-2 transition-all select-none overflow-hidden group ${
  isFullscreen && !showControls ? "cursor-none" : "cursor-pointer"
} ${
  isFullscreen
    ? "!fixed !inset-0 !z-50 !w-screen !h-screen !max-w-none !rounded-none !border-0 !aspect-auto bg-black shadow-none"
    : isSpotlight
      ? "w-full max-w-5xl aspect-video md:h-[62vh] shadow-2xl" // <-- 核心缺陷：强制 aspect-video 与固定 md:h-[62vh]
      : isTheaterMode
        ? "min-w-[140px] max-w-[160px] h-[130px] flex-shrink-0"
        : "min-h-[140px] sm:min-h-[190px] aspect-video w-full"
} ...
```
- **分析**：
  - `aspect-video` 强制将容器宽高比约束为 16:9 (`1.7778`)。
  - `md:h-[62vh]` 强行将桌面端卡片高度锁死在视口高度的 62%。
  - 当推流视频为非标准 16:9（如 MacBook 16:10、带鱼屏 21:9、手机竖屏 9:16、4:3、或任意宽高窗口应用）时，容器本身就是一个固定 16:9 或变形的矩形，无法与视频帧真实比例贴合。

#### 缺陷 2：视频渲染组件使用 `object-contain bg-black`（`VoiceRoomArea.tsx:374-378`）
```tsx
// VoiceRoomArea.tsx 行 374-378
const mainFitClass = isFullscreen
  ? "w-full h-full object-contain bg-black"
  : (hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera)
    ? "w-full h-full object-contain bg-black" // <-- 屏幕分享非全屏时依然采用 bg-black
    : "w-full h-full object-cover";
```
- **分析**：
  - 由于外层卡片容器固定为 16:9，内部 `<video>` 采用 `object-contain` 缩放视频。当视频比例与 16:9 不一致时，video 元素四周（上下或左右）由 `bg-black` 填充为纯黑条。
  - 对于竖屏 9:16 流，视频仅占卡片中间约 31% 面积，卡片左右两侧出现巨大的黑边旷量；
  - 对于 21:9 超宽屏流，卡片上下两侧出现明显黑边。

#### 缺陷 3：中央舞台外层 Grid 对单流聚焦的宽度约束过紧（`VoiceRoomArea.tsx:2251`）
```tsx
// VoiceRoomArea.tsx 行 2248-2260
<div
  className={`w-full grid gap-3 sm:gap-4 mb-4 transition-all animate-fadeIn ${
    stageParticipants.length === 1
      ? "grid-cols-1 max-w-4xl" // <-- 限制为 max-w-4xl (896px)
      : stageParticipants.length === 2
        ? "grid-cols-1 md:grid-cols-2 max-w-6xl"
...
```
- **分析**：
  - `max-w-4xl`（896px）限制了单个聚焦流的最大宽度。在 1080P 或 2K/4K 屏幕上，舞台流被强行限制在很小的宽度内，而即使给卡片设置 `max-w-5xl`，也因外层 `max-w-4xl` 无法充分利用视口宽度展开。
  - 缺乏 `place-items-center` / 居中对齐，当竖屏卡片宽度收窄时容易产生偏移。

---

### 1.2 推流视频真实分辨率监听方案

在 WebRTC 环境下，推流源包含三种可能类型（LiveKit `RemoteVideoTrack`/`LocalVideoTrack`、原生 WebRTC `MediaStreamTrack`、`MediaStream`）。无论底层是哪种 Track，最终都挂载至 `VideoTrackPlayer` 内部的 HTML `<video>` 元素。

#### 核心机制：
1. **`onLoadedMetadata` 事件**：当视频首帧元数据载入时触发，读取 `video.videoWidth` 与 `video.videoHeight`；
2. **`onResize` 事件**：HTMLVideoElement 原生规范事件，当 WebRTC 动态切换码流分辨率（Simulcast 升降档、主播调整窗口大小、屏幕旋转等）导致 `videoWidth`/`videoHeight` 变动时**实时触发**；
3. **`useEffect` 挂载保底**：当 Track 切换或 DOM 已缓存 metadata 时，在 `useEffect([track])` 中主动读取 `el.videoWidth`；
4. **清理机制**：当 Track 卸载或流停止时，回调通知 `(0, 0)` 重置宽高比。

#### 方案设计代码（`VideoTrackPlayer`）：
```tsx
interface VideoTrackPlayerProps {
  track: any;
  isMirrored?: boolean;
  className?: string;
  dataTestId?: string;
  onResolutionChange?: (width: number, height: number) => void;
}

const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
  isMirrored = false,
  className = "w-full h-full object-cover",
  dataTestId,
  onResolutionChange,
}) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const checkResolution = (el: HTMLVideoElement | null) => {
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      onResolutionChange?.(el.videoWidth, el.videoHeight);
    }
  };

  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !track) {
      onResolutionChange?.(0, 0);
      return;
    }
    // 挂载 track 逻辑...
    checkResolution(el);

    return () => {
      onResolutionChange?.(0, 0);
    };
  }, [track]);

  return (
    <video
      ref={videoElRef}
      autoPlay
      playsInline
      muted
      data-testid={dataTestId}
      className={`${className} ${isMirrored ? "-scale-x-100" : ""}`}
      onLoadedMetadata={(e) => checkResolution(e.currentTarget)}
      onResize={(e) => checkResolution(e.currentTarget)}
    />
  );
};
```

---

### 1.3 容器与视频动态贴合 CSS 方案（消除黑边与视口弹性约束）

#### 数学与 CSS 推导：
设视频物理分辨率为 $W \times H$，真实长宽比 $R = W / H$。
要求卡片受到 `max-h-[72vh]` 与 `max-w-full` 的双重约束，且宽高比严格保持 $R$：
- 理想卡片高度上限为 $72\text{vh}$；
- 对应理想卡片宽度为 $72\text{vh} \times R$；
- 当屏幕较宽时，宽度取 $72\text{vh} \times R$，高度为 $72\text{vh}$，卡片完美贴合视频物理比例；
- 当屏幕较窄或为超宽屏（$72\text{vh} \times R > 100\%$）时，宽度被 `100%`（容器宽度）钳位，高度依据 `aspectRatio: R` 自动按比例缩减（高度 $= 100\% / R \le 72\text{vh}$）；
- CSS 表达式：
  ```css
  aspect-ratio: var(--aspect-ratio, 16 / 9);
  width: min(100%, calc(72vh * var(--aspect-ratio)));
  max-height: 72vh;
  max-width: 100%;
  ```

#### 拟实施细节：
1. **`ParticipantCard` 中维护纵横比状态**：
   ```tsx
   const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);

   const handleResolutionChange = useCallback((width: number, height: number) => {
     if (width > 0 && height > 0) {
       setVideoAspectRatio(width / height);
     } else {
       setVideoAspectRatio(null);
     }
   }, []);
   ```
2. **卡片类名与行内样式更新**：
   - 聚焦卡片类名从 `"w-full max-w-5xl aspect-video md:h-[62vh] shadow-2xl"` 改为：
     `"w-full max-h-[72vh] max-w-full shadow-2xl"`
   - 注入动态 `style`：
     ```tsx
     style={
       isSpotlight && !isFullscreen
         ? {
             aspectRatio: videoAspectRatio ? `${videoAspectRatio}` : "16 / 9",
             width: videoAspectRatio
               ? `min(100%, calc(72vh * ${videoAspectRatio}))`
               : undefined,
           }
         : undefined
     }
     ```
3. **移除视频元素非全屏黑底**：
   ```tsx
   const mainFitClass = isFullscreen
     ? "w-full h-full object-contain bg-black"
     : (hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera)
       ? "w-full h-full object-contain" // 移除 bg-black，卡片已与视频完全贴合，无缝无黑条
       : "w-full h-full object-cover";
   ```
4. **优化单流聚焦舞台容器**：
   `VoiceRoomArea.tsx:2250`：
   `stageParticipants.length === 1 ? "grid-cols-1 max-w-7xl place-items-center justify-center"`
   使单流卡片居中展示，最大宽度放开至 `max-w-7xl`，充分享受视口空间。

---

## 二、需求 R5：伴音混音器清理调研

### 2.1 全仓库导入与调用检索结果

通过全局代码检索，`audioMixer.ts` 相关符号分布在以下 **7 个文件**中：

| 序号 | 所在文件路径 | 涉及行号 | 现状代码与用途分析 | 处理建议 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `apps/web/src/services/audioMixer.ts` | 全文 1-161 行 | 定义 `AudioMixer` 单例类，使用 Web Audio API 合并麦克风与系统音 | **彻底删除该文件** |
| 2 | `packages/types/src/index.ts` | 2055-2060 行 | `export interface AudioMixerConfig { micVolume; systemAudioVolume; ... }` | **彻底删除接口定义** |
| 3 | `packages/types/src/index.ts` | 2062-2080 行 | `export function computeMixGains(...)` 混音增益计算公式 | **彻底删除函数定义** |
| 4 | `packages/types/src/index.ts` | 2050 行 | `mixedAudio?: boolean;` 在 `ScreenShareOptions` 中 | **彻底删除该废弃字段** |
| 5 | `apps/web/src/components/VoiceRoomArea.tsx` | 32, 1127, 1203-1206, 2067-2071, 2128-2143, 2944-3006 | 导入 `audioMixer`，维护 `isMixerOpen`/`micMixGain`/`systemMixGain`，顶部控制按钮及右下角弹窗 | **清理全部状态、函数与 UI** |
| 6 | `apps/web/src/App.tsx` | 95 行 | `import { audioMixer } from "./services/audioMixer.js";` | **直接移除无用 import** |
| 7 | `apps/web/src/services/livekit.ts` | 37, 2201 行 | `import { audioMixer } ...` 并在 `stopScreenShare()` 中调用 `audioMixer.cleanup()` | **直接移除 import 与 cleanup 调用** |
| 8 | `apps/server/src/verify-phase4-full.ts` | 7, 250-286 行 | 服务端 Phase 4 验证脚本，导入并测试了 `computeMixGains` | **同步清理导入与测试用例，防止构建报错** |
| 9 | `apps/web/src/i18n/locales/*/voice.json` | 148 行 | 5 种语言的 `"mixPanel"` 键值 | **同步从 5 套语言包中删除该键** |
| 10 | `README.md` | 70 行 | 说明文档提及 `audioMixer.ts` | **更新文档移除过时描述** |

---

### 2.2 `VoiceRoomArea.tsx` 残留代码与硬编码中文详析

在 `apps/web/src/components/VoiceRoomArea.tsx` 中：

1. **导入与状态声明**：
   - 行 32：`import { audioMixer } from "../services/audioMixer.js";`
   - 行 56：`Sliders`（lucide 图标，仅用于混音器，需移除）
   - 行 1127：`const [isMixerOpen, setIsMixerOpen] = useState(false);`
   - 行 1203-1206：
     ```tsx
     const [micMixGain, setMicMixGain] = useState(audioMixer.config.micVolume);
     const [systemMixGain, setSystemMixGain] = useState(
       audioMixer.config.systemAudioVolume,
     );
     ```
   - 行 2067-2071：
     ```tsx
     const handleMixGainChange = (mic: number, sys: number) => {
       setMicMixGain(mic);
       setSystemMixGain(sys);
       audioMixer.setGains(mic, sys, isMuted);
     };
     ```
2. **顶部房间信息栏按钮（行 2128-2143）**：
   ```tsx
   {/* 顶部右侧：伴音混音与网络健康看板切换按钮 */}
   <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
     {/* 声卡伴音混音控制开关 */}
     <button
       onClick={() => setIsMixerOpen(!isMixerOpen)}
       className={`...`}
       title={t("voice:mediaTooltips.mixPanel")}
     >
       <Sliders className="w-3.5 h-3.5 text-discord-brand" />
       <span className="hidden sm:inline">伴音混音器</span> {/* 硬编码中文 */}
       <span className="sm:hidden">混音</span>              {/* 硬编码中文 */}
     </button>
   </div>
   ```
   > 移除此按钮后，由于右侧无其他常驻按钮，该 `div` 可直接移除或清空。

3. **控制台模态浮层（行 2944-3006）**：
   ```tsx
   {/* 4.2 伴音与麦克风声卡混音控制模态浮层 */}
   {isMixerOpen && (
     <div className="absolute bottom-24 right-6 z-40 bg-[#313338] w-80 p-5 rounded-2xl border border-[#3f4147] shadow-2xl animate-fadeIn space-y-4">
       ...
       <h4 className="font-bold text-sm text-white">
         声卡伴音混音控制台  {/* 严重硬编码中文 */}
       </h4>
       ...
       <span className="text-discord-textMuted">麦克风人声增益</span> {/* 严重硬编码中文 */}
       ...
       <span className="text-discord-textMuted">系统/游戏音频伴音</span> {/* 严重硬编码中文 */}
       ...
       <span>立体声推流状态:</span> {/* 严重硬编码中文 */}
       <span>已合成立体声</span>   {/* 严重硬编码中文 */}
     </div>
   )}
   ```
   > 该组件违反项目 `AGENTS.md` 零硬编码中文与极简规范，且未接入实质推流管线，属于伪功能悬浮层，必须连同状态整块移除。

4. **多语言字典（`apps/web/src/i18n/locales/*/voice.json` 行 148）**：
   - `zh-CN`: `"mixPanel": "声卡伴音与麦克风混音控制面板",`
   - `zh-TW`: `"mixPanel": "系統音訊與麥克風混音面板",`
   - `zh-HK`: `"mixPanel": "系統聲音與咪高峰混音面板",`
   - `en-US`: `"mixPanel": "System audio and microphone mixer",`
   - `ja-JP`: `"mixPanel": "システム音声とマイクのミキサー",`
   > 需在 5 个文件中对称移除该键。

---

### 2.3 `apps/server/src/verify-phase4-full.ts` 风险预警

- 在 `apps/server/src/verify-phase4-full.ts` 中：
  - 行 7：`import { computeMixGains } from "@tescord/types";`
  - 行 250-286：执行了一组针对 `computeMixGains` 的单元测试断言。
- **重要提醒**：`apps/server` 的 `build` 脚本配置为 `tsx scripts/ensure-prisma.ts && tsc`。若直接在 `@tescord/types` 中删除 `computeMixGains`，而未同步修改 `apps/server/src/verify-phase4-full.ts`，将直接触发 TypeScript 编译报错，破坏 `pnpm build` 门禁！必须一并移除或重构该测试段落。

---

## 三、需求 R5：屏幕共享原生音频完整性核查

### 3.1 屏幕共享音频链路全景审计

系统在捕获与推流屏幕音频时，使用的是**完全独立的原生音轨链路**，从始至终从未依赖 `audioMixer.ts`：

#### 1. 采集层（`apps/web/src/services/displayCapture.ts`）
- **Web 浏览器端**：
  - 调用标准 `navigator.mediaDevices.getDisplayMedia({ audio: true, video: ... })`；
  - 采集到的媒体流 `stream` 直接包含 1 条视频轨和 1 条原生系统/标签页音频轨；
  - 若系统声卡独占抛出 `NotReadableError`，在行 55-60 自动降级为 `getDisplayMedia({ audio: false })` 纯画面推流；
- **Electron 桌面端**：
  - 通过原生 WASAPI 捕获系统/窗口 loopback 音频；
  - 通过 `models/displayAudioWorklet.js` 音频工作线程重组 PCM 流，并生成标准的 `MediaStreamTrack` 追加到 `stream.addTrack(track)`。

#### 2. 推流与发布层
- **LiveKit SFU 模式（`apps/web/src/services/livekit.ts:2078-2085`）**：
  ```ts
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack && options?.captureAudio) {
    await room.localParticipant.publishTrack(audioTrack, {
      name: "screen-share-audio",
      source: Track.Source.ScreenShareAudio,
      audioPreset: { maxBitrate: 128000 },
      dtx: true,
    });
    this.localScreenAudioTrack = audioTrack;
  }
  ```
  > 屏幕音频作为独立的 `Track.Source.ScreenShareAudio` 发布，麦克风人声则作为独立的 `Track.Source.Microphone` 发布。双轨并行，互不冲突，各自享有独立的编解码、静音与音量控制！

- **P2P 直连与接力模式（`apps/web/src/services/p2p/P2PStreamManager.ts:310-316`）**：
  ```ts
  for (const track of streamToOffer.getTracks()) {
    const alreadyAdded = senders.some((s) => s.track?.id === track.id);
    if (!alreadyAdded) {
      const sender = pc.addTrack(track, streamToOffer);
      sframeManager.assertReady();
      sframeManager.attachSender(sender);
    }
  }
  ```
  > 遍历 `streamToOffer.getTracks()`，原生视频轨与原生音频轨均被添加到 RTCPeerConnection 中，并受到 SFrame 端到端加密保护。

- **Cloudflare Realtime 模式（`apps/web/src/App.tsx:4691-4696`）**：
  ```ts
  await cloudflareRealtimeService.publishMediaTrack(videoTrack, stream, "screen");
  if (actualHasAudioTrack) {
    await cloudflareRealtimeService.publishMediaTrack(
      stream.getAudioTracks()[0],
      stream,
      "screen-audio",
    );
  }
  ```
  > 屏幕音频同样作为 `"screen-audio"` 独立轨直接推送。

### 3.2 结论
- `audioMixer.ts` 中的 `mixStreams` 方法在全仓库**从无任何一处调用**。
- 移除 `audioMixer.ts` 纯属清理冗余死代码和伪 UI，**对 WebRTC、LiveKit、P2P 直连以及 Cloudflare 下的原生屏幕音频捕获与推流没有任何副作用或负面影响**。
- 现存的 `e2e/screen-share-audio-fallback.spec.ts` 与 `e2e/screen-share-resolution-16x9.spec.ts` 均测试原生采集链路，不受任何破坏。

---

## 四、具体修改方案代码级实施规划 (For Implementer)

### 4.1 方案 A：`apps/web/src/components/VoiceRoomArea.tsx` 改造

#### 1. 移除混音器相关代码
- 删除行 32：`import { audioMixer } from "../services/audioMixer.js";`
- 移除 `lucide-react` 中的 `Sliders` 图标（行 56）
- 删除状态：`isMixerOpen`, `micMixGain`, `systemMixGain`（行 1127, 1203-1206）
- 删除函数：`handleMixGainChange`（行 2067-2071）
- 删除顶部按钮：行 2128-2143
- 删除底部弹窗：行 2944-3006
- 顺带修复行 621 全屏按钮硬编码中文：
  `title={isFullscreen ? t("voice:exitFullscreen") : t("voice:fullscreen")}`

#### 2. `VideoTrackPlayer` 增强
```tsx
interface VideoTrackPlayerProps {
  track: any;
  isMirrored?: boolean;
  className?: string;
  dataTestId?: string;
  onResolutionChange?: (width: number, height: number) => void;
}

const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
  isMirrored = false,
  className = "w-full h-full object-cover",
  dataTestId,
  onResolutionChange,
}) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const checkResolution = (el: HTMLVideoElement | null) => {
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      onResolutionChange?.(el.videoWidth, el.videoHeight);
    }
  };

  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !track) {
      onResolutionChange?.(0, 0);
      return;
    }
    try {
      if (typeof track.attach === "function") {
        track.attach(el);
      } else if (track instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([track]);
      } else if (
        track instanceof MediaStream ||
        (track && typeof track.getTracks === "function")
      ) {
        el.srcObject = track;
      }
    } catch (e) {
      console.warn("VideoTrackPlayer attach error:", e);
    }
    checkResolution(el);

    return () => {
      onResolutionChange?.(0, 0);
      try {
        if (typeof track.detach === "function" && el) {
          track.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [track]);

  return (
    <video
      ref={videoElRef}
      autoPlay
      playsInline
      muted
      data-testid={dataTestId}
      className={`${className} ${isMirrored ? "-scale-x-100" : ""}`}
      onLoadedMetadata={(e) => checkResolution(e.currentTarget)}
      onResize={(e) => checkResolution(e.currentTarget)}
    />
  );
};
```

#### 3. `ParticipantCard` 宽高比自适应与黑边消除
- 引入状态：
  ```tsx
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const handleResolutionChange = useCallback((w: number, h: number) => {
    if (w > 0 && h > 0) {
      setVideoAspectRatio(w / h);
    } else {
      setVideoAspectRatio(null);
    }
  }, []);

  useEffect(() => {
    if (!hasAnyVideo) setVideoAspectRatio(null);
  }, [hasAnyVideo, mainTrack]);
  ```
- 修改 `mainFitClass`：
  ```tsx
  const mainFitClass = isFullscreen
    ? "w-full h-full object-contain bg-black"
    : (hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera)
      ? "w-full h-full object-contain"
      : "w-full h-full object-cover";
  ```
- 修改卡片容器样式（行 445-458）：
  ```tsx
  isFullscreen
    ? "!fixed !inset-0 !z-50 !w-screen !h-screen !max-w-none !rounded-none !border-0 !aspect-auto bg-black shadow-none"
    : isSpotlight
      ? "w-full max-h-[72vh] max-w-full shadow-2xl"
      : isTheaterMode
        ? "min-w-[140px] max-w-[160px] h-[130px] flex-shrink-0"
        : "min-h-[140px] sm:min-h-[190px] aspect-video w-full"
  ```
  并增加 `style`：
  ```tsx
  style={
    isSpotlight && !isFullscreen
      ? {
          aspectRatio: videoAspectRatio ? `${videoAspectRatio}` : "16 / 9",
          width: videoAspectRatio
            ? `min(100%, calc(72vh * ${videoAspectRatio}))`
            : undefined,
        }
      : undefined
  }
  ```
- 给主视频传递回调：
  ```tsx
  <VideoTrackPlayer
    track={mainTrack}
    isMirrored={isMainMirrored}
    className={mainFitClass}
    dataTestId={`participant-main-video-${participant.userId}`}
    onResolutionChange={handleResolutionChange}
  />
  ```

#### 4. 优化中央单流舞台容器约束（行 2251）
  ```tsx
  stageParticipants.length === 1
    ? "grid-cols-1 max-w-7xl place-items-center justify-center"
  ```

---

### 4.2 方案 B：代码库清理清单

1. **删除文件**：
   - `apps/web/src/services/audioMixer.ts`
2. **`packages/types/src/index.ts`**：
   - 移除 `mixedAudio?: boolean;`（行 2050）
   - 移除 `AudioMixerConfig` 接口（行 2055-2060）
   - 移除 `computeMixGains` 函数（行 2062-2080）
3. **`apps/web/src/App.tsx`**：
   - 移除行 95 的 `import { audioMixer } from "./services/audioMixer.js";`
4. **`apps/web/src/services/livekit.ts`**：
   - 移除行 37 的 `import { audioMixer } from "./audioMixer.js";`
   - 移除行 2201 的 `audioMixer.cleanup();`
5. **`apps/server/src/verify-phase4-full.ts`**：
   - 移除行 7 的 `computeMixGains` 导入
   - 移除行 250-286 的 `computeMixGains` 对应测试断言
6. **`apps/web/src/i18n/locales/*/voice.json`**：
   - 对称从 `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP` 5 份文件的 `mediaTooltips` 中移除 `"mixPanel"` 键值
7. **`README.md`**：
   - 移除行 70 中关于 `audioMixer.ts` 的描述

---

## 五、验收标准与验证方案

1. **类型安全与全库构建验证**：
   - 运行 `pnpm build`，验证 TypeScript 零报错（包括 types, web, desktop, server 四大工作区全部编译通过）；
2. **多语言对称性验证**：
   - 验证 5 份 `voice.json` 键名 100% 对齐；
   - 验证 `VoiceRoomArea.tsx` 内无任何遗留硬编码中文；
3. **伴音混音器无残留验证**：
   - 全局搜索 `audioMixer`、`AudioMixer`、`computeMixGains`、`isMixerOpen`，确认无任何代码引用残留；
4. **屏幕分享原生音频测试验证**：
   - 执行 `pnpm exec playwright test e2e/screen-share-audio-fallback.spec.ts` 与 `e2e/screen-share-resolution-16x9.spec.ts`，确保全部 PASS；
5. **聚焦模式纵横比适应验证**：
   - 分别测试 16:9、16:10、21:9、9:16 分辨率流，验证聚焦卡片贴合物理画面，无多余大黑边，且在视口伸缩时保持在 `max-h-[72vh]` 与 `max-w-full` 约束内。
