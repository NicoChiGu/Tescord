# 降噪实现与验收状态

三种降噪模式只选用一个实际模型：浏览器 RNNoise WASM、DTLN/DeepFilterNet3 的本地 ONNX WASM Worker；Electron 使用同源 RNNoise Node-API 库和 ONNX Runtime Node utilityProcess。模型与 WASM 资源由 Web 构建目录本地提供。失败时先回退 RNNoise，再回退明确标记的直通；用户主动关闭降噪时保持直通。

## 可重现的模型检查

- `node scripts/verify-rnnoise-parity.mjs`：同一 48 kHz / 480 点输入对照 Web WASM 与 Windows 原生 RNNoise。
- `python scripts/generate-dtln-reference.py`：在安装 NumPy、ONNX Runtime 的隔离 Python 环境中，按官方 `real_time_processing_onnx.py` 的零预填充、128 点步长和双阶段状态流程重新生成 16 kHz 参考 PCM。`node scripts/verify-denoise-models.mjs` 同时验证该参考、DTLN 跨块一致性、DFN3 上游参考 WAV，并以同一 PCM 对照 ONNX Runtime Node 和部署用 ONNX Runtime Web WASM 的输出与重置行为。
- `node scripts/stage-dfn3-model.mjs`：校验固定的上游 ONNX、初始状态和元数据 SHA-256，重新生成 12 个状态的布局与二进制文件。当前 ONNX 是上游预导出的流式图；**尚未完成从 torchDF 权重重新导出图的独立流水线**。来源与许可证见 `apps/web/public/models/dfn3/SOURCE.md`。
- `pnpm --filter @tescord/desktop exec electron ../../scripts/verify-denoise-desktop.cjs`：测试三个 utilityProcess 实际推理与隔离渲染进程的 MessagePort。设置 `TESCORD_PACKAGED_RESOURCES` 为 `win-unpacked/resources` 后再运行，可检验打包资源及 `file://` AudioWorklet 加载。
- `pnpm --filter @tescord/desktop exec electron ../../scripts/verify-denoise-worklet.cjs`：在实际 Electron `file://` AudioWorklet 图中测试三引擎两轮非零输出、无处理错误与子进程退出。
- `pnpm --filter @tescord/desktop exec electron ../../scripts/verify-denoise-electron-engine.cjs`：在 Electron 隔离渲染进程中用假麦克风运行完整 AudioEngine，检查两轮模式切换、快速连点、各模式发送轨道电平及说话指示器、四轨试听与会话清理。

## 当前本机证据（Windows x64，Chromium）

- `pnpm build`：4/4 包构建通过；`pnpm format:check` 通过。Turbo 已把共享 `packages/audio-dsp` 纳入全局依赖哈希，DSP 改动会触发 Web 与桌面重建。
- RNNoise 100 帧 Web/原生最大绝对差约 `3.90e-8`；DTLN 官方参考 122 步长最大差约 `1.40e-7`、跨块最大差 0；DFN3 上游参考 190 帧最大差约 `3.79e-5`。
- 同一秒固定输入下，DTLN Node/WASM 最大逐样本差 `2.54e-7`、状态重置后 `4.88e-10`；DFN3 Node/WASM 最大差 `4.77e-7`、重置后 `1.28e-12`。WASM 后端测试在 Node 宿主运行，实际 Chromium Worker 的加载、切换和输出由 Playwright 覆盖；尚未做浏览器 PCM 与 Node PCM 的逐样本直接对照。
- 音频专项 Playwright 10/10 通过，涵盖三引擎运行、快速切换、DTLN 模型哈希失败回退、RNNoise WASM 失效直通、设备切换、PTT/静音、一次录音四轨重放、试听取消及资源释放。短时 Web 假麦克风运行中，DTLN p95 约 1.1–1.5 ms、DFN3 p95 约 1.8–2.3 ms，采样时队列 0 ms。此测量不代表真实设备、浏览器后台或目标机器的长期性能。
- Windows x64 unpacked 资源中，三个原生模式各输出 15,360 个有限样本；`file://` AudioWorklet 和隔离渲染进程 MessagePort 桥接通过，超长 PCM 与断序消息被拒绝。此检查不等于完整安装器安装验收。
- 2026-09-25 的 Electron 故障复现表明：AudioWorklet 的端口传输 PCM 时使用 ArrayBuffer transfer list，会让 utilityProcess 收不到输入；直接测试原生模型不能发现该问题。移除 transfer list 后，`file://` 工作线程三模式连续两轮均有非零输出。原先 STOP 与端口关闭竞态会遗留原生会话；现在用受校验的窗口归属 IPC 按 requestId 显式终止。快速切换初始化去重，取消就绪等待会拒绝 Promise，不再无限悬挂。
- 完整 Electron AudioEngine 假麦克风测试中，每次 RNNoise、DTLN、DFN3 切换的处理轨道 RMS 非零且本地音量/说话指示均被触发；快速连点后 RNNoise 恢复输出。四轨试听原生会话峰值为 4，结束后为 0，四个轨道均生成且无模型错误。此为本机 Windows x64 测量，非真实频道远端收听或目标设备听感验收。
- Windows PowerShell 中先另开终端运行 `pnpm --filter @tescord/web exec vite --host 127.0.0.1 --port 3100 --strictPort`，再运行 `$env:TESCORD_AUDIO_TEST_ORIGIN='https://127.0.0.1:3100'; $env:TESCORD_AUDIO_SOAK_MS='600000'; node scripts/verify-denoise-browser.mjs`：Chromium 假麦克风下，DTLN 和 DFN3 分别连续运行 300.1 秒，每个模式采样 60 次；处理帧数分别从 632 增至 37,527、从 475 增至 28,148，观测的最大队列延迟均为 0 ms，最大 p95 分别为 1 ms、2 ms，页面异常 0。此结果不包含实体设备、后台页面、CPU/内存曲线或完整端到端延迟。
- Playwright 已改为独占 `3101` 端口的隔离 SQLite 服务，并禁止复用已有 `3001` 开发服务。2026-09-25 全量 `pnpm test:e2e`：114/125 通过，11 项失败，集中在未读标记、首屏加载、权限、邀请码、个人资料、重新认证和账号切换等非降噪用例。音频专项 `pnpm exec playwright test e2e/denoise-engines.spec.ts` 为 7/7 通过，新增处理后电平与说话指示断言。不能宣称全量 Playwright 门禁通过。
- 修改测试隔离前，旧配置曾复用 `3001` 开发服务执行测试，可能写入 `apps/server/prisma/dev.db`。只读核对发现 8 个测试命名公会创建于这次误复用时段；由于没有变更前快照，未删除任何记录。已对当前数据库建立同哈希备份 `apps/server/prisma/dev.db.codex-audio-e2e-20260925-0417.bak`，需按业务数据核对后再决定清理范围。
- `apps/web/src/App.tsx` 中的 P2P Mesh、LiveKit 公会语音和 1:1 通话都取 `audioEngine.getStream()`；该接口优先返回处理后的固定输出轨道。尚未在真实 TURN/SFU 中记录 RTP 字节、ICE 路径和编解码统计。

## 尚未通过的发布门禁

- 四轨试听已对**一次录制的相同输入**使用独立实例重放并删除虚构 SNR 数值；通过 5 ms 分辨率的能量包络相关估计起点偏移，相关不足时保持原时间轴。静稳噪声、微弱语音及编码延迟仍不能保证精确对齐，试听结果不能作为严格等响或客观质量评分。
- DTLN 已对照官方算法生成的参考 PCM，DFN3 已对照上游参考 WAV，RNNoise 已对照 Web WASM/Windows 原生输出；ONNX Node/WASM 逐样本及状态重置对照已通过，但浏览器 AudioWorklet/Worker 完整路径与 Electron utilityProcess 完整路径尚未使用同一 PCM 做端到端逐样本对照。
- 本机合计十分钟的假设备持续运行已通过；仍缺每个引擎独立十分钟、目标机器 CPU/内存曲线及真实端到端延迟验收。
- DTLN 48→16 kHz 与 16→48 kHz 均使用保留跨块状态的 63 抽头 FIR；1 kHz 正弦回采样幅度误差小于 1%，15 kHz 镜像幅度小于 0.01。流式音频已有有界队列、每帧序号与累计采样数验证，并在 Worklet 更换端口时淘汰旧代次回包；尚未完成十分钟长时无漂移验证。
- 缺少 macOS x64/arm64 原生构建与安装包验收、实体麦克风和扬声器双讲/回声听感、真实 TURN/SFU 和公网媒体/E2EE 边界的端到端记录。这些均为**待环境验收**。
- 全量 Playwright 失败项须单独修复并复跑至全部通过；在这些门禁完成前，不能标记为生产可发布。
