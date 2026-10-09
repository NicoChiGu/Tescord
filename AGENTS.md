# 🤖 Tescord 多智能体协作与工程准则 (AGENTS.md)

本文档是 **Tescord（类 Discord 本地私有化实时音视频与即时通讯系统）** 代码库中所有 AI 智能体（Agents / Subagents）协同研发的**唯一权威指导规范（Single Source of Truth）**。任何参与本项目的智能体必须严格遵循本规范。

---

## 1. 核心工程哲学与架构原则 (Engineering Philosophy)

1. **协议先行 (Contract-First)**：
   - 所有跨端（Web/Desktop）或前后端交互的改动，**必须首先**在 `packages/types` 中定义并导出强类型接口与事件。
   - 坚决杜绝在业务代码中出现未定义的 `any` 或未经校验的裸 JSON。
2. **纯粹的私有化与离线自治 (Self-Hosted & Offline-First)**：
   - 核心系统严禁隐式依赖任何境外/闭源商业 SaaS（如云端 AI 降噪、第三方云存储）。
   - 音频降噪（RNNoise）、媒体流控（LiveKit）、对象存储（MinIO）、网络穿透（Coturn）必须 100% 支持在局域网或自主 VPS 内自闭环运行。
3. **极简主上下文与按需代理 (Context Hygiene)**：
   - 遵守长思维链与高思考等级（High Thinking）推演。
   - 避免在主对话上下文中做大规模的冗余文件吞吐，善用专职子代理完成查阅与方案验证。
4. **全域国际化与无硬编码文案 (Full-Stack i18n & Zero Hardcoded Copy)**：
   - 系统全面支持 5 种官方语言区域：**简体中文 (`zh-CN`)、繁体中文（台湾）(`zh-TW`)、繁体中文（香港）(`zh-HK`)、英语 (`en-US`)、日本語 (`ja-JP`)**。
   - 坚决杜绝在前端组件（JSX/TSX）或后端返回中出现任何未经 i18n 抽离的硬编码展示文本与中文错误字符串。
5. **极简静默与零冗余提示 (Minimalism & Zero Redundant Prompts)**：
   - 严禁在代码中编写介绍功能用途、说明实现原理或描述实际效果的注释；仅保留关键算法逻辑与边界防御说明。
   - 未经用户明确要求，严禁在 UI 界面或交互流程中主动添加功能说明、底层算法、加密方式（如算法名称/模式）或运行状态（如加密中/未加密）等文字提示或状态徽标。
   - 严禁在回复或交付报告中堆砌功能介绍、原理解读或效果描述，仅呈现客观操作与验证结果。

---

## 2. 智能体角色分工矩阵 (Agent Roles & Responsibilities)

在项目研发中，智能体应根据任务特征充当或派发以下专职角色：

| 角色标识                | 角色名称             | 核心职责与专业领域                                                                                                                               |
| :---------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`architect`**         | **系统架构师**       | Monorepo 依赖拓扑治理、技术选型方案权衡（A/B对比）、协议规范设计、整体里程碑推进。                                                               |
| **`frontend-electron`** | **前端与桌面端专家** | React 18/19、Tailwind CSS、Discord 像素级体验还原、虚拟长列表性能调优、Electron 主进程原生 IPC、窗口采集与系统托盘。                             |
| **`audio-webrtc`**      | **音视频与算法专家** | LiveKit SFU 媒体服务集成、WebRTC PeerConnection 生命周期管理、AudioWorklet 隔离线程、RNNoise WASM 神经网络降噪管线、声卡混音与 Coturn 网络穿透。 |
| **`backend-devops`**    | **后端与运维专家**   | Fastify REST API、WebSocket 网关长连接状态机、开发 SQLite／生产 PostgreSQL + Prisma 双模型校验、Redis、MinIO 与 Docker Compose 生产编排。        |
| **`security-crypto`**   | **安全与密码学专家** | SFrame (WebRTC Insertable Streams) 音频端到端加密、Double Ratchet 文本频道加密、Argon2id/JWT 身份鉴权与安全审计。                                |
| **`qa-verification`**   | **质量与验证专家**   | 编写 Vitest 自动化单元测试、Playwright 跨端并发集成测试、端到端自动化验收、弱网丢包模拟与降噪信噪比客观评估。                                    |

---

## 3. 子代理（Subagents）编排与派发规范 (Orchestration Policy)

当当前主 Agent 运行于 **Gemini 系列模型** 时，必须严格执行以下规则：

### 3.1 派发参数规范

- **模型限定**：必须指定 `Model: 'flash'`（对应最新的 Gemini Flash 系列），并在 Prompt 中明确要求**最高思考等级（High Thinking Level）**，发挥极速并发与深度推演优势。
- **TypeName 选型**：
  - 代码检索、长文档调研、外部资料查阅：强制使用 `research`（只读轻量沙箱，保持主上下文干净）。
  - 需要执行代码编写、安装依赖或运行测试的独立任务：使用 `self` 或通过 `define_subagent` 声明的专家角色。
- **工作区隔离策略**：
  - 无代码改动、纯调研：`Workspace: 'inherit'`。
  - 破坏性重构、复杂算法实验（如 C++ 原生模块编译、SFrame 流式测试）：强制使用 `Workspace: 'branch'` 隔离分支。

### 3.2 协作与信息沉淀

- **禁止循环轮询**：派发子代理后，依靠系统的 **Reactive Wakeup** 自动唤醒，无需用轮询检查状态。
- **高阶汇报**：汇总子代理成果时，向用户提供经过提炼、整合后的决策与结论，杜绝简单堆砌子代理中间日志。

---

## 4. 代码库规范与开发操作指南 (Code Standards)

### 4.1 目录结构职责

```text
tescord/
├── apps/
│   ├── web/        # React 18 SPA (渲染进程，严禁直接调用 node 内置模块)
│   ├── desktop/    # Electron 主进程与预加载脚本 (通过 contextBridge 暴露原生 API)
│   └── server/     # Fastify 后端与 WebSocket Gateway
├── packages/
│   └── types/      # 全系统唯一强类型源泉 (所有模块必须依赖此包)
└── docker/         # 生产与私有化一键编排
```

### 4.2 依赖管理准则

- 必须使用 **`pnpm`** 进行依赖管理，禁止使用 npm/yarn。
- 跨 Workspace 包引用必须采用 `workspace:*` 声明（如 `"@tescord/types": "workspace:*"`）。
- 在 `.npmrc` 中维护国内镜像与 Electron 加速设置，避免 CI/CD 或新环境安装因网络超时中断。

### 4.3 常用开发指令速查

```bash
# 全仓库构建
pnpm build

# 启动后端服务 (端口 3001)
pnpm dev:server

# 启动 Web 前端服务 (端口 3000)
pnpm dev:web

# 启动 Electron 桌面客户端
pnpm dev:desktop

# 运行 Playwright 端到端自动化验收测试
pnpm test:e2e

# 代码格式化
pnpm format
```

### 4.4 国际化与本地化工程规范 (i18n & Localization Standards)

为保障全球化与多区域用户的原生体验，所有智能体在开发任何功能、界面或协议时，必须严格执行以下 i18n 规范：

1. **官方支持语言矩阵（Strict 5 Locales）**：
   - `zh-CN`：简体中文（系统核心默认与兜底回退语言）
   - `zh-TW`：繁體中文（台灣，正体中文习惯、本地术语）
   - `zh-HK`：繁體中文（香港，港式用语习惯）
   - `en-US`：English (United States)
   - `ja-JP`：日本語（日语音系、敬语与本地化表达）
   - 强类型定义统一受控于 `@tescord/types` 的 `SupportedLocale` 联合类型与 `SUPPORTED_LOCALES` 元数据数组。

2. **多语言资源包组织与命名空间划分 (`apps/web/src/i18n/locales/`)**：
   - 每种语言必须在对应目录完整包含 10 个标准业务域 JSON 字典，严禁随意新增根目录孤立文件：
     - `common.json`：全局通用操作（确认、取消、保存、搜索、重试、加载等）
     - `auth.json`：登录、注册、找回密码、双因子验证、快速登入
     - `settings.json`：用户设置面板、语言选择、音频视频设备与偏好文案
     - `chat.json`：聊天输入、消息操作、频道通知、历史消息横幅与系统提示
     - `voice.json`：语音频道控制面板、网络连线状态、静音/开麦、屏幕共享
     - `server.json`：公会设置、频道管理、身份组权限、成员列表与管理
     - `contextMenu.json`：消息/用户/频道/服务器全局右键上下文菜单
     - `modals.json`：各类交互模态确认弹窗、加入公会、创建频道
     - `admin.json`：平台治理、审计日志与超级管理后台
     - `errors.json`：全系统标准错误码提示字典映射
   - **键名对称性红线**：修改或新增任何多语言键值时，**必须同时且完整地更新全部 5 种语言的对应 JSON 文件**。键路径必须 100% 对齐，杜绝漏键；严禁在某个语言中留下空键或拼写不一致。

3. **前端代码研发与组件呈现准则**：
   - **严禁裸写文案**：禁止在 JSX/TSX 中硬编码任何人类可读的展示文本（包括按钮文字、标题、描述、placeholder、title、aria-label 及 tooltip 等）。
   - **规范化调用**：React 组件中必须使用 `const { t } = useTranslation('namespace')`；非 React 上下文（如工具类、全局通知）必须使用 `tGlobal('namespace:key')`。
   - **样式与排版适应**：UI 必须支持不同语言长度的自适应（如英语通常较中文更长，日语需要适配换行），容器必须合理使用 `truncate`、`text-ellipsis`、弹性布局（Flex/Grid）或动态最小宽度，严禁因多语言文本长度不一导致布局破碎或内容截断不可见。

4. **桌面端（Electron）原生环境适配**：
   - Electron 主进程的原生托盘（Tray Tooltip/ContextMenu）、应用主菜单（App Menu）、编辑器右键菜单（撤销/复制/粘贴/检查元素）及启动屏（Splash Screen）必须统一通过 `apps/desktop/src/locales.ts` 中的 `desktopLocales` 管理。
   - 必须通过 IPC 监听前端同步指令（`syncLocale`），实现用户在前端切换语言时，桌面原生组件无缝、零重启即时热更新，并持久化到本地用户配置。

5. **服务端错误码与协议响应契约**：
   - 服务端（Fastify REST / WebSocket Gateway）**严禁向客户端直接返回硬编码的人类语言错误字符串**（如 `reply.send({ error: "密码错误" })`）。
   - 服务端必须使用 `packages/types` 中导出的标准 `ErrorCode` 枚举，并调用 `sendApiError(reply, status, ErrorCode.XXX, fallbackMsg)` 返回标准结构 `{ code: ErrorCode, error: string }`。
   - 客户端（Web/Desktop）统一通过 `getErrorMessage(err)` 与 `errors.json` 字典完成当前语言的动态映射呈现，确保错误提示与当前界面语言绝对一致。

---

## 5. 质量保证与安全检查清单 (Checklist for Agents)

在交付任何代码或标记任务完成前，必须核对以下清单：

1. **类型安全检查**：运行 `pnpm build`，确保 TypeScript 零错误（Zero TS Errors）。
2. **跨平台与协议兼容**：
   - 前端 Web 页面必须兼容直接在浏览器访问与在 Electron 的 `file://` 离线协议加载（统一通过 `apps/web/src/config.ts` 获取目标服务地址）。
   - 文件路径必须使用平台无关的方式处理（如 `path.join`），杜绝在 Windows/Linux 间出现硬编码反斜杠或斜杠问题。
3. **音频与媒体资源释放**：
   - 音频 AudioContext、MediaStream、WebSocket 连接在组件卸载或离开频道时，必须有明确的 `cleanup` 清理逻辑，防止内存与硬件占用泄露。
4. **UI 与核心交互端到端验收 (Playwright E2E Mandatory)**：
   - 凡涉及 Web/Desktop 前端界面展示、用户交互行为、音视频面板、右键菜单或端到端核心链路的改动，**在最终交付前必须运行并通过 Playwright 自动化验收测试**（`pnpm test:e2e` 或专项 Playwright 脚本）。
   - **验收指标与凭证**：测试用例必须 100% 通过（PASS），控制台无未捕获的严重错误（Console Error）。Agent 在任务完成汇报中，**必须附带 Playwright 测试通过的执行日志或测试凭据**。
   - **用例补充红线**：若开发了新交互功能或重构了核心交互流程，必须同步在 `e2e/` 补充配套的 Playwright 测试用例，严禁未经浏览器真实渲染验证即交付。
5. **国际化与多语言完整性验收 (i18n Completeness & UI Integrity)**：
   - 任何涉及用户界面文案或错误提示的修改，必须检查并确保 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP` 全部 5 套语言字典同步更新，键名保持 100% 对称，严禁遗漏任何目标语言翻译。
   - 代码库自查中严禁遗留未抽离的硬编码中英文字符串。
   - 切换 5 种语言测试验证时，界面布局严禁出现文字溢出（Text Overflow）、按钮换行破损或样式崩坏。
   - 凡涉及新界面或核心流程改动，必须确保或扩展现有的多语言自动化验收测试（`e2e/i18n-language-switch.spec.ts`），确保 5 种语言即时热切换与本地持久化测试通过（PASS）。
6. **零冗余与静默契约验收 (Zero Redundancy & Silent Contract)**：
   - 检查并确保代码中无阐述功能作用或实际效果的冗余注释。
   - 检查并确保界面中无未经明确要求的底层实现提示（如加密方式、状态指示器、说明横幅等）。

### 5.1 安全边界与负向测试（所有 AI 必须遵守）

1. 修改 HTTP、Gateway、管理员、DM、附件、媒体或更新链路前，记录入口、身份来源、资源归属、授权条件与拒绝行为。跨端协议先更新 `packages/types`，服务端必须验证客户端提供的 ID 和数据。
2. 每项授权逻辑至少测试：无令牌、伪造／过期令牌、越权用户、封禁用户、撤销会话。Gateway 还须测试未完成 IDENTIFY 的连接、跨公会和跨频道事件；私信只能发送给参与者。
3. 文件和更新改动必须测试直接静态访问、签名篡改与过期、路径穿越、恶意归档、体积／类型不匹配、哈希或签名失败。公开资源与私有附件必须有独立的授权边界；更新校验失败时保留已安装版本。
4. 媒体改动必须验证 E2EE 密钥或能力不足时拒绝未加密连接，以及实际收发的 ICE candidate、RTP 字节和编解码统计。本机 loopback 不能证明 TURN、SFU 或公网媒体可用；缺少目标环境时明确标记“待环境验收”。
5. 数据库测试只能使用隔离库。不得对现有业务 SQLite 或生产 PostgreSQL 执行 `db:push`、重置、破坏性测试；生产变更使用经审查的 PostgreSQL 迁移，并完成备份与恢复验收。
6. 交付时列出执行命令、通过／失败数、关键日志、未执行原因及剩余风险。任何失败或缺失的必需门禁都不得报告为“生产可发布”，不得以跳过测试、降低断言或 `continue-on-error` 掩盖失败。
