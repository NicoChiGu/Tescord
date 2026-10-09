# 依赖拒绝服务漏洞修复验收

## 修复范围

本次对应 `GHSA-vfj7-8cjw-p6xm`（braces 递归栈耗尽，高危）和 `GHSA-hp3w-g68c-fv3c`（sprintf-js 非法精度，中危）。入口是构建工具的 glob 字符串/AST，以及桌面依赖的代理日志格式化；本次不改 HTTP、Gateway、身份、资源授权或媒体加密协议，不接触生产业务数据库。

- Web：`tailwindcss -> chokidar -> braces`、`tailwindcss -> micromatch -> braces`、`tailwindcss -> fast-glob -> micromatch -> braces`。
- Desktop：`onnxruntime-node -> global-agent -> roarr -> sprintf-js`，以及 `electron-builder -> app-builder-lib -> @electron/get -> global-agent -> roarr -> sprintf-js`。

通过 `pnpm-workspace.yaml` 的固定 override 将 `global-agent <4.1.3` 更新到正式版本 4.1.3。新版不依赖 roarr/sprintf-js；锁文件移除旧日志依赖链，同时保留两个消费者实际调用的 `bootstrap` 与 `createGlobalProxyAgent` API。用真实本地 HTTP/HTTPS 源站及代理验证两个初始化入口，而不只核对版本号。

braces 尚无已发布的上游安全版本。本次保留原包身份、版本及许可，使用 pnpm 的 `patchedDependencies` 固定 `patches/braces@3.0.3.patch`；锁文件补丁哈希为 `a8e919e5d3ee4e9a94fc1e8d986ea5c3d2d308d32fb0ee0ac32da017ac744b36`。字符串解析限制容器嵌套（根节点计入 100 层预算）；compile/expand/stringify 先迭代验证 AST 深度，并拒绝循环或共享节点，防止直接 AST 入口绕过解析。parent/prev 回链不参与树遍历。超限输入返回 SyntaxError，与库原有长度限制的拒绝方式一致。

补丁保护已披露的递归栈耗尽路径，不承诺任意恶意正则、组合展开或无限大自定义 AST 的资源消耗安全。调用方仍须处理非法模式错误。正常嵌套、引用、转义、字符类、范围及文件匹配行为有回归覆盖；构建生成的 CSS 与修复前逐 SHA-256 比较一致。

## 当前验证

凭据均在忽略目录 `release/acceptance-20261009/`，原始浏览器报告不提交。

- 修复前针对深度缺口的 11 项断言均失败，证明回归可以发现原实现；见 `dependency-security-before.log`。
- `pnpm install --frozen-lockfile`：通过，见 `dependency-frozen-install.log`；补丁格式恢复后再次通过，见 `dependency-frozen-install-final.log`。仅生成 Prisma 客户端，未执行 db:push、迁移或业务库重置。
- `pnpm build`：4/4 成功，50.7 秒，见 `dependency-build.log`。
- `pnpm test:dependency-security`：17/17 通过、零跳过，见 `dependency-regression.log`；补丁格式恢复后复验仍为 17/17，见 `dependency-regression-final.log`。包含深度 4,000 的 brace/paren、8,000 层未闭合模式、混合嵌套、直接深 AST/循环 AST、三条真实依赖绑定、正常 glob 及两个代理集成场景。
- 两个代理场景均验证 HTTP 转发、HTTPS CONNECT、NO_PROXY 绕过以及严格 TLS 验证；只信任本地 Vite 测试证书，未关闭证书验证。源站、代理、socket 和隔离子进程均清理。
- CSS SHA-256 修复前后均为 `C076DB9334E0B09830471DF57528695214ED1275F10359F0384328CDC88BDFE2`，见 `dependency-css-comparison.json`。
- `pnpm exec playwright test --config playwright.electron.config.ts file-session.spec.ts native-capture-encrypted-rtp.spec.ts --retries=0`：桌面专项 3/3 通过、零跳过、零重试，2.0 分钟。覆盖原生凭据存储、IPC 来源/用户隔离和真实 Windows 指定应用音频经加密 P2P 进入独立接收渲染器，见 `dependency-desktop.log`、`dependency-desktop-exit.json`。未执行打包安装器验收。
- 首次 `pnpm exec playwright test --project chromium --retries=0`：379 通过、1 失败，10.2 分钟。失败用例在 DOMContentLoaded 后立即读取仅在登录初始化 effect 中暴露的 p2pStreamManager，未等待真实初始化；原始失败日志及截图已保存到 `dependency-browser-first.log`、`dependency-browser-first-artifacts/`、`dependency-browser-first-report/`。补正该用例的就绪等待，保留全部断言、默认超时及零重试，且不再把缺失的 fallback 方法默认为 false。
- 就绪等待专项 `pnpm exec playwright test --project chromium --grep "WebRTC 媒体与网络健康看板" --repeat-each=10 --retries=0`：11/11（setup 1 项、目标用例连续 10 次）通过，30.0 秒；见 `dependency-focused.log`、`dependency-focused-exit.json`。
- 完整 Chromium 项目复验：380/380 通过，零重试，9.8 分钟；执行时间为北京时间 2026-10-09 23:57:07 至 2026-10-10 00:06:54，退出码 0，见 `dependency-browser.log`、`dependency-browser-exit.json`、`dependency-browser-final-report/index.html`。包含五语言切换、实际加密 RTP、授权负向及核心界面用例；本次未重复未改动的 20 轮多人压力矩阵。

新增 `pnpm test:dependency-security` 与 CI 的依赖安全/代理兼容步骤，位于构建之后以使用新生成的本地测试证书。原 CI 审计步骤保持原有高危门槛。

`.gitattributes` 将 `patches/*.patch` 固定为 LF，稳定跨平台补丁内容；统一差异格式使用单空格表示空白上下文行，因此仅补丁文件关闭行尾空白检查，源码检查规则不变。尝试零上下文补丁时 pnpm 错放一处插入代码，安全回归立即失败；该尝试已撤回，恢复此前通过全部验收的补丁。安装后的 5 个修改源码文件与验收版本一致，见 `dependency-installed-source.json`，17 项安全/代理测试复验通过。三个补丁按 LF 规范化后的 SHA-256 均与锁文件一致，见 `dependency-patch-hashes.json`。构建上下文包含补丁文件，未依赖忽略目录中的编辑副本。

## 原始审计与发布边界

修复前 `pnpm audit --json --registry=https://registry.npmjs.org` 为 1 高危、1 中危；修复后为 1 高危、0 中危，退出码仍为 1，见 `dependency-audit-before.json`、`dependency-audit-after.json`、恢复执行后的 `dependency-audit-latest.json`。最新注册表查询仍为 braces 3.0.3。sprintf-js 已从锁文件和依赖树移除。braces 源码保护已经生效，但 npm 审计按上游 3.0.3 版本判断，无法确认本地补丁；没有添加忽略名单、伪造修补版、修改包名或降低审计级别。

因此不能报告“原始依赖审计全绿”或“全部发布门禁通过”，现有 CI 的原始审计步骤仍会因这项版本号告警失败。本次不部署；此前真实 Cloudflare 全矩阵仍有未通过用例。本地修补证明与尚未通过的上游版本号审计分别保留，待正式安全发行版发布后替换补丁并重新验证。

来源：[GitHub braces 安全公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[braces 上游问题及深度保护建议](https://github.com/micromatch/braces/issues/70)、[GitHub sprintf-js 安全公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)、[pnpm 补丁机制](https://pnpm.io/cli/patch)。
