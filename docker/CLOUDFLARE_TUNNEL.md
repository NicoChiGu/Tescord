# 🌐 Tescord Cloudflare Zero Trust (Access) 穿透实践指南

本文档介绍如何在 Docker 中通过 **Cloudflare Zero Trust (Access) Connectors (`cloudflared`)** 将 Tescord 服务的各个组件安全、低延迟地穿透至公网，支持多子域名独立路由架构。

---

## 1. 架构拓扑与穿透原理

```text
[ 外网客户端 / 移动端 / Web 浏览器 ]
               │
               │ HTTPS (443) / WSS
               ▼
   [ Cloudflare 全球边缘网络 (CDN + WAF) ]
               │
               │ 双向持久安全隧道 (QUIC / HTTP2)
               ▼
 [ tescord-cloudflared 容器 (docker-compose-tunnel.yml) ]
         │
         ├── 宿主机通信 (host.docker.internal)
         │     ├── :3000  ──► Web 前端 (React 18 SPA)
         │     └── :3001  ──► 后端 API & Gateway (Fastify / WebSocket)
         │
         └── Docker 内部桥接网络
               ├── minio:9000    ──► MinIO 对象存储 (文件/附件直传与预览)
               └── livekit:7880  ──► LiveKit SFU 媒体信令服务
```

---

## 2. 核心架构说明：WebRTC UDP 媒体流与穿透最佳实践

> [!IMPORTANT]
> **关于 WebRTC UDP 媒体流穿透的重要说明**：
>
> - **Cloudflare Tunnel 原生支持并完美代理**：HTTP、HTTPS、WebSocket (WSS) 全双工长连接。
>   - 文字聊天、频道消息、私信实时推送、MinIO 大文件直传、头像更新、以及 LiveKit 房间**信令握手（`/rtc`）**均可通过隧道畅通运行。
> - **WebRTC 语音/视频媒体流（UDP 端口 50000-50100 及 Coturn 3478/UDP）**：
>   - Cloudflare 免费标准 HTTP/TCP 隧道**不代理公网裸 UDP 媒体包**。
>   - **推荐落地路径**：
>     1. **混合中继方案（推荐）**：信令走 Cloudflare Tunnel 穿透，媒体流配置独立的公网 Coturn 服务器（可参考项目内置的 [standalone-coturn](file:///d:/NodeJSProject/Tescord/docker/standalone-coturn) 部署于具有独立公网 IP 的云服务器），或在局域网内直接直连。
>     2. **Zero Trust WARP 方案**：客户端通过安装 Cloudflare WARP 客户端，开启 Zero Trust Private Network 路由，可实现端到端 UDP 与全端口打通。
>     3. **TCP 降级**：LiveKit 支持 WebRTC over TCP（端口 7881），但延迟相较 UDP 略高。

---

## 3. 准备工作与 Cloudflare Zero Trust 控制台配置

### 步骤 1：创建 Tunnel 并获取 Token

1. 登录 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com/)。
2. 在左侧菜单导航至 **Networks** ➔ **Tunnels**。
3. 点击 **Add a tunnel**（或 **Create a tunnel**）。
4. 选择 **Cloudflare Tunnel**，输入隧道名称（例如 `tescord-tunnel`），点击 **Save tunnel**。
5. 在环境选择页面选择 **Docker**。
6. 在生成的运行命令中，复制 `--token` 后面的长字符串（例如 `eyJh...`）。
7. 在本地项目根目录或 `docker/` 目录下复制配置：
   ```bash
   cp docker/.env.tunnel.example docker/.env.tunnel
   ```
   并将复制的 Token 填入 `docker/.env.tunnel`：
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...你的真实Token...
   ```

---

### 步骤 2：在控制台配置多子域名路由 (Public Hostnames)

在刚才创建的 Tunnel 详情页面中，切换至 **Public Hostname** 标签页，依次点击 **Add a public hostname**，为 Tescord 的各项独立服务配置映射规则：

| 序号  | 建议域名示例             |     Service Type      | URL (目标地址)              | 附加配置 (Additional application settings ➔ TLS)                                 | 说明                                   |
| :---: | :----------------------- | :-------------------: | :-------------------------- | :------------------------------------------------------------------------------- | :------------------------------------- |
| **1** | `tescord.yourdomain.com` | **HTTPS** 或 **HTTP** | `host.docker.internal:3000` | 若 Web 本地开发使用 basicSsl 插件 (https)，**必须开启 `No TLS Verify: Enabled`** | **Web 前端页面**                       |
| **2** | `api.yourdomain.com`     |       **HTTP**        | `host.docker.internal:3001` | 默认即可，自动透传 `/api` 与 `/gateway` WebSocket                                | **Fastify REST API 与 WebSocket 网关** |
| **3** | `s3.yourdomain.com`      |       **HTTP**        | `minio:9000`                | 默认即可（利用 Docker 内部网络名直接互联）                                       | **MinIO 对象存储**                     |
| **4** | `rtc.yourdomain.com`     |       **HTTP**        | `livekit:7880`              | 默认即可（利用 Docker 内部网络名直接互联）                                       | **LiveKit WebRTC 房间信令**            |

> [!TIP]
> **关于 `host.docker.internal`**：
> `docker-compose-tunnel.yml` 中已经通过 `extra_hosts` 注入了 `host.docker.internal:host-gateway`，确保无论是 Windows、macOS 还是 Linux 宿主机，容器内均能稳定通过此域名访问宿主机上运行的 Web 和 Server 进程。

---

## 4. 客户端与服务端环境变量配套

采用多子域名独立穿透后，需同步配置前端与服务端的环境变量，使其感知公网域名：

### 前端配置 (`apps/web/.env.production` 或开发环境变量)

```env
# 生产或穿透模式下的 API 与网关地址
VITE_API_URL=https://api.yourdomain.com
VITE_GATEWAY_URL=wss://api.yourdomain.com/gateway
VITE_LIVEKIT_URL=wss://rtc.yourdomain.com
```

### 服务端配置 (`apps/server/.env`)

```env
# 服务端用于签发附件外链和预签名 URL 的基础地址
SERVER_BASE_URL=https://api.yourdomain.com
MINIO_ENDPOINT=s3.yourdomain.com
MINIO_PORT=443
MINIO_USE_SSL=true
```

---

## 5. 快速启动与运维命令

在项目根目录下，支持以下快捷指令：

### 联合启动 (基础服务 + Cloudflare 隧道)

```bash
# 启动数据库、缓存、MinIO、LiveKit 以及 cloudflared 隧道
pnpm tunnel:up

# 或原生 Docker Compose 指令:
docker compose -f docker/docker-compose.yml -f docker/docker-compose-tunnel.yml --env-file docker/.env.tunnel up -d
```

### 查看隧道状态与连接日志

```bash
pnpm tunnel:logs

# 或原生指令:
docker compose -f docker/docker-compose-tunnel.yml logs -f cloudflared
```

_当看到 `Registered tunnel connection` 字样时，说明已成功接入 Cloudflare 全球边缘节点。_

### 仅启动隧道容器 (若基础服务已在运行)

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose-tunnel.yml --env-file docker/.env.tunnel up -d cloudflared
```

### 停止隧道与关联服务

```bash
pnpm tunnel:down

# 或原生指令:
docker compose -f docker/docker-compose.yml -f docker/docker-compose-tunnel.yml down
```

---

## 6. 常见故障排查 (Troubleshooting)

1. **浏览器访问前端报 502 Bad Gateway**：
   - 检查前端 Vite 是否已启动（`pnpm dev:web`），确认本地能访问 `localhost:3000`。
   - 检查 Cloudflare Dashboard 的 Public Hostname 设置：
     - 若 Vite 启动了 HTTPS（basicSsl），Service Type 需选 **HTTPS**，URL 填 `host.docker.internal:3000`，并在 **Additional Application Settings ➔ TLS** 中开启 **No TLS Verify**。
2. **WebSocket `/gateway` 连接失败**：
   - Cloudflare 控制台对应域名的 HTTP 设置中确认启用了 WebSockets（Cloudflare 默认自动开启）。
   - 确认前端 `VITE_GATEWAY_URL` 使用的是 `wss://` 协议而非明文 `ws://`。
3. **MinIO 图片直传报 Mixed Content 或 SSL 错误**：
   - 当浏览器通过 HTTPS 外网访问时，所有图片直传与资源获取必须走 `https://`。
   - 确认 `s3.yourdomain.com` 已经配置，并且在 MinIO 客户端初始配置中配置了 `useSSL: true`。
