# Tescord 单机生产部署与验收

`docker-compose-without-coturn.yml` 是 rootless Podman + Cloudflare Tunnel 的部署入口，示例配置在 `.env.without-coturn.example`。它将 Web 源站仅绑定到 `127.0.0.1:18080`，由同网络的 `cloudflared` 转发至 `http://web:80`。Cloudflare 控制台需将公开主机名指向该 Tunnel 的 `http://web:80`；Tunnel 不承载 LiveKit 的 UDP/TCP 媒体端口。

所有 Compose 持久化数据位于 Compose 文件目录下的 `./datas/`（PostgreSQL、Redis、MinIO，以及独立 Coturn 的日志）。首次启动前创建目录并确认 rootless Podman 的容器用户可写；不要把现有命名卷当作空目录直接替换。备份时数据库与对象存储必须成对保存，在另一套隔离实例恢复后验证数量和附件哈希。外部 Coturn 未配置时 `TURN_HOST` 与 `TURN_SECRET` 都留空，ICE API 不下发 TURN；配置外部服务时同时填写有效地址和相同的长随机密钥。

首次生产部署使用新的 PostgreSQL 空库。开发 SQLite 数据不会被导入。当前仓库保留 `docker/livekit.yaml` 等开发配置；生产只使用本目录的 `docker-compose.yml` 与生产环境变量。

## 准备

在有 Docker Compose 的目标主机上，将 `docker/.env.production.example` 复制为 `docker/.env.production`。为 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`MINIO_SECRET_KEY`、`JWT_SECRET`、`UPLOAD_SIGNING_SECRET`、`TURN_SECRET` 和 `LIVEKIT_API_SECRET` 分别生成不同的至少 32 字节随机值。PostgreSQL 密码要同步写入 URL 编码后的 `DATABASE_URL`。`LIVEKIT_API_KEY` 使用字母数字及下划线。填入实际 `SITE_HOST`、`TURN_HOST` 和 `PUBLIC_IP`，不得使用 localhost。将该站点的证书与私钥放到 `docker/certs/fullchain.pem`、`docker/certs/privkey.pem`，并限制私钥文件权限。

PowerShell 可生成十六进制随机密钥：

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

检查配置并启动：

```powershell
docker compose -f docker/docker-compose.yml --env-file docker/.env.production config -q
docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
docker compose -f docker/docker-compose.yml --env-file docker/.env.production ps
```

PostgreSQL、Redis、MinIO 仅在 Compose 内网可达。客户端通过 443 使用 Web、API、Gateway 与 LiveKit 信令；需要开放 Coturn 3478/TCP+UDP、49152-49252/UDP，以及 LiveKit 7881/TCP、50000-50100/UDP。上游反向代理和防火墙不得把 MinIO、Redis 或 PostgreSQL 直接暴露到公网。LiveKit webhook 使用 `http://server:3001/api/livekit/webhook` 内部地址，API key 与服务端配置相同。

## 发布与恢复

发布前在独立环境运行 `pnpm build`、`pnpm test:security-media`、`pnpm test:updater`、`pnpm test:e2e`，验证 PostgreSQL `migrate deploy` 及一组用户、服务器、频道和消息的读写。发布工作流使用 Ed25519 私钥签署 `manifest.json`，桌面客户端只信任构建时嵌入的公钥。用 `node scripts/generate-update-signing-key.mjs` 首次生成密钥对；将公钥内容存入 GitHub 变量 `UPDATE_SIGNING_PUBLIC_KEY_BASE64`，私钥内容存入 GitHub Secret `UPDATE_SIGNING_PRIVATE_KEY_BASE64`，并把私钥离线备份。不得把私钥提交到仓库。配置 GitHub `production-release` 环境的必需审批人，并把 CI 验证设置为受保护分支的必需检查。

数据库和对象存储必须作为一组备份，并在隔离环境演练恢复。推荐先停写或进入维护模式，使用 `pg_dump -Fc` 导出 PostgreSQL，再用 MinIO Client 对 `tescord-assets` bucket 做完整镜像。记录备份时间、数据库迁移版本与对象数量；在新的 PostgreSQL/MinIO 实例恢复后，验证用户、频道、消息和附件数量及随机抽取的附件哈希。不得在原生产库上执行恢复演练或 `db:push`。

## 生产验收

在真实目标网络分别验证 P2P 直连、Coturn relay 和 LiveKit SFU。每条路径都记录 selected candidate pair、实际发/收 RTP 字节、协商 codec 与断线后切换结果。测试 E2EE 密钥缺失、伪造 Gateway token、跨频道 P2P 信令、私有附件 `/uploads/` 直访、过期签名、恶意更新清单及 ZIP。仅有 Compose 配置、服务启动或本机 loopback 不构成公网媒体验收证据。
