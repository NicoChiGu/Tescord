# Coturn 独立节点 Docker 一键部署模板

本目录提供 Tescord 音视频穿透中继节点（Coturn）的独立容器化部署模板。适用于将 Coturn 独立部署在具备公网 IP 的独立 VPS 节点上。

完整原生部署与详细排障手册请查阅根目录文档：[docs/deploy-coturn.md](../../docs/deploy-coturn.md)。

---

## 快速上手步骤

### 1. 复制目录至公网 VPS

在本地或 CI/CD 中，将本目录上传至目标公网云服务器：
```bash
scp -r docker/standalone-coturn user@<your-vps-ip>:~/coturn
cd ~/coturn
```

### 2. 准备环境变量与配置文件

```bash
cp .env.example .env
```
编辑 `.env`：
- 修改 `TURN_SECRET` 为一个高强度的随机密钥（例如执行 `openssl rand -hex 32` 生成）。
- 确保该密钥与 Tescord 主服务 `.env` 中的 `TURN_SECRET` 保持完全一致。

编辑 `turnserver.conf`：
- 找到 `external-ip` 配置项，按服务器网络类型配置公网 IP（若为云厂商 1:1 NAT VPC，请使用 `公网IP/内网IP` 格式）。

### 3. 放行云安全组端口

在云控制台安全组入方向放行：
- `3478/udp` 与 `3478/tcp`
- `49152-49252/udp`（动态媒体中继端口段）

### 4. 启动服务

```bash
docker compose up -d
```

查看运行日志：
```bash
docker compose logs -f
```

---

## 与 Tescord 主服务对接

在 Tescord 主服务所在的服务器修改 `.env`：
```bash
TURN_HOST=<本独立节点的公网IP或域名>
TURN_PORT=3478
TURN_SECRET=<上述配置的相同密钥>
```

主服务使用无内置 Coturn 的编排文件启动：
```bash
docker compose -f docker/docker-compose-without-coturn.yml up -d
```
