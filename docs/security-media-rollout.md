# Tescord 安全、DM 与媒体变更交付说明

## 已实施的安全边界

- HTTP 与 Gateway 只接受签名有效、账号存在、未封禁且 `sessionVersion` 一致的访问令牌。已删除默认用户、请求体身份和 JWT 解码兜底。
- DM 历史、发送、回复、反应、置顶、删除、输入状态与已读游标均校验会话参与者及资源所属频道。DM 事件只投递给参与者，超级管理员不会自动收到。
- 公会 P2P 信令要求发送方和目标方都真实处于同一语音频道。Gateway 与登录、上传、呼叫令牌接口均有限流。
- 附件上传使用短期、绑定账号的签名授权；消息只能认领本人未使用的上传授权。下载 URL 五分钟失效，并绑定消息所在频道。主动内容类型和危险扩展名被拒绝。
- 生产模式拒绝开发 JWT、LiveKit、TURN 和上传签名密钥；空生产库不会注入默认管理员或测试账号。
- Coturn 使用共享密钥生成十分钟凭据，并暴露明确的 UDP relay 端口范围。公共 STUN 仅在 `ALLOW_PUBLIC_STUN=true` 时加入。
- `@fastify/jwt` 已升级到 10.2.2（`fast-jwt` 6.3.3）；MinIO 的 `query-string` 与 `stream-json` 传递依赖已覆盖到修复版本。MinIO 8.0.7 的 ESM 命名空间兼容问题由仓库内 pnpm 补丁修正，并通过预签名 URL 冒烟测试。

## 超级管理员和 DM

- 管理用户与公会接口采用数据库分页、过滤和稳定排序。角色、封禁、重置密码均撤销 refresh token 并增加会话版本。
- 最后一名有效超级管理员受事务保护；禁止自我封禁或自降权。临时密码随机生成，仅在成功响应中返回一次，登录后强制改密。
- 公会强制删除要求完整名称确认，删除前写入独立平台审计日志，并只通知受影响成员。
- 1v1 DM 使用排序用户 ID 生成唯一 `dmKey`。已有会话不再检查共享公会；首次创建仍要求共享公会或有效超级管理员。
- 消息使用频道内单调序号，已读游标只前进。新消息在同一事务中恢复接收方已隐藏的会话。

## 呼叫与媒体

- DM 呼叫由服务端生成 `callId` 并维护振铃、接听和结束状态。振铃 30 秒超时；事件校验参与者、状态和接听设备，旧事件不能取得媒体令牌。
- LiveKit DM 房间名包含 `callId`，令牌只为有效且已接听的设备签发。拒接、挂断、超时和设备断开会通知双方并从对应 LiveKit 房间移除参与者。
- P2P/Voice Mesh 统计从选中的 ICE candidate pair 和 RTP `codecId` 读取实际路径及编解码，排除 RTX/FEC。未采集的 RTT、缓冲、分辨率和编码器显示为未知。
- 已移除固定 52000 UDP 的 UPnP 映射。浏览器无法保证该端口就是实际 ICE socket，因此不再将映射成功宣称为打洞成功。

## E2EE 当前安全状态

- 每个账号和设备在 IndexedDB 生成不可导出的 ECDSA P-256 与 ECDH P-256 私钥；服务端仅保存公钥、指纹和撤销状态。已知设备公钥变化返回冲突，要求先撤销再确认。
- DM 呼叫方使用临时 ECDH、HKDF-SHA256、AES-GCM 和 ECDSA 签名，为对端每个在线设备分别封装同一随机媒体发送密钥。信封绑定频道、`callId`、发送设备与接收设备；服务端只短期保存密文信封用于网关漏包补偿，不持有媒体明文密钥。
- 首次设备身份执行 TOFU 并在通话界面展示指纹状态；已知设备的公钥或指纹变化会阻止协商，直到用户撤销旧设备。设备撤销、账号封禁、改密或维护模式会结束活动通话并清理媒体资格。
- 已删除从频道 ID 生成默认媒体密钥的路径。SFrame 密钥未就绪时会拒绝明文发送或加入 E2EE 频道。
- LiveKit 已接入固定版本 SDK 的 ExternalE2EEKeyProvider 与 E2EE Worker；P2P/Turn 使用 Insertable Streams 适配器。加密、签名、重放或浏览器能力校验失败时丢弃媒体帧，禁止回落到明文。
- DM 媒体按 P2P host/srflx、TURN relay、LiveKit SFU 顺序协商；每次 SFU 房间和令牌绑定独立 `callId`。公会 Mesh 也不再以 LiveKit 成功作为启动条件。
- 本期仍不宣称 DM 文本消息已完整端到端加密。旧 `isEncrypted` 文本数据只作历史兼容，服务端拒绝新增伪加密写入。公会 E2EE 频道的多设备换钥仍需在真实多端媒体环境完成验收。

## 安全审计结论

已修复的高风险项包括：JWT 验签失败解码兜底、请求体身份兜底、Gateway 默认用户、JWT 库算法/缓存/空密钥相关已知漏洞、跨 DM 资源访问、全局 DM 广播、附件未认证上传与目录逃逸、活动内容同源访问、管理角色只信 JWT、固定 TURN 凭据、默认生产密钥、媒体密钥由频道 ID 派生、加密失败返回原始媒体帧、任意目标呼叫信令以及 Electron 任意导航和未校验外链。

中风险后续项：将进程内上传授权迁移为数据库或 Redis 一次性记录以支持多实例；为平台审计日志增加归档与留存周期；为公会多人 E2EE 完成成员版本驱动的自动换钥与多发送者压力测试；把管理与消息接口的手写运行时检查统一迁移到共享 schema 校验器；对附件增加内容嗅探和可选病毒扫描。以上项目不削弱当前 DM 的参与者隔离和媒体 fail-closed 边界。

## SQLite 迁移

不要直接对业务库执行 `db:push`。先停写并在仓库根目录执行：

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$db = "E:\nodejs_project\Tescord\apps\server\prisma\dev.db"
Copy-Item -LiteralPath $db -Destination "$db.$stamp.bak" -ErrorAction Stop
$env:DATABASE_URL = "file:./dev.db"
pnpm --filter @tescord/server db:preflight:dm | Tee-Object ".\artifacts\dm-preflight-$stamp.json"
```

预检退出码为 `2` 时不要应用唯一约束。报告会列出重复双方会话、参与者数量异常、孤立引用和重复消息序号。先导出人工合并报告，保留全部消息与参与者状态，再在维护窗口应用经过审查的迁移。

预检通过后，在数据库副本上执行并验证。当前 Windows 主机的 Prisma 6.4.1 `db push` schema engine 会无诊断退出，因此不要在业务库绕过该错误；应先升级/修复 Prisma schema engine，或由 `prisma migrate diff --from-empty/--from-url` 生成 SQL 后人工审查并在副本执行：

```powershell
$env:DATABASE_URL = "file:./migration-rehearsal.db"
pnpm --filter @tescord/server db:push
pnpm --filter @tescord/server db:preflight:dm
pnpm build
```

恢复时停止 Tescord 服务，将失败库另存为取证副本，再把同一时间点的 `.bak` 复制回 `dev.db`。设备私钥只存在客户端 IndexedDB，数据库备份不会恢复旧设备身份。

## 部署配置

生产环境至少设置：`JWT_SECRET`、`UPLOAD_SIGNING_SECRET`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`、`LIVEKIT_URL`、`TURN_HOST`、`TURN_PORT`、`TURN_SECRET`、`CORS_ORIGINS`。`TURN_SECRET` 必须与 Coturn `static-auth-secret` 一致，并在防火墙开放 3478 TCP/UDP 与 49152-49252 UDP。

Vite、API 和 Gateway 可以继续经 cloudflared HTTP 隧道访问。该隧道不证明 WebRTC UDP、Coturn relay 端口或 LiveKit 媒体端口在公网可达。本机未安装 Docker CLI，无法启动仓库内 Coturn/LiveKit 编排；因此 TURN、SFU 和公网媒体仍需在具备独立可达媒体入口的主机上执行跨网双端验收。

## 验证记录

- `pnpm build`：四个 workspace 构建通过，包含 LiveKit E2EE Worker 产物。
- `pnpm test:security-media`：媒体密钥正确解密、重放拒绝、篡改拒绝、缺失密钥禁止发送全部通过。
- `pnpm audit --prod --registry=https://registry.npmjs.org`：`No known vulnerabilities found`；项目默认 npmmirror 不提供 audit API，因此审计命令需显式使用官方 registry。
- MinIO 预签名 URL 冒烟测试：升级后的传递依赖与仓库补丁可生成带 `X-Amz-*` 签名的对象 URL，无需连接真实存储节点。
- `verify-admin-dm.ts`（隔离 SQLite + 真实后端）：伪造令牌、管理分页、DM 并发唯一性、第三方读取隔离、已读游标单调性、过期呼叫令牌与封禁后会话撤销通过。
- Playwright 现在自动创建隔离 SQLite、启动真实后端并登录取得签名令牌；旧 UI fixture 不再依赖默认用户鉴权兜底。媒体 UI 用例中的 LiveKit 连接使用显式测试适配器，不能代替真实 SFU 媒体证明。
- 新增真实 Chromium PeerConnection 回环验收：无媒体适配器参与，实际 host ICE 连接的 RTP 发送/接收字节、编码/解码帧均增长，且基于 `codecId` 的收发视频编码一致并排除 RTX/FEC。该测试证明本机直连与统计采集，不证明 TURN/SFU。
- `pnpm test:e2e -- --workers=1`：最终回归中，setup 与 Chromium 共 55/55 通过（`55 passed (1.1m)`）。
- Prisma 在当前 Windows 主机创建隔离 SQLite 测试库时仍返回无详细信息的 `Schema engine error`。Playwright 启动器使用 `migrate diff` 生成新库 DDL，并通过 Prisma query engine 应用到隔离库；未对现有 `dev.db` 执行迁移或修复。
