## 2026-10-09T23:36:21Z

你是由 Project Orchestrator 派发的最终加固专职实施代理（Worker Final Fix）。
工作目录：e:\nodejs_project\Tescord\.agents\teamwork\worker_final_fix\
原始需求：e:\nodejs_project\Tescord\.agents\teamwork\ORIGINAL_REQUEST.md
项目总纲：e:\nodejs_project\Tescord\PROJECT.md
前序复验报告：e:\nodejs_project\Tescord\.agents\teamwork\challenger_reverify\handoff.md

请强制以最高思考等级（High Thinking Level）执行这处终极加固。

【独占写入边界】：

- apps/web/src/services/p2p/ipClassifier.ts
- scripts/test-p2p-ip-classification.ts

【修复详述】：
Challenger Reverification 发现：当受污染的 IPv4 附带端口冒号时（例如 `127.0.0.1%00.evil.com:80` 或 `192.168.1.1%attacker:5000`），`addr.includes(":")` 依然会为 true，从而意外触发 `%` 截断，将污染串洗白为 `127.0.0.1`。

请对 `apps/web/src/services/p2p/ipClassifier.ts` 的 `extractIpAddress` 进行精准加固：
将判断是否为 IPv6 地址的启发式条件从：

```typescript
if (addr.includes(":")) {
```

升级为严格的 IPv6 冒号多重性校验：

```typescript
const colonCount = (addr.match(/:/g) || []).length;
if (addr.includes("::") || colonCount >= 2) {
```

如此只有真正的 IPv6 地址（包含 `::` 或至少 2 个冒号）才会剥离 `%zone`；仅有 1 个冒号的 IPv4 带端口字符串（如 `127.0.0.1%00.evil.com:80`）绝不剥离 `%`，保留 `%` 字符后经后续解析必定被拒绝并判定为 `"unknown"`。
同时确保带括号或无括号的合法 IPv6（如 `[fe80::1%eth0]:80` 或 `fe80::1%eth0`）依然能正常剥离 `%zone` 并判定为 `link-local-v6`。

【测试验证】：

1. 在 `scripts/test-p2p-ip-classification.ts` 中补充针对 `127.0.0.1%00.evil.com:80` 与 `192.168.1.1%attacker:5000` 的断言，确保 `classifyIp` 返回 `"unknown"`；
2. 运行单测：`pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts`，确保 100% PASS；
3. 运行构建：`pnpm build`，确保 0 TS 错误；
4. 运行单行复现命令验证缺陷彻底消除。

【MANDATORY INTEGRITY WARNING】：
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

【交付物】：
在 `e:\nodejs_project\Tescord\.agents\teamwork\worker_final_fix\handoff.md` 输出交付报告并通过 send_message 汇报。
