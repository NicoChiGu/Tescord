# 未 push 提交审查与 Cloudflare Compose 部署

本轮按用户指令审查 `main` 上尚未推送的三个提交：`08d41b5`、`2e3db55`、`8eddf1b`。远端及目标部署前均为 `6fbb37d81037a07e3011c395ae1876492bb846c5`，本地初始工作区干净。目标为 `tera@100.69.12.101:/home/tera/apps/tescord`，使用 rootless Podman 及 `docker/scripts/compose-cloudflare.sh`。

## 审查与修复

- 检查共享类型、音频输出及输入切换、P2P 地址分类、连接统计、图片预览、五语言字典、个人及公会表情上传与验证脚本。
- 修复失效的持久化输出设备在无标签枚举时导致输出不就绪的边界；仅对 `NotFoundError` 自动恢复默认设备，权限拒绝仍保持静音及原选择。新增浏览器回归在修复前失败，修复后通过。
- 表情认领绑定个人／公会范围，数据库写入失败释放认领凭据；删除接口等待物理文件移除。修复新增可达分支的权限错误码，移除依赖现有业务库、缺少 finally 清理的验证脚本。
- 连接详情的新增头像回退改为本地图标，HD 显示使用五语言资源，候选统计移除新增 any，替换音频分析节点时释放旧节点。恢复被构建过程固化目标地址的桌面生成配置；未将本轮本地 E2E 地址写入发布源码。
- 两处原有 E2E 选择器仍引用已变更的旧文案，改用现行字典及稳定测试 ID。
- Antigravity 提供只读第二意见。首次报告因 15 分钟超时部分返回，同一会话的窄范围复核正常完成；其全员静音、跨公会越权等过度结论已撤回。本报告仅采纳 Codex 已验证的发现。
- 未修改数据库模型或迁移。未认领上传的持久存储配额／定期回收属于既有通用上传链路后续工作，本轮的格式、文件大小、身份、授权及凭据边界验收不等价于已完成全局存储配额治理。

## 本地凭据

原始执行日志位于受 Git 忽略的 `release/review-20261010-*`，浏览器截图、trace 及统计位于 `test-results/`；不提交含临时认证信息的浏览器档案。

| 门禁                                             | 本轮结果                                                   | 凭据                                                             |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| pnpm build                                       | 4/4，零 TypeScript 错误；默认引擎及 Cloudflare 构建均通过  | review-20261010-build-final.log                                  |
| PostgreSQL／SQLite 模型对齐                      | PASS                                                       | review-20261010-schema.log                                       |
| 五语言修改域键名一致                             | 5 域 × 5 语言 PASS                                         | review-20261010-i18n-keys.log                                    |
| 格式与差异                                       | PASS；格式比较基准显式使用 Tescord/main                    | review-20261010-format-check.log                                 |
| IP 分类、对抗及复核                              | 10/10、5/5、5/5                                            | review-20261010-ip.log、adversarial.log、ip-reverify.log         |
| SFrame／媒体安全                                 | PASS                                                       | review-20261010-security-media.log                               |
| 依赖补丁回归                                     | 17/17                                                      | review-20261010-dependency-tests.log                             |
| 表情签名、过期、路径、范围、回滚、重用及物理删除 | 22 条断言 PASS                                             | review-20261010-emoji-claims.log                                 |
| 新增输出恢复／权限及表情会话测试                 | 已纳入最终 402 项并全部 PASS                               | review-20261010-output-recovery-final.log、recovery-security.log |
| 完整 Playwright 初次运行                         | 413/416；两处旧选择器及一处构建资源空窗失败，保留原始结果  | review-20261010-e2e.log、e2e-results.json                        |
| 最终 Chromium 交互复验                           | 402/402，10.6 分钟，零重试／跳过                           | review-20261010-ui-final.log                                     |
| Chrome／Edge 输出专项                            | Chrome 16/16、Edge 16/16；均零重试                         | review-20261010-audio-chrome.log、audio-edge.log                 |
| Electron                                         | 4/4 PASS；安装包用例因未提供产物跳过 1 项                  | review-20261010-electron.log                                     |
| 生产依赖审计                                     | 0 项漏洞，退出码 0                                         | review-20261010-audit-prod.json                                  |
| 完整工作区原始审计                               | 1 项 high，退出码 1；braces 3.0.3 版本号告警，补丁回归通过 | review-20261010-audit-full.json                                  |

完整 Playwright 的初次运行保留失败记录。其中一轮三人并发／轮换测试在重建正在服务的预览目录期间失败，trace 确认 `sframe.worker-DlrubWDh.js` 于 `2026-10-10T07:30:49Z` 返回 404。该失败属于本轮操作造成的资源空窗；后续构建与浏览器验收串行执行，不降低加密、RTP、PCM 或成员断言。

另一次 UI 诊断轮将 Cloudflare 构建提供给使用 LiveKit 桩的现有本地用例，394/402 通过、8 个连接等待用例失败，记录在 review-20261010-ui-config-mismatch.log 及其 JSON、test-results/review-ui-final/。随后使用这些用例要求的默认构建重新运行全部交互用例；Cloudflare 模式通过独立公网 SFU／TURN 专项检验。诊断轮不计为通过，不把桩的连接成功当作实际 Cloudflare 媒体证明。

三人二十轮并发／轮换专项重新执行 2/2 PASS（含 setup），5.5 分钟、零重试；原完整运行的其余 16 个多人用例均已通过。最终交互 402/402 PASS，10.6 分钟。分别保留原失败及复验结果，不把不同执行轮冒充为单次全量无失败运行。

## 备份与隔离恢复

备份目录为 `/home/tera/tescord-backups/review-20261010-20261010T071046Z`。源码 bundle、PostgreSQL custom dump、MinIO／Redis 卷及 Compose／环境配置的 SHA-256 校验通过。环境文件权限为 0600。

PostgreSQL 恢复到无网络、无映射端口的临时容器，用户 5、公会 1、频道 6、消息 75、迁移 9 与源库一致，临时容器已删除。MinIO 恢复 150 文件、64,204,458 字节，150 项哈希一致；120 项与现网一致，其余 30 项仅为运行元数据，对象数据差异 0。临时恢复目录已删除。该检查不扩大为完整 S3 服务恢复证明。

保留 server／web 的 `rollback-20261010T071046Z` 镜像。未对业务库执行 db:push、重置或破坏性测试。

## 目标部署与清理

目标结果待完成后写入。使用增量 bundle 的本地／远端 SHA-256 与 git bundle verify，通过 fast-forward 更新源码，不向目标提供 GitHub 凭据。通过 Cloudflare Compose 构建、执行迁移及切换 server／web。

两个部署前表情基线轮分别为 `07c1be8262`、`356c98c5b4`。前者在 PowerShell UTF-8 BOM 解析处失败，后者在旧服务端表情预签名接口返回 500 处失败；修复脚本编码后保留失败凭据。两轮 cleanupExit 均为 0，精确删除各自账号及第二轮公会，所有业务资源残留 0，均未上传物理对象。

## 验收边界

不将同机浏览器、合成音频／视频或 Electron 源码启动验收扩大为实体麦克风／扬声器、独立公网网络、已签名安装器或完整三人／五人 20 轮 Cloudflare SFU/TURN P95 矩阵验收。原始完整审计仍未通过，不报告全部生产发布门禁通过。
