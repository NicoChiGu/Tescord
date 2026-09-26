# Tescord Cloudflare SFU/TURN 目标验收与空实例交付

日期：2026-09-26（Asia/Shanghai）。目标：`tera@100.69.12.101`，公网入口 `https://tescord.terata.top`，源码版本 `d78793e`。运行镜像：server `1b13e2acb6c3`、web `fbe8c598cc21`。Web 镜像在 `e2b4eea` 构建；之后的 `d78793e` 仅改验收脚本。目标 Cloudflare 配置存于权限 `0600` 的 `docker/.env.cloudflare`，未写入此报告。

## 验收结果

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 4/4 workspace 构建通过 |
| `pnpm test:minio-compat` | ESM、CommonJS 通过 |
| `pnpm test:security-media` | 协商解密、重放/篡改拒绝、缺密钥拒绝通过 |
| `pnpm test:updater` | 13/13 服务测试及归档校验通过 |
| `pnpm test:e2e` | 145/145 通过 |
| 目标公网 Cloudflare 用例 | DM 呼叫 1/1；三人频道强制 relay 1/1，最后一次运行活跃媒体阶段控制台错误为 0 |
| 打包 Windows Electron `file://` 公网脚本 | 登录与 30 天会话恢复、双向 Opus、摄像头 VP8 解码、屏幕视频及共享音频通过；脚本退出码 0 |
| 空实例只读复验 | `/health` 200，匿名公会 API 401，登录页呈现且页面异常 0，旧验收管理员登录 401 |

三人浏览器验收使用真实 `RTCPeerConnection`、公网 Cloudflare SFU 和强制 TURN relay，并用合成麦克风/摄像头信号提供可重复媒体输入。[媒体统计](media-stats.json)记录三端 selected candidate 为 `relay`、双向持续增长的 Opus RTP、摄像头和屏幕 VP8 接收字节及解码帧、麦克风和摄像头切换后的持续接收。[接收画面](media-receiver.png)和[最终空登录页](empty-login.png)为截图。此前还通过普通公网 ICE 路径、阻断 P2P 后的 SFU 回退、断网恢复、服务重启自动恢复和退出资源释放；这些运行的终端结果在本次会话中，原始 Playwright 临时目录被后续运行覆盖，未全部留存为独立文件。DM 用例确认 E2EE 发送/接收变换器挂接及双向 Opus RTP，DM 专项截图和统计同样被后续 Playwright 运行覆盖。

有一次目标三人用例在首个连接的 25 秒断言上失败；当时客户端仍处于首次 ICE 的 30 秒窗口。验收断言已延长至覆盖客户端的一次自动重试，随后独立运行和与 DM 联合运行通过。一次联合运行在成员退出附近出现远端订阅的 403 控制台日志；最后一次带活跃阶段控制台错误断言的运行通过。此类边缘时序仍建议持续监测。自动化使用合成设备，未覆盖真实声卡、摄像头或屏幕驱动的人工体验。Windows 更新签名公钥未配置，本次服务验收不代表正式桌面发行认证。

## 清理与备份

进入维护模式并停止 API 写入后，生成成对备份：

`/home/tera/apps/tescord-deploy-backups/20260926T051522Z-final-empty`

目录权限 `0700`，数据库、MinIO、配置和校验文件为 `0600`，`SHA256SUMS` 已全部通过。PostgreSQL 自定义格式备份在独立 PostgreSQL 容器恢复后，19 张业务表逐表计数与原库完全一致；MinIO 备份在独立容器恢复后，19 个对象、38,219,784 字节及全部对象内容 SHA-256 指纹一致。原始对象内容指纹为 `bb8e29a9ef069f467f6c1f8231c1dbd18209370ee7e3c8410c2e1206f5100e92`。备份目录内保存清理 dry-run、前后计数、镜像 ID、源码提交、截图、媒体统计和 Playwright 报告。

清理前：136 个账号、67 个公会、160 个频道、26 条消息、18 条附件记录；`tescord-assets` 有 19 个对象；专用 Redis DB 有 138 个键。按 19 张业务表白名单在事务中 `TRUNCATE ... RESTRICT`，删除该 bucket 的 19 个对象并清空 Tescord 专用 Redis DB。清理后 19 张业务表均为 0，bucket 对象为 0，Redis DB 为 0；`SystemSetting` 的 4 条配置和 `_prisma_migrations` 的 3 条记录保留。维护模式已解除，API、Web 与公网健康检查正常。验收管理员及临时密码文件已删除，没有在清理后创建新账号。

首次调用 MinIO SDK `removeObject` 时遇到 `qs.stringify is not a function`，该调用未删除任何对象。随后使用限定 bucket 的 S3 SigV4 DELETE 完成清理，并核对对象数为 0。当前业务代码没有使用 `removeObject`，但这一 SDK 路径仍需在以后启用附件删除功能前修复并测试。

## 创建首位管理员

在目标机交互终端执行：

```sh
ssh -t tera@100.69.12.101 'cd /home/tera/apps/tescord && ./docker/scripts/create-admin.sh USERNAME EMAIL'
```

脚本通过 `podman exec -i` 调用服务端创建逻辑，隐藏输入并二次确认密码。只创建 `SUPER_ADMIN` 与审计记录，不自动创建公会或频道；重复用户名或邮箱会失败。可用 `--container NAME` 明确指定 API 容器。目标验收前已验证脚本创建、登录、管理员权限及重复账号拒绝；最终空实例未保留测试管理员。
