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

---

## 2. 智能体角色分工矩阵 (Agent Roles & Responsibilities)

在项目研发中，智能体应根据任务特征充当或派发以下专职角色：

| 角色标识                | 角色名称             | 核心职责与专业领域                                                                                                                               |
| :---------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`architect`**         | **系统架构师**       | Monorepo 依赖拓扑治理、技术选型方案权衡（A/B对比）、协议规范设计、整体里程碑推进。                                                               |
| **`frontend-electron`** | **前端与桌面端专家** | React 18/19、Tailwind CSS、Discord 像素级体验还原、虚拟长列表性能调优、Electron 主进程原生 IPC、窗口采集与系统托盘。                             |
| **`audio-webrtc`**      | **音视频与算法专家** | LiveKit SFU 媒体服务集成、WebRTC PeerConnection 生命周期管理、AudioWorklet 隔离线程、RNNoise WASM 神经网络降噪管线、声卡混音与 Coturn 网络穿透。 |
| **`backend-devops`**    | **后端与运维专家**   | Fastify REST API、WebSocket 网关长连接状态机、PostgreSQL + Prisma 数据建模、Redis Pub/Sub 广播、MinIO 对象存储与 Docker Compose 生产编排。       |
| **`security-crypto`**   | **安全与密码学专家** | SFrame (WebRTC Insertable Streams) 音频端到端加密、Double Ratchet 文本频道加密、Argon2id/JWT 身份鉴权与安全审计。                                |
| **`qa-verification`**   | **质量与验证专家**   | 编写 Vitest 自动化单元测试、Playwright 跨端并发集成测试、弱网丢包模拟与降噪信噪比客观评估。                                                      |

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

# 代码格式化
pnpm format
```

---

## 5. 质量保证与安全检查清单 (Checklist for Agents)

在交付任何代码或标记任务完成前，必须核对以下清单：

1. **类型安全检查**：运行 `pnpm build`，确保 TypeScript 零错误（Zero TS Errors）。
2. **跨平台与协议兼容**：
   - 前端 Web 页面必须兼容直接在浏览器访问与在 Electron 的 `file://` 离线协议加载（统一通过 `apps/web/src/config.ts` 获取目标服务地址）。
   - 文件路径必须使用平台无关的方式处理（如 `path.join`），杜绝在 Windows/Linux 间出现硬编码反斜杠或斜杠问题。
3. **音频与媒体资源释放**：
   - 音频 AudioContext、MediaStream、WebSocket 连接在组件卸载或离开频道时，必须有明确的 `cleanup` 清理逻辑，防止内存与硬件占用泄露。
