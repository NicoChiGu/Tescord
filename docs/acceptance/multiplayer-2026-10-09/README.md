# 多人加密与 Cloudflare SFU 加入修复验收

本次只修改工作区并运行本机隔离测试，未部署现网，未修改业务 SQLite 或生产 PostgreSQL。验收使用合成麦克风音频和真实浏览器 WebRTC；真实 SFU/TURN 测试使用根目录已有配置、每次新建的 UUID SQLite 数据库及独立端口 3102/4174。

当前产品构建及完整本地 E2E 通过，强化逐远端媒体检查的多人专项 12/12 通过。最新真实 SFU/TURN 矩阵为 4/8 通过：relay 五人完整 20 轮与首音频 10 秒门禁通过；普通路径和 relay 三人仍有 ICE 超时、缺失接收媒体或供应商 5xx，整体验收尚未通过，不能标记为生产可发布。最新原始日志为 `test-results/multiplayer-validation/real-matrix-per-peer-final.log`，脱敏汇总见 `real-per-peer-results.json`。

## 修复内容

- 媒体协商升级为 v3，房间上下文增加单调 `contextRevision`。密钥签名和 ACK 同时绑定 contextId、revision、成员版本；注册请求增加独立 registrationId，避免旧退出请求撤销重新加入的设备。媒体帧格式和加密算法保持原样。
- 服务端按房间串行处理注册、上下文、发布和 ACK，稳定排序成员；异步权限和签名校验后重新核对登录会话、Gateway 会话及房间版本。旧轮换超时不能移除已进入新版本的成员。
- 客户端忽略旧快照，暂存先到达的未来版本密钥并合并同步请求。真实设备签名和接收者验证成功、有效解密管线确认安装后才发送 ACK。重复信封和 ACK 幂等；正常成员变化取消旧任务，身份或安全失败仍停止媒体。
- 相同已提交的发布和 ACK 在短暂响应丢失时原样有界重试；收到 ACK 的信封不再随每次同步重复提交。账号切换仍清理设备身份，单次离开语音保留同一账号的设备注册。
- SFU 请求身份与房间全员协商状态分离；合法注册中的会话可以准备传输，媒体发送仍等待密钥 ACK。设备注册、麦克风和 ICE 配置并行准备，创建短寿命会话前先准备本地候选。
- SFU 轨道初始快照和 Gateway 公告按房间 revision 合并。发布、批量订阅、关闭和 SDP 交换统一排队，出队时重核对身份和轨道。只重试明确逐轨道拒绝；未知分配结果退休旧会话，初次加入最多重建一次新连接，退出或账号变更阻止复活。
- Cloudflare 要求先完成连接再执行后续操作，因此远端订阅在本地发布 SDP 和 connected 后开启；连接期间的公告缓存保留。公告等待在 SDP 队列外，按 sender 检查当前代次密钥已完成 ACK，以及该 sender 的实际 RTP 计数相较基线增长；最终公告作为短队列项检查完整发布集合。关闭或替换轨道会为剩余未公告轨道重启任务。参见 [官方协商流程](https://developers.cloudflare.com/realtime/sfu/concepts/negotiation/) 和 [425/410 与部分结果处理](https://developers.cloudflare.com/realtime/sfu/observability/error-codes/)。请求级失败不作为已分配资源不存在的证明。
- Gateway 权限查询后和发送前重新验证 P2P 发送会话，转发 authoritative senderSessionId；设备转移关闭旧 PeerConnection 并拒绝旧设备延迟信令。麦克风切换通知在音频引擎配置更新后发出，避免显示退回旧设备。
- ACK 不再读取整房间信封快照并重复四次上下文校验：发布和 ACK 使用专门的登记上下文路径，成员授权并行查询，发送 ACK 前仍完整重核对授权和房间。已确认密钥的旧超时任务直接结束，避免继续占用房间队列。
- 新加入的操作只由包含自己 registrationId 的上下文启动，延迟旧房间事件不会覆盖新注册。预分配摄像头 sender 明确绑定视频类型，避免摄像头稍后开启时仍按音频格式加密；补充实际 RTP、解码像素及关闭后重开回归。
- 初次 ICE 连接等待缩短为 5 秒；初始化期间的 failed 状态进入同一个有界重建流程，保留麦克风且最多重建一次。旧连接清理完成后不能覆盖新连接状态。创建 SFU 会话的网络/5xx 失败或缺失 sessionId 同样使用该预算；401/403 不重试。
- SFU 重协商在请求前及异步返回后重新验证登录会话、频道和注册权限，授权失效时撤回本地发现状态并关闭已知轨道；发布返回后的迟到 MID 也纳入清理，避免账号退出期间遗留已知分配。
- Worker 与兼容加密管线在第一帧实际加密或解密成功后立即上报统计，随后维持原有批量周期。首音频时延不再额外等待 50 帧或 1 秒统计刷新；真实 Opus RTP 回归检查第一次计数为 1。时延门槛仍为 5/10 秒。
- UI 回归发现并修复分类创建的 REST/Gateway 双到达竞态，两个入口均按分类 ID 合并。
- 多浏览器上下文的本地 HTTPS 测试改为固定信任 Vite 测试证书的公钥。NetLog 定向复现的三个失败请求各经历 32 次证书校验失败和请求重启，未发送 HTTP 请求；对应轮的实际媒体已通过。没有将这类测试环境错误归因于服务端 ACK 或 HTTP 缓存，也没有忽略控制台错误。

## 安全边界

| 入口                       | 身份及资源归属                                                              | 授权与拒绝条件                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 媒体 join/sync/publish/ACK | HTTP JWT、数据库有效登录、Gateway 会话、注册设备、频道/通话及注册代次       | CONNECT、未封禁、会话未撤销、v3、正确成员版本和真实设备签名；过期上下文返回 409，旧协议明确拒绝                |
| SFU 创建/发布/订阅/重协商  | 有效 HTTP 登录与媒体会话的同用户、同登录会话归属                            | 当前频道/通话权限及登记身份；发布额外要求 SPEAK，订阅检查目标轨道、来源和观看权限；不能借用其他登录的 SFU 会话 |
| SFU 心跳/退出              | 活动或短期保留的退休会话归属同时绑定用户与登录会话                          | 退休会话只允许 inactive 心跳与幂等退出响应，不能发布、订阅、重协商或恢复租约                                   |
| P2P Gateway 信令           | 已 IDENTIFY 的连接、authoritative senderSessionId、当前语音或有效待加入代次 | 异步权限查询前后重核验；跨频道/公会/通话及被替代旧设备不能发送有效媒体信令                                     |
| 测试远端清理钩子           | 仅真实隔离运行入口、loopback 与本次随机 bearer nonce                        | 伪造 nonce 返回 403；仅等待已有清理请求。`drained` 表示等待结束，不表示每项远端关闭均获服务端确认              |

## 重现命令

在仓库根目录执行，使用 `pnpm`。真实运行入口只从配置读取 SFU/TURN 设置，不打印凭据，也不接受部署目标地址。

```powershell
pnpm build
pnpm format:check
pnpm --filter @tescord/server exec tsx ../../scripts/test-media-encryption-crypto.mts
pnpm --filter @tescord/server exec tsx scripts/test-media-encryption.mts
pnpm --filter @tescord/server exec tsx scripts/test-cloudflare-subscriptions.mts
pnpm test:security-media
pnpm test:e2e
pnpm exec playwright test --project multiplayer --no-deps --output=test-results/per-peer-multiplayer
pnpm node scripts/run-real-multiplayer.mjs
# INPUT 为单次 UUID 输出目录，LOG 为该次日志，OUTPUT 为脱敏 JSON 路径
pnpm node scripts/summarize-multiplayer-evidence.mjs INPUT LOG OUTPUT
```

普通完整 E2E 使用 3101/4173 隔离库。单 worker 按配置的项目顺序运行 UI 后的长媒体矩阵，媒体测试各自创建真实签名账号，不能因其他 UI 用例失败而跳过。真实 SFU 入口另外构建 `apps/web/build/real-media`，不覆盖默认 Web 构建；库名为 `tescord-real-media-<uuid>.sqlite`，结束后删除本次库及附属文件。

默认 E2E 输出固定为 `test-results/default-e2e`，真实矩阵为 `test-results/multiplayer-real/<uuid>`，执行日志为 `test-results/multiplayer-validation`。Playwright 会清空自己的输出目录，因此三个目录必须隔离，不能把根目录 `test-results` 用作任一测试入口的可清理输出目录。

## 媒体与时延判据

每个端点对每个远端发送者验证匹配 MID/轨道、实际选中的 ICE candidate、实际 Opus 编解码、持续增长的 RTP 字节及非零接收 PCM。`evidenceSchemaVersion: 2` 的媒体凭据另外逐条绑定 sender/receiver 原生加密变换的真实 Worker 统计，检查每条路径的加密、解密计数持续增长；SFU 的单路本地发布加密计数由该发布对应的远端路径共享。测试仅旁听已有 Worker 的统计消息，不替换帧、密钥或网络响应。此前版本的凭据只有端点聚合加解密计数，不能据此声称逐远端加解密计数已验证。顺序加入通话持续至少 60 秒；并发矩阵每种人数包含 10 次同时加入及 10 次轮换中加入，逐轮保留证据。控制台严重错误不能忽略或以 connected 状态代替媒体通过。

后续成员时延是点击加入至 `firstPlayableAudio`，该标记要求 AudioContext 可播放、真实解密计数增加且远端音频 RMS 非零，并在完整 RTP/Opus/逐远端检查通过后采用。另保存全部远端可播放时间。首人独立统计密钥和发布连接 ready 时间。至少 10 个样本的 P95 门槛保持普通路径 5 秒、强制 TURN 10 秒，权限弹窗不包含在已授权样本内。

## 执行记录

最终结果和阶段耗时见本目录的 JSON 与日志；完整 trace、失败截图及逐房间媒体数据位于忽略的 `test-results/`，其中可能包含短期测试账号网络认证数据，不适合公开上传。

- 本地构建、格式、帧加密、后端协议、安全拒绝及 SFU 协商专项已执行。
- 初轮真实 8 项矩阵为 2 通过、6 失败（21.9 分钟），三人和五人 relay 顺序 60 秒及重入/转移通过。普通三人并发成功 8 轮，普通五人 1 轮，relay 三人 14 轮，relay 五人 5 轮；失败样本均保留。
- 第二轮真实 8 项矩阵为 1 通过、7 失败（17.4 分钟），普通三人顺序 60 秒及重入/转移通过。其余场景仍有慢连接、逐轨道暂不可用或未知结果，未满足完整矩阵和时延门禁。历史结果详细归因在 `real-results.json`，不将 CPU/网络正常或服务端单因视为已证明。
- 完整 E2E 初轮记录为 335 通过、22 失败、11 未运行（12.8 分钟）。旧 Tooltip/原生下拉框测试定位与共享个人设置初始化已修复；后续重测结果单独记录，不能覆盖或隐藏该次失败。
- UI 修复后专项为 53 通过、2 失败；移动长按重测通过，分类重复 ID 的实际竞态已修复并等待下一轮验收。后端队列优化后的 12 项多人专项为 9 通过、3 失败：全部 6 项签名设备时序回归通过，五人顺序测试已完成 60 秒全路音频及生命周期，但仍记录到续租请求的浏览器网络错误，整项保持失败；两个并发矩阵遇到延迟钩子晚于 API fetch 绑定安装的问题，钩子修复后待重测。
- 后续完整运行 `full-e2e-delivery-final.log` 在 369 项完成后中断，未形成整套门禁结果：368 通过、1 失败、4 项未完成。三人/五人顺序 60 秒及全部 40 轮并发/轮换矩阵通过；分类创建已通过，唯一已完成的失败是移动端拖拽测试复用旧坐标，最新专项重测通过。该轮尚未包含最终 packet-ready 构建，不能作为最新工作区完整验收。
- 签名设备生命周期 6/6、移动/核心交互 6/6 均通过；新增公告探针首轮安装过晚导致 5 个用例漏记请求，修正模块加载顺序后 SFU 协商 28/28 通过，原失败日志保留。
- 第三轮独占本机的真实 8 项矩阵为 2 通过、6 失败（17.3 分钟），普通及 relay 三人顺序 60 秒及生命周期通过。普通五人和 relay 三人、五人已完成的有效媒体轮仍分别遇到供应商 5xx 或初始 ICE 不连接；细节见 `real-exclusive-results.json`。该轮促成初始连接 5 秒重建和重协商授权修复。
- 第四轮 transport 构建为 4/4 通过；后端 SFU 清理/授权 11/11、浏览器 SFU 协商 31/31、ICE 6/6 通过。真实运行 UUID 为 `df72bfae-a197-4aa2-bab5-5513772224ce`，构建哈希见 `source-transport-final.json`。真实 8 项结果为 5 通过、3 失败（33.2 分钟）：普通/relay 的三人、五人顺序 60 秒及完整生命周期全部通过，relay 五人全部 20 轮和 10 秒门禁通过。普通三人及 relay 三人均完成全部 20 轮，但后续成员 P95 分别为 11.917/11.248 秒；普通五人完成 10 轮后第 11 轮 sessions/new 返回 502，整项失败。详见 `real-transport-results.json`。该运行在第一帧统计和 sessions/new 恢复补充前启动，不能作为这两项后续修改的测试凭据。
- 最新源码 `source-latest-final.json`：构建 4/4、帧加密 9/9、后端媒体协议/授权 17/17、SFU 清理/授权 11/11、安全专项及格式检查通过。浏览器媒体专项 `latest-media-focus.log` 为 57 通过、0 失败（1.4 分钟），包含初始化 1 项、SFU 协商 35 项、ICE 6 项、真实音视频 RTP 15 项；其中 Worker/兼容 Opus 首帧计数、错误密钥拒绝、H264/VP8/VP9/AV1 解码像素、预分配视频 sender 关闭重开均通过。最新真实运行 UUID 为 `8237b25d-00ba-44ec-bd06-41daeca01ecf`，完成后保存最终结果及完整时延门禁 JSON。
- 上述最新真实 8 项结果为 3 通过、5 失败（19.6 分钟）：普通三人/五人、relay 三人顺序 60 秒及生命周期通过；四个并发矩阵分别完成 12/6/4/7 轮后失败，relay 五人顺序未完成 60 秒。失败包含两次初始 ICE 均超时、供应商订阅 500，以及 HTTP 200 内的 `empty_track_error`、`transport_unavailable_error`、`not_found_track_error`。缺失轨道样本在密钥 ACK 正常、实际 Opus 上行增长时仍无接收 RTP，不能仅凭 connected 或顶层 HTTP 200 通过。见 `real-latest-results.json` 和 `real-missing-rtp-responses.jsonl`。四个矩阵都未完整完成，未形成完整 P95 时延门禁结果。
- 启动完整 E2E 时发现原配置使用 `test-results` 根目录作为 outputDir，Playwright 清理了该目录下此前原始日志与 trace。该次运行已停止，默认输出改为独立子目录；提交目录中的脱敏历史报告、响应摘要和源码哈希仍保留。独立 HTML 报告已恢复最新 UUID 的全部 39 份原始媒体 JSON 和失败截图，位于 `test-results/multiplayer-real/8237b25d-00ba-44ec-bd06-41daeca01ecf-recovered-html`；历史自定义 trace ZIP 和纯文本执行日志未被 HTML 复制，无法恢复。自定义 trace 现显式登记为附件，保存失败会使测试失败；最新源码的完整 E2E 和真实矩阵重新生成原始凭据，此后不以已清理的历史路径作为可用原始附件。
- 输出隔离后的完整 `pnpm test:e2e` 为 **386 通过、0 失败（26.8 分钟）**，日志为 `test-results/multiplayer-validation/full-e2e-latest-final.log`，逐房间脱敏结果见 `local-multiplayer-results.json`。三人/五人顺序 60 秒及生命周期、全部 40 轮并发/轮换、6 项真实签名设备生命周期回归和五语言回归全部通过。默认浏览器部分包含 35 项 SFU 协商、6 项 ICE 和 15 项真实加密音视频 RTP。此轮验证产品修复及默认输出隔离；运行中补充的 trace 附件登记由后续真实入口验证。
- 原始日志恢复用的重测仍为构建 4/4、帧加密 9/9、后端协议/授权 17/17、SFU 清理/授权 11/11、安全专项通过，日志保存为 `build-final.log` 及 `final-frame/protocol/authorization/security.log`。
- 补存原始凭据的真实运行 `56a0d2f1-2ec8-49cd-8747-e81ce591851c` 为 **4 通过、4 失败（27.5 分钟）**，普通/relay 的三人和五人顺序 60 秒及生命周期全部通过。普通三人全部 20 轮完成，后续成员 40 个样本 P95 为 11.236 秒，首人 20 个样本为 10.567 秒，5 秒门禁失败；relay 五人全部 20 轮完成，后续成员 80 个样本 P95 为 7.376 秒，首人 20 个样本为 11.393 秒，首人 10 秒门禁失败。普通五人第 4 轮初始 ICE 两次超时，relay 三人第 11 轮供应商发布 500，整项失败。完整结果见 `real-evidence-results.json`，独立日志为 `real-matrix-evidence-final.log`；原始 JSON、trace ZIP 和清理凭据保存在该 UUID 输出目录。
- 产品源码保持不变后的 schema v2 多人专项为 **12 通过、0 失败（18.9 分钟）**，49 份房间媒体凭据均包含逐远端加解密持续增长证明；三人、五人各完成 10 次并发加入和 10 次轮换中加入，顺序通话均持续至少 60 秒并完成生命周期检查。日志为 `per-peer-multiplayer.log`，脱敏报告为 `per-peer-local-results.json`。前述完整 386 项验证产品修复，新统计采集器由本次独立多人专项和下述真实 SFU/TURN 入口另行验证；历史结果不因补充运行而覆盖。
- schema v2 真实运行 UUID 为 `53c82468-12d6-4814-8de0-479ed35053bf`，源码及构建哈希见 `source-per-peer-final.json`，为 **4 通过、4 失败（21.6 分钟）**。普通三人、relay 三人和 relay 五人顺序 60 秒及完整生命周期通过；relay 五人全部 20 轮通过，首人 20 个样本 P95 为 **4.530 秒**，后续成员首个可播放加密音频的 80 个样本 P95 为 **6.558 秒**，均通过 10 秒门禁。全部远端音频齐备的辅助 P95 为 13.448 秒，不作为首音频门禁。普通三人完成 2 轮后第 3 轮初始 ICE 超时；普通五人顺序在第四端出现缺失接收媒体，并发完成 7 轮后第 8 轮缺失一路媒体；relay 三人完成 10 轮后第 11 轮发布出现供应商 `500/internal_error`，随后加入失败。后三个矩阵未完成，不生成完整时延门禁结果。
- 此次保存 46 份房间原始媒体 JSON、201 份原始浏览器 trace ZIP 及对应附件副本，默认、补充多人及真实测试输出目录互相隔离。脱敏汇总为 `real-per-peer-results.json`，日志为 `real-matrix-per-peer-final.log`。汇总脚本采用 RMS > 0.001 的保守快照子集，实时浏览器门禁为 RMS > 0.0001；子集统计不能代替完整矩阵门禁文件。真实三人普通/relay 的六条路径在 60 秒内最低分别新增 2,987/2,983 帧解密及 552,000/550,160 字节接收 RTP；relay 五人的二十条路径最低新增 2,998 帧解密及 555,312 字节接收 RTP，全部使用实际 relay 候选。
- `isolated-database-cleanup.json` 已核对，本次 UUID SQLite 及 wal/shm/journal 均不存在；测试端口 3101、4173、3102、4174 均无监听。远端 drain 使用无效 nonce 拒绝/有效 nonce 成功的检查，确认等待已知清理任务结束；不能据此声称所有供应商未知分配均已核对关闭。
- 交付构建 `build-delivery-final.log` 再次为 4/4，通过 `pnpm format:check` 和 `git diff --check`，日志为 `format-delivery-final.log` 与 `diff-delivery-final.log`。默认隔离库清理的计算路径命令被自动审批拒绝后，改为核对并删除单个明确绝对路径，成功清理 `tescord-playwright.sqlite`；其附属文件同样不存在，凭据为 `default-isolated-database-cleanup.json`。没有借此删除业务数据库或其他文件。

schema v2 真实运行中的五人顺序失败另保存 `real-per-peer-track-responses.jsonl`：第四端发布获得 answer，批量订阅获得 offer 并完成重协商，均为 HTTP 200；其本地真实加密及上行字节增长，但三个接收路径的 RTP、解密计数和 PCM 均为零。其他成员订阅该端的响应依次出现 `empty_track_error`、`transport_unavailable_error`，部分随后为 `not_found_track_error`。摘要仅保留角色序号、API 路径、状态、SDP 类型、MID 和错误码，不含令牌、凭据、请求体或 SDP 内容。尚不能据此把单一网络或供应商根因视为已证明。

公网跨网络、实体麦克风/扬声器、现网服务重启和发布部署均待环境验收。v3 客户端和服务端后续部署必须同步更新；本次没有新增数据库迁移。
