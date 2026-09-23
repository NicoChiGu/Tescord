# Tescord Coturn (STUN/TURN) 独立节点生产部署指南

本指南专为 **Tescord** 音视频通信系统提供独立部署 Coturn 中继节点的完整操作手册。

---

## 1. 架构背景与核心原理

### 1.1 为什么需要独立部署 Coturn？

在 Tescord 的架构设计中：
1. **主业务服务与媒体信令**：包括 Web 前端、Fastify API 网关、PostgreSQL、Redis、MinIO 及 LiveKit SFU。这些服务通常可以部署在私有内网、家庭服务器、甚至通过反向代理（如 Cloudflare Tunnel、Nginx、Frp）向外暴露 HTTP/WebSocket 服务。
2. **WebRTC P2P 音视频通话（DM 1v1 与 Voice Mesh 局域/广域直连）**：底层依赖直接的 UDP 媒体报文交互。当双方处于**对称型 NAT（Symmetric NAT）**、企业防火墙、双层路由器或开启了严格 UDP 策略的网络环境下时，直接打洞（STUN）必然失败，必须借由具备**独立公网 IP** 的 **TURN（Traversal Using Relays around NAT）** 服务器完成报文的中转（Relay）。
3. **HTTP 隧道无法代理 WebRTC UDP 媒体流**：类似 Cloudflare Tunnel 等 HTTP 隧道只代理 TCP 7层流量，无法代理大范围的高并发 WebRTC UDP 端口。因此，Coturn 必须部署在一台拥有**真实公网 IPv4/IPv6** 的独立服务器（VPS）上。

```text
[ 客户端 A (内网 NAT) ] ──(STUN/TURN 握手)──> [ 独立 Coturn 服务器 (公网 IP) ]
          │                                                │
     (P2P 直连失败)                                  (UDP 媒体数据中继)
          │                                                │
          ▼                                                ▼
[ 客户端 B (内网 NAT) ] <───────────────────────────────────┘
```

### 1.2 Tescord 的动态短期凭据机制 (REST API Ephemeral Credentials)

Tescord 服务端（`apps/server`）与 Coturn 之间不采用固定的静态账号密码，而是遵循 WebRTC 工业级标准的 **HMAC-SHA1 动态短期凭据** 方案：
- **生成规则**：
  - 凭据过期时间：当前 Unix 时间戳 + 10 分钟 (`expiresAt = now + 600`)。
  - 动态用户名：`${expiresAt}:${userId}`。
  - 动态密码：`HMAC-SHA1(TURN_SECRET, turnUser).toString('base64')`。
- **校验规则**：
  Coturn 通过预置的 `static-auth-secret` 对客户端发来的用户名和密码进行逆向校验，一旦时间超时或签名不匹配，立即拒绝中继。此举杜绝了 TURN 服务器被第三方扫描恶意盗刷中继流量的风险。

---

## 2. 主机选型与网络准备

### 2.1 推荐硬件与系统配置
- **操作系统**：Ubuntu 22.04 LTS / 24.04 LTS 或 Debian 12（推荐）。
- **规格配置**：
  - 基础中继（10-30 并发语音）：1 核 CPU、1GB 内存。
  - 高并发语音/视频中继（100+ 并发流）：2 核+ CPU、2GB+ 内存，**按流量计费或大带宽（建议 10Mbps - 100Mbps 独享上行）**。
- **公网 IP**：必须具备公网独立 IP 地址（云厂商弹性公网 IP 或独立公网网卡）。

### 2.2 防火墙与云安全组开通清单 (必须放行)

请在云厂商（如阿里云、腾讯云、华为云、AWS、轻量云等）的“安全组”以及宿主机防火墙（ufw / iptables）中开放以下端口：

| 端口号 / 范围 | 协议 | 用途说明 | 必选/可选 |
| :--- | :--- | :--- | :--- |
| **`3478`** | **UDP** | STUN 协议与 TURN UDP 主通信控制端口 | **必选** |
| **`3478`** | **TCP** | TURN TCP 备用端口（穿透阻断 UDP 的网络） | **必选** |
| **`5349`** | **TCP & UDP** | TURNS (TLS/DTLS) 加密中继端口 | 可选（配置证书后） |
| **`49152-49252`** | **UDP** | 动态媒体转发中继端口池（RTP/RTCP Relay） | **必选** |

> [!WARNING]
> **常见失误警告**：许多开发者只开放了 `3478` 端口，却遗漏了中继端口池（`49152-49252/udp`），导致客户端能够连上 STUN 探针并拿到凭据，但一旦发起通话却完全没有声音或视频黑屏！请务必在云控制台放行该 UDP 端口段。

---

## 3. 方案一：Linux (Ubuntu/Debian) 原生 apt + systemd 部署（推荐核心）

在 Linux 原生环境下运行 Coturn 拥有最低的网络开销，没有 Docker 虚拟网卡与 iptables NAT 的二次损耗，是生产高并发环境下的首选部署方式。

### 步骤 1：安装 Coturn

在你的公网独立服务器上执行：

```bash
sudo apt update
sudo apt install -y coturn
```

### 步骤 2：启用 Coturn 守护进程

编辑 `/etc/default/coturn`：

```bash
sudo nano /etc/default/coturn
```

确保文件中存在且未被注释以下行：
```ini
TURNSERVER_ENABLED=1
```

### 步骤 3：系统性能优化（网络中继调优）

WebRTC 媒体转发需要同时开启较多 UDP Socket，避免因默认文件句柄或 UDP 缓冲区过小导致丢包：

1. 编辑系统限制 `/etc/security/limits.d/20-coturn.conf`：
   ```ini
   turnserver soft nofile 65535
   turnserver hard nofile 65535
   ```

2. 调整内核网络缓冲区，编辑 `/etc/sysctl.d/99-coturn.conf`：
   ```ini
   net.core.rmem_max = 16777216
   net.core.wmem_max = 16777216
   net.core.rmem_default = 262144
   net.core.wmem_default = 262144
   ```
   执行 `sudo sysctl --system` 使其生效。

### 步骤 4：编写生产级配置文件 `/etc/turnserver.conf`

在配置之前，先生成一个强随机的 `TURN_SECRET` 密钥（记录好此密钥，后续需填入 Tescord 后端配置）：

```bash
# 生成 32 字节随机 Hex 密钥
openssl rand -hex 32
# 示例输出：a8b9c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c
```

备份原始配置文件并创建新配置：

```bash
sudo mv /etc/turnserver.conf /etc/turnserver.conf.bak
sudo nano /etc/turnserver.conf
```

将以下内容完整写入 `/etc/turnserver.conf`（请根据实际情况替换其中的 `<公网IP>`、`<内网IP>` 与 `<生成的随机密钥>`）：

```ini
# ==========================================
# Tescord 独立 Coturn 生产配置文件
# ==========================================

# 1. 基础监听端口
listening-port=3478
tls-listening-port=5349

# 2. 监听网卡 IP
listening-ip=0.0.0.0

# 3. 外部公网 IP 映射 (至关重要！)
# 场景 A: 云服务器（如阿里云/腾讯云/AWS）拥有私网 IP，公网通过 1:1 NAT 映射绑定
# 语法: external-ip=公网IP/内网私有IP
# 示例: external-ip=203.0.113.10/172.16.0.5
external-ip=<你的公网IP>/<你的内网IP>

# 场景 B: 服务器网卡直接绑定真实公网 IP（无内网 1:1 NAT）
# external-ip=<你的公网IP>

# 4. 鉴权与安全机制 (与 Tescord 严格对齐)
fingerprint
use-auth-secret
static-auth-secret=<你刚才生成的32字节随机密钥>
realm=tescord.local

# 5. 动态媒体中继端口范围 (需在安全组放行)
min-port=49152
max-port=49252

# 6. 安全加固与防内网探测 (防 SSRF 滥用中继探测内部网络)
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255

# 7. 日志配置
verbose
syslog
no-stdout-log
```

> [!IMPORTANT]
> **云厂商 1:1 NAT 架构避坑指南**：
> 大多数国内云厂商（阿里云 ECS、腾讯云 CVM 等）通过 `ip addr` 查看网卡时，看到的仅是 `172.x.x.x` 或 `10.x.x.x` 的私有 IP，而公网 IP 是通过云上网关 1:1 映射进来的。
> 此时 `external-ip` **必须填写为 `公网IP/内网IP` 格式**！如果只填公网 IP，Coturn 在内网套接字绑定时会报错无法监听；如果只填内网 IP，返回给客户端的 ICE candidate 会是不可达的内网地址。

### 步骤 5：启动并加入开机自启

```bash
# 重启 coturn 服务
sudo systemctl restart coturn

# 检查运行状态
sudo systemctl status coturn

# 设置开机自启
sudo systemctl enable coturn
```

查看日志输出确认监听成功：
```bash
sudo journalctl -u coturn -f
```
若日志中输出类似 `IPv4. listener opened on : 0.0.0.0:3478` 且无致命错误，即说明启动成功。

---

## 4. 方案二：配置 TURNS (TLS/DTLS 加密中继，可选进阶)

在部分高安全管控网络（如校园网认证网络、大型金融/外企防火墙）中，所有未知的 UDP 流量及 3478 端口常被深度包检测（DPI）全面拦截。配置 **TURNS (TLS/DTLS 5349 端口)** 并使用正规域名与 TLS 证书，可以有效伪装流量，确保通话 100% 畅通。

### 步骤 1：申请域名并配置 DNS 解析
将你的子域名（如 `turn.yourdomain.com`）的 A 记录解析至该独立 Coturn 服务器的公网 IP。

### 步骤 2：使用 Certbot 申请 Let's Encrypt 证书
```bash
sudo apt install -y certbot
# 临时关闭 80 端口冲突服务，独立申请证书
sudo certbot certonly --standalone -d turn.yourdomain.com
```

### 步骤 3：赋予 Coturn 读取证书权限并更新配置
由于 Coturn 默认以 `turnserver` 低权限用户运行，无法直接读取 `/etc/letsencrypt/live` 目录：
```bash
sudo chgrp -R turnserver /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod -R 750 /etc/letsencrypt/live /etc/letsencrypt/archive
```

在 `/etc/turnserver.conf` 中追加证书路径与更正 realm：
```ini
realm=turn.yourdomain.com
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
```

重启 Coturn：
```bash
sudo systemctl restart coturn
```

---

## 5. 方案三：使用独立 Docker 容器化部署（可选方案）

如果你更倾向于在独立 VPS 上通过 Docker 统一维护服务，本仓库在 [docker/standalone-coturn/](file:///d:/NodeJSProject/Tescord/docker/standalone-coturn/) 目录下为你提供了现成的 Docker Compose 模板。

### 极简操作步骤：

1. 将 `docker/standalone-coturn/` 目录复制到你的独立服务器上：
   ```bash
   scp -r docker/standalone-coturn user@<your-vps-ip>:~/coturn
   cd ~/coturn
   ```
2. 复制并编辑环境变量文件：
   ```bash
   cp .env.example .env
   nano .env
   ```
   填入你的服务器公网 IP 与生成的 `TURN_SECRET`。
3. 一键启动容器（采用 `host` 网络模式以获取与原生一致的网络吞吐）：
   ```bash
   docker compose up -d
   ```

---

## 6. 与 Tescord 主服务联动配置

当你的独立 Coturn 节点就绪后，现在只需将相关参数通知 Tescord 主服务即可完成对接。

### 步骤 1：在 Tescord 主服务配置环境变量

在 Tescord 主服务所在的部署环境，修改根目录下的 `.env`（或传给容器的环境变量）：

```bash
# ------------------------------------------
# Coturn 独立穿透与中继配置
# ------------------------------------------
# 独立 Coturn 节点的公网 IP 或解析域名
TURN_HOST=203.0.113.10
# 默认端口 3478
TURN_PORT=3478
# 必须与 Coturn /etc/turnserver.conf 中的 static-auth-secret 保持完全一致！
TURN_SECRET=a8b9c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c
```

### 步骤 2：启动不带内置 Coturn 的 Tescord 基础编排

由于 Coturn 已经独立运行在外部 VPS 上，Tescord 本地/主服务器无需再在 Docker 内重复启动 Coturn 容器。

请使用仓库提供的无 Coturn 生产编排文件启动主服务：

```bash
docker compose -f docker/docker-compose-without-coturn.yml up -d
```
此时主服务仅会启动 Postgres、Redis、MinIO 及 LiveKit SFU，显著减少主节点的网络与端口负担。

### 步骤 3：验证 API 接口凭据下发

启动后，访问 Tescord 后端提供的接口（需附带有效 Authorization Bearer Token）：
```bash
curl -H "Authorization: Bearer <用户TOKEN>" http://localhost:3001/api/network/ice-servers
```
正确响应应如下所示：
```json
{
  "iceServers": [
    { "urls": "stun:203.0.113.10:3478" },
    {
      "urls": [
        "turn:203.0.113.10:3478?transport=udp",
        "turn:203.0.113.10:3478?transport=tcp"
      ],
      "username": "1774351234:user-id-uuid",
      "credential": "generated-hmac-base64-secret"
    }
  ],
  "turnActive": true
}
```

---

## 7. 联调验证、性能测试与排障手册

### 7.1 使用 Google Trickle ICE 工具进行端到端验证

这是检验 STUN/TURN 中继是否部署成功的**黄金标准**：

1. 打开浏览器访问：[WebRTC Trickle ICE 测试页面](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)。
2. 移除页面上默认的 Google STUN 地址。
3. 点击 **Add Server**，添加你的节点信息：
   - **STUN or TURN URI**：`turn:203.0.113.10:3478?transport=udp`（替换为你的公网 IP/域名）
   - **TURN username**：从第 6.3 步接口取得的动态 username，或在服务器上通过命令行临时计算的一个用户名
   - **TURN password**：对应的动态 credential
4. 点击 **Gather candidates**。
5. **判断标准**：
   - 如果列表中出现了 **`Component: 1, Type: relay`** 的 candidate 记录，**说明 TURN 中继完全打通，中继端口开放正常！**
   - 如果只出现 `srflx`（反射型，STUN 成功）但没有 `relay`，则说明 TURN 鉴权失败或中继端口（49152-49252）被安全组拦截。

```text
示例成功结果表格：
Time  | Component | Type  | Foundation | Protocol | Address       | Port  | Priority
0.012 | 1         | host  | ...        | udp      | 192.168.1.100 | 54321 | ...
0.089 | 1         | srflx | ...        | udp      | 203.0.113.10  | 54321 | ...
0.145 | 1         | relay | ...        | udp      | 203.0.113.10  | 49188 | ...  <-- 必须见到 relay！
```

### 7.2 常见故障排查表 (FAQ)

| 症状 / 报错现象 | 可能的根本原因 | 解决方案与排查步骤 |
| :--- | :--- | :--- |
| **Trickle ICE 收集报错 `401 Unauthorized`** | 1. `TURN_SECRET` 与 Tescord 后端不匹配<br>2. 系统时钟严重偏离导致动态凭据超时失效 | 1. 检查 `/etc/turnserver.conf` 中的 `static-auth-secret` 与后端 `.env` 中的 `TURN_SECRET` 是否存在多余空格或字符不一致。<br>2. 服务器执行 `timedatectl`，确保启用了 NTP 时间同步。 |
| **STUN 正常 (`srflx`)，但始终无法 Gather 到 `relay`** | 1. 云厂商安全组未放行 `49152-49252/udp`<br>2. `external-ip` 未配置或配置错误 | 1. 登录云服务器控制台，检查安全组 UDP 规则。<br>2. 检查 `external-ip` 是否按 `公网IP/内网IP` 格式填写。 |
| **日志提示 `Cannot bind to 0.0.0.0:3478`** | 3478 端口被其他进程占用 | 执行 `sudo lsof -i :3478` 或 `sudo netstat -tlpn \| grep 3478` 查看占用进程并停止。 |
| **通话 10-30 秒后自动静音或断流** | NAT 状态超时被云网关丢弃连接 | Coturn 会自动发送 STUN keep-alive，确保中途没有代理防火墙重置 UDP 会话。 |
