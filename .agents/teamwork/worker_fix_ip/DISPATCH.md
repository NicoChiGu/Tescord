## 2026-10-09T23:20:29Z

你是由 Project Orchestrator 派发的问题修复专职实施代理（Worker Fix IP）。
工作目录：e:\nodejs_project\Tescord\.agents\teamwork\worker_fix_ip\
原始需求：e:\nodejs_project\Tescord\.agents\teamwork\ORIGINAL_REQUEST.md
项目总纲：e:\nodejs_project\Tescord\PROJECT.md
对抗挑战反馈报告：e:\nodejs_project\Tescord\.agents\teamwork\challenger_1\handoff.md

请强制以最高思考等级（High Thinking Level）进行修复与强化。

【独占写入边界】：

- apps/web/src/services/p2p/ipClassifier.ts
- scripts/test-p2p-ip-classification.ts

【任务详述与修复要点】：
根据 Challenger 1 在对抗挑战中发现的 3 处缺陷，对 `ipClassifier.ts` 进行精准修复与加固：

1. **修复三冒号/多连冒号解析旁路 (Triple-Colon Parser Bypass)**：
   - 在 `parseIpv6` 函数中：
     - 若 `cleaned.includes(":::")` 直接返回 `null`；
     - 在 `parseHextets` 遍历切片时，若遇到空字符串 `h === ""` 直接返回 `null`（严禁 `if (!h) continue;` 隐式跳过空项）；
     - 确保 `parseIpv6(":::")`、`isValidIpv6(":::")` 返回 `null`/`false`，`classifyIp("fe80:::1")` 返回 `"unknown"`。
2. **修复 IPv4 盲目截断 `%` 导致污染字符洗白**：
   - 在 `extractIpAddress` 中：
     - 限制仅对包含冒号 `:` 的地址（即 IPv6）才执行 `%zone` 截断；
     - 对 IPv4 地址（不含冒号 `:`）绝不截断 `%`，使 `"127.0.0.1%00.example.com"` 或 `"192.168.1.1%20evil.com"` 保留原始字符串，因含非法字符 `%` 而无法通过 `parseIpv4`，正确返回 `"unknown"`。
3. **增加运行时类型守卫 (Runtime Type Guards)**：
   - 在 `extractIpAddress(raw)` 开头增加：`if (!raw || typeof raw !== "string") return "";`；
   - 在 `determineP2PConnectionType` 中对候选类型使用安全类型转换：
     ```ts
     const normLType = typeof lType === "string" ? lType.toLowerCase() : "";
     const normRType = typeof rType === "string" ? rType.toLowerCase() : "";
     ```
4. **补充单元测试并全面验证**：
   - 在 `scripts/test-p2p-ip-classification.ts` 中新增对上述 3 个极限边界（三冒号解析拒绝、IPv4 非法 % 不截断拒绝、非字符串类型守卫）的自动化测试断言；
   - 执行单元测试验证：`pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts`，确保全部 PASS；
   - 执行 Challenger 1 的压力测试套件：`.\apps\server\node_modules\.bin\tsx .agents/teamwork/challenger_1/stress_test.ts`，确保全部 PASS 且 3 个 VULN 彻底消失；
   - 执行全局构建：`pnpm build`，确保 0 TS 编译错误。

【MANDATORY INTEGRITY WARNING】：
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

【交付物】：
在 `e:\nodejs_project\Tescord\.agents\teamwork\worker_fix_ip\handoff.md` 输出修复交付报告，并通过 `send_message` 向父代理汇报。
