# Tescord 生产前验收记录（2026-09-26）

结论：**未达到完整生产发布门禁**。本地 Web 测试、Windows Electron 的已覆盖用例、目标机 PostgreSQL/MinIO 核心读写及隔离恢复通过；Cloudflare Tunnel 公网核心业务复验也已通过。真实媒体路径、桌面签名及若干 Windows 全场景门禁仍未通过。所有目标机数据均位于 `/home/tera/apps/tescord/docker/datas/`；部署使用 `tera` 的 rootless Podman，未改动原有 `sing-box` 容器。

## 版本与工程验证

- 分支：`codex/tescord-preprod-session-acceptance`。目标机通过经校验的 Git bundle 检出分支提交；目标机对 GitHub origin 的 `git ls-remote` 返回 403，因此没有声称其直接拉取成功。最终提交以本报告所在版本的 `git rev-parse HEAD` 为准。
- `pnpm build`：4/4 workspace 任务通过。
- `pnpm test:minio-compat`：ESM、CommonJS 两条 MinIO 8.0.7 通知解析路径通过。
- `pnpm test:security-media`：解密协商、重放和篡改拒绝、发送端 fail-closed 通过。
- `pnpm test:updater`：13/13 更新服务用例，加上恶意归档与版本校验通过。
- `pnpm test:e2e`：143/143 通过，0 失败。报告：`playwright-report/index.html`；执行日志：本机 `%TEMP%/tescord-full-pass-e2e.log`。关键截图在 `test-results/`，包括附件上传、图像加载状态及 E2EE UI。
- 真实 Windows Electron：开发态 `file://` 登录/窗口用例 1/1；Windows NSIS 安装到隔离目录后的打包 UI 与 IPC 边界用例 1/1。公网域名修复后，打包应用还通过真实线上登录与重启后快捷登录。安装包 `apps/desktop/release/Tescord Setup 0.1.0.exe` 的 SHA-256 为 `1A1637CDD32E7F587D4F92865096BB2FDB9EE8D8AD28F1F367459262E62A29F1`。安装包和解包 EXE 的 Authenticode 状态是 `NotSigned`，不可作为已签名正式版交付。

## 目标机、迁移与数据

- 主机：`tera@100.69.12.101`；仓库：`/home/tera/apps/tescord`；组合：`docker/docker-compose-without-coturn.yml`。`tescord.service` 为已启用的用户级 systemd 服务，`Linger=yes`；连续启动、整组重启以及 API 单容器重启后，PostgreSQL、Redis、MinIO、API、Web、LiveKit、Cloudflared 运行，API 和 Web 健康。主机重启未执行，因为会影响同机其他服务。
- 生产 PostgreSQL 共 3 个迁移。新增邀请注册迁移先在隔离数据库运行；Prisma schema diff 为 `No difference detected` 后，先备份目标库再迁移。目标库迁移后 diff 同样为空。未对现有业务库执行 `db:push`。
- `scripts/target-smoke.py` 在目标机源站验证：注册、匿名拒绝、创建公会和文字频道、MinIO 附件授权和上传、带附件消息、私有附件未签名/篡改拒绝、刷新令牌轮换及旧令牌拒绝。整组和 API 单独重启后复验登录、公会、消息、附件读取与 SHA-256；无 Coturn 时 `turnActive=false`、`iceServers=[]`。
- 一组配套备份保存在目标机 `docker/datas/backups/acceptance-20260926.pgcustom`（50,938 字节，SHA-256 `0a683638410a1c03d001e9d51bdbe3ba9cfddc3aa764c292977b94feaccb9f2b`）和 `acceptance-20260926-minio.tar.gz`（7,141 字节，SHA-256 `c33a83d51ec7a2d432d8ac99f72c7470ca7edde3ced1b2240a7f084f6ff4fbf8`）；两者权限均为 0600。隔离 PostgreSQL/MinIO 容器恢复后，`scripts/target-restore-check.py` 核对用户、公会、频道、消息各 1 条目标记录及 MinIO 对象 SHA-256 一致。恢复容器已移除，隔离恢复数据保留。备份是验收时间点快照，不代表持续备份机制已配置。
- 部署环境文件权限 0600，Tunnel token 不在 Git、日志及本报告。外部 Coturn 字段为空。源站仅在主机 `127.0.0.1:18080` 暴露；数据库、缓存、对象存储管理端口未向外发布。

## Tunnel 公网补验

- 用户修正 Cloudflare 路由后，`https://tescord.terata.top/` 和 `/healthz` 均返回 HTTP 200，未登录 `/api/guilds` 为 401，未授权 LiveKit Twirp 信令为 401，`/uploads/` 私有资源直访为 404。先前指向连接器内 `localhost:3000` 而返回 502 的入口问题已解除。
- `node scripts/verify-public-acceptance.mjs` 通过：公网注册、公会/频道、消息、附件上传与签名下载及 SHA-256、匿名/未签名/篡改拒绝、真实 Web 登录与刷新后保持登录、Gateway `IDENTIFY/READY`、移动端登录布局、打包 Windows Electron 的公网登录及重启后快捷登录。Web 控制台错误数为 0。脱敏输出位于 `test-results/public-acceptance/public-smoke.log`；桌面、移动端和 Electron 截图在同目录。脚本只在内存中保存随机生成的测试凭据；验收账号及公会仍保留在本次隔离部署数据中。
- `node scripts/verify-public-session.mjs` 通过：真实公网 A→B→A 快捷登录、未勾选记住登录时续期凭据仅驻留 `sessionStorage`、静默轮换后身份保持。脱敏输出位于 `test-results/public-acceptance/public-session.log`。
- `node scripts/verify-public-media.mjs` **未通过**。真实网页通过 Tunnel 信令进入 LiveKit 房间，但在 12 秒时 ICE 仍处于 `checking`、无 selected candidate pair/收发 RTP；25 秒后连接关闭。`test-results/public-acceptance/media-stats.json` 与 `media-attempt.png` 记录了客户端状态。LiveKit 服务端确认候选地址为 `100.69.12.101:7882/UDP` 和 `100.69.12.101:7881/TCP`，对 Windows 候选的 ICE 检查请求没有收到响应，未选出成功的 pair。没有实际 codec 或 E2EE 媒体证据。

## 阻断与待环境验收

1. **P0 媒体端口**：主机监听 `7881/TCP` 与 `7882/UDP`，并配置 `LIVEKIT_NODE_IP=100.69.12.101`；但 Windows 客户端从 Tailscale 访问 `100.69.12.101:7881` 失败，而 SSH 22 端口可达。目标机自身连接 7881 成功。公网真实语音加入也因 ICE 检查无响应失败，当前无 selected candidate pair、双向 RTP 字节或真实 codec 证据，不能报告 SFU/直连可用。目标机现有 Tailscale Serve 占用 443、8443，不占用 7881；在保存现有配置后，尝试以 `tera` 增加 7881 原始 TCP 转发，被守护进程明确拒绝为 `Access denied`，原 Serve 配置未改变。需有管理员权限排查主机防火墙/Tailnet ACL 或授权 Tailscale operator，再测真实双端媒体、E2EE 和断线恢复。用户当前无法调整媒体网络，故此项保持阻断。
2. **P0 TURN 回退**：外部 Coturn 按约定未配置；TURN relay 和依赖它的跨网回退均待环境验收。Cloudflare Tunnel 的普通公开域名路由不能代替 UDP/TCP WebRTC 媒体路径。
3. **P0 桌面正式发布**：Windows 安装包未签名，更新公钥/正式签名发布链尚未配置。已通过的更新器负向测试不等同于正式签名升级及失败回滚验收。
4. **P1 Electron 全场景**：打包应用的线上登录及重启快捷登录已通过，但通知、采集、托盘、设备释放、真实音视频/屏幕共享及签名更新失败回滚尚无完整 Windows 验收；本地专项测试不能替代这些门禁。
5. **P2 离线隐私**：新用户默认头像和若干前端占位头像仍引用 `api.dicebear.com`；离线环境可能缺图，并可能向第三方发送头像种子。需要改为自托管头像资源后复测。
6. **待审依赖**：GitHub 在推送时提示默认分支有 75 条 Dependabot 告警（21 high、42 moderate、12 low）。这些告警尚未逐项判断是否影响本部署，不等同于已确认的可利用漏洞。

缺失的门禁不得由健康检查、构建成功或本机媒体 loopback 替代。下次发布前应补齐媒体实测、签名更新链及 Windows 全场景报告。
