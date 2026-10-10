import test from "node:test";
import assert from "node:assert/strict";
import {
  extractIpAddress,
  formatCandidateAddress,
  parseIpv4,
  isValidIpv4,
  isPrivateIpv4,
  isLoopbackIpv4,
  isLinkLocalIpv4,
  isPublicIpv4,
  parseIpv6,
  isValidIpv6,
  isUlaIpv6,
  isLinkLocalIpv6,
  isLoopbackIpv6,
  isPublicIpv6,
  isLoopback,
  isValidIp,
  classifyIp,
  isLanCandidateIp,
  determineP2PConnectionType,
} from "../../../apps/web/src/services/p2p/ipClassifier.js";

// ============================================================================
// Suite 1: IPv4 映射的 IPv6 (IPv4-Mapped IPv6 RFC 4291) 对抗压力测试
// ============================================================================
test("Suite 1: IPv4-Mapped IPv6 对抗压力测试", async (t) => {
  await t.test("1.1 点分十进制与纯十六进制 ::ffff:x.x.x.x 解析与分类", () => {
    // 局域网私网 IPv4 映射
    assert.equal(classifyIp("::ffff:192.168.1.1"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:192.168.1.1"), true);
    assert.equal(classifyIp("::ffff:10.20.30.40"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:10.20.30.40"), true);
    assert.equal(classifyIp("::ffff:172.16.0.1"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:172.16.0.1"), true);
    assert.equal(classifyIp("::ffff:172.31.255.254"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:172.31.255.254"), true);

    // 纯十六进制表达的 IPv4 映射（::ffff:c0a8:0101 = 192.168.1.1）
    assert.equal(classifyIp("::ffff:c0a8:0101"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:c0a8:0101"), true);
    assert.equal(classifyIp("::ffff:0a14:1e28"), "private-v4"); // 10.20.30.40
    assert.equal(isLanCandidateIp("::ffff:0a14:1e28"), true);

    // 公网 IPv4 映射
    assert.equal(classifyIp("::ffff:1.2.3.4"), "public-v4");
    assert.equal(isLanCandidateIp("::ffff:1.2.3.4"), false);
    assert.equal(classifyIp("::ffff:8.8.8.8"), "public-v4");
    assert.equal(isLanCandidateIp("::ffff:8.8.8.8"), false);
    assert.equal(classifyIp("::ffff:114.114.114.114"), "public-v4");
    assert.equal(isLanCandidateIp("::ffff:114.114.114.114"), false);

    // 回环与链路本地 IPv4 映射
    assert.equal(classifyIp("::ffff:127.0.0.1"), "loopback");
    assert.equal(isLanCandidateIp("::ffff:127.0.0.1"), true);
    assert.equal(classifyIp("::ffff:169.254.1.1"), "private-v4");
    assert.equal(isLanCandidateIp("::ffff:169.254.1.1"), true);

    // 特殊/保留 IPv4 映射（非公网、非私网）
    assert.equal(classifyIp("::ffff:0.0.0.0"), "unknown");
    assert.equal(classifyIp("::ffff:224.0.0.1"), "unknown");
    assert.equal(classifyIp("::ffff:255.255.255.255"), "unknown");
  });

  await t.test("1.2 带端口的 IPv4 映射 IPv6 提取与格式化", () => {
    // 标准 RFC 5952 方括号带端口
    assert.equal(extractIpAddress("[::ffff:192.168.1.1]:5000"), "::ffff:192.168.1.1");
    assert.equal(classifyIp("[::ffff:192.168.1.1]:5000"), "private-v4");
    assert.equal(extractIpAddress("[::ffff:1.2.3.4]:8080"), "::ffff:1.2.3.4");
    assert.equal(classifyIp("[::ffff:1.2.3.4]:8080"), "public-v4");

    // 候选地址格式化
    assert.equal(
      formatCandidateAddress("::ffff:192.168.1.1", 5000),
      "[::ffff:192.168.1.1]:5000",
    );
    assert.equal(
      formatCandidateAddress("::ffff:1.2.3.4", 8080),
      "[::ffff:1.2.3.4]:8080",
    );
  });

  await t.test("1.3 IPv4 映射的 IPv6 在 determineP2PConnectionType 中的决策", () => {
    // 双方均为内网 IPv4 映射 host 直连 -> LAN
    assert.equal(
      determineP2PConnectionType(
        "::ffff:192.168.1.1",
        "::ffff:192.168.1.2",
        "host",
        "host",
      ),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType(
        "[::ffff:192.168.1.1]:5000",
        "[::ffff:192.168.1.2]:6000",
        "host",
        "host",
      ),
      "LAN",
    );

    // 双方为公网 IPv4 映射 host 直连 -> P2P
    assert.equal(
      determineP2PConnectionType(
        "::ffff:1.2.3.4",
        "::ffff:5.6.7.8",
        "host",
        "host",
      ),
      "P2P",
    );

    // 一端内网一端公网 -> P2P
    assert.equal(
      determineP2PConnectionType(
        "::ffff:192.168.1.1",
        "::ffff:1.2.3.4",
        "host",
        "host",
      ),
      "P2P",
    );

    // 任意一端中继 -> RELAY
    assert.equal(
      determineP2PConnectionType(
        "::ffff:192.168.1.1",
        "::ffff:192.168.1.2",
        "relay",
        "host",
      ),
      "RELAY",
    );
  });
});

// ============================================================================
// Suite 2: 运营商单播 IPv6 边界与 ULA/Link-local 位运算精准度测试
// ============================================================================
test("Suite 2: 运营商 IPv6 与位掩码边界极限测试", async (t) => {
  await t.test("2.1 中国三大运营商前缀全地址段边界覆盖", () => {
    // 中国电信 (China Telecom): 240e::/16 ~ 240e:ffff:...
    assert.equal(isPublicIpv6("240e::"), true);
    assert.equal(isPublicIpv6("240e::1"), true);
    assert.equal(isPublicIpv6("240e:0000:0000:0000:0000:0000:0000:0001"), true);
    assert.equal(isPublicIpv6("240e:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("240e:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "public-v6");
    assert.equal(isLanCandidateIp("240e:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), false);

    // 中国联通 (China Unicom): 2408::/16 ~ 2408:ffff:...
    assert.equal(isPublicIpv6("2408::"), true);
    assert.equal(isPublicIpv6("2408:0000:0000:0000::1"), true);
    assert.equal(isPublicIpv6("2408:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("2408::"), "public-v6");
    assert.equal(isLanCandidateIp("2408::"), false);

    // 中国移动 (China Mobile): 2409::/16 ~ 2409:ffff:...
    assert.equal(isPublicIpv6("2409::"), true);
    assert.equal(isPublicIpv6("2409:0000::1"), true);
    assert.equal(isPublicIpv6("2409:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("2409:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "public-v6");
    assert.equal(isLanCandidateIp("2409:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), false);

    // 教育网 (CERNET / CERNET2): 2001:da8::/32
    assert.equal(isPublicIpv6("2001:da8::"), true);
    assert.equal(isPublicIpv6("2001:da8:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("2001:da8::1"), "public-v6");
    assert.equal(isLanCandidateIp("2001:da8::1"), false);
  });

  await t.test("2.2 RFC 3587 全局单播公网 2000::/3 极限数学边界 (0x2000 ~ 0x3fff)", () => {
    // 严格下边界：0x2000:0000:...
    assert.equal(isPublicIpv6("2000::"), true);
    assert.equal(isPublicIpv6("2000::1"), true);
    assert.equal(classifyIp("2000::"), "public-v6");

    // 严格上边界：0x3fff:ffff:ffff:ffff:...
    assert.equal(isPublicIpv6("3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "public-v6");

    // 越界下界：0x1fff:ffff:... (位掩码 0x1fff & 0xe000 === 0x0000 !== 0x2000)
    assert.equal(isPublicIpv6("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), false);
    assert.equal(classifyIp("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "unknown");

    // 越界上界：0x4000:0000:... (位掩码 0x4000 & 0xe000 === 0x4000 !== 0x2000)
    assert.equal(isPublicIpv6("4000::"), false);
    assert.equal(classifyIp("4000::"), "unknown");
  });

  await t.test("2.3 RFC 4193 ULA fc00::/7 极限数学边界 (0xfc00 ~ 0xfdff)", () => {
    // 严格下边界：fc00::
    assert.equal(isUlaIpv6("fc00::"), true);
    assert.equal(isUlaIpv6("fc00:0000::1"), true);
    assert.equal(classifyIp("fc00::"), "ula-v6");
    assert.equal(isLanCandidateIp("fc00::"), true);

    // 严格上边界：fdff:ffff:...
    assert.equal(isUlaIpv6("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "ula-v6");
    assert.equal(isLanCandidateIp("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);

    // 内部任意段验证 (fcff, fd00, fd12)
    assert.equal(isUlaIpv6("fcff::1"), true);
    assert.equal(isUlaIpv6("fd00::1"), true);
    assert.equal(isUlaIpv6("fd12:3456:789a:bcde::1"), true);

    // 越界下界：0xfbff (位掩码 0xfbff & 0xfe00 === 0xfa00 !== 0xfc00)
    assert.equal(isUlaIpv6("fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), false);
    assert.equal(classifyIp("fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "unknown");

    // 越界上界：0xfe00 (位掩码 0xfe00 & 0xfe00 === 0xfe00 !== 0xfc00)
    assert.equal(isUlaIpv6("fe00::"), false);
    assert.equal(classifyIp("fe00::"), "unknown");
  });

  await t.test("2.4 RFC 4291 Link-Local fe80::/10 极限数学边界 (0xfe80 ~ 0xfebf)", () => {
    // 严格下边界：fe80::
    assert.equal(isLinkLocalIpv6("fe80::"), true);
    assert.equal(isLinkLocalIpv6("fe80::1"), true);
    assert.equal(classifyIp("fe80::"), "link-local-v6");
    assert.equal(isLanCandidateIp("fe80::"), true);

    // 严格上边界：febf:ffff:...
    assert.equal(isLinkLocalIpv6("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
    assert.equal(classifyIp("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "link-local-v6");
    assert.equal(isLanCandidateIp("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);

    // 越界下界：0xfe7f (位掩码 0xfe7f & 0xffc0 === 0xfe40 !== 0xfe80)
    assert.equal(isLinkLocalIpv6("fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), false);
    assert.equal(classifyIp("fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "unknown");

    // 越界上界：0xfec0 (已废弃的 Site-Local，非 Link-Local)
    assert.equal(isLinkLocalIpv6("fec0::1"), false);
    assert.equal(classifyIp("fec0::1"), "unknown");
  });
});

// ============================================================================
// Suite 3: 极端 candidateType 状态机与决策组合矩阵测试
// ============================================================================
test("Suite 3: candidateType 全排列矩阵与极端拓扑决策测试", async (t) => {
  const allCandidateTypes = [
    "host",
    "srflx",
    "prflx",
    "relay",
    "HOST",
    "SrFlx",
    "PRFLX",
    "Relay",
    undefined,
    "",
    "unknown-type",
  ];

  await t.test("3.1 中继优先级测试：任意端含 relay 必须判定为 RELAY", () => {
    for (const remoteType of allCandidateTypes) {
      assert.equal(
        determineP2PConnectionType("192.168.1.1", "192.168.1.2", "relay", remoteType),
        "RELAY",
      );
      assert.equal(
        determineP2PConnectionType("192.168.1.1", "192.168.1.2", remoteType, "relay"),
        "RELAY",
      );
      assert.equal(
        determineP2PConnectionType("192.168.1.1", "192.168.1.2", "RELAY", remoteType),
        "RELAY",
      );
      assert.equal(
        determineP2PConnectionType("192.168.1.1", "192.168.1.2", remoteType, "RELAY"),
        "RELAY",
      );
    }
  });

  await t.test("3.2 LAN 判定严格门禁：必须双方均为 host 且双方均为内网 IP", () => {
    // 双方为 host，双方均为合法局域网地址
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("10.0.0.1", "10.0.0.2", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("172.16.0.1", "172.31.0.1", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("fd00::1", "fd00::2", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("fe80::1", "fe80::2", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("127.0.0.1", "127.0.0.1", "host", "host"),
      "LAN",
    );
    assert.equal(
      determineP2PConnectionType("::1", "::1", "host", "host"),
      "LAN",
    );

    // 异构局域网 IP 搭配（如 IPv4 私网与 ULA IPv6 搭配）
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "fd00::1", "host", "host"),
      "LAN",
    );

    // 大小写容错
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", "HOST", "Host"),
      "LAN",
    );
  });

  await t.test("3.3 公网直连破坏 LAN：一方或双方为公网 IP 必须断言为 P2P", () => {
    // 双方均为运营商公网单播 IPv6（修复的核心场景）
    assert.equal(
      determineP2PConnectionType(
        "240e:398:123:456::1",
        "240e:398:789:abc::2",
        "host",
        "host",
      ),
      "P2P",
    );
    assert.equal(
      determineP2PConnectionType(
        "2408:8207:123::1",
        "2409:8a00:456::2",
        "host",
        "host",
      ),
      "P2P",
    );

    // 一方私网，一方公网 IPv6
    assert.equal(
      determineP2PConnectionType(
        "192.168.1.1",
        "240e:398:123::1",
        "host",
        "host",
      ),
      "P2P",
    );

    // 双方公网 IPv4
    assert.equal(
      determineP2PConnectionType("114.114.114.114", "8.8.8.8", "host", "host"),
      "P2P",
    );

    // 一方私网，一方公网 IPv4
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "8.8.8.8", "host", "host"),
      "P2P",
    );
  });

  await t.test("3.4 NAT 反射候选 (srflx/prflx) 穿透直连：必须断言为 P2P", () => {
    const nonHostDirectTypes = ["srflx", "prflx", "SRFLX", "PRFLX"];
    for (const t1 of nonHostDirectTypes) {
      assert.equal(
        determineP2PConnectionType("192.168.1.1", "1.2.3.4", "host", t1),
        "P2P",
      );
      assert.equal(
        determineP2PConnectionType("1.2.3.4", "192.168.1.1", t1, "host"),
        "P2P",
      );
      assert.equal(
        determineP2PConnectionType("1.2.3.4", "5.6.7.8", t1, t1),
        "P2P",
      );
    }
  });

  await t.test("3.5 缺省与未知 candidateType 降级：安全兜底至 P2P", () => {
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", undefined, "host"),
      "P2P",
    );
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", "host", undefined),
      "P2P",
    );
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", undefined, undefined),
      "P2P",
    );
    assert.equal(
      determineP2PConnectionType("192.168.1.1", "192.168.1.2", "unknown", "unknown"),
      "P2P",
    );
  });
});

// ============================================================================
// Suite 4: 畸形、路径、空格与 ReDoS 鲁棒性基线
// ============================================================================
test("Suite 4: 畸形、路径、空格与 ReDoS 鲁棒性基线", async (t) => {
  await t.test("4.1 带路径、URL Schema、查询参数的畸形地址防崩测试", () => {
    const maliciousInputs = [
      "http://192.168.1.1",
      "https://192.168.1.1:443/api/v1",
      "ws://[240e:398::1]:3001/socket",
      "192.168.1.1/24",
      "192.168.1.1/index.html",
      "192.168.1.1?auth=token&id=1",
      "192.168.1.1#section-1",
      "240e:398::1/64",
      "[240e:398::1]:5000/stream",
      "ftp://anonymous@10.0.0.1",
    ];

    for (const raw of maliciousInputs) {
      assert.doesNotThrow(() => {
        const category = classifyIp(raw);
        assert.equal(category, "unknown");
        assert.equal(isLanCandidateIp(raw), false);
        assert.equal(isValidIp(raw), false);
      });
    }
  });

  await t.test("4.2 空格、制表符、换行符与格式容错", () => {
    // 包含前后空格/制表符/换行符的标准 IP 应能自愈清洗
    assert.equal(classifyIp("  192.168.1.1  "), "private-v4");
    assert.equal(classifyIp("\t10.0.0.1\n"), "private-v4");
    assert.equal(classifyIp(" \r\n [240e:398::1]:5000 \t "), "public-v6");

    // 内含空格的畸形地址应判定为 unknown
    assert.equal(classifyIp("192. 168. 1. 1"), "unknown");
    assert.equal(classifyIp("240e : 398 :: 1"), "unknown");
    assert.equal(classifyIp("192.168.1.1\0malicious"), "unknown");
  });

  await t.test("4.3 超长字符串与重复字符防 ReDoS 与栈溢出", () => {
    const longStrings = [
      "a".repeat(10000),
      "192.168.1.".repeat(1000) + "1",
      "240e:".repeat(2000) + "1",
      "[".repeat(1000) + "192.168.1.1" + "]".repeat(1000),
      ":".repeat(5000),
      ".".repeat(5000),
    ];

    for (const str of longStrings) {
      const start = Date.now();
      assert.doesNotThrow(() => {
        classifyIp(str);
        isValidIp(str);
      });
      const duration = Date.now() - start;
      assert.ok(duration < 50, `Parsing ${str.slice(0, 20)}... took ${duration}ms (potential ReDoS)`);
    }
  });

  await t.test("4.4 空值与基础边界保护", () => {
    assert.equal(extractIpAddress(""), "");
    assert.equal(extractIpAddress(null), "");
    assert.equal(extractIpAddress(undefined), "");

    assert.equal(classifyIp(""), "unknown");
    assert.equal(isLanCandidateIp(null), false);
    assert.equal(isLanCandidateIp(undefined), false);

    assert.equal(formatCandidateAddress(undefined), undefined);
    assert.equal(formatCandidateAddress(""), undefined);

    assert.equal(determineP2PConnectionType(), "P2P");
  });
});

// ============================================================================
// Suite 5: 对抗攻击与深层缺陷实证挖掘 (Empirical Vulnerability Proofs)
// ============================================================================
test("Suite 5: 对抗攻击与深层缺陷实证挖掘 (Vulnerability Proofs)", async (t) => {
  await t.test("5.1 漏洞实证：三冒号 ':::' 畸形 IPv6 解析旁路 (Triple-Colon Parser Bypass)", () => {
    // RFC 4291 严禁三冒号 ':::'，但当前算法因 match(/::/g) 步进与 parseHextets 空串跳过机制，错误将其断言为合法 IPv6
    const tripleColonParsed = parseIpv6(":::");
    const isTripleColonValid = isValidIpv6(":::");
    console.log(`\n  [VULN-1 PROOF] parseIpv6(':::') =>`, tripleColonParsed, `isValidIpv6(':::') =>`, isTripleColonValid);

    // 缺陷实证：当前实现将 ':::' 误认为 8 个 0 的 IPv6
    assert.ok(Array.isArray(tripleColonParsed) && tripleColonParsed.length === 8, "Vulnerability confirmed: ':::' incorrectly parsed as 8 zero hextets");
    assert.equal(isTripleColonValid, true, "Vulnerability confirmed: ':::' incorrectly deemed valid IPv6");

    // 更严重的旁路：三冒号伪装的 Link-Local 和运营商 IPv6
    const fe80Bypass = parseIpv6("fe80:::1");
    const classifyFe80Bypass = classifyIp("fe80:::1");
    console.log(`  [VULN-1 PROOF] classifyIp('fe80:::1') => ${classifyFe80Bypass}`);
    assert.equal(classifyFe80Bypass, "link-local-v6", "Vulnerability confirmed: malformed 'fe80:::1' misclassified as link-local-v6");

    const telecomBypass = parseIpv6("240e:::1");
    const classifyTelecomBypass = classifyIp("240e:::1");
    console.log(`  [VULN-1 PROOF] classifyIp('240e:::1') => ${classifyTelecomBypass}`);
    assert.equal(classifyTelecomBypass, "public-v6", "Vulnerability confirmed: malformed '240e:::1' misclassified as public-v6");
  });

  await t.test("5.2 漏洞实证：非 IPv6 盲目剔除 '%' 导致的污染字符剥离误判 (Blind Zone ID Stripping)", () => {
    // extractIpAddress 无条件对所有字符串执行 addr.slice(0, zoneIndex)，即便未包含 ':'
    const taintedLoopback = "127.0.0.1%00.example.com";
    const extractedLoopback = extractIpAddress(taintedLoopback);
    const classifiedLoopback = classifyIp(taintedLoopback);
    console.log(`\n  [VULN-2 PROOF] extractIpAddress('${taintedLoopback}') => '${extractedLoopback}', classifyIp => '${classifiedLoopback}'`);
    assert.equal(extractedLoopback, "127.0.0.1", "Vulnerability confirmed: % suffix stripped from IPv4");
    assert.equal(classifiedLoopback, "loopback", "Vulnerability confirmed: tainted string misclassified as loopback");

    const taintedPrivate = "192.168.1.1%20evil.com";
    const extractedPrivate = extractIpAddress(taintedPrivate);
    const classifiedPrivate = classifyIp(taintedPrivate);
    console.log(`  [VULN-2 PROOF] extractIpAddress('${taintedPrivate}') => '${extractedPrivate}', classifyIp => '${classifiedPrivate}'`);
    assert.equal(extractedPrivate, "192.168.1.1", "Vulnerability confirmed: URL-encoded %20 suffix stripped from IPv4");
    assert.equal(classifiedPrivate, "private-v4", "Vulnerability confirmed: tainted string misclassified as private-v4");
  });

  await t.test("5.3 鲁棒性实证：非字符串运行时输入导致未捕获 TypeError 崩溃 (Non-String Type Safety)", () => {
    // 验证 extractIpAddress 缺乏 typeof raw === 'string' 守卫
    let extractCrashed = false;
    try {
      extractIpAddress(123 as any);
    } catch (e: any) {
      extractCrashed = true;
      console.log(`\n  [VULN-3 PROOF] extractIpAddress(123) threw TypeError: ${e.message}`);
    }
    assert.equal(extractCrashed, true, "Robustness issue confirmed: extractIpAddress crashes on non-string input");

    // 验证 determineP2PConnectionType 缺乏对 candidateType 为非字符串的守卫
    let determineCrashed = false;
    try {
      determineP2PConnectionType({ localCandidateType: 123 as any });
    } catch (e: any) {
      determineCrashed = true;
      console.log(`  [VULN-3 PROOF] determineP2PConnectionType({ localCandidateType: 123 }) threw TypeError: ${e.message}`);
    }
    assert.equal(determineCrashed, true, "Robustness issue confirmed: determineP2PConnectionType crashes on non-string candidateType");
  });
});

// ============================================================================
// Suite 6: 性能与高并发压力吞吐基准 (50,000 次分类)
// ============================================================================
test("Suite 6: 性能与高并发压力吞吐基准 (50,000 次极限调用)", () => {
  const testAddresses = [
    "192.168.1.1:5000",
    "10.0.0.1",
    "172.20.1.100:8080",
    "240e:398:123:456::1",
    "[2408:8207:123::1]:6000",
    "2409:8a00:123::1",
    "fd12:3456:789a::1",
    "[fe80::1%eth0]:5000",
    "127.0.0.1:9000",
    "[::1]:3000",
    "::ffff:192.168.1.1",
    "[::ffff:1.2.3.4]:8080",
    "8.8.8.8:53",
    "114.114.114.114",
    "invalid.address.string",
  ];

  const iterations = 50000;
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    const ip = testAddresses[i % testAddresses.length];
    classifyIp(ip);
    determineP2PConnectionType(ip, testAddresses[(i + 1) % testAddresses.length], "host", "host");
  }

  const durationMs = Date.now() - startTime;
  const opsPerSec = Math.round((iterations / durationMs) * 1000);

  console.log(`\n⚡ 性能测试结果: 完成 ${iterations} 次极限调用，耗时 ${durationMs}ms (${opsPerSec} ops/sec)`);
  assert.ok(durationMs < 1000, `Performance benchmark too slow: ${durationMs}ms for ${iterations} calls`);
});
