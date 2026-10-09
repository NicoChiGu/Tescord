# 媒体加密快照同步迁移至 Gateway WebSocket

## 行为与兼容

`/api/channels/:channelId/media-encryption/sync` 的客户端调用优先迁移到现有 Gateway：`MEDIA_ENCRYPTION_SYNC` 请求及 `MEDIA_ENCRYPTION_SYNC_RESULT` 响应。服务端在 `READY.mediaEncryptionSync` 声明支持；支持 v3 但未声明该能力的已认证旧服务端继续使用 HTTP。

请求包含随机 `requestId`、频道、设备、Gateway 会话与注册实例。响应关联请求、频道和注册实例，成功时携带原有 v3 快照，失败时携带标准 `ErrorCode`。客户端先验证响应形状与作用域，再交给现有上下文版本、签名和密钥校验流程。

每次请求最多等待 5 秒。同步传输错误最多重试两次；上下文竞争沿用原有最多三次重试。退出频道、切换身份、替换连接及断线清理待处理请求、计时器和取消监听器；未知、重复和已取消请求的迟到响应不会再次完成请求。Gateway 不可用时不会通过 HTTP 绕过当前连接身份校验，也不会降级到明文媒体。

本次保留原有协商期间自适应同步与稳定通话每 5 秒的同步保活。因此稳定通话每设备约 12 次/分钟的 HTTP `sync` 调用改为 WebSocket 消息；数据库授权、成员核验与密钥快照工作仍会执行。`join`、`publish`、`acknowledge`、`leave` 保持 HTTP 传输。

## 安全边界

- 入口：已完成 JWT `IDENTIFY` 的 Gateway socket；JWT 到期/伪造凭证在 `IDENTIFY` 被拒绝。连接存续期间复核账号、会话版本和有效登录会话。
- 身份：用户 ID、登录会话与 Gateway 会话只从服务端连接取得，要求请求的 Gateway 会话与该连接相同，并核对该连接仍是当前实例。
- 资源：当前语音频道或已授权 DM 通话中的注册设备；复用原有按房间串行的 registry `snapshot`。
- 授权：当前登录与设备未撤销、账号未封禁、频道 CONNECT/DM 参与权限成立、当前语音/通话及注册实例匹配。每连接最多四个在途同步，限制并行快照工作。
- 拒绝：未认证、错误版本/数据、跨会话、错误设备/注册、跨频道/公会或非参与者请求不返回快照。成功响应只发送到发起请求的 socket，不广播至其他设备或重连实例。

## 验证

- `pnpm build`：4/4 通过。
- `pnpm --filter @tescord/server exec tsc --noEmit`：通过。
- 对全部改动及新增文件执行 `pnpm exec prettier --check ...`、`node scripts/check-format-changed.mjs`、`git diff --check`：通过；新文档表格格式已修正，运行时源码在验收后没有变化。
- `pnpm --filter @tescord/server exec tsx scripts/test-media-encryption.mts`：23/23 通过；新增真实 loopback WebSocket 请求的认证、跨资源、设备撤销、封禁与会话撤销负向测试，隔离数据库已清理。
- 初次 `pnpm test:e2e e2e/media-encryption-gateway-client.spec.ts e2e/media-encryption-lifecycle.spec.ts --retries=0`：11/11 通过，3.8 分钟。覆盖请求关联/重复/迟到响应、错误作用域/形状、超时/取消/断线、3/5 人真实签名设备、丢响应恢复、密钥/ACK 推送丢失及旧服务端兼容。
- 更严格的并发协商丢响应专项：3/3 通过，1.5 分钟；3/5 人各丢失一次协商中的响应，最终 HTTP `sync` 均为 0。
- 完整回归初次运行在 380 项 UI/API 通过后发现一个旧测试观测问题：三设备用例仅从 HTTP 响应读取成员版本，迁移后无法观测 WebSocket 同步引发的版本变化。保留该次失败及中断记录，未计为通过。用例改为观测实际 Gateway 快照与 epoch 推送，并按 `contextRevision` 防止观测回退；保留原有轮换/RTP/PCM 断言，另增加离开后的加解密增长检查。专项重跑 2/2 通过，33.7 秒。
- 第二次完整回归在 45 项通过后被工具会话中断，没有最终退出报告，未计为完整通过。
- 最终完整回归：`node node_modules/@playwright/test/cli.js test --retries=0`（与 `pnpm test:e2e --retries=0` 相同的 CLI、配置与用例），395/395 通过，0 失败、0 重试，30.4 分钟，退出码 0。使用后台进程保存退出凭据，避免用户继续消息中断工具会话。
- 最终丢响应用例：3 人 WebSocket 请求计数 `[15,14,9]`，丢响应 1 次、重复响应 37 次；5 人 `[14,14,12,13,7]`，丢响应 1 次、重复响应 59 次。两者 HTTP `sync` 均为 0，仍通过持续媒体与离开/重进检查。
- `pnpm audit --json --registry=https://registry.npmjs.org`：退出码 1，仍有 1 高危（braces）、1 中危（sprintf-js），0 严重；凭据为 `ws-sync-audit-final.json`、`ws-sync-audit-exit.json`。未添加审计忽略或伪造修复版本。

执行日志在忽略目录 `release/acceptance-20261009/ws-sync-*.log`；最终完整日志为 `ws-sync-e2e-final.log`，退出凭据为 `ws-sync-e2e-exit.json`，原始凭据为 `ws-sync-final-artifacts`、`ws-sync-final-report`，数值汇总为 `ws-sync-local-media-final.json`（53 份房间证据）。初次专项原始凭据也已保留。原始 trace 可能包含短期测试凭证，不提交代码库。

以上本地验证使用隔离数据库和同机浏览器，检查实际选中 ICE、Opus、逐远端 RTP、Worker 加解密增长及非零 PCM。

## 同版本真实 Cloudflare SFU/TURN

`node scripts/run-real-multiplayer.mjs --retries=0`：6 通过、2 失败，30.6 分钟、0 重试，退出码 1。运行 UUID 为 `af019acf-55a4-4c8b-8179-6ab44f81298e`；使用专用 `build/real-media` 前端及全新 UUID SQLite，未使用业务库或部署目标作为测试后端。

| 路径/人数      | 60 秒通话、重进与设备切换 | 20 轮并发/轮换                                                           | 首人就绪 / 后续首个加密音频 P95          |
| -------------- | ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| 普通三人       | PASS                      | FAIL：完成 2 轮，第 3 轮 Cloudflare subscribe 500，发布者登记仍为 active | 未完成，不生成放行 P95                   |
| 普通五人       | PASS                      | FAIL：完成 16 轮，第 17 轮 Cloudflare media ICE timeout                  | 未完成，不生成放行 P95                   |
| 强制 TURN 三人 | PASS                      | PASS，20/20                                                              | 4.537 秒（20 样本）/ 4.950 秒（40 样本） |
| 强制 TURN 五人 | PASS                      | PASS，20/20                                                              | 5.444 秒（20 样本）/ 7.030 秒（80 样本） |

强制 TURN 首人就绪及后续首音频门禁为 10 秒，两组通过。另记录全部远端齐备的辅助 P95：三人 6.521 秒，五人 10.710 秒。普通路径的两个失败仍需调查，日志不能证明唯一根因；未通过重试、跳过或放宽断言掩盖失败。

凭据：`ws-sync-real-final.log`、`ws-sync-real-final-stderr.log`、`ws-sync-real-exit.json`；64 份房间证据及脱敏数值汇总为 `ws-sync-real-artifacts`、`ws-sync-real-media-final.json`，完整报告为 `ws-sync-real-report`。这些验证使用真实 Cloudflare SFU/TURN、同机浏览器和合成音源；不证明不同网络之间、实体麦克风/扬声器或生产部署的媒体体验。

## 清理与提交/部署状态

- 隔离 UUID 数据库及 WAL/SHM/journal 已删除，并逐路径验证不存在；凭据为 `ws-sync-real-artifacts/isolated-database-cleanup.json`。
- 报告中 3 份 `remote-sfu-cleanup.json` 均为 `drained: true`，覆盖失败后重启的 worker；脱敏凭据为 `ws-sync-sfu-cleanup-proof.json`。该凭据证明测试登记的临时 SFU 资源已清理，不保证供应商错误中未知分配的资源状态。
- 没有在生产创建测试用户、服务器或频道数据。
- `tera@100.69.12.101` 已执行 `podman image prune -f`，退出码 0；没有镜像删除输出，清理后 dangling 列表为空。运行镜像、构建基础镜像和回滚镜像保留，未操作业务卷；凭据为 `ws-sync-image-cleanup.json`、`ws-sync-target-dangling.log`。
- 清理后 PostgreSQL、Redis、MinIO、server、web 均健康，cloudflared 运行中；目标本地 `/healthz` 返回 `ok`，匿名 `/api/users/@me` 返回 401，详见 `ws-sync-target-*.log`。
- 本次改动提交到 main 用于保存代码、更新内容和验收结论。真实矩阵及完整依赖审计仍未通过，生产未放行、未迁移或重启候选代码；目标源码仍为 `a3ce088f2cdb339eda511262b664ff6f0ab2b633`。此前发布记录见 `release-2026-10-09.md`。
