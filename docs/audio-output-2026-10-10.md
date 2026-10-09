# 音频输出修复验收记录（2026-10-10）

## 变更

- 浏览器与 Electron 共用输出控制：P2P 语音、屏幕声音、Cloudflare 播放、LiveKit 与私信通话应用当前拒听、输出音量和输出设备。
- 个人音量保留 0–200%，经独立 GainNode 后再应用全局音量。拒听、个人静音与输出音量 0% 保持静音。
- 闭麦关闭采集输出轨道；拒听自动闭麦，解除拒听保留麦克风静音状态。
- 设备切换串行执行，成功后提交选择；失败保留旧路由与选择。输入选择核对原始采集轨道的实际 deviceId。
- 设置与快捷菜单共用设备枚举。设备拔除回到系统默认。测试声音与提示音使用同一输出设备；设置测试声音实时应用输出音量并在停止或关闭设置时释放。
- 新增错误文案同步五种语言。
- LiveKit 解码元素不再由 SDK 管理；实际 `Room.startAudio()` 恢复后仍保持静音。SDK 与应用各自的播放恢复均保留拒听。
- 私信协商优先读取匹配 call ID、频道的当前通话对象，避免 Gateway 回调使用旧私信列表而漏掉接收方。

## 验证方法与边界

音频专项通过两条真实 Chromium RTCPeerConnection 接收加密 Opus 音频，向实际播放服务输入接收轨道，在最终输出 GainNode 之后采样 PCM。记录 selected ICE、接收 RTP 字节、实际 codec 与 SFrame 计数。独立采样另一用户的 GainNode，检查调整目标用户音量不会改变另一用户。麦克风静音测试同时检查加密链路接收的 PCM 与实际采集输出轨道 enabled 状态。

Cloudflare 与 LiveKit 专项验证本地接收后的播放图，未连接公网 SFU。媒体元素 sink 回退使用原生 Chromium API；两个指定设备、失败回滚和拔插使用枚举与 sink 调用夹具。此证据不能代替物理设备听测。

私信专项使用真实签名账号、Gateway、设备密钥注册和 P2P 协商，操作通话舞台的闭麦与拒听按钮，在最终输出之后采样。覆盖三次重复开关及保持拒听挂断后重新呼叫；重建后的 RTP 和加密解码非零，最终 PCM 为零。挂断后检查闲置播放上下文释放。

入口仍为现有已授权的频道或私信媒体会话；身份、房间归属和访问控制保持原有 Gateway 与媒体服务校验。新增控制仅操作本地接收后的播放资源，不增加服务器接口、数据库迁移或客户端授权条件。加密能力不足仍拒绝连接；安全媒体专项保留解密、重放、篡改与拒绝明文断言。

测试后端由 `scripts/run-e2e-server.ts` 创建隔离数据库，不对业务数据库执行重置或 db:push。

## 执行记录

日志目录：`test-results/audio-output-validation/`。

专项浏览器配置为 `playwright.audio-output.config.ts`，包含音频控制、设备设置和真实私信共 14 项。PowerShell 设置 `$env:TESCORD_E2E_BROWSER_CHANNEL = "chrome"` 或 `"msedge"`，执行 `pnpm exec playwright test --config playwright.audio-output.config.ts --project chromium --reporter=list`。测试项目与默认配置共用隔离后端、签名登录及原有媒体权限参数。

| 命令／环境                                | 结果                                       | 日志                                    |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `pnpm build`                              | 4/4 构建任务通过，TypeScript 零错误        | `build.log`                             |
| `pnpm test:security-media`                | 解密、重放拒绝、篡改拒绝、发送失败关闭通过 | `security-media.log`                    |
| Chrome 154.0.8037.99 音频、设备、私信专项 | 14 通过、0 失败                            | `chrome.log`                            |
| Edge 155.0.4283.45 音频、设备、私信专项   | 14 通过、0 失败                            | `edge.log`                              |
| `pnpm test:e2e:electron --reporter=list`  | 4 通过、0 失败、1 跳过（未提供安装包 EXE） | `electron.log`                          |
| `pnpm test:e2e --reporter=list`           | 405 通过、6 失败，退出码 1（34.8 分钟）    | `full-e2e.log`、`full-e2e-results.json` |
| 失败文件的 Playwright 专项复测            | 14 通过、0 失败，退出码 0（41.7 秒）       | `ui-diagnostics.log`                    |
| `pnpm format:check`、`git diff --check`   | 通过                                       | `format.log`、`diff-check.log`          |
| 五语言错误字典键名核对                    | 全部 62 键，完全对称                       | `i18n.log`                              |

Chrome／Edge 合计 12 组 PCM 数据：50%／100% 比例 0.4992–0.5026，200%／100% 比例 1.9994–2.0043；个人静音、输出音量 0%、拒听、拒听时加入轨道均测得零。selected ICE 为 succeeded，实际编解码为 audio/opus；各组接收 RTP 30,722–32,882 字节，加密与解密计数 304–325。原始数据保存在各浏览器的 `*-pcm.json`，汇总为 `browser-metrics.json` 与 `browser-metrics-summary.json`。

`chrome-dm-pcm.json`、`msedge-dm-pcm.json` 记录真实私信闭麦、拒听及保持拒听重新呼叫的输出、轨道状态、RTP 和加密计数。LiveKit 数据还记录实际 SDK 恢复后 `decoderMuted: true`、SDK 附着元素 0、最终输出 0。

设备专项检查实际 sink 调用参数、快速切换的提交顺序、失败回滚、默认路由、权限变化、拔除、重开设置与刷新后的持久化；输入专项检查原始采集轨道的 deviceId，拒绝权限后保留旧流与选择。测试声音检查选择的 sink、实时音量、停止与卸载后的上下文关闭。不支持 sink API 的浏览器禁用选择并回到系统默认；旧音量偏好保留迁移兼容。

全量运行中的 17 项多人媒体测试全部通过，包括三／五设备连续加入、持续收发、离开重入、设备接管，各 20 轮并发加入与轮换，以及同步丢失、旧快照和旧密钥事件隔离。证据保存在 `test-results/default-e2e/` 与 `test-results/media-encryption-proof/`。此矩阵为本机 P2P，不能证明公网 SFU 或 TURN 可用。

本轮全量的 6 项失败分布于 `seven-features-enhancement.spec.ts`、`stream-topology-mode.spec.ts`、`video-codecs.spec.ts`、`voice-channel-interaction.spec.ts`、`voice-channel-topology-mode.spec.ts`。独立复测首先为 13 通过、1 失败；剩余频道进入失败确认是单用户 P2P 夹具未转换重新获取的频道列表，真实 SFU 配置覆盖了夹具配置。补齐 `/api/guilds/:id/channels` 的 GET 读取路径后，上述完整文件 14 项全部通过，未降低断言。其他 5 项在独立复测中未复现。保留 `ui-diagnostics-before-channel-list-fix.log` 与首次全量失败截图；未把专项复测改记为全量 411 项通过。

`full-e2e-results.json` 将实际执行的 411 项逐一与 UTF-8 测试清单核对，记录真实通过／失败状态、命令退出码及音频源码哈希；原始全量日志的中文编码显示异常不影响结果计数，中文用例名可在该 JSON 中核对。测试后重新构建正常服务配置的桌面 Web 资源、Electron 与浏览器资源，日志为 `restore-desktop-web.log`、`restore-desktop.log`、`restore-web.log`。浏览器构建检查后，最后保留 Electron `file://` 可加载的相对 `./assets/` 产物，使用原有正式服务地址，日志为 `restore-desktop-web-final.log`。

修复过程中保留了失败日志：首次全量 405 通过、2 失败（旧音量键兼容及缺少设备枚举的夹具），修复后专项通过；新增私信实际通话暴露旧回调遗漏对方 ID，已修复并通过真实加密通话检查。发现 SDK 恢复绕过拒听后中止旧构建的全量运行，补充 SDK 回归再重跑。对应日志为 `full-e2e-before-fixes.log`、`targeted-before-fixtures.log`、`dm-before-peer-fix.log`、`full-e2e-before-sdk-resume-fix.log`、`full-e2e-before-dm-peer-fix.log`、`full-e2e-interrupted-388.log`；中止的运行不计为通过。

## 待环境验收

- Chrome、Edge 与 Electron 使用两套真实输出设备，核对声音实际路由、拒听和增益。
- 打包后的 Electron 安装程序与 EXE；当前自动化运行源码构建的 Electron。
- 公网 Cloudflare SFU、TURN 与跨主机媒体链路。

本次未进行生产部署。
