# Cloudflare Compose 部署与目标验收

用户在知悉此前完整媒体矩阵和原始审计结果后再次明确要求部署。本次目标为 `tera@100.69.12.101:/home/tera/apps/tescord`，使用 rootless Podman 和 `docker/scripts/compose-cloudflare.sh`；所有时间说明采用北京时间，备份目录中的时间戳为 UTC。

## 版本与备份

- 部署前版本：`a3ce088f2cdb339eda511262b664ff6f0ab2b633`。首次 server、migrate、web 镜像使用 `bced99287f802d6b2a4f576d78df2293df4b47a4`。
- 验收中发现屏幕发布就绪前查询观看人数的竞态，修复提交为 `30a868ddf786d3891010efd3ab49deef0f0ea8d9`；Web 镜像已使用该提交更新，后端协议及数据库模型未变化。
- 新备份：`/home/tera/tescord-backups/deploy-20261010-20261009T161953Z`。包括源码 bundle、Compose/环境配置、PostgreSQL custom dump、MinIO/Redis 卷归档、容器及镜像清单，全部 SHA-256 校验通过。
- PostgreSQL 在独立无网络、无端口的临时容器中恢复成功。源库及恢复库均为用户 5、公会 1、频道 6、消息 71、迁移 9；临时容器已删除。
- MinIO 恢复 128 个文件、61,381,717 字节，逐文件哈希一致；122 个文件与现网一致，其余 6 个差异均为运行元数据，对象数据差异 0。临时恢复目录已删除；未将文件恢复检查扩展为完整 S3 服务恢复验收。
- 保留部署前 server/web 的 `rollback-20261009T161953Z` 镜像。环境文件权限始终为 `0600`，没有向目标提供 GitHub 凭据；增量 bundle 本地/目标哈希及 `git bundle verify` 均通过。

## 执行与修复

`compose-cloudflare.sh build server migrate web` 成功后，执行迁移服务和 server/web 容器切换。迁移退出码 0，`prisma migrate status` 确认 9 个迁移已应用、无待应用迁移。未执行 db:push、数据库重置或破坏性业务库测试。

初次切换后的公网 `/healthz` 为 200，匿名 `/api/users/@me` 为 401；页面加载 `index-CLd4cUkE.js`，与初次镜像构建相符。后端镜像中的 Gateway、媒体加密服务、SFrame 源码及 braces 补丁与对应源码 SHA-256 一致。

Web 更新后，目标源码为 `30a868d`，工作区干净，页面资源为 `/assets/index-3hL-fosP.js`，公网健康与匿名鉴权检查仍分别为 200/401。运行镜像为 server `07627ef45c0c`、web `417a40de8ca0`；迁移镜像 `d56768781d98` 退出 0。后续测试及文档提交不改变这两份运行镜像的源版本。

观看人数接口保持原授权边界：Bearer 登录身份、当前 SFU 会话及频道归属由服务端核验，不存在的直播仍拒绝。本次客户端将自身直播查询推迟到加密 RTP 的 `/tracks/ready` 确认之后；轨道未确认、替换或移除时不发查询，旧会话返回不写入当前状态。未新增跨端事件、展示文案或服务端授权例外。

`pnpm build` 为 4/4、零缓存；`pnpm exec playwright test e2e/cloudflare-sfu-negotiation.spec.ts --project chromium --retries=0` 为 37/37，包括 setup，35.9 秒。新增回归在修复前失败，证明其检测到提前查询。格式及差异检查通过。

公网屏幕延迟采样使用实际解码尺寸还原 640×360 的发送端标记坐标，保留至少 15 个有效时间戳样本断言。原脚本跳过宽度不足 640 的视频，导致已解码的 320×180/480×270 自适应视频无法采样。DM 测试使用页面已有的 `home-nav-button` 测试 ID；原 tooltip 文案并非按钮的 accessible name，先前失败发生于导航阶段。

## 目标验收、清理与边界

原始凭据位于忽略目录 `release/deploy-20261010/`，可能含短期测试认证数据的浏览器报告不提交。

普通 SFU 复验轮 `ec9ddc8ba3`：Playwright **1/1 PASS、1.6 分钟、零自动重试**，`testExit=0`、`cleanupExit=0`。与 TURN 轮执行相同的音频、摄像头/屏幕、设备切换、权限及资源释放断言，selected ICE 为 prflx，屏幕 640×360、readyState=4。30 个画面样本，中位 203ms、P95 225ms、首帧 5391ms。C 两次离开重入时，A/B 仍在频道，四份离开后接收端 PCM RMS 0.0370–0.0388，RTP 与加解密计数增长；该场景结束时 Gateway 同步请求/响应均为 60，REST sync 为 0。

强制 TURN 轮 `008bd31b40`：Playwright **1/1 PASS、1.9 分钟、零自动重试**，`testExit=0`、`cleanupExit=0`。三浏览器 Opus 音频双向 RTP 持续增长，selected ICE 为 relay，摄像头、摄像头切换、屏幕共享 VP8 解码/播放、观看者踢出、越权访问 403 及离开资源释放均通过；控制台仅出现测试预期的那一条 403，未出现其他错误。屏幕 320×180、readyState=4，30 个时间戳样本，中位 343ms、P95 389ms、首帧 5505ms。这是同机画面延迟，不是 RTT。

该轮 C 离开后 A/B 持续五次音频检查，再重入，重复两轮；双方仍在语音且加密/解密、RTP 计数增长。离开后的四份接收端快照均为 Opus/relay，PCM RMS 0.0368–0.0381，高于 0.0001 门槛。测试音源为浏览器生成的 440Hz 波形，关闭降噪、AEC 和 AGC，仅证明合成媒体的实际解码播放。采样时 Gateway 加密同步请求/响应均为 71，REST `/media-encryption/sync` 请求 0；这组计数在成员场景结束时记录，不代表整轮测试总数。

DM 诊断轮 `60e357a507`：**0/1 PASS、1 FAIL**。发起端发送 CALL_OFFER 并收到 state=ringing 的 CALL_STATE_UPDATE，被叫页面没有收到 CALL_OFFER，15 秒内未出现接听按钮；双方 Gateway 状态均为 connected，发起端 callState=connecting，被叫 callState=idle。密钥/设备 API 返回 200，未获得通话加密媒体证据，原因尚未定位，不能报告 DM 目标验收通过。已精确删除该轮 3 个测试账号及全部关联资源，cleanupExit=0。

本次共 10 轮，包括 1 次中断、2 次通过及 7 次失败；每轮均根据唯一 marker 和已记录 ID 清理，cleanupExit 全部为 0。最后以 30 个精确账号 ID 确认 PostgreSQL 中账号均已删除，再移除对应的 30 条 Redis presence 和 4 个 online_users 成员，两个残留数均为 0，未清空业务缓存。最终业务计数恢复到部署前基线：用户 5、公会 1、频道 6、消息 71。

清理镜像前验证运行容器与镜像引用，删除未被容器使用的 `rollback-20261008` server/web 旧镜像，再执行 `podman image prune -f`。镜像总数由 84 降到 40，显示占用由 8.525GB 降到 2.904GB，约回收 5.62GB；dangling 查询为空。当前运行镜像与完整的部署前 `rollback-20261009T161953Z` server/web 镜像均保留。没有执行全量 system/volume prune。清理后 server、web、PostgreSQL、Redis、MinIO 健康，cloudflared 运行，迁移容器退出 0，本地 `/healthz=ok`。

已保留的失败轮次：首次三浏览器组合采样失败；诊断轮的 C 两次离开重入及加密音频检查通过，但旧屏幕采样因分辨率假设失败，并捕获发布前观看人数 404；首次 DM 在旧导航选择器处超时；修改导航后，DM 未出现接听界面；更新 Web 后，一次离开后的即时 PCM 快照为 0.000025，低于 0.0001 门槛。随后采用现有多人验收工具的持续轮询方式，同时保留门槛与 RTP/加解密计数增长断言。中断轮 `99741fc0d8` 不计为通过，已单独执行精确清理。普通 SFU 轮 `5f86062caa` 因 SSL 请求错误、ICE 超时及加入界面超时失败。所有已结束轮次清理退出码均为 0，账号、公会、邀请码、频道、DM 参与者及媒体密钥残留均为 0。没有通过跳过断言、过滤非预期错误或自动重试将失败改为通过。

生产依赖审计为 0 项漏洞、退出码 0。完整工作区原始审计仍有 braces 3.0.3 的 1 项高危版本号告警，源码补丁已固定并验证，CI 原始高危审计步骤尚不能报告通过。本次目标专项也不替代此前未通过的完整三人/五人 20 轮 SFU/TURN 压力与 P95 矩阵；同机浏览器及合成媒体不证明独立网络、实体麦克风/扬声器或打包安装器验收。
