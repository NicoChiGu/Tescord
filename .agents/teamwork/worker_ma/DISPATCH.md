## 2026-10-09T21:44:29Z

你是由 Project Orchestrator 派发的专职实施代理（Worker MA）。
你的工作目录：e:\nodejs_project\Tescord\.agents\teamwork\worker_ma\
原始需求说明：e:\nodejs_project\Tescord\.agents\teamwork\ORIGINAL_REQUEST.md
项目总纲与架构：e:\nodejs_project\Tescord\PROJECT.md
前序调研成果：
- Explorer 1 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_1\report.md
- Explorer 2 报告：e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_2\report.md

请强制以最高思考等级（High Thinking Level）进行深度推演和代码实现。

【独占写入边界】：
- packages/types/src/index.ts
- apps/web/src/services/p2p/ipClassifier.ts (新建)
- apps/web/src/services/p2p/VoiceMeshManager.ts
- apps/web/src/services/audioMixer.ts (删除此文件)
- apps/server/src/verify-phase4-full.ts
- scripts/test-p2p-ip-classification.ts (新建)

【任务详述与实施要点】：
1. **类型协议更新 (R4 & R5)**：
   - 在 `packages/types/src/index.ts` 中的 `PeerLatencyReport` 接口扩充字段：
     ```ts
     localAddress?: string;
     remoteAddress?: string;
     candidateType?: string;
     ```
   - 彻底删除 `packages/types/src/index.ts` 中的 `AudioMixerConfig` 与 `computeMixGains` 及其相关导出。
2. **IP 分类与 P2P/LAN 判定算法 (R1)**：
   - 在 `apps/web/src/services/p2p/ipClassifier.ts` 实现严谨的 IP 分类算法：
     - 正确解析与标准化 IPv4 和 IPv6（包括带端口如 `1.2.3.4:5000` 或 `[240e::1]:5000`）；
     - RFC 1918 私网 IPv4：`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`；
     - RFC 4193 ULA IPv6：`fc00::/7` (高 7 位匹配 `0xfc00`，如 `fc00::` ~ `fdff::`)；
     - RFC 4291 Link-Local IPv6：`fe80::/10` (高 10 位匹配 `0xfe80`，如 `fe80::` ~ `febf::`)；
     - Loopback：`127.0.0.1`, `::1`；
     - 公网单播 IPv6：`2000::/3` (包含电信 `240e::/16`、联通 `2408::/16`、移动 `2409::/16`、CERNET `2001:da8::` 等)；
     - 判定规则：仅当双方物理 IP 均判定为私网 IPv4 / ULA IPv6 / Link-Local IPv6 / Loopback，且双方均为 host 候选时，判定为 `"LAN"`；双方若为公网 IPv6 直连或公网 IPv4 直连（host/srflx/prflx），判定为 `"P2P"`；含 relay 则判定为 `"RELAY"`。
3. **VoiceMeshManager.ts 改造 (R1 & R4)**：
   - 引入 `ipClassifier` 算法模块；
   - 在 `getStats()` 候选对解析中提取选中的 localCandidate 和 remoteCandidate 的具体物理 IP 地址与端口，以及 candidateType；
   - 存入每位成员的 `latencyReports`（包含 localAddress, remoteAddress, candidateType, connectionType）；
   - 修复连接类型判定，彻底杜绝公网 IPv6 被误判为局域网的问题。
4. **伴音混音器清理 (R5)**：
   - 彻底删除 `apps/web/src/services/audioMixer.ts` 文件；
   - 更新 `apps/server/src/verify-phase4-full.ts`：移除对 `computeMixGains` 的引入和相关测试调用，确保后端编译与测试不受影响。
5. **单元测试编写与执行 (AC1)**：
   - 在 `scripts/test-p2p-ip-classification.ts` 中使用 `node:test` + `node:assert/strict` 编写覆盖全面的单元测试：
     - 验证电信 `240e:398:...`、CERNET `2001:da8:...` 等公网 IPv6 作为 host 候选时直连判定为 `"P2P"`；
     - 验证私网 IPv4 (`192.168.1.1` 与 `192.168.1.2`) 双方 host 判定为 `"LAN"`；
     - 验证 ULA IPv6 (`fd12:3456::1` 与 `fd12:3456::2`) 双方 host 判定为 `"LAN"`；
     - 验证一方为 relay 候选时判定为 `"RELAY"`；
     - 验证边界与异常格式输入。
   - 运行测试并确保 100% 通过：`pnpm tsx scripts/test-p2p-ip-classification.ts`。
   - 运行构建验证：`pnpm --filter @tescord/types build` 以及必要的依赖校验。
