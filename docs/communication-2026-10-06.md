# 语音通信与交互修复：实现与验收记录

本次实现保留 Cloudflare Serverless SFU/TURN、Web 本地降噪及 Electron 原生推理。交付范围是代码及本地验证；未执行生产部署、业务库变更、提交或推送。媒体协议升级到 v2，客户端和服务端须一起升级。

## 实现范围

| 项目         | 实现                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2P 音频     | 接收轨道以短窗口增量计算丢包、抖动、缓冲、concealment 和 RTP；Opus 单声道、20ms、带内 FEC、按丢包调整码率；支持时接收缓冲有界调整。设备、降噪及连接代次隔离，避免旧任务恢复发送。                    |
| 降噪下载     | RNNoise/DTLN/DFN3 真实字节下载、哈希校验、缓存、初始化及首个输出就绪阶段；同一常驻 Toast 更新，准备期间保留旧引擎；取消、快速切换、停滞及初始化超时分别处理。                                        |
| 共享声音     | 共用捕获服务返回实际音轨、范围及限制原因。Windows 主进程从授权窗口解析进程，WASAPI 捕获所选应用进程树；整屏优先排除 Tescord。Web 检查浏览器实际返回的音轨，无法确认窗口隔离时不使用系统声音替代。    |
| 原图         | 私有附件流式下载、可靠字节进度、解码后替换预览；关闭、换图及换账号取消；失败保留预览并可重试。                                                                                                       |
| 强制媒体加密 | 所有语音及共享音频使用独立流随机密钥和计数器；优先 Worker ScriptTransform，兼容旧编码流接口；ECDH/ECDSA 签名密钥信封、设备指纹信任、成员版本轮换及确认超时；不支持或失败拒绝连接。视频使用同一协议。 |
| GIF 图标     | 后端 Sharp 解码、帧预览、所有帧统一裁剪为 512×512 GIF 或所选帧 PNG；保留延迟和循环。前端触控裁剪、播放暂停、选帧；减少动态效果时显示静态帧。                                                         |
| 移动资料卡   | Drawer、资料卡、菜单、确认窗、Toast 层级统一；资料卡打开期间暂停底层手势，关闭保留成员列表位置。                                                                                                     |
| 移动排序     | 管理员常驻 44px 手柄，触摸拖拽仅在手柄启动；名称区域 600ms 长按，8px 位移、滚动、多点触控和取消终止；桌面鼠标排序保留。                                                                              |
| 消息分页     | 频道/DM/群聊 before/after 分页，首次及最新 100 条、增量 50 条；边缘 Loading、错误重试、可见消息锚点、实时去重和 sequence 排序、缺口同步及代次隔离；旧数组响应兼容。                                  |

新增契约集中在 `packages/types/src/communication.ts`、`desktop-capture.ts`、`media-encryption.ts` 和 `media-frame.ts`，五种语言的对应业务域及错误字典同步更新。

Electron 回归同时修复了会话窗口过渡的相邻问题：启动时以原生记住登录会话核对窗口缓存标记；同模式通知保持幂等，反向切换创建新的认证 renderer，旧窗口的关闭及延迟回调不得清理新窗口。认证初始化采用单次共享任务，完成原生迁移后以原生令牌为准，防止未记住密码的会话从浏览器 sessionStorage 恢复。测试覆盖记住登录、取消记住后重启、快速重新登录及登出，并按新窗口身份验证清理结果。

WebKit 回归还修复了启动能力检测：降噪节点在缺少 AudioWorklet 时可安全导入，RNNoise 模块仅在实际初始化时加载；编解码检测在调用依赖库之前检查 WebRTC 接口。初始导航占位值不会覆盖首次公会选择，图片解码错误使用本地化提示，全局媒体 Toast 加入状态播报及安全区适配。

多人真实媒体回归定位到同时 Offer 的协商冲突及初始化轨道的竞态。P2P 现在按连接串行执行 SDP/ICE，以固定用户顺序决定冲突让步，使用请求编号拒绝过期、无编号及重复 Answer；重新打洞的每次 Offer 均有独立超时，提前到达的候选有界缓存并按 ICE ufrag 筛选。麦克风轨道在启用 Mesh 前绑定，连接身份和 Mesh 代次隔离旧回调。协商策略参考 [MDN Perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)。真实三设备测试主动持有 Offer、验证多次超时重试、强制碰撞并注入非法旧响应，要求每个方向有 Opus RTP、非零接收音频及实际加解密计数，退房后轮换继续播放。

## 安全边界

| 入口                        | 身份和资源                                                                      | 授权与拒绝                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 媒体上下文及密钥信封 HTTP   | JWT、有效登录会话、已 IDENTIFY Gateway 会话、本人的未撤销设备、当前频道/DM 通话 | 校验 CONNECT/DM 参与、活动会话、当前成员版本、发送流、签名和指定收件人；无令牌、伪造/过期令牌、跨会话/频道、旧协议、撤销和封禁拒绝。服务端只存储密文信封。                          |
| Gateway/Cloudflare 媒体发布 | 已识别会话、活动频道/通话、v2 媒体上下文                                        | 加密能力、完整名单和密钥确认不足拒绝；成员变化暂停发送并轮换，超时移除不具备协商条件的参与者。                                                                                      |
| Electron 捕获 IPC           | 受信任 renderer、主进程 desktopCapturer 画面源、单次短期授权                    | HWND 对应进程由主进程及原生模块解析；不接受 renderer 指定 PID；来源变化、失效窗口及销毁清理捕获、端口、Worklet 和音轨。                                                             |
| GIF 上传及处理              | JWT、本人未绑定的暂存上传、目标公会                                             | 处理前后均校验管理权限；不接受任意 URL；10MiB、300 帧、原始解码像素 4000 万、并发 2、排队 8、超时 30s；失败保留旧图标，取消仅清理本人未绑定上传。处理后的图标另有明确有界输出限制。 |
| 原图附件                    | 当前账号的私有附件访问与签名                                                    | 保留权限检查、签名续期、缓存、取消；过期/篡改签名和直接静态访问由现有私有附件边界拒绝。                                                                                             |
| 消息分页和排序              | JWT、频道或会话归属                                                             | 沿用阅读/会话参与授权，游标限定当前资源；排序仍在服务端验证管理权限。                                                                                                               |

## 媒体封装与兼容

音频载荷按 [RFC 9605](https://www.rfc-editor.org/rfc/rfc9605.html) 使用 AES-256-GCM、HKDF-SHA512 及认证后的重放窗口；测试包含标准附录 C.3 的公开密文向量。每次重连或重新发布使用新的随机发送流密钥与 KID，不复用房间共享密钥的计数空间。

视频的浏览器 RTP 分包器需要读取部分编解码头部。H264 保留三个 Exp-Golomb 路由字段的完整字节并认证，避免固定长度截断 slice/PPS 信息。实现保留必要的 H.264/VP8 等路由头并纳入认证，H.26x 密文使用 RBSP 转义，AV1 使用携带 SFrame 的 OBU 封装。实际测试读取协商 codec、双向 RTP、加解密计数及接收端解码像素，避免仅凭 SDP 或本地预览判断成功。实现参考浏览器分包行为：[WebRTC H.264 packetizer](https://webrtc.googlesource.com/src/+/07efe436c9002e139845f62486e3ee4e29f0d85b/modules/rtp_rtcp/source/rtp_format_h264.cc)。

移动画面专项要求每种编码器持续解码多帧，同时记录 RTX `apt` 协商和独立 SSRC。调查中，测试仅保留主 codec 而剔除 RTX，导致 H264/AV1 在异步 transform 下仅首帧解码；逐帧 SHA256、key/delta 和时间戳对照确认编码载荷原样恢复。恢复 RTX 后四种编码器通过持续解码断言，生产唯一的 `setCodecPreferences` 路径也保留 repair codecs。[WebRTC RTP 文档](https://webrtc.googlesource.com/src/+/HEAD/pc/g3doc/rtp.md)说明有 RTX 时探测 padding 使用其独立序号流；没有 RTX 时与媒体共用序号。这是本地对照结果，Cloudflare 目标路径的 RTX/分包行为仍需验收。

当前 Cloudflare 路径使用本实现。旧 LiveKit SDK 内置加密封装与新格式不兼容，其旧 token 入口拒绝连接；恢复该备用服务需要单独完成加密适配，不能绕过强制加密。旧客户端同样拒绝媒体连接。

[退出重试取消证据](acceptance/communication-2026-10-06/canceled-retry.json)要求释放迟到 ICE 请求后仍为 0 个连接，旧重试不会在退出后恢复媒体资源。

Windows 应用进程树 loopback 按 [Microsoft ApplicationLoopback 要求](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)检测系统能力（build 20348 起）。无法获得应用级捕获时允许仅共享画面，并提示实际原因。浏览器 `windowAudio`/`systemAudio` 是提示，必须以实际音轨和可确认的范围为准。

## 数据库和上线边界

SQLite 与 PostgreSQL schema 同步增加 `StreamMediaKeyEnvelope`。正式 PostgreSQL 增量迁移位于 `apps/server/prisma-postgres/migrations/20261006000000_stream_media_encryption/migration.sql`，保留旧 DM 信封表。测试仅使用隔离临时 SQLite，未对现有业务库执行 push/reset。PostgreSQL schema 差异校验不等于在目标 PostgreSQL 上成功执行迁移。

目标部署须另行备份并验证恢复、审查并执行迁移、同步升级服务端与客户端、重新加入通话，再完成目标环境验收。

媒体验收通过 transport 的 [selectedCandidatePairId](https://developer.mozilla.org/en-US/docs/Web/API/RTCTransportStats/selectedCandidatePairId)读取实际选中的 ICE pair，并在连接、双向 RTP、非零音频及 ICE 证据同时就绪后记录结果。多人协商专项连续 3 次通过（加上 setup 共 4 项），[重复验收证据](acceptance/communication-2026-10-06/three-device-mesh-repeat.json)记录 2 次无应答重试、强制碰撞、旧/缺失编号响应及 3500ms ICE 配置延迟。

## 本地验证

完整 Chromium、WebKit 和 Electron 已完成。最后的退出重试守卫及计数证据在三设备专项中复核；格式门禁在证据归档后通过。早期失败日志保留供追溯，最终结果以下表和日志为准。

| 命令 / 验证                                                                                                                          | 结果                                                             | 证据                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm test:e2e`                                                                                                                      | 310 通过、0 失败；含双向音频、持续视频解码和多语言               | [日志](../test-results/communication-validation/test-results-full-e2e.log)            |
| `pnpm exec playwright test e2e/media-encryption-device-mesh.spec.ts --repeat-each=3 --output test-results/final-mesh-validation`     | 三设备专项连续 3 次通过，加 setup 共 4 项；含取消重试            | [日志](../test-results/communication-validation/test-device-mesh-validation.log)      |
| `pnpm exec playwright test e2e/media-encryption-real-rtp.spec.ts --grep impairment --output test-results/audio-recording-validation` | 4 组录音专项通过，加 setup 共 5 项                               | [日志](../test-results/communication-validation/test-audio-recording-validation.log)  |
| `pnpm format:check`                                                                                                                  | 通过；两份 `.mts` 额外核对通过                                   | [日志](../test-results/communication-validation/format-check-validation.log)          |
| `pnpm build`                                                                                                                         | 4/4 workspace 构建通过，0 TypeScript 错误                        | [日志](../test-results/communication-validation/build-validation.log)                 |
| `pnpm exec playwright test --config playwright.communication-webkit.config.ts`                                                       | 11 通过、0 失败，iPhone 13 视口；不替代真实 iOS                  | [日志](../test-results/communication-validation/test-webkit-validation.log)           |
| `pnpm test:e2e:electron`                                                                                                             | 3 通过、0 失败、1 跳过；未提供 `TESCORD_E2E_PACKAGED_EXE` 安装包 | [日志](../test-results/communication-validation/test-electron-validation.log)         |
| `pnpm test:security-media`                                                                                                           | PASS：协商、解密、重放、篡改和禁止明文发送                       | [日志](../test-results/communication-validation/test-security-media-validation.log)   |
| `pnpm --filter @tescord/server exec tsx ../../scripts/test-media-encryption-crypto.mts`                                              | 9 通过、0 失败，含 RFC 9605 公开向量及 H264 变长字段             | [日志](../test-results/communication-validation/test-media-crypto-validation.log)     |
| `pnpm --filter @tescord/server exec tsx scripts/test-media-encryption.mts`                                                           | 7 通过、0 失败；隔离 SQLite                                      | [日志](../test-results/communication-validation/test-media-registry-validation.log)   |
| `pnpm --filter @tescord/server exec tsx ../../scripts/test-guild-icon-processor.ts`                                                  | 46 个断言通过                                                    | [日志](../test-results/communication-validation/test-gif-processor-validation.log)    |
| `node scripts/test-display-capture-security.mjs`                                                                                     | 20 个断言通过                                                    | [日志](../test-results/communication-validation/test-capture-security-validation.log) |
| `apps/desktop/node_modules/electron/dist/electron.exe scripts/test-display-capture-native.cjs`                                       | 3 项真实 WASAPI 检查通过                                         | [原生证据](acceptance/communication-2026-10-06/native-capture-proof.txt)              |
| `pnpm --filter @tescord/server exec prisma migrate diff --from-empty --to-schema-datamodel prisma-postgres/schema.prisma --script`   | 离线 schema 校验通过；未连接目标数据库                           | [日志](../test-results/communication-validation/postgres-schema-validation.log)       |

Windows 原生测试使用不同应用播放 440Hz 和 880Hz，Tescord 播放 220Hz。窗口捕获中所选应用 440Hz 振幅约 0.01250，其余应用 880Hz 约 0.00000512；整屏捕获同时收到 440/880Hz，Tescord 220Hz 约 0.00000733。失效 HWND 被拒绝，停止捕获正常完成。

[Electron 实际加密接收证据](acceptance/communication-2026-10-06/native-encrypted-rtp-proof.json)记录应用声音经独立 renderer 之间的 P2P：Opus、host/host ICE、接收 9223 RTP 字节、46 个解密帧、RMS 0.00901、播放状态为 true；接收所选应用 440Hz 与另一应用 880Hz 相差约 64.6dB。这是本机原生捕获及接收端采样证据，不能证明公网 TURN/SFU。

编码帧压力测试使用同一 `noisy_2s_48k.wav` 循环输入并保存 source/received WAV。本轮 0/1/3/5% 编码帧丢弃下，录音相关性估计延迟分别为 40/35/22/49ms，concealment events 为 1/3/10/15；这些是本地单次观测，不是实际网络丢包或稳定网络额外延迟的验收结论。音频保留在 `docs/acceptance/communication-2026-10-06/audio/encoded-impairment-*-{source,received}.wav`，[5% 接收音频](acceptance/communication-2026-10-06/audio/encoded-impairment-5-received.wav)及对应 JSON 指标保存到 `docs/acceptance/communication-2026-10-06`。

所有测试日志保存在本机忽略目录 `test-results/communication-validation`；媒体 JSON 证据另存于本目录下的 `acceptance/communication-2026-10-06`，避免后续 Playwright 清理覆盖。

## 待环境验收

- Cloudflare SFU、强制 TURN、公网 P2P、回退及重连：当前新增协议必须重新验收，历史版本的公网证据不能证明本次格式可用。
- 真实网络的 1%/3%/5% 丢包和抖动、同一人声录音在关闭/RNNoise/DTLN/DFN3 四模式的中断和延迟对照，以及稳定网络额外延迟不超过 100ms。自动化编码帧丢弃和本机 host ICE 不替代网络损伤验收。
- 真实 iOS 设备的 GIF 触控、原图、Drawer 和分页；WebKit/iPhone 视口仅为本地浏览器覆盖。
- 目标 PostgreSQL 迁移与备份恢复、签名 Windows 安装包内原生模块分发，以及非 Windows 声音捕获能力。
