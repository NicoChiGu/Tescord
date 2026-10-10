## 2026-10-09T22:43:26Z
你是由 Project Orchestrator 派发的专职实施代理（Worker MC）。
你的工作目录：e:\nodejs_project\Tescord\.agents\teamwork\worker_mc\
原始需求说明：e:\nodejs_project\Tescord\.agents\teamwork\ORIGINAL_REQUEST.md
项目总纲与规范：e:\nodejs_project\Tescord\PROJECT.md 与 e:\nodejs_project\Tescord\AGENTS.md
前序报告参考：
- Explorer 3 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_3\report.md (重点参考其国际化多语言词条矩阵)
- Worker MA 报告：e:\nodejs_project\Tescord\.agents\teamwork\worker_ma\handoff.md
- Worker MB 报告：e:\nodejs_project\Tescord\.agents\teamwork\worker_mb\handoff.md

请强制以最高思考等级（High Thinking Level）进行深度推演与代码落地。

【独占写入边界】：
- apps/web/src/i18n/locales/{zh-CN,zh-TW,zh-HK,en-US,ja-JP}/*.json
- apps/web/src/components/voice/VoiceConnectionStatusPopover.tsx (仅做 i18n 替换与硬编码清除)
- apps/web/src/components/modals/NetworkQualityModal.tsx (仅做 i18n 替换与硬编码清除)
- apps/web/src/components/chat/LightboxModal.tsx (仅做 i18n 替换与硬编码清除)
- apps/web/src/components/VoiceRoomArea.tsx (仅做 i18n 替换与硬编码清除)
- apps/web/src/components/ChannelSidebar.tsx (仅做 i18n 替换与硬编码清除)

【任务详述与实施要点】：
1. **R7: 国际化 5 语言全域对称性落地 (Strict 5 Locales)**：
   - 检查并补齐 `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP` 全部 5 套语言字典：
     - 在 `voice.json`、`modals.json`、`chat.json` 中，补齐 Worker MB 新增的 UI 文案对应的国际化翻译（包括 P2P 连接指标、全员平均/中位数延迟、丢包率、直连局域网/公网P2P/中继RELAY、远端IP、本端IP、点对点独立RTT、HD 高清原图徽章提示、图片加载中/解码中等）；
     - 确保所有新增键名在 5 套语言包中 100% 对齐，键路径完全对称，杜绝任何缺失或拼写不一致；
     - 清理过时的混音器多语言文案（如 `mediaTooltips.mixPanel`）。
2. **严禁硬编码中文 (Zero Hardcoded Copy)**：
   - 全面排查 `VoiceConnectionStatusPopover.tsx`, `NetworkQualityModal.tsx`, `LightboxModal.tsx`, `VoiceRoomArea.tsx`, `ChannelSidebar.tsx`, `ImageAttachment.tsx`；
   - 将所有遗留或新增的人类可读展示文本（如 "P2P 总体丢包率", "点对点独立 RTT", "远端 IP", "本端 IP", "直连 LAN", "公网 P2P", "原图" 等）全部替换为 `t("namespace:key")` 动态多语言获取；
   - 确保 TSX 组件中无任何硬编码中文。
3. **全局工程门禁验收 (AC7 & Verification)**：
   - 运行全仓库构建：`pnpm build`，确保 TypeScript 零错误（Zero TS Errors）；
   - 运行 IP 检测单元测试：`pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts`，确保 9/9 全部 PASS；
   - 运行 Playwright E2E 测试验收（尤其是 `e2e/chat-image-skeleton.spec.ts` 与 `e2e/lightbox-interaction-and-download.spec.ts` 或多语言切换相关测试），确保全部通过；
   - 运行代码格式化与规范校验：`pnpm prettier --check ...` 或 `pnpm format`。

【MANDATORY INTEGRITY WARNING】：
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

【交付物】：
在 `e:\nodejs_project\Tescord\.agents\teamwork\worker_mc\handoff.md` 输出详细交付报告（包含 5 语言词条对齐清单、硬编码清理清单、pnpm build 执行输出与测试通过凭据），并通过 `send_message` 向父代理汇报完成状态。
