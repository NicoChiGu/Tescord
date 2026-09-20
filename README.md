# Tescord (类 Discord 本地私有化实时音视频与即时通讯系统)

Tescord 是一个专注于本地私有化部署、高性能、安全加密的类似 Discord 的跨端（Web / 桌面端）协作平台。包含文字频道、实时低延迟语音通信、屏幕分享直播、以及 RNNoise 智能降噪与端到端加密体系。

---

## 🌟 核心特性

- **跨端架构 (Turborepo Monorepo)**：Web (React 18 + Vite + Tailwind CSS) 与桌面端 (Electron) 共享核心状态与 UI 组件。
- **开源 WebRTC 媒体引擎 (LiveKit SFU)**：超低延迟音视频路由、Simulcast 自适应码率屏幕分享（1080p 60fps）。
- **音频引擎与智能降噪**：客户端 AudioWorklet + RNNoise (深度学习 WASM 降噪) 滤除键盘杂音与环境底噪，支持 48kHz 高保真立体声模式与 VAD 语音感应。
- **混合分级加密安全**：全站 TLS 1.3 / DTLS-SRTP 通道加密，敏感频道支持 SFrame (WebRTC Insertable Streams) 端到端加密 (E2EE)。
- **即时通讯信令网关**：基于 Fastify + WebSocket + Redis 的类 Discord Gateway 长连接协议。
- **一键私有化部署**：提供完整 `docker-compose.yml`，一键拉起 Postgres、Redis、MinIO、LiveKit SFU 与 Coturn STUN/TURN。

---

## 📂 项目目录结构

```text
Tescord/
├── apps/
│   ├── web/               # React 18 + Vite 前端客户端 (Discord 风格三栏界面)
│   ├── server/            # Fastify REST API 与 WebSocket Gateway 服务
│   └── desktop/           # Electron 桌面外壳 (支持全局热键与屏幕捕获)
├── packages/
│   └── types/             # 共享 TypeScript 核心协议与实体类型定义
├── docker/
│   ├── docker-compose.yml # 基础设施一键编排 (Postgres, Redis, MinIO, LiveKit, Coturn)
│   ├── livekit.yaml       # LiveKit SFU 核心配置
│   └── turnserver.conf    # Coturn NAT 穿透中继配置
├── package.json           # Monorepo 根配置
├── pnpm-workspace.yaml    # pnpm 工作区定义
├── turbo.json             # Turborepo 流水线编排
└── .env.example           # 环境变量示例
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 编译构建所有模块

```bash
pnpm build
```

### 3. 本地全栈开发调试

可以在根目录下启动所有子应用：

```bash
# 启动所有服务 (后端 API、WebSocket 网关与 Web 前端)
pnpm dev
```

或分别启动：

```bash
# 1. 启动后端 API 与 Gateway (端口 3001)
pnpm --filter @tescord/server dev

# 2. 启动 Web 前端界面 (端口 3000)
pnpm --filter @tescord/web dev

# 3. 启动桌面客户端 (需先启动 Web 服务)
pnpm --filter @tescord/desktop dev
```

启动后访问：[http://localhost:3000](http://localhost:3000)

---

## 🐳 Docker 私有化全套基础设施

部署在自建服务器或内网 NAS 时，一键启动所有后端支撑组件：

```bash
cd docker
docker compose up -d
```

包含组件：

- **PostgreSQL 16**: 业务数据与消息记录持久化 (端口 `5432`)
- **Redis 7**: 实时网关状态与 PubSub (端口 `6379`)
- **MinIO**: S3 兼容多媒体对象存储 (API: `9000`, 控制台: `9001`)
- **LiveKit Server**: WebRTC SFU 媒体中心 (信令: `7880`, TCP: `7881`, UDP: `50000-50100`)
- **Coturn**: 内置 STUN/TURN 网络穿透服务 (端口 `3478`)
