# Challenger Reverification 对抗复验报告: IP 分类与清洗加固实测评估

**判定结果**：`CHALLENGE_FAILED`  
*(未能达成 `APPROVE` 标准所要求的“算法坚固无破绽，所有缺陷彻底消除”。虽然缺陷 1（三冒号）和缺陷 3（运行时类型守卫）已彻底解决，但在针对缺陷 2（IPv4 污染清洗）的深度实测中，挖掘出确定性的**“启发式旁路（Heuristic Bypass）”**：由于采用 `addr.includes(":")` 作为判断 IPv6 的粗糙依据，当 IPv4 污染字符串附带端口冒号时（如 `127.0.0.1%00.evil.com:80` 或 `192.168.1.1%evil:5000`），清洗逻辑仍然会错误截断 `%` 之后的所有内容，导致污染字符串被洗白为回环或私网 IP)*

---

## 1. Observation (客观观察与实测数据)

### 1.1 针对 5 项复验目标的实测结果汇总

| 复验目标 | 测试输入与命令 | 预期严格结果 | 实测客观结果 | 状态 |
|---|---|---|---|---|
| **1. 三冒号/多连冒号拦截** | `parseIpv6(":::")`<br>`isValidIpv6(":::")`<br>`classifyIp("fe80:::1")`<br>`classifyIp("240e:::1")` | `null`<br>`false`<br>`"unknown"`<br>`"unknown"` | `null`<br>`false`<br>`"unknown"`<br>`"unknown"` | **PASS (彻底加固)** |
| **2.1 IPv4 无端口污染清洗** | `extractIpAddress("127.0.0.1%00.evil.com")`<br>`classifyIp("127.0.0.1%00.evil.com")` | `"127.0.0.1%00.evil.com"`<br>`"unknown"` | `"127.0.0.1%00.evil.com"`<br>`"unknown"` | **PASS** |
| **2.2 合法 IPv6 链路本地 Scope** | `extractIpAddress("fe80::1%eth0")`<br>`classifyIp("fe80::1%eth0")` | `"fe80::1"`<br>`"link-local-v6"` | `"fe80::1"`<br>`"link-local-v6"` | **PASS** |
| **3. 运行时类型守卫** | `extractIpAddress(123 as any)`<br>`determineP2PConnectionType({ localCandidateType: 123 as any })` | `""`<br>`"P2P"` (无未捕获异常) | `""`<br>`"P2P"` (0 uncaught throw) | **PASS (彻底加固)** |
| **4. 核心单测套件** | `pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts` | 10/10 tests pass | `tests 10, pass 10, fail 0` (耗时 10.08ms) | **PASS** |
| **5. 全局编译构建** | `pnpm build` | 4/4 packages success, 0 TS errors | `Tasks: 4 successful, 4 total` (0 TS error) | **PASS** |

### 1.2 对抗挖掘实证：带端口/特殊伪装的 IPv4 污染清洗启发式旁路

- **目标代码位置**：`apps/web/src/services/p2p/ipClassifier.ts` 第 34-40 行
  ```typescript
  // 剔除 IPv6 Scope/Zone 标识（如 fe80::1%eth0 或 fe80::1%12），仅对包含冒号的 IPv6 执行
  if (addr.includes(":")) {
    const zoneIndex = addr.indexOf("%");
    if (zoneIndex !== -1) {
      addr = addr.slice(0, zoneIndex);
    }
  }
  ```
- **执行命令**：
  ```powershell
  pnpm --filter @tescord/server exec tsx ../../scripts/reverify-challenger-suite.ts
  ```
- **实测输出摘录**：
  ```text
  [CHALLENGE-EVIDENCE] portPolluted: 127.0.0.1%00.evil.com:80
  [CHALLENGE-EVIDENCE] extracted: 127.0.0.1
  [CHALLENGE-EVIDENCE] classified: loopback
  [CHALLENGE-EVIDENCE] directPort: 127.0.0.1%00:5000 -> 127.0.0.1 classified as: loopback
  ```
- **更多实测证明**：
  - `extractIpAddress("192.168.1.1%attacker:5000")` 输出 `"192.168.1.1"`，`classifyIp` 输出 `"private-v4"`。
  - `extractIpAddress("[127.0.0.1%00.evil.com]:80")` 输出 `"127.0.0.1"`，`classifyIp` 输出 `"loopback"`。
  - `extractIpAddress("10.0.0.1%bar:8080")` 输出 `"10.0.0.1"`，`classifyIp` 输出 `"private-v4"`。

---

## 2. Logic Chain (推演与漏洞链条)

1. **观察 1.1 与 1.2 显示的成因**：
   - 在 `extractIpAddress` 中，函数设计初衷是支持携带端口的地址提取（如 `192.168.1.1:5000`）。
   - 对于纯净的 IPv4+端口（`192.168.1.1:5000`），第 26-31 行正则 `^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$` 成功匹配并截断端口，后续 `addr` 不再含冒号 `:`。
   - 但当输入为带有 `%` 污染的 IPv4 且附带端口时（如 `127.0.0.1%00.evil.com:80` 或 `192.168.1.1%evil:5000`）：
     1. 第 21 行 `bracketMatch` 未匹配（非标准方括号或含非法字符）；
     2. 第 26 行 `ipv4PortMatch` 因含有 `%` 字符匹配失败，`addr` 维持原样 `127.0.0.1%00.evil.com:80`；
     3. 关键缺陷点爆发在第 35 行：开发者使用了 `if (addr.includes(":"))` 作为判断“当前地址是 IPv6”的启发式条件；
     4. 由于端口 `:80` 或 `:5000` 携带冒号，`addr.includes(":")` 评估为 `true`；
     5. 随后的 `addr.slice(0, zoneIndex)` 将 `%` 及之后的所有内容（包括端口）一刀切截断，最终将被污染的 IPv4 提取为 `"127.0.0.1"` 或 `"192.168.1.1"`；
     6. `classifyIp` 接收到洗白后的地址，分别判定为 `"loopback"` 与 `"private-v4"`。

2. **为什么这是确定性的安全破绽**：
   - 攻击者只需在被污染的 IPv4 字符串后追加任意端口（如 `:80`、`:5000`）即可绕过 Worker Fix IP 的防御，将带有注入污染或混淆后缀的 IPv4 地址强行洗白为受信任的局域网/回环地址（LAN Candidate）。
   - Worker Fix IP 在交付报告中声称“绝不对 IPv4 截断 %”、“彻底消除了字符清洗洗白风险”，但实测证明在携带端口时该防御被完整穿透。

---

## 3. Caveats (注意事项与假设)

1. **业务影响分级**：该旁路属于解析器对抗边界缺陷。在 WebRTC 正常浏览器环境中，标准 STUN/TURN 反射给客户端的 candidate 通常格式严格，不会主动构造 `%evil:5000`。但在处理外部不受信信令或私有协议握手包时，该漏洞依然构成地址洗白风险。
2. **Review-only 原则遵循**：本 Challenger 严格遵循规范，未修改 `apps/` 任何生产代码，仅在 `scripts/reverify-challenger-suite.ts` 编写了独立复验脚本以提供可独立执行的实证凭据。

---

## 4. Conclusion (结论与修复方案)

**最终裁决**：`CHALLENGE_FAILED`  
*(因存在针对端口后缀 IPv4 的启发式洗白旁路，未能达成“算法坚固无破绽”之 APPROVE 标准)*

### 极简加固方案建议 (供 Worker 采纳)

在 `apps/web/src/services/p2p/ipClassifier.ts` 第 35 行，将朴素的 `addr.includes(":")` 替换为准确的 IPv6 冒号特征检测：
```typescript
// IPv6 无方括号时必包含 :: 或至少 2 个冒号；IPv4:port 仅包含单个冒号
if (addr.includes("::") || (addr.match(/:/g) || []).length >= 2) {
  const zoneIndex = addr.indexOf("%");
  if (zoneIndex !== -1) {
    addr = addr.slice(0, zoneIndex);
  }
}
```
此改动单行即可彻底杜绝携带端口冒号的 IPv4 误入 Scope 截断流程，实现坚固无破绽的防御闭环。

---

## 5. Verification Method (独立复现与验证方式)

任何智能体或 Orchestrator 均可运行以下命令验证本报告的实测结论：

1. **运行独立复验套件**：
   ```powershell
   pnpm --filter @tescord/server exec tsx ../../scripts/reverify-challenger-suite.ts
   ```
   *预期结果*：控制台打印 4 处 `[CHALLENGE-EVIDENCE]`，实证 `127.0.0.1%00.evil.com:80` 被洗白为 `loopback`。

2. **单行命令直接复现旁路洗白**：
   ```powershell
   pnpm --filter @tescord/server exec tsx -e "import { extractIpAddress, classifyIp } from '../../apps/web/src/services/p2p/ipClassifier.ts'; console.log('extract:', extractIpAddress('127.0.0.1%00.evil.com:80')); console.log('classify:', classifyIp('127.0.0.1%00.evil.com:80'));"
   ```
   *复现输出*：
   ```text
   extract: 127.0.0.1
   classify: loopback
   ```
   证实缺陷确凿存在。
