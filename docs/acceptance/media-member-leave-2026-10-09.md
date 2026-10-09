# 成员离开后的加密接收器清理

后续依赖修复已升级 global-agent 并移除 sprintf-js，为 braces 固定源码补丁；原始审计变为 1 高危、0 中危。下文保留本次媒体验收时的审计快照，最新依赖验证及发布边界见[依赖安全修复记录](dependency-security-2026-10-09.md)。

## 已确认的触发路径

用户报告网页端 A、B 通话时 C 加入再退出，有概率使 B 因密钥问题退出。本次确认并复现的是接收器清理缺口；尚未取得用户那次线上失败的完整错误码和浏览器日志，不把该路径视为所有误退的唯一原因。

Cloudflare SFU 共用一条 PeerConnection。C 的订阅消失后，原实现释放播放资源并调用轨道 `stop()`，没有解除 SFrame 接收器；C 对应的 Worker 仍存在于全局密钥安装确认集合。迟到的 Worker fatal 会失败整个 B 加密上下文，残留 Worker 也可能阻塞新密钥安装。轨道 `stop()` 不发出 `ended` 事件，见 [W3C 生命周期及 stop 算法](https://www.w3.org/TR/mediacapture-streams/#dom-mediastreamtrack-stop)。

确定性回归在修复前失败：结束 C 接收轨道后发出迟到错误，B 的失败回调被调用一次，违反保留 B 活动上下文的断言。原始日志保留在 `release/acceptance-20261009/member-leave/receiver-before-fix.log`。

## 修复与边界

- SFrame 增加单接收器解除绑定，先撤销 Worker 所有权，再终止 Worker；清理轨道结束监听器及待确认集合。剩余活动 Worker 仍须完成密钥安装确认。
- 自然结束的轨道自动解除接收器；SFU 释放订阅时在 `stop()` 之前显式解除绑定，覆盖音频、视频、退订及无法匹配当前发布者的旧轨道。
- P2P 整连接清理复用同一接收器清理逻辑。停用上下文时清理所有结束监听器。
- 已解除绑定的 Worker 迟到错误和 ACK 不影响当前会话；活动接收管道完整性错误仍触发严格失败处理，没有明文降级。
- 本次不改 HTTP/Gateway 身份或资源授权，不改变密钥、签名、上下文版本及跨端事件格式。

## 验证

- `pnpm build`：4/4 通过。
- `pnpm --filter @tescord/server exec tsx ../../scripts/test-sframe-receiver-lifecycle.mts`：3/3 通过，覆盖结束后的迟到错误、剩余密钥安装，以及活动管道错误仍失败。
- `pnpm --filter @tescord/server exec tsx ../../scripts/test-media-encryption-crypto.mts`：9/9 通过。
- 本地三人/五人浏览器专项（含 setup）：3/3 通过，2.1 分钟、零重试；C 各两次加入/离开，B 被注入退役接收 Worker 的迟到错误后仍在频道；实际逐远端 RTP、Opus、Worker 加解密增长及非零 PCM 通过。
- `node scripts/run-real-multiplayer.mjs --grep "member leave" --retries=0`：真实 Cloudflare 三人/五人、普通 ICE/强制 TURN 专项 4/4 通过，4.5 分钟、零重试；各两次 C 入会/离开及迟到错误注入后，B 和其他剩余成员持续媒体及留在频道的断言均通过。
- 完整浏览器回归：`node node_modules/@playwright/test/cli.js test --retries=0`，使用仓库默认完整配置，397/397 通过、零重试，35.7 分钟；执行时间 21:20:03 至 21:55:47（北京时间），退出码 0。凭据见 `full.log`、`full-exit.json`、`full-report/index.html`；媒体汇总提取 55 份房间证据，见 `local-media-summary.json`。
- `git diff --check`、八份本次变更文件的 Prettier 检查，以及 `node scripts/check-format-changed.mjs` 均通过。后端负向用例产生预期诊断日志，不将测试日志描述为无任何错误文字；新增媒体专项的浏览器 console error 断言均通过。

真实专项的两轮离开后持续采样合计覆盖 56 条有向接收路线：每条路线均为 Opus，RTP 收发及 Worker 加解密计数增长；最小发送增量 64,164 字节、最小接收增量 56,283 字节、最小加密/解密增量分别为 340/293 帧，最小解码 RMS 为 0.03308。普通 ICE 实选 `prflx/host`，强制 TURN 实选 `relay/host`，四个场景控制台错误计数均为零。数值凭据见 `member-leave-media-proof.json`。麦克风源为同机浏览器振荡器，不代替不同网络或实体麦克风/扬声器验收。

日志及原始凭据保存在忽略目录 `release/acceptance-20261009/member-leave/`，原始 trace 可能含测试凭证，不提交。专用真实测试使用全新 UUID 数据库，退出后清理隔离库及登记的临时 SFU 资源，不使用生产业务库。

真实专项 UUID 为 `8b750c25-6fc2-4ea9-b0b1-1558b7160a5f`。SQLite 及 WAL/SHM/journal 已逐路径验证不存在；HTML 报告提取的两份清理钩子凭据均为 `drained: true`，见 `real-artifacts/isolated-database-cleanup.json`、`sfu-cleanup-proof.json`。该结果证明已登记测试资源清理，不扩展声称供应商未知分配的状态。没有在生产建立测试用户或服务器数据。

尚未部署此修复。本次专项不替代此前未通过的完整真实 SFU 矩阵：先前完整矩阵为 6/8，普通 ICE 压力用例有订阅 500 与连接超时。2026-10-09 本次刷新依赖审计仍为 1 高危、1 中危，分别涉及 `braces <=3.0.3` 与 `sprintf-js <=1.1.3`；npm 当前最新版本仍为 3.0.3 与 1.1.3，审计所列修补版本 3.0.4/1.1.4 尚未发布。审计凭据见 `audit.json`。

本次只读核对目标 `/home/tera/apps/tescord` 的 HEAD 仍为 `a3ce088f2cdb339eda511262b664ff6f0ab2b633`；PostgreSQL、Redis、MinIO、server、web 容器健康，cloudflared 在运行，`http://127.0.0.1:18080/healthz` 返回 `ok`。线上版本尚未包含本次接收器清理及此前 WebSocket sync 改动。

21:53（北京时间）再次执行目标 rootless Podman 的 `podman image prune -f`，退出码 0；随后 dangling 镜像查询为空。保留运行镜像、带标签的回滚镜像及构建基础镜像，未执行全量镜像、卷或系统清理；凭据见 `target-image-cleanup.json`。
