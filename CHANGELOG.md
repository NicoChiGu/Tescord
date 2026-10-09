# 变更日志 (CHANGELOG)

本文档遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，并严格记录每个版本的变更与修复项。发布时 CI 将自动从本文件中提取对应版本的更新日志推送到 GitHub Releases。

## [Unreleased] - 2026-10-09

### 新增

- 媒体加密快照同步优先通过已认证的 Gateway WebSocket 传输，减少协商和通话期间的 HTTP `media-encryption/sync` 请求。支持请求关联、超时、取消、旧响应隔离及旧服务端 HTTP 兼容。
- 管理员可通过语音成员右键菜单，在确认后将成员移出语音频道；服务端验证 MOVE_MEMBERS 权限、角色层级和当前登录会话。被移出的成员可以重新加入。
- 媒体加密协商升级为 v3，密钥发布和确认绑定房间版本及设备注册实例，拒绝旧设备、旧会话和跨频道操作。部署时需要同步更新服务端和客户端，旧客户端需刷新或更新后重新加入语音。

### 修复

- Web IndexedDB 和桌面 SQLite 对权威消息序列范围进行原子对账，清理已删除消息的缓存与全文索引，保留范围外历史、本地待发送消息及其他频道的数据。
- 修复空历史直接清空频道缓存导致本地待发送消息丢失的边界；空分页按请求方向修剪已删除历史并保留当前游标消息。
- 加固多人加入、密钥轮换、设备转移和 SFU SDP 操作的排队及身份复核，增加有界初始连接恢复；只对明确未分配的轨道重试，未知分配结果撤销旧会话。
- 管理员断开语音时先撤销旧会话，避免异步清理误删重新加入的会话；Cloudflare 模式不再调用默认 LiveKit 地址。
- 断开语音操作使用当前账号的访问令牌，支持未记住登录的会话；确认弹窗期间切换账号会取消旧账号的操作。新增文案与错误码覆盖全部五种语言。
- 升级 Sharp 至 0.35.5，并将 fast-jwt 固定到已修复的 6.3.4，修复图像处理与 JWT 校验依赖的安全问题。
- 升级构建工具间接依赖 http-cache-semantics 至 4.3.0、source-map-js 至 1.2.2、postcss-selector-parser 至 7.1.6；braces 与 sprintf-js 尚无可用修复发行版，保留审计告警与发布阻塞记录。

### 验收

- 增加语音管理授权负向测试、真实菜单取消／确认及重新加入测试、异步断开与设备重入竞态测试。
- 增加三人／五人真实签名设备的加密媒体生命周期、并发加入、逐远端 RTP／解密／PCM 和真实 Cloudflare SFU/TURN 矩阵；测试凭据目录相互隔离，隔离测试库与测试资源按次清理。
- 完整执行结果及剩余发布门禁见 `docs/acceptance/release-2026-10-09.md`；测试入口或代码存在不代表真实媒体验收通过。

## [0.3.7] - 2026-10-08

### 🚀 新增功能与体验革新 (Features & UX)

- **Discord 风格移动端手势动作抽屉 (Discord-Style Mobile Action Drawer)**：
  - 基于手势引擎与 `vaul` 打造丝滑的移动端底部动作抽屉，配备深色磨砂蒙层、居中拖拽把手及全视口底部安全区（`safe-area-inset-bottom`）；
  - 触发长按时提供 40ms 细腻触觉震动反馈（Haptic Feedback），并自动失焦收起系统软键盘；
  - 核心操作内置“原地红色二次确认（Inline Destructive Confirmation）”交互，危险动作（删除/撤回等）点击就地提示并在 3.5s 后自动重置，避免打断式弹窗。

- **多级子菜单下钻导航栈 (Nested Sub-menu Drill-down Navigation)**：
  - 抽屉内部通过 `ActionDrawerContext` 支持子页面下钻视图入栈（`pushView`）与出栈（`popView`）；
  - 顶部自动呈现带返回箭头的导航栏，移动端多级菜单体验（如频道静音时长等）高度拟合原生 App。

- **全响应式上下文菜单桥接适配器 (Responsive Context Menu Bridge)**：
  - 重构 `apps/web/src/components/ui/context-menu.tsx`，在 PC 桌面端继续保持 Radix UI 浮动菜单与坐标物理缓存防闪烁机制；
  - 在移动触控设备（视口 `< 1024px` 或触控设备）自动降级并转换为 Discord 风格的 `ActionDrawer`，业务组件零改动兼容双端。

- **全新移动端消息操作面板与 Emoji 快捷栏 (Redesigned Mobile Action Sheet)**：
  - 顶部横向集成 8 个高频 Emoji 快捷回应栏（👍 ❤️ 😂 🎉 🔥 👏 👀 🚀）及更多表情选择器；
  - 整合引用回复、编辑消息、置顶/取消置顶、复制文字与原地确认删除等高频操作。

### 🛠️ 细节优化与交互对齐 (Improvements & Polish)

- **响应式图片与骨架屏等比缩放 (Responsive Image & Skeleton Scaling)**：
  - 优化小屏设备（320px ~ 768px）图片气泡与加载骨架屏尺寸，自动计算视口缩放阶梯比例（Scale Factor）；
  - 严格维持原图长宽比（`aspect-ratio`）与 `max-w-full`，彻底杜绝横向撑破聊天气泡与视口。

- **迷你音频浮窗移动端触控拖拽升级 (Mini Audio Player Mobile Touch Dragging)**：
  - 将小窗拖拽与波形定位重构为 W3C 标准 `PointerEvent`，绑定 `setPointerCapture` 与 `touch-none` 样式；
  - 消除浏览器原生下拉刷新/滑动手势干扰，增加移动端视口边界防负数安全裁切，解决边缘闪烁问题。

- **长按手势防抖与黄金阈值调优 (Long-Press Haptic Debounce & Threshold Tuning)**：
  - `useLongPress` 触发阈值调优至 450ms 黄金时长，并加入 10px 位移防抖容差，完美区分滚动与长按；
  - 修复 `ChatArea.tsx` 中触屏判定逻辑缺陷，确保移动端长按消息 100% 稳定唤起。

- **Tooltip 组件事件穿透保障 (Tooltip Event Pass-Through)**：
  - 使用 `React.forwardRef` 包装，全面透传 `onContextMenu` 与 `onPointerDown` 事件，杜绝作为包裹层时吞掉长按或破坏 Radix ref 绑定。

- **全域多语言 100% 对称对齐 (Full-Stack 5-Locale i18n Alignment)**：
  - 5 套官方语言包（`zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP`）全量同步更新新增特性与提示文案，零漏键、零硬编码。

### 🧪 自动化测试 (E2E Tests)

- 新增 `e2e/mobile-action-drawer.spec.ts` 移动端动作抽屉与子菜单下钻自动化验收测试；
- 新增 `e2e/mobile-image-skeleton-and-floating-player-drag.spec.ts` 移动端图片缩减与播放器拖拽验收测试。

---

## [0.3.6] - 2026-10-07

### 🚀 新增功能与体验革新 (Features & UX)

- **类 Discord 自定义暗黑无障碍下拉选项组件 (Custom Accessible Select Component)**：
  - 彻底淘汰浏览器原生 `<select>` / `<option>` 标签，杜绝浅色边框与平台外观割裂；
  - 严格遵循 WAI-ARIA 规范（`role="listbox"` / `role="option"` / `aria-expanded` / `aria-selected`），支持 `ArrowUp` / `ArrowDown` 快速键盘导航（智能跳过禁用项）、`Enter` / `Space` 选中与 `Escape` / 外部点击自动收起；
  - 深度集成多语言国际化，并在创建频道、编辑频道、邀请设置、公会审计日志过滤、用户音频设备选择与超级管理后台全域无缝替换。

- **全局 Portal 悬浮暗黑微气泡 Tooltip 组件 (Portal-Based Dark Micro-Bubble Tooltips)**：
  - 告别浏览器原生 `title` 属性的显示延迟与父容器 `overflow: hidden` 裁剪遮挡问题；
  - 基于 React Portal 挂载至 `document.body`，提供 4 方位（`top` / `bottom` / `left` / `right`）与 3 种对齐策略（`center` / `start` / `end`）；
  - 配备 150ms 优雅微防抖与精准边缘避让，全面升级侧边栏、频道操作、通话控制栏、推流面板及音乐底栏悬停提示。

- **聊天附件专属右键上下文菜单 (Dedicated Attachment Context Menu)**：
  - 为聊天区图片、音频与通用文件附件绑定专属右键菜单交互；
  - 支持附件快速下载、复制直链并弹出 Toast 成功通知、新标签页打开与原图查看；
  - 联动消息级操作（引用回复、复制消息 ID、删除自身消息）。

### 🛠️ 细节优化与交互对齐 (Improvements & Polish)

- **浮动音乐播放器全窗口拖拽与双侧磁吸附 (Floating Mini Player Magnetic Snapping)**：
  - 迷你播放器支持全窗口自由拖动，松手时根据屏幕位置智能贴边吸附至左侧或右侧（`snappedSide: "left" | "right"`），并在窗口缩放时自适应贴边；
  - 波形图采用双层亚像素平滑渐变剪裁（`clip-path: inset(...)`），消除离散色块跳变；
  - 新增播放游标（Thumb）指示线与 hover 波形实时时间戳浮层微气泡。

- **语音与文本频道命名规则智能解耦 (Voice vs Text Channel Name Decoupling)**：
  - 文本频道继续保持 Discord 规范化小写与连字符约束；
  - 语音频道完全放宽限制，支持保留原始英文大小写与自然空格输入，并在前后端完成同步放宽与双向校验。

- **语音拓扑状态徽标与主播推流 HUD 重构 (Voice Topology Badges & Streamer HUD)**：
  - 频道列表喇叭图标支持叠加 P2P 蓝色网络拓扑小标与 E2EE 绿色安全锁徽标，精简频道标题旁冗余人数胶囊；
  - 主播本人的推流观众数徽标由右上角调整为左上角悬浮操作区，解除与全屏/聚焦/诊断图标的密集挤占。

- **全域多语言 100% 对称对齐 (Full-Stack 5-Locale i18n Alignment)**：
  - 5 套官方语言包（`zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP`）全量同步更新新增特性与提示文案，零漏键、零硬编码。

---

## [0.3.5] - 2026-10-07

### 🚀 新增功能与体验革新 (Features & UX)

- **类 Discord 自定义波形音频播放器 (Discord-Styled Custom Waveform Audio Player)**：
  - 彻底淘汰原生 HTML5 `<audio controls>` 灰条，重构为高度沉浸的 Discord 风格深灰音频卡片组件（`AudioAttachment`）；
  - 基于 Web Audio API 离线提取 PCM 峰值并计算 RMS 均方根波形，在非支持或受限环境下采用平滑确定性正弦伪随机波形降级；
  - 引入 LRU 峰值内存缓存（最大 200 项）与命中自刷新机制，保障高频消息滚动与重新渲染时的流畅性能；
  - 提供波形柱状图拖拽寻道（Drag-to-Seek Scrubbing）、动态毫秒级播放进度条、静音切换与四档倍速循环调节（1.0x / 1.25x / 1.5x / 2.0x）。

- **全局单例互斥播放与常驻微缩浮动胶囊底栏 (Global Mutex Playback & Floating Mini Dock)**：
  - 设计全局播放状态机（`useAudioPlayerStore`），以单例原生 `HTMLAudioElement` 驱动播放，从底层彻底根除多音频同时播放导致的声音混叠；
  - 离开当前消息视口、切换文字频道或进入其他公会时，背景播放持续进行，右下角自动激活常驻微缩胶囊底栏（`GlobalMiniPlayer`）；
  - 支持极简胶囊（Pill）与完整面板（Dock）两种视图无缝切换，实现真正的无感跨频道流转收听。

- **流媒体端到端加密实时信令与设备确认 (Realtime Media E2EE Signaling & Device Acknowledgment)**：
  - 扩展 SFrame 流媒体加密协议规范（`MEDIA_KEY_ENVELOPE`、`MEDIA_KEY_ACK`、`MEDIA_EPOCH_UPDATE`），前后端统一由 `@tescord/types` 强类型驱动；
  - 服务端基于 WebSocket 网关精准实现针对设备会话的实时信令直推；前端增加 2.5s 轮询补偿防丢机制；通过 7 项独立数据库隔离单元测试套件。

- **音频全生命周期资源安全释放与异常防御 (Audio Lifecycle Safeguards & Event Defenses)**：
  - 在 Web Audio 波形解码的 `finally` 块中严格回收 `AudioContext` 实例，杜绝并发解码失败导致的浏览器音频上下文耗尽泄漏；
  - 为波形拖拽全局事件挂载加入组件卸载（unmount）与拖拽终结时的双重解绑防线；
  - 在单例音轨切换与播放器关闭时，过滤切歌引发的无害 `AbortError`，重置音频源并防御空 `src` 伪错误污染。

- **全域多语言 100% 对称支持 (Full-Stack 5-Locale i18n Alignment)**：
  - 在 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP` 全部 5 套官方语言包的 `chat.json` 与 `modals.json` 中完成 100% 键名对称性对齐，零未抽离硬编码文案。

---

## [0.3.4] - 2026-10-07

### 🐛 问题修复与体验优化 (Bug Fixes & UX)

- **响应式视口切换与手势 Hook 稳定性修复 (Responsive Hook Invariant Fix)**：
  - 修复平板横竖屏或视口动态变化时条件调用 `useUserProfilePopoutStore` 违反 React Rules of Hooks 导致的链表槽位错乱与 `Cannot read properties of undefined (reading 'length')` 运行时崩溃；
  - 提取 Store 状态至顶层无条件消费，保障全端抽屉滑动手势（`useSwipeGesture`）在全尺寸视口下的稳定性。

- **服务器邀请卡片原生拖拽阻断 (Server Invite Embed Drag Prevention)**：
  - 彻底禁止邀请卡片内的公会头像与横幅背景发生浏览器原生图片拖拽（`draggable={false}` / `onDragStart.preventDefault`），杜绝因拖动卡片误触发聊天区文件拖拽上传；
  - 在 `GuildIcon` 基础组件增加默认防拖拽属性兜底。

- **私信音视频通话呼叫界面极简化 (DM Call Stage Simplified)**：
  - 移除呼叫连接阶段冗余技术术语提示（`WebRTC P2P Direct / LiveKit SFU`）与黑屏过渡菊花；
  - 统一并入纯净呼叫舞台设计，完整保留对方大头像、水波呼吸波纹、端到端加密状态徽标（`已验证设备 · E2EE`）与底部控制栏。

- **好友列表通话事件消息简介本地化转换 (Call History Message Snippet Localization)**：
  - 修复私信好友列表最后一条消息直接渲染原始 `[CALL_EVENT:canceled]` 等协议字符串的问题；
  - 新增智能事件转义器，全面对称支持 5 种官方语言区域（`zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`），将未接听、已取消、已拒绝与通话时长优雅渲染为本地化文字摘要；
  - 同步优化桌面系统通知消息体转义，保证各端交互呈现一致性。

- **服务器邀请卡片实时在线人数准确计算 (Accurate Invite Presence Count)**：
  - 修复服务端 `/api/invites/:code` 路由中使用虚构模拟公式 `Math.max(1, Math.floor(memberCount * 0.4))` 导致离线人数与在线统计失真的问题；
  - 改造为实时查询公会成员列表并调用 `cacheStore.batchGetPresences` 真实统计有效在线（ONLINE / IDLE / DND）人数。

- **聊天消息用户头像拖拽上传防御 (Message Avatar Drag Prevention & External Drag Guard)**：
  - 为聊天消息内的作者头像、DM 横幅大头像与成员列表头像添加 `draggable={false}` 与 `onDragStart.preventDefault`；
  - 在 `ChatArea` 引入全局内部拖拽守卫与外部文件类型纯净度校验（`isExternalFileDrag`），彻底杜绝网页内部任何元素被意外拖动为上传文件。

---

## [0.3.3] - 2026-10-06

### 🚀 新增功能 (Features)

- **SFrame (RFC 9605) 实时流媒体端到端加密体系 (Media E2EE v2)**：
  - 核心音视频流基于 RFC 9605 标准实现客户端本地帧级加密（Insertable Streams / ScriptTransform 与 Web Worker 隔离线程）；
  - 信令与媒体解耦，支持硬件加速与自动密钥轮转；服务端仅充当盲中继，零明文访问；
  - 网关升级至媒体协议 v2，完善握手超时拦截与客户端密钥信封协商 (`StreamMediaKeyEnvelope`)；
  - 完善端到端加密状态指示器与可视化仪表板（`MediaEncryptionIndicator` / `NetworkQualityModal`）。

- **多端在线状态协同与智能闲置仲裁 (Multi-Session Presence & Idle Arbitration)**：
  - 引入客户端会话级（Session-level）在线状态独立追踪与智能仲裁算法，区分用户手动设定与客户端挂机状态；
  - 10 分钟无操作自动判定进入闲置状态（`IDLE`），全端离席自动判定闲置，并在全端活跃唤醒时即时恢复在线；
  - 服务端网关新增精准的断开连接防抖重新仲裁与状态广播机制，杜绝断线震荡。

- **类 Discord 动态噪点马赛克剧透标签 (Discord-Style Noise Mosaic Spoiler Tag)**：
  - 支持 `||剧透内容||` markdown 语法解析与行内渲染；
  - 像素级还原 Discord 动态噪点马赛克遮罩动效，支持点击显现与再次隐藏交互；
  - 适配系统的 `prefers-reduced-motion` 辅助功能偏好，降低弱网与低功耗设备渲染开销。

- **富媒体公会邀请卡片与首频道智能直达 (Rich Server Invite Embed & Auto Navigation)**：
  - 聊天中的服务器邀请链接全面升级为 Discord 风格富媒体卡片；
  - 呈现公会横幅、图标、创建年月、实时在线人数与总成员数；
  - 支持一键加入或“前往服务器”，并智能直达首个可用文本频道，增加异步数据拉取竞态保护。

- **STL 3D 模型在线交互式预览 (3D Model Preview in Chat)**：
  - 聊天附件全面支持 STL 3D 模型文件在线解析与交互式预览；
  - 基于 Three.js 异步独立分包（首屏零开销），支持模型自由旋转、全方位缩放、自动居中、面数统计及物理尺寸（mm）实时计算；
  - 模态框关闭与组件卸载时强制调用 WebGL 上下文释放（`forceContextLoss`），杜绝显存泄漏。

- **桌面客户端原生音频环回捕获 (Native WASAPI Audio Loopback)**：
  - 深度集成 Windows 原生 C++ 插件（WASAPI Build 20348+），实现系统伴奏与应用级无损音频流采集；
  - 主进程提供短期 Grant 权限安全校验，屏幕共享时提供独立进程授权与无损混音。

- **公会动态 GIF 图标与像素级安全防护 (Animated Guild Icons)**：
  - 支持服务器上传动态 GIF 图标并在鼠标悬停时平滑播放；
  - 服务端深度集成 Sharp 像素级安全检测与魔数比对，限制最大帧数与像素上限，阻断恶意解压炸弹。

### 🐛 问题修复与体验优化 (Bug Fixes & UX)

- **聊天双向游标消息历史分页 (Bidirectional Message History)**：
  - 重构消息历史加载机制为双向游标（Cursor-based Pagination），彻底消除跨频道切换与跳转定位时的列表闪烁与抖动；
  - 优化触屏手势抽屉与长按上下文菜单响应，提升移动端与高触控设备的交互流畅度。
- **国际化与多语言 100% 对齐与硬编码修复**：
  - 消除网络质量弹窗与频道欢迎横幅的历史硬编码，全面抽离为 i18n 规范调用；
  - 同步更新 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP` 全部 5 套语言字典。

### 🛠 部署与数据 (Deployment & Data)

- **PostgreSQL 数据库迁移**：新增 `20261006000000_stream_media_encryption` 生产迁移，创建 `StreamMediaKeyEnvelope` 表支持端到端密钥信封存储。

---

## [0.3.2] - 2026-10-02

### 🚀 新增功能 (Features)

- **Discord 原生级搜索引擎体系 (Message Search Engine)**：
  - 支持全公会与单频道的全文与多维联合检索（Prisma 联合索引与时间范围查询）；
  - 支持快捷高级语法过滤标签（`from:`, `in:`, `has:file`, `has:image`, `pinned:true`）；
  - 前端右侧独立滑出式搜索抽屉（`SearchResultsDrawer`），正文关键字黄色高亮展示；
  - 搜索结果卡片支持一键平滑跳转（Jump to message）：跨频道自动切换并滚动贴合至目标消息，并伴随黄色闪烁脉冲高亮定位；
  - 完美兼容端对端加密（E2EE）频道的客户端本地倒排索引检索（`clientFtsStorage`）。

### 🐛 问题修复与体验优化 (Bug Fixes & UX)

- **修复邀请好友至服务器点击无反应 (Friend Invite Fix)**：
  - 修复 `InviteFriendsModal` 在未提前手动生成链接时点击好友条目“邀请”静默退出的缺陷；
  - 打开弹窗时自动后台预生成有效链接，填入只读分享框；
  - 点击好友“邀请”按钮支持即时兜底创建，并通过私信自动向好友发送公会邀请卡片；
  - 新增发送中旋转加载指示器与“已邀请”不可点状态反馈，捕获异常 Toast 提示。
- **大字号与窄屏排版防挤压截断 (Header Typography & Overflow Fix)**：
  - 彻底修复在大字号（如 20px / 125% 缩放）或紧凑视口下，Header 频道标题撑破、搜索栏占用固定宽度导致右侧置顶图钉和成员列表开关被挤出屏幕被物理截断的缺陷；
  - 频道标题采用阶梯式优雅截断（`truncate`）；
  - 搜索栏在紧凑宽度下自适应折叠为单图标按钮；
  - 右侧置顶图钉与成员列表切换按钮添加 `flex-shrink-0` 绝对防溢出保护。
- **触屏端服务器列表长按与拖拽状态机优化 (Touch Gesture & Drag Ordering)**：
  - 移除服务器按钮上阻断滑动的 `touch-none` 类，恢复移动端/触屏用户在服务器列表侧栏上的自由垂直平滑滚动；
  - 建立 1450ms 连续手势状态机（450ms 唤起上下文菜单，菜单展示满 1 秒后滑动无缝启动拖拽重排）；
  - 拖拽启动时派发 Escape 瞬间卸载 Radix 上下文菜单，配合 40ms 轻度振动反馈。
- **多语言国际化 100% 对齐**：同步更新 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP` 全部 5 种官方语言包的搜索与邀请相关键位。

---

## [0.3.1] - 2026-10-01

### 🚀 新增功能 (Features)

- **自定义表情包系统 (Custom Emoji System)**：引入类 Discord 的自定义表情体系，支持个人表情（配额 50 个）与服务器公会表情上传、管理与检索；聊天输入框支持快速搜索与插入，消息 Reaction 反应胶囊原生渲染自定义表情。
- **统一 SVG 在线状态角标 (Unified StatusBadge)**：重构用户在线状态指示器，采用高精度 SVG Mask 物理镂空遮罩（闲置月牙、请勿打扰横杠、离线空心环），彻底解决传统浮层锯齿与错位，并全面兼容主流浏览器与暗色模式。
- **全局文字缩放与防回流排版 (Typography & Zero CLS)**：移除客户端易导致渲染破损的强制缩放滑块，改为 13px~20px 全局无级文字缩放；聊天图片附件保存并回传原始宽高，根据宽高比预占位容器，消除图片加载时的页面抖动（CLS）。
- **超级管理员建服控制 (Admin Guild Creation Control)**：管理后台新增“允许非超级管理员创建公会”开关，开启后普通用户建服将被拦截并引导加入已有服务器，为团队协作与私有化单服务器部署提供纯粹自治体验。

### 🐛 问题修复与安全强化 (Bug Fixes & Security)

- **iOS Safari 头像与附件上传修复**：动态嗅探 Safari 的 WebP 导出能力并平滑降级为 JPEG，解决移动端 Safari 上传头像触发 415 媒体类型不支持的错误。
- **二进制魔数与解压炸弹防御**：附件上传服务端采用 Sharp 深度核验图像前序 Magic Bytes，并限制最大 4000 万像素（`limitInputPixels: 40_000_000`），阻断恶意文件伪装与像素炸弹 DoS。
- **表情资源重定向缓存**：自定义表情重定向路由 `/api/custom-emojis/:emojiId` 新增 `Cache-Control` 强缓存头，避免高频表情与 Reaction 渲染重复回源查询数据库。
- **大字号弹窗排版自适应**：修复当用户将全局字号调节至 20px 时表情选择器右侧按钮被截断的问题，弹窗与表情网格全面适配 rem 响应式排版。
- **多语言国际化 100% 对齐**：同步更新 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP` 全部 5 种语言的 30 个业务域字典，零硬编码展示文案。

### 🛠 部署与数据 (Deployment & Data)

- **PostgreSQL 架构迁移**：新增 `20261001000000_custom_emoji_and_attachment_dims` 生产数据库迁移，支持 `CustomEmoji` 数据模型与 `Attachment` 的宽高字段存储。Cloudflare Compose 部署时将自动应用该迁移。

## [0.3.0] - 2026-09-30

### 🚀 新增功能 (Features)

- 文字频道新增左侧未读指示条、频道与服务器一键标记已读，并在服务端保存已读进度以支持多端同步。
- 外观设置新增聊天字体大小、消息紧凑模式和界面缩放控制，Web 与桌面端均可使用。
- 网页、登录界面和桌面端统一采用新吉祥物图标，桌面托盘在有未读消息时显示提醒标记。
- 正文中的本站图片附件链接支持内嵌预览和大图查看，附件凭据过期后通过登录与频道权限校验自动续签。
- 增加频道分类折叠、消息操作栏、侧边栏和语音控制按钮的交互动画。
- 桌面安装包支持在构建时配置服务器、Gateway 与媒体服务地址，并提供完整构建文档。

### 🐛 问题修复 (Bug Fixes)

- 调整服务器设置页边距、成员身份组徽章与角色选择浮层的布局，并阻止连续角色操作时发生覆盖。
- 修复频道已读接口的权限校验和乱序请求导致的已读进度倒退；切换账号时清除未读状态并按服务端结果重建。
- 修复桌面端打包时 Web 资源路径错误导致安装包在 `file://` 模式下停留于加载界面的问题。
- 修复浏览器四轨降噪试听在计算资源不足时丢失 DeepFilterNet 试听轨的问题。
- 桌面宿主升级至 Electron 41.10.6，修复上下文隔离、协议访问与沙箱相关的已知安全问题，同时更新存在安全公告的构建依赖。
- 修复纯数字发布标签的增量包下载路径；主进程在下载前和启用前检查最低宿主版本，拒绝不兼容更新并保留已安装版本。
- 补齐 macOS 系统音频、麦克风与摄像头权限说明，以及五种语言的原生权限文案。
- macOS 的 Intel 与 Apple Silicon 安装包分别在对应架构的构建机生成，并核对包内 Electron 与 RNNoise 原生模块的架构。

### 🛠 部署与数据 (Deployment & Data)

- 新增 PostgreSQL `ChannelReadState` 迁移；Cloudflare Compose 部署时须执行 `db:migrate:deploy`，并在迁移完成后启动新版应用。
- 服务镜像内置已验证的 pnpm 缓存，启动和迁移不再依赖运行时下载包管理器。
- 增量更新清单采用 Ed25519 签名，最低宿主版本为 0.3.0；未内置验签公钥或旧版本宿主须先安装新版桌面程序。

## [v0.2.0] - 2026-09-29

### 🚀 新增功能 (Features)

- 支持 WebAuthn 通行密钥注册、免密登录、重命名及解绑；新增账号安全设置入口。
- 新增私信一对一语音与视频通话流程，包括来电、接听、拒接、挂断和通话画面。
- 新增更新公告弹窗，可在版本更新后展示变更内容。
- 增强聊天富文本工具栏、用户提及、图片查看与移动端手势操作。
- 增加频道及服务器右键菜单操作，并记住各服务器的最后访问位置。
- 新增 P2P 讲话检测、可拖动网络统计面板和直播观看者移除操作。

### 🐛 问题修复 (Bug Fixes)

- 修复 P2P 重连打洞卡死、摄像头轨道处理，以及私信视频未挂接 SFrame 加解密的问题。
- 私信的 Cloudflare 媒体会话绑定已接通的通话与当前设备会话，挂断后撤销关联媒体会话。
- 修复公会权限、越权访问、Gateway 事件泄露和桌面进程隔离相关问题。
- 修复图片预览路径、移动端灯箱操作及私信拒接记录不一致的问题。

### 🛠 部署与数据 (Deployment & Data)

- 增加 PostgreSQL `Passkey` 表迁移；生产部署须通过 `db:migrate:deploy` 应用。
- Cloudflare Compose 固定 WebAuthn 的站点 RP ID 与允许来源。

## [v0.1.0] - 2026-09-23

### 🚀 新增功能 (Features)

- 引入类似 Discord 的客户端双轨更新服务（Native 宿主壳 + Web Bundle 增量热更新）。
- 增量更新包体积仅 5~15MB，支持 Win/Mac 平台免重新安装、无感秒级生效。
- 集成 `gh-proxy` 智能阶梯加速代理（默认优先 `https://v6.gh-proxy.org/`，超时平滑回退 `https://gh-proxy.com/` 与直连）。
- 还原 Discord 拟态无边框 Splash 启动窗口，展示启动与增量更新下载解压进度。
- 客户端设置页新增“版本与更新”面板，支持查看生效版本、检测更新及自定义代理节点。
- 新增后台静默检测与就绪横幅通知，更新完成后温和提示用户重启。
- 支持构建期 Git 仓库变量写死与智能检测：未配置仓库信息时自动关闭更新服务。

### 🐛 问题修复 (Bug Fixes)

- 修复 macOS/Windows 平台增量更新解压路径自适应与跨平台路径分隔符兼容性。
- 修复更新下载过程中的 SHA256 完整性哈希校验，防止代理节点异常污染。
- 优化主进程单例锁与热重载生命周期状态机。

### ⚡ 性能与体验优化 (Performance & Improvements)

- 优化启动时 Splash 到主窗口的平滑渐变过渡动效。
- 增量版本自动保留最新 2 个版本，自动清理过期旧版本，节约磁盘空间。
