<div align="center">
  <img src="packages/assets/logo.svg" width="128" height="128" alt="Tescord Logo" />
  <h1>Tescord</h1>
  <p><strong>类 Discord 本地私有化实时音视频与即时通讯系统</strong></p>
  <p><em>Self-Hosted, Offline-First, End-to-End Encrypted Real-time Collaboration Platform</em></p>

  <p>
    <img src="https://img.shields.io/badge/version-v0.3.0-5865F2.svg?style=flat-square" alt="Version" />
    <img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License" />
    <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square" alt="TypeScript" />
    <img src="https://img.shields.io/badge/React-18-61DAFB.svg?style=flat-square" alt="React" />
    <img src="https://img.shields.io/badge/Fastify-5.x-black.svg?style=flat-square" alt="Fastify" />
    <img src="https://img.shields.io/badge/Electron-Desktop-47848F.svg?style=flat-square" alt="Electron" />
    <img src="https://img.shields.io/badge/WebRTC-LiveKit%20%7C%20P2P-orange.svg?style=flat-square" alt="WebRTC" />
    <img src="https://img.shields.io/badge/Cloudflare-Calls%20%7C%20Tunnel-F38020.svg?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare" />
    <img src="https://img.shields.io/badge/i18n-5%20Locales-blueviolet.svg?style=flat-square" alt="i18n" />
  </p>
</div>

---

## 📖 项目简介 (Overview)

**Tescord** 是一个专注于**本地私有化部署、离线自治、高性能音视频通信与端到端加密**的跨端即时协作平台（Web / Electron 桌面端）。系统深度还原 Discord 经典交互体验，提供文字频道、富文本即时通讯、1v1 呼叫、公会多人实时语音、4K 60fps 超清屏幕分享直播、深度学习神经网络降噪（RNNoise / DTLN / DFN3）以及严格的 SFrame WebRTC 端到端加密（E2EE）安全体系。

无论是自建团队内部协作基础设施、局域网私网开黑，还是高安全敏感环境，Tescord 均可在 100% 无公网外部商业 SaaS 依赖的环境下安全自治运行。

---

## 🌟 核心特性与已开发支持功能矩阵

### 💬 1. 即时聊天与富文本 (Chat & Rich Text Experience)

- **高性能 Markdown 引擎 (`fastMarkdown`)**：
  - 高保真支持粗体（`**`）、斜体（`*`）、下划线（`__`）、删除线（`~~`）、行内代码与多行语法高亮代码块。
  - **Discord 经典剧透黑条 (`||spoiler||`)**：默认遮蔽敏感文字与图片，点击翻转查看，再次点击重新遮蔽。
  - **@提及胶囊 (@Mentions)**：高亮展示 `@username`、`@everyone`、`@here`；点击胶囊即可呼出个人悬浮资料卡片。
  - **AST 编译缓存加速**：静态 Tokenizer 规避重复正则计算，保障万级长消息列表滚动流畅达 60 FPS。
- **TipTap 风格浮动气泡工具栏 (Bubble Menu)**：
  - 选中文本后自动浮现 8 大常用格式快捷按钮；移动端输入框顶部自适应吸附横向滚动格式栏。
- **URL 智能提取与服务器邀请卡片内嵌 (`ServerInviteEmbed`)**：
  - 智能括号平衡提取算法，完美解析带括号的 URL；聊天发送或粘贴公会邀请码时自动内嵌公会头像、名称、在线人数及“一键加入”按钮。
- **全功能多媒体灯箱 (`LightboxModal`)**：
  - **移动端触控手势双指缩放（Pinch-to-zoom）** 与平移视野限制（Clamp Position 防越界）。
  - **单指下滑退出（Swipe-down to dismiss）**：带有阻尼位移与背景透明度渐变动效。
  - 原图/缩略图无缝切换、原图一键下载、双击重置缩放比例。
- **多媒体附件安全上传**：
  - 支持拖拽、剪贴板截图粘贴与点击上传；具备环形进度条与骨架屏（Skeleton）加载占位。
  - 服务端 HMAC-SHA256 5 分钟短期签名授权防盗链，严格限制文件尺寸与 MIME 类型。
- **消息互动与上下文操作 (`MessageContextMenu`)**：
  - Emoji Picker 分类表情选择器与快捷反应栏；
  - 引用回复消息并支持跨长距离消息流平滑滚动定位与高亮闪烁；
  - 消息置顶（Pinned Messages）抽屉；撤回与删除（具权管理员或作者本人）。
- **未读标记与历史消息虚拟化**：
  - **冻结式未读分割红线 (`Frozen Unread Marker`)**：切入未读频道时冻结首条未读线，滚过自动淡出，消除跳动。
  - **频道草稿本地隔离记忆 (`channelDraftMap`)**：草稿按频道独立暂存，切换频道无缝恢复。
  - **TanStack Virtual 虚拟滚动列表**：仅渲染视口可视区域 DOM，百万条历史记录低内存常驻。

### 🎙️ 2. 实时音视频与流媒体矩阵 (Voice, Video & Streaming)

- **1v1 私聊音视频呼叫系统 (`DMCallStage`, `IncomingCallModal`, `DMPictureInPicture`)**：
  - 完整呼叫生命周期状态机：`ringing`（30s 超时防骚扰）、`connecting`、`active`、`ended`。
  - 全屏沉浸舞台与悬浮迷你画中画（PiP），支持画面 Cover/Contain 切换、对端独立音量增益调节（0% - 200%）。
- **公会多人语音频道 (`VoiceRoomArea`)**：
  - 自由切换视图：网格模式（Grid）、影院大图模式（Theater）、悬浮画中画与全屏。
  - 毫秒级发言状态捕获与头像绿圈说话光圈（Speaking Halo）。
  - 频道成员独立右键控制与单人音量滑块调节（0% - 200%）。
- **超清屏幕分享与游戏直播推流**：
  - 支持 480p / 720p / 1080p / 1440p / 4K 分辨率及 15fps / 30fps / 60fps 帧率预设。
  - **双路混音器 (`audioMixer.ts`)**：支持本地同时捕获麦克风人声与系统音频并合成推流。
  - **在线观众管理 (`StreamViewersModal`)**：实时统计在线观众，房主可管理观看成员或踢出违规观看。
- **独立解耦的多媒体传输拓扑**：
  - **LiveKit SFU 集中式媒体中心**：自适应 Simulcast 码率分流与多路转发。
  - **Cloudflare Calls (Realtime Calls) 边缘分发**：支持全球分布式边缘 Session 协商与流转。
  - **P2P Mesh 与动态树状拓扑分发 (`Mesh Tree`)**：主播为根节点、观众动态平衡级联转发，无需云端 SFU 也可实现多人开黑。
- **可拖拽流媒体诊断 HUD (`StreamStatsHUD`)**：
  - 悬浮窗实时采集并展示：传输拓扑、打洞候选路径（Host / Srflx / Relay）、编解码器（Opus / H.264 / AV1 / VP9）、动态上下行码率、丢包率、RTT 往返时延、Jitter 抖动与已编解码帧数，支持一键导出排障报告。

### 🧠 3. 音频工程与深度学习降噪 (AI Audio Engine)

- **前沿四模态降噪矩阵**：
  - **Off（直通）**：无损原音直出。
  - **RNNoise WASM**：轻量级深度学习降噪（48kHz / 480 点帧长），高效过滤环境敲击声与风扇稳态底噪。
  - **DTLN（双阶段 LSTM 神经网络）**：16kHz 频域+时域双级推理，搭配自研 63 抽头抗混叠 FIR 重采样滤波器，消除突发非稳态噪声。
  - **DFN3（DeepFilterNet3）**：多状态流式全频带神经网络，基于 ONNX Runtime Web WASM SIMD 多线程加速。
- **高可用容灾熔断降级链**：DFN3/DTLN 运行异常时秒级自动平滑降级至 RNNoise，再降级至直通，保证通话不间断。
- **QuadTrack 四轨录音对齐与 A/B/C/D 实时对比试听**：
  - 本地录制 5 秒音频，底层实例并行生成 4 轨音频，基于能量包络相关对齐起始时间轴，无缝切换对比试听与波形呈现。
- **高保真立体声模式 (High-Fidelity Stereo)**：突破传统语音限制，支持高达 510kbps 双声道无损传输。
- **语音输入模式**：VAD（语音感应激活，附带实时音量电平表与阈值调节）与 PTT（按键说话，按键捕获与松手延迟调节）。
- **音频打断自动恢复横幅 (`AudioInterruptedBanner`)**：应对浏览器 Autoplay Policy 造成的 AudioContext 挂起，一键快速恢复。

### 🖥️ 4. 桌面客户端原生体验 (Desktop Electron)

- **进程沙箱与 ContextBridge**：主进程与渲染进程严格隔离，仅通过 `preload.ts` 暴露安全的 `electronAPI`。
- **单例进程锁 (Single Instance Lock)**：杜绝应用重复多开，重复启动时自动唤出前台已有主窗口。
- **离线 `file://` 协议打包**：完全支持纯离线本地静态资源解析与运行，无需外网连接即可启动客户端。
- **双窗口形态动态过渡**：
  - 登录阶段呈现居中且紧凑的小窗（480x640）；
  - 登录成功后平滑切换至 1280x800 全功能主工作区，并自动持久化窗口位置与尺寸。
- **系统托盘与动态未读角标**：
  - 任务栏托盘实时指示用户状态（在线绿点、离开黄点、勿扰红点、离线灰点）；
  - 出现未读消息或提及通知时，托盘图标自动点亮红点剪影角标（`tray-badge.png`）。
- **Windows 原生通知与快捷定位**：
  - 注册专属 `AppUserModelId`，系统 Toast 通知携带频道/公会元数据，点击直接精准唤醒并切入目标频道。
- **原生语言热更新 (`desktopLocales`)**：
  - 托盘右键菜单、原生应用主菜单、输入框右键菜单与前端语言无缝同步，切换语言无需重启。
- **PC 游戏活动侦测 (`gameDetector.ts`)**：
  - 自动轮询识别正在运行的游戏进程，向信令网关同步 "Playing <Game Name>" 状态。
- **独立子进程神经网络音频推理**：
  - 基于 Electron `utilityProcess.fork` 将 AI 降噪运算隔离在专属独立子进程中，通过 `MessagePort` 进行轻量二进制 PCM 帧直传，彻底规避界面渲染卡顿。
- **离线持久化存储架构**：
  - 桌面专用驱动 (`ElectronSqliteStorageAdapter`)：基于独立 Worker 线程的本地 SQLite，关键 Token 依托系统级 `safeStorage`（Windows DPAPI / macOS Keychain）硬件级加密；
  - Web 端专用驱动 (`IndexedDBStorageAdapter`)：依托浏览器 IndexedDB 缓存历史消息。
- **安全自动更新机制 (`UpdateManager`)**：
  - 具备优雅的启动屏加载动画（Splash Screen），支持 SHA-256 完整性校验与防 Zip Slip 路径穿越解压防护。

### 🔒 5. 安全体系与端到端加密 (Security & Cryptography)

- **SFrame WebRTC 音视频端到端加密 (E2EE)**：
  - 基于 WebRTC Insertable Streams，在音视频帧编码后、RTP 打包前加密，接收端解码前解密。
  - **设备独立身份密钥（Per-Device Keys）**：本地生成不可导出的 ECDSA P-256（身份签名）与 ECDH P-256（密钥协商）密钥对，私钥严禁离开本地设备。
  - **1v1 媒体密钥信封 (`MediaKeyEnvelope`)**：采用 Ephemeral ECDH + HKDF-SHA256 + AES-GCM，为接收方各活动设备单独加密封装媒体主密钥并附带数字签名。服务端仅中转密文，**完全不持有明文密钥**，SFU 与中继节点无法窥探音视频内容。
  - **首次使用信任 (TOFU) 与防篡改告警**：通话界面展示设备公钥指纹；若对端设备指纹发生替换，立即触发安全告警并中断未授权通话。
  - **Fail-Closed 熔断安全准则**：SFrame 密钥未就绪或帧验签失败时直接丢弃该帧，绝不回退至明文发送。
- **双棘轮文本加密体系 (Double Ratchet)**：
  - 基于 Signal 协议体系，通过 DH 棘轮与对称 KDF 棘轮实现每条消息独立密钥，兼具前向安全性（Forward Secrecy）与后向保密性（Post-Compromise Security）。
- **WebAuthn / Passkey 免密生物认证**：
  - 支持 Windows Hello、Apple Touch ID / Face ID、Android 指纹/面容以及 YubiKey 硬件密钥。
  - 个人设置中支持通行密钥命名、多设备注册管理与即时注销。
- **纵深防御与合规**：
  - 严格校验 RBAC 30+ 权限位掩码；全路由执行 IDOR 越权校验；
  - 异常响应强制写入 `Cache-Control: no-store` 等防 CDN 负向缓存标头；
  - 密码采用抗 GPU/ASIC 爆破的 Argon2id 哈希算法；
  - JWT 双令牌轮换与单用户自增 `sessionVersion`，支持一键踢出全部已登录设备。

### 🎨 6. 外观定制与交互体验 (Appearance & UX)

- **双展示模式**：Cozy（舒适模式：完整头像与宽松信息流）与 Compact（紧凑模式：单行高密度时间戳排版）。
- **字体与视口缩放**：
  - 聊天字号滑块预设 12px ~ 20px，通过 CSS 变量 `--chat-font-size` 全局响应驱动；
  - 视口缩放支持 0.8x ~ 1.5x，支持 `Ctrl/Cmd + Plus/Minus/0` 快捷缩放与重置。
- **移动端与平板触摸优化**：
  - 单指横向滑动快速唤起频道抽屉或成员抽屉；
  - 判定滑动矢量智能拦截横向 `TouchMove`，杜绝误触发移动端浏览器的“上一页/下一页”导航冲突；
  - 移动端长按消息触发震动触感并弹出轻量底部操作面板（`MobileActionSheet`）。
- **新版本特性更新公告模态框 (`WhatsNewModal`)**：
  - 客户端启动时检测版本变更，以新功能（Features）、优化（Improvements）、修复（Fixes）三栏展示更新摘要。
- **个人资料自由裁剪 (`ImageCropModal`)**：
  - 基于 Canvas 的圆形自由裁剪，支持头像上传、自定义个人横幅（Banner）与自定义状态。
- **多账号快速热切换 (`AccountPicker`)**：本地加密缓存已登录凭据，免重复输入密码秒级切换。

### 🌐 7. 全域国际化 (Full-Stack i18n)

- **严格 5 种官方语言区域**：
  - 🇨🇳 `zh-CN`：简体中文（核心默认与回退语言）
  - 🇹🇼 `zh-TW`：繁體中文（台灣，台湾本地学术与正体中文术语）
  - 🇭🇰 `zh-HK`：繁體中文（香港，港式粤语用语习惯）
  - 🇺🇸 `en-US`：English (United States)
  - 🇯🇵 `ja-JP`：日本語（日语音系、敬语与本地化表达）
- **10 大业务命名空间划分**：
  - `common`, `auth`, `settings`, `chat`, `voice`, `server`, `contextMenu`, `modals`, `admin`, `errors`，共 50 个高保真对称 JSON 资源包。
  - 坚决杜绝硬编码文本；服务端通过标准 `ErrorCode` 枚举下发，客户端依据当前语言动态映射呈现。

### 🛠️ 8. 平台超级治理后台 (Admin Dashboard)

- **用户治理中心**：全局用户列表分页检索、一键封禁/解封、生成临时密码并强制下次登录改密。
- **公会审查与治理**：公会检索、成员列表审查、公会强制解散（需完整输入公会名二次确认）。
- **永久独立平台审计日志 (`PlatformAuditLog`)**：公会删除后其所有平台级操作审计记录依然永久留存归档。
- **全服系统广播与维护模式锁定**：网关实时推送维护信令，客户端秒级全屏锁定敏感操作。

---

## 🎨 品牌图标与视觉资产 (Brand Assets)

Tescord 拥有专属的品牌设计语言与视觉规范，官方吉祥物母版为**猫耳天线电竞机甲头盔 (Lynx / Cat-Ear Tech Mech)**，采用纯数学贝塞尔曲线绝对对称校准生成。

| 资产类型                    | 物理路径                                                                               | 规格与特性                                                                     | 适用场景                             |
| :-------------------------- | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- | :----------------------------------- |
| **官方全彩徽标 (Logo)**     | [`packages/assets/logo.svg`](packages/assets/logo.svg)                                 | 128x128 矢量 SVG，Discord 经典紫蓝底色 (`#5865F2`)，圆角 `rx=28`，白色机甲头盔 | 官方主页、README 宣传、对外展示      |
| **官方透明单色标 (Symbol)** | [`packages/assets/symbol.svg`](packages/assets/symbol.svg)                             | 128x128 矢量 SVG，镂空遮罩设计，单色 `#5865F2`，透明背景                       | UI 嵌入、水印、深浅主题自适应        |
| **网页矢量 Favicon**        | [`apps/web/public/favicon.svg`](apps/web/public/favicon.svg)                           | 纯矢量 SVG 网页图标                                                            | 现代浏览器标签页标头                 |
| **网页多层 ICO**            | [`apps/web/public/favicon.ico`](apps/web/public/favicon.ico)                           | 16/32/48 多图层 ICO 格式                                                       | 浏览器收藏夹与网页快捷方式           |
| **桌面高清大图**            | [`apps/desktop/resources/icon.png`](apps/desktop/resources/icon.png)                   | 512x512 高清无损 PNG 图标                                                      | Electron 安装向导与主窗口图标        |
| **Windows 完整 ICO**        | [`apps/desktop/resources/icon.ico`](apps/desktop/resources/icon.ico)                   | 包含 16 ~ 256 全尺寸图层                                                       | Windows 任务栏与可执行程序嵌入       |
| **系统托盘剪影**            | [`apps/desktop/resources/tray-white.png`](apps/desktop/resources/tray-white.png)       | 32x32 单色高对比度剪影 PNG                                                     | 操作系统任务栏系统托盘默认图标       |
| **托盘未读角标**            | [`apps/desktop/resources/tray-badge.png`](apps/desktop/resources/tray-badge.png)       | 32x32 带有 `#f23f43` 醒目红点角标 PNG                                          | 有未读消息或提及时的系统托盘动态切换 |
| **React 徽标组件**          | [`apps/web/src/components/ui/BrandLogo.tsx`](apps/web/src/components/ui/BrandLogo.tsx) | 支持 `badge` 与 `symbol` 变体及多尺寸响应                                      | Web 前端组件库直接渲染               |

---

## 📂 项目目录结构 (Directory Structure)

```text
Tescord/
├── apps/
│   ├── web/               # React 18 SPA 前端客户端 (Discord 风格三栏界面、富文本、音视频舞台)
│   ├── server/            # Fastify REST API 与 WebSocket 信令网关服务 (Gateway 长连接、状态机)
│   └── desktop/           # Electron 桌面客户端外壳 (离线 file:// 协议、系统托盘、安全硬件加密)
├── packages/
│   ├── types/             # 全系统强类型契约中心 (所有跨端跨模块通信的唯一协议源)
│   └── assets/            # 官方品牌视觉资产 (全彩 Logo、镂空 Symbol 矢量母版)
├── docker/
│   ├── docker-compose.yml # 基础设施一键编排 (Postgres, Redis, MinIO, LiveKit, Coturn)
│   ├── livekit.yaml       # LiveKit SFU 核心媒体配置
│   └── turnserver.conf    # Coturn NAT 穿透中继配置
├── e2e/                   # 171+ Playwright 端到端全链路自动化验收用例
├── package.json           # Monorepo 根配置
├── pnpm-workspace.yaml    # pnpm 现代化工作区定义
├── turbo.json             # Turborepo 高性能流水线编排
└── .env.example           # 基础设施与服务环境变量配置模版
```

---

## 🚀 快速开始与本地开发 (Quick Start)

### 1. 环境准备

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0` (推荐 `pnpm@11`)
- **Docker & Docker Compose**: 运行自建数据库与媒体组件

### 2. 安装依赖

```bash
pnpm install
```

### 3. 初始化数据库

```bash
# 生成 Prisma 客户端并同步数据库结构
pnpm db:init
```

### 4. 启动本地全栈开发环境

在仓库根目录下并行启动所有核心服务：

```bash
# 同时拉起后端 API、WebSocket 信令网关与 Web 前端
pnpm dev
```

或按需独立启动单个模块：

```bash
# 启动后端 API 与 Gateway (默认端口 3001)
pnpm dev:server

# 启动 Web 前端界面 (默认端口 3000)
pnpm dev:web

# 启动 Electron 桌面客户端 (开发环境会自动加载 Web 界面)
pnpm dev:desktop
```

启动完成后，打开浏览器访问：**[http://localhost:3000](http://localhost:3000)**。

### 5. 管理员账号与命令行工具速查

```bash
# 创建超级管理员账号
pnpm admin:create

# 赋予已有账号超级管理员权限
pnpm admin:grant <username>

# 启动本地内置 LiveKit SFU 实例 (Windows PowerShell)
pnpm livekit

# 全项目代码格式化校验
pnpm format
```

---

## 🐳 Docker 私有化全套基础设施

部署在自建服务器、私有 VPS 或局域网内网 NAS 时，一键拉起所有后端支撑组件：

```bash
cd docker
docker compose up -d
```

### 基础设施组件与端口矩阵：

| 组件名称           | 版本      | 核心作用                                           | 暴露端口                                            |
| :----------------- | :-------- | :------------------------------------------------- | :-------------------------------------------------- |
| **PostgreSQL**     | 16-alpine | 业务数据持久化、用户关系与消息记录存储             | `5432`                                              |
| **Redis**          | 7-alpine  | WebSocket 网关状态同步、会话保活与 PubSub 集群分发 | `6379`                                              |
| **MinIO**          | Latest    | S3 兼容的高性能本地多媒体对象存储服务              | API: `9000`<br/>控制台: `9001`                      |
| **LiveKit Server** | Latest    | WebRTC SFU 媒体中心，超低延迟音视频路由与屏幕分享  | 信令: `7880`<br/>TCP: `7881`<br/>UDP: `50000-50100` |
| **Coturn**         | Latest    | 内置 STUN / TURN NAT 网络穿透中继服务              | `3478` (TCP/UDP)                                    |

---

## ☁️ Cloudflare 全栈支持与生产部署指南 (Cloudflare Calls & Zero Trust)

Tescord 原生深度集成了 Cloudflare 生态，支持**无公网 IP、无独立 VPS 穿透、全边缘加速**的一体化生产部署方案，涵盖全球边缘 WebRTC SFU 与持久化内网穿透隧道。

### 1. 核心架构模式对比

| 架构维度           | 方案 A：Cloudflare 一体化全托管部署 (推荐生产方案)    | 方案 B：自建 SFU + Cloudflare Zero Trust 穿透 (混合方案)         |
| :----------------- | :---------------------------------------------------- | :--------------------------------------------------------------- |
| **音视频媒体引擎** | **Cloudflare Calls (Realtime Calls)** 边缘 WebRTC SFU | 自建 **LiveKit SFU** + Coturn STUN/TURN                          |
| **网络穿透方式**   | **单域名模式 (Single Domain via NGINX 反代)**         | **多子域名模式 (Multi-Subdomain via Cloudflare Tunnel)**         |
| **公网端口暴露**   | **0 开放端口** (全站走 `cloudflared` 隧道安全回源)    | **0 开放端口** (媒体流推荐直连或 Coturn 独立中继)                |
| **运维复杂度**     | 极低（免维护 Coturn、免维护 LiveKit 进程）            | 中等（自维护完整媒体与穿透容器栈）                               |
| **编排配置文件**   | `docker/docker-compose-cloudflare.yml`                | `docker/docker-compose.yml` + `docker/docker-compose-tunnel.yml` |
| **环境配置模版**   | `docker/.env.cloudflare.example`                      | `docker/.env.tunnel.example`                                     |

---

### 2. 方案 A：Cloudflare 一体化全托管生产部署 (推荐)

此方案利用 **Cloudflare Calls** 承载音视频媒体流，利用 **Cloudflare Zero Trust Tunnel** 穿透前端、网关与对象存储，前端由内置 NGINX 统一反代，只需在 Cloudflare 解析一个单域名即可完整运行全站。

#### 拓扑图：

```text
[ 用户客户端 (Web / Electron) ]
               │
               │ HTTPS / WSS (单域名: tescord.yourdomain.com)
               ▼
[ Cloudflare 全球边缘网络 (CDN + WAF) ]
       │                               │
       │ WebRTC 媒体流 (UDP)           │ 双向安全加密隧道 (QUIC/HTTP2)
       ▼                               ▼
[ Cloudflare Calls 全球 SFU ]   [ cloudflared 容器 (docker-compose-cloudflare.yml) ]
                                       │
                                       ▼
                                [ NGINX 统一反向代理 ]
                                       ├── / ────────► Web 前端静态应用
                                       ├── /api ─────► Fastify REST API (:3001)
                                       ├── /gateway ─► WebSocket 信令网关 (:3001)
                                       └── /ort/ ────► WASM 降噪模型资源
```

#### 部署步骤：

1. **准备环境变量**：
   ```bash
   cp docker/.env.cloudflare.example docker/.env.cloudflare
   ```
2. **填入 Cloudflare 凭证与站点配置** (`docker/.env.cloudflare`)：
   - `SITE_HOST`: 您的公网单域名（例如 `tescord.yourdomain.com`）
   - `CLOUDFLARE_CALLS_APP_ID`: Cloudflare Dashboard ➔ Calls ➔ App ID
   - `CLOUDFLARE_CALLS_APP_SECRET`: Cloudflare Dashboard ➔ Calls ➔ App Secret
   - `CLOUDFLARE_CALLS_TURN_KEY_ID`: Cloudflare Calls 提供的 TURN 密钥 ID
   - `CLOUDFLARE_CALLS_TURN_API_TOKEN`: Cloudflare Calls 提供的 TURN API Token
   - `CLOUDFLARE_TUNNEL_TOKEN`: Cloudflare Zero Trust Tunnels 创建的 Tunnel Token
3. **在 Cloudflare Zero Trust 控制台配置 Public Hostname**：
   - 映射 `tescord.yourdomain.com` ➔ `HTTP` ➔ `web:80`（或 `http://localhost:18080`）
4. **一键启动全栈服务**：
   ```bash
   docker compose -f docker/docker-compose-cloudflare.yml --env-file docker/.env.cloudflare up -d
   ```

---

### 3. 方案 B：自建媒体 SFU + Cloudflare Zero Trust 多子域名穿透 (混合架构)

若希望媒体数据完全保留在自建基础设施（LiveKit + Coturn），同时享受 Cloudflare Zero Trust 免公网 IP、免映射端口的穿透便利：

#### 快速启动指令：

```bash
# 联合启动基础服务与穿透隧道
pnpm tunnel:up

# 实时查看隧道接入与运行日志
pnpm tunnel:logs

# 停止隧道与关联服务
pnpm tunnel:down
```

#### 多子域名独立路由映射表：

在 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com/) 的 Tunnel ➔ **Public Hostname** 中配置以下 4 条路由：

| 序号  | 建议域名示例             | Service Type | URL (目标地址)              | 说明                                      |
| :---: | :----------------------- | :----------: | :-------------------------- | :---------------------------------------- |
| **1** | `tescord.yourdomain.com` |   **HTTP**   | `host.docker.internal:3000` | Web 前端客户端                            |
| **2** | `api.yourdomain.com`     |   **HTTP**   | `host.docker.internal:3001` | Fastify API 与 WebSocket `/gateway` 网关  |
| **3** | `s3.yourdomain.com`      |   **HTTP**   | `minio:9000`                | MinIO 附件对象存储 (支持直传与大文件下载) |
| **4** | `rtc.yourdomain.com`     |   **HTTP**   | `livekit:7880`              | LiveKit SFU WebRTC 房间信令通道           |

> [!NOTE]
> 详细的多子域名配置步骤、WebRTC UDP 穿透原理及 Coturn 搭配策略，请参阅专用文档：[`docker/CLOUDFLARE_TUNNEL.md`](docker/CLOUDFLARE_TUNNEL.md)。

---

### 4. Cloudflare 核心环境变量速查

| 变量名                            | 适用服务     | 描述与示例                                                                  |
| :-------------------------------- | :----------- | :-------------------------------------------------------------------------- |
| `VOICE_ENGINE`                    | Server / Web | 设为 `cloudflare_realtime` 启用 Cloudflare 边缘媒体引擎（默认为 `livekit`） |
| `CLOUDFLARE_CALLS_APP_ID`         | Server       | Cloudflare Realtime Calls 应用程序 ID                                       |
| `CLOUDFLARE_CALLS_APP_SECRET`     | Server       | Cloudflare Realtime Calls 应用程序私钥                                      |
| `CLOUDFLARE_CALLS_TURN_KEY_ID`    | Server       | Cloudflare 提供的全球边缘 TURN Key ID                                       |
| `CLOUDFLARE_CALLS_TURN_API_TOKEN` | Server       | Cloudflare 全球边缘 TURN API 凭证                                           |
| `CLOUDFLARE_TUNNEL_TOKEN`         | cloudflared  | Cloudflare Zero Trust 远程安全隧道鉴权 Token                                |

---

### 5. 防 CDN 缓存污染与 WAF 安全防御策略

为防止公网 CDN / 边缘节点错误缓存用户私密数据，Tescord 服务端实施了严格的防缓存注入策略：

- **私有附件短期访问签名**：所有附件与媒体资源均签发带有 5 分钟有效期的 HMAC-SHA256 签名外链；
- **防 CDN 负向缓存标头 (Negative Caching Defense)**：
  - 对 `404 Not Found`、`403 Forbidden`、`401 Unauthorized` 等非成功请求，服务端严格附加标头：
    ```http
    Cache-Control: no-store, no-cache, must-revalidate
    Cloudflare-CDN-Cache-Control: no-store
    CDN-Cache-Control: no-store
    ```
  - 彻底规避因某成员暂时无权访问导致 CDN 边缘节点持久缓存 403 页面、阻断后续授权访问的安全缺陷。

---

## 🧪 自动化测试与工程质量保证 (Testing & Verification)

项目遵循严苛的质量门禁与端到端自动化验收标准，覆盖 171+ 场景的全量 Playwright 真实浏览器测试套件：

```bash
# 运行完整的 Playwright E2E 自动化测试套件
pnpm test:e2e

# 运行桌面 Electron 专用端到端验收测试
pnpm test:e2e:electron

# 开启交互式 UI 调试运行测试
pnpm test:e2e:ui

# 运行核心安全端到端媒体加密校验
pnpm test:security-media

# 验证防 CDN 污染与负向缓存标头机制
pnpm test:cache-headers

# 校验客户端安全自动更新与防 Zip-Slip 归档校验
pnpm test:updater
```

---

## 📜 开源协议 (License)

本项目基于 **MIT License** 开源。
欢迎查阅代码、提交 Issue 与参与 Pull Request 协作，共同构建极致、自由、安全的本地私有化实时通讯新标杆！
