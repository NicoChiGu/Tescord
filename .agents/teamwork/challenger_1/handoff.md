# Challenger 1 对抗挑战与压力测试报告: IP 分类与网络状态机鲁棒性评估

**判定结果**：`CHALLENGE_FAILED`
_(核心业务场景（公网 IPv6 直连断言 P2P、私网/ULA/Link-Local 直连断言 LAN、中继断言 RELAY）已实现并能正确工作；但在极限对抗与模糊测试中发现 3 处确定性缺陷，未能达成 `APPROVE` 标准所要求的“算法坚固无破绽”)_

---

## 1. Observation (客观观察与实测数据)

### 1.1 代码审阅与算法结构观察

- **目标文件**：`apps/web/src/services/p2p/ipClassifier.ts`
- **关键逻辑点**：
  1. `extractIpAddress` (第 34-38 行)：
     ```typescript
     // 剔除 IPv6 Scope/Zone 标识（如 fe80::1%eth0 或 fe80::1%12）
     const zoneIndex = addr.indexOf("%");
     if (zoneIndex !== -1) {
       addr = addr.slice(0, zoneIndex);
     }
     ```
     观察：代码无条件截断 `%` 之后的所有字符，未校验该地址是否为包含冒号 `:` 的 IPv6 地址。
  2. `parseIpv6` (第 135-146 行)：
     ```typescript
     const doubleColons = (cleaned.match(/::/g) || []).length;
     if (doubleColons > 1) return null;

     const parseHextets = (list: string[]): number[] | null => {
       const res: number[] = [];
       for (const h of list) {
         if (!h) continue;
         if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
         res.push(parseInt(h, 16));
       }
       return res;
     };
     ```
     观察：`cleaned.match(/::/g)` 匹配非重叠子串。对于 `":::"`，正则只匹配到 1 个 `"::"`（剩余 1 个 `":"`），`doubleColons` 计数值为 1。随后在 `cleaned.split("::")` 产生空项时，`parseHextets` 中 `if (!h) continue;` 隐蔽地跳过了空项，导致畸形的三冒号地址被解析成功。
  3. 类型防护缺失 (第 18 行、第 334 行)：
     ```typescript
     let addr = raw.trim(); // 未防御 typeof raw !== "string"
     const normLType = lType?.toLowerCase(); // 若 lType 非 string（如数字）将直接崩溃
     ```

### 1.2 独立对抗压力测试脚本执行记录

- **测试脚本**：`e:\nodejs_project\Tescord\.agents\teamwork\challenger_1\stress_test.ts`
- **执行命令**：
  ```powershell
  .\apps\server\node_modules\.bin\tsx .agents/teamwork/challenger_1/stress_test.ts
  ```
- **执行输出与测试集覆盖情况**：
  ```text
    [VULN-1 PROOF] parseIpv6(':::') => [ 0, 0, 0, 0, 0, 0, 0, 0 ] isValidIpv6(':::') => true
    [VULN-1 PROOF] classifyIp('fe80:::1') => link-local-v6
    [VULN-1 PROOF] classifyIp('240e:::1') => public-v6

    [VULN-2 PROOF] extractIpAddress('127.0.0.1%00.example.com') => '127.0.0.1', classifyIp => 'loopback'
    [VULN-2 PROOF] extractIpAddress('192.168.1.1%20evil.com') => '192.168.1.1', classifyIp => 'private-v4'

    [VULN-3 PROOF] extractIpAddress(123) threw TypeError: raw.trim is not a function
    [VULN-3 PROOF] determineP2PConnectionType({ localCandidateType: 123 }) threw TypeError: lType?.toLowerCase is not a function

  ⚡ 性能测试结果: 完成 50000 次极限调用，耗时 392ms (127551 ops/sec)
  TAP version 13
  # Subtest: Suite 1: IPv4-Mapped IPv6 对抗压力测试 (3/3 pass)
  # Subtest: Suite 2: 运营商 IPv6 与位掩码边界极限测试 (4/4 pass)
  # Subtest: Suite 3: candidateType 全排列矩阵与极端拓扑决策测试 (5/5 pass)
  # Subtest: Suite 4: 畸形、路径、空格与 ReDoS 鲁棒性基线 (4/4 pass)
  # Subtest: Suite 5: 对抗攻击与深层缺陷实证挖掘 (3/3 pass)
  # Subtest: Suite 6: 性能与高并发压力吞吐基准 (1/1 pass)
  # tests 25
  # pass 25
  # fail 0
  ```

---

## 2. Logic Chain (推演与漏洞链条)

### 2.1 针对 4 大挑战目标的正面验证链条

1. **IPv4 映射的 IPv6 (RFC 4291)**：
   - 观察：`::ffff:192.168.1.1` 被 `parseIpv6` 正确解出 6 字节前缀与后 2 字节 IPv4 地址，在 `classifyIp` 第 261-274 行递归解包并分类为 `private-v4`（`isLanCandidateIp` 返回 `true`）；
   - 观察：`::ffff:1.2.3.4` 正确分类为 `public-v4`（`isLanCandidateIp` 返回 `false`）；
   - 观察：`determineP2PConnectionType` 正确将双方内网映射判定为 `"LAN"`，公网映射判定为 `"P2P"`。
2. **运营商单播 IPv6 边界与 ULA/Link-Local 位运算**：
   - 观察：三大运营商 `240e::/16`, `2408::/16`, `2409::/16` 及 CERNET `2001:da8::/32` 全部命中 `(hextets[0] & 0xe000) === 0x2000`，100% 判定为 `public-v6`；
   - 观察：数学下边界 `0x2000::` 与上边界 `0x3fff:ffff:...` 均通过，越界值 `0x1fff::` 与 `0x4000::` 被准确剔除为 `unknown`；
   - 观察：ULA `fc00::/7` (掩码 `0xfe00 === 0xfc00`) 与 Link-Local `fe80::/10` (掩码 `0xffc0 === 0xfe80`) 数学边界 100% 精确。
3. **candidateType 极端组合状态机**：
   - 观察：任意端包含 `relay`（包括大小写 `Relay`/`RELAY`）均 100% 断言为 `"RELAY"`；
   - 观察：双方均为 `host` 且双方均为内网 IP 时断言为 `"LAN"`；只要一方为公网（IPv6 或 IPv4）或反射候选（srflx/prflx），一律断言为 `"P2P"`；
   - 观察：未定义、空值与异常类型安全回退到 `"P2P"`。
4. **吞吐性能与防 ReDoS**：
   - 观察：50,000 次分类与拓扑决策连续压测耗时 392ms（约 12.7 万 ops/sec）；
   - 观察：10,000 字符超长字符串测试无回溯卡死，单次解析耗时 < 2ms。

### 2.2 对抗挖掘暴露的 3 项确定性缺陷推演 (Vulnerabilities)

#### 漏洞 1 (高危边界解析缺陷)：三冒号 `:::` 畸形 IPv6 解析旁路 (Triple-Colon Parser Bypass)

- **成因推演**：
  1. RFC 4291 明确规定 `::` 在整个 IPv6 地址中最多出现一次，严禁连续 3 个冒号 `:::`。
  2. 在 `ipClassifier.ts` 第 135 行，`cleaned.match(/::/g)` 匹配非重叠子串。对于 `"fe80:::1"`，正则步进吃掉前两个冒号后剩余一个 `:`，计算得出的 `doubleColons` 仍为 1。
  3. 执行 `cleaned.split("::")` 得到 `left = "fe80"`，`right = ":1"`。
  4. `right.split(":")` 得到 `["", "1"]`。
  5. 在 `parseHextets`（第 141 行）中，执行了 `if (!h) continue;`，将切分出来的空串 `""` 悄悄跳过，导致 `fe80:::1` 被解析为 `[0xfe80, 0, 0, 0, 0, 0, 0, 1]`。
- **危害表现**：
  - `parseIpv6(":::")` 返回全 0 数组，`isValidIpv6(":::")` 判定为 `true`；
  - `fe80:::1` 被判定为合法的 `link-local-v6` 并允许作为 LAN 候选；
  - `240e:::1` 被判定为合法的 `public-v6`。

#### 漏洞 2 (中危字符清洗缺陷)：IPv4 盲目剔除 `%` 导致污染字符串被洗白

- **成因推演**：
  1. RFC 4007 / RFC 6874 中 `%zone` 仅对 IPv6 Link-Local 作用域（如 `fe80::1%eth0`）有效，IPv4 绝无 Scope ID 语法规范。
  2. 在 `ipClassifier.ts` 第 35-38 行，未判断地址是否包含 `:` 即盲目执行 `addr.slice(0, zoneIndex)`。
- **危害表现**：
  - 恶意/畸形字符串如 `"127.0.0.1%00.example.com"` 被截断为 `"127.0.0.1"`，并被误判为 `loopback`；
  - URL 编码或带参数字符串如 `"192.168.1.1%20evil.com"` 被截断为 `"192.168.1.1"`，并被误判为 `private-v4`；
  - 破坏了输入清洗的纯粹性，给上层带来地址混淆风险。

#### 漏洞 3 (低危类型健壮性缺陷)：非字符串输入引发未捕获的运行时 TypeError

- **成因推演**：
  1. `extractIpAddress(raw)` 第 17-18 行使用 `if (!raw) return ""; let addr = raw.trim();`。若运行时调用者传入数字（如 `123`）或对象，`raw.trim` 将直接抛出 `TypeError: raw.trim is not a function`。
  2. `determineP2PConnectionType` 第 334 行 `lType?.toLowerCase()`，若传入对象中 `localCandidateType` 非字符串，直接抛出 `TypeError`。

---

## 3. Caveats (注意事项与假设)

1. **WebRTC 运行环境假定**：在浏览器标准 `RTCPeerConnection` 正常运作下，浏览器内置 ICE 引擎输出的候选 IP 通常格式规范，极少主动产生形如 `:::` 的畸形字符串。
2. **纯算法边界与业务影响分离**：漏洞 1 和漏洞 2 属于严格 parser 边界与对抗清洗层面的破绽，不会导致正常合法用户无法建立 P2P 连线，但确实无法达到“算法坚固无破绽”的免检标准。
3. **Review-only 原则**：本角色严格遵循 review-only 约束，未在 `apps/` 主代码区修改任何业务代码，仅在 `.agents/teamwork/challenger_1/` 留下测试脚本与挑战证据。

---

## 4. Conclusion (结论与改进建议)

**最终判定**：`CHALLENGE_FAILED`
_(未达成 APPROVE 所附带的“算法坚固无破绽”红线)_

### 修复补丁建议 (供 Worker MA 或后续维护者参考)

1. **修复三冒号多连冒号漏洞**（在 `parseIpv6` 头部增加连续 3 个及以上冒号检测）：
   ```typescript
   if (cleaned.includes(":::")) return null;
   ```
   并在 `parseHextets` 中严格拦截连续冒号产生的空串：
   ```typescript
   for (const h of list) {
     if (h === "") return null; // 拒绝空串，杜绝额外隐式多冒号
     if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
     res.push(parseInt(h, 16));
   }
   ```
2. **修复 IPv4 盲目截断 `%` 漏洞**（限制仅对包含 `:` 的 IPv6 处理 Scope ID）：
   ```typescript
   if (addr.includes(":")) {
     const zoneIndex = addr.indexOf("%");
     if (zoneIndex !== -1) {
       addr = addr.slice(0, zoneIndex);
     }
   }
   ```
3. **增强运行时类型防御**：
   ```typescript
   export function extractIpAddress(raw?: string | null): string {
     if (!raw || typeof raw !== "string") return "";
     let addr = raw.trim();
     ...
   ```

---

## 5. Verification Method (独立复现与验证方式)

任何团队成员或 Orchestrator 可直接运行以下命令复现本报告中的所有实测结论与漏洞证明：

1. **运行对抗压力测试与漏洞实证套件**：

   ```powershell
   .\apps\server\node_modules\.bin\tsx .agents/teamwork/challenger_1/stress_test.ts
   ```

   _预期结果_：控制台打印 3 处 `[VULN-X PROOF]` 实证输出，25 项测试全量执行完毕。

2. **单行命令快速复现漏洞 1 (三冒号非法绕过)**：

   ```powershell
   .\apps\server\node_modules\.bin\tsx -e "import { isValidIpv6, classifyIp } from './apps/web/src/services/p2p/ipClassifier.ts'; console.log('isValid(:::):', isValidIpv6(':::')); console.log('classify(fe80:::1):', classifyIp('fe80:::1'));"
   ```

   _复现结果_：输出 `isValid(:::): true` 与 `classify(fe80:::1): link-local-v6`，直接证实漏洞存在。

3. **单行命令快速复现漏洞 2 (IPv4 盲目 % 洗白)**：
   ```powershell
   .\apps\server\node_modules\.bin\tsx -e "import { extractIpAddress, classifyIp } from './apps/web/src/services/p2p/ipClassifier.ts'; console.log('extract:', extractIpAddress('127.0.0.1%00.evil.com')); console.log('classify:', classifyIp('127.0.0.1%00.evil.com'));"
   ```
   _复现结果_：输出 `extract: 127.0.0.1` 与 `classify: loopback`，证实被错误洗白。
