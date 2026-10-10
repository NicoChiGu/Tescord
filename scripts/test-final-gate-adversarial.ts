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
} from "../apps/web/src/services/p2p/ipClassifier.js";

test("Final Gate Gate 1: 终极验证受污染 IPv4 (带端口/Scope/特殊伪装) 100% 拒绝", () => {
  const contaminatedIpv4Cases = [
    "127.0.0.1%00.evil.com:80",
    "192.168.1.1%attacker:5000",
    "10.0.0.1%20evil.com:8080",
    "172.16.0.1%zone:443",
    "127.0.0.1%evil:80:80",
    "127.0.0.1%::1:80",
    "127.0.0.1%::",
    "127.0.0.1%::80",
    "127.0.0.1%:80",
    "[127.0.0.1%00.evil.com]:80",
    "[127.0.0.1%attacker]:5000",
    "[127.0.0.1%dead:beef]:80",
    "[127.0.0.1%dead:beef:cafe]:80",
    "192.168.1.1%00",
    "192.168.1.1%eth0",
    "10.0.0.1%dummy",
    "172.20.0.1%bypass.com",
    "127.0.0.1%00.evil.com",
    "192.168.1.1%20evil.com",
  ];

  for (const raw of contaminatedIpv4Cases) {
    const extracted = extractIpAddress(raw);
    const classified = classifyIp(raw);
    const valid = isValidIp(raw);
    const lan = isLanCandidateIp(raw);

    // 严禁洗白为纯净 IPv4
    assert.notEqual(
      extracted,
      "127.0.0.1",
      `Should not whitelist to 127.0.0.1: ${raw}`,
    );
    assert.notEqual(
      extracted,
      "192.168.1.1",
      `Should not whitelist to 192.168.1.1: ${raw}`,
    );
    assert.notEqual(
      extracted,
      "10.0.0.1",
      `Should not whitelist to 10.0.0.1: ${raw}`,
    );
    assert.notEqual(
      extracted,
      "172.16.0.1",
      `Should not whitelist to 172.16.0.1: ${raw}`,
    );
    assert.notEqual(
      extracted,
      "172.20.0.1",
      `Should not whitelist to 172.20.0.1: ${raw}`,
    );

    // 分类必须为 unknown
    assert.equal(
      classified,
      "unknown",
      `classifyIp("${raw}") must be "unknown", got "${classified}"`,
    );
    assert.equal(valid, false, `isValidIp("${raw}") must be false`);
    assert.equal(lan, false, `isLanCandidateIp("${raw}") must be false`);
  }
});

test("Final Gate Gate 2: 终极验证合法 IPv6 链路本地地址 (带/不带方括号、带/不带端口、带 Zone ID) 100% 正常剥离并分类", () => {
  const validLinkLocalV6Cases: Array<{
    input: string;
    expectedExtract: string;
  }> = [
    { input: "[fe80::1%eth0]:80", expectedExtract: "fe80::1" },
    { input: "fe80::1%eth0", expectedExtract: "fe80::1" },
    { input: "[fe80::1%12]:5000", expectedExtract: "fe80::1" },
    { input: "fe80::1%12", expectedExtract: "fe80::1" },
    { input: "[fe80::1]:80", expectedExtract: "fe80::1" },
    { input: "fe80::1", expectedExtract: "fe80::1" },
    {
      input: "fe80::200:5efe:192.168.1.1%eth0",
      expectedExtract: "fe80::200:5efe:192.168.1.1",
    },
    {
      input: "[fe80::200:5efe:192.168.1.1%eth0]:80",
      expectedExtract: "fe80::200:5efe:192.168.1.1",
    },
    { input: "FE80::1%WLAN0", expectedExtract: "fe80::1" },
  ];

  for (const { input, expectedExtract } of validLinkLocalV6Cases) {
    const extracted = extractIpAddress(input);
    const classified = classifyIp(input);
    const isLinkLocal = isLinkLocalIpv6(input);
    const isLan = isLanCandidateIp(input);

    assert.equal(
      extracted,
      expectedExtract,
      `extractIpAddress("${input}") should be "${expectedExtract}", got "${extracted}"`,
    );
    assert.equal(
      classified,
      "link-local-v6",
      `classifyIp("${input}") should be "link-local-v6", got "${classified}"`,
    );
    assert.equal(
      isLinkLocal,
      true,
      `isLinkLocalIpv6("${input}") should be true`,
    );
    assert.equal(isLan, true, `isLanCandidateIp("${input}") should be true`);
  }
});

test("Final Gate Gate 3: 终极验证三冒号与多连冒号畸形 IPv6 拒绝", () => {
  const multiColonCases = [
    ":::",
    "::::",
    ":::::",
    "::::::",
    "fe80:::1",
    "240e:::1",
    ":::1",
    "1:::",
    "1:2:3:::4:5",
    "1::2::3",
    "::1::",
    "1::2::",
    "::ffff:::192.168.1.1",
    "fe80::1:::1",
  ];

  for (const raw of multiColonCases) {
    assert.equal(parseIpv6(raw), null, `parseIpv6("${raw}") should be null`);
    assert.equal(
      isValidIpv6(raw),
      false,
      `isValidIpv6("${raw}") should be false`,
    );
    assert.equal(
      classifyIp(raw),
      "unknown",
      `classifyIp("${raw}") should be "unknown"`,
    );
    assert.equal(isValidIp(raw), false, `isValidIp("${raw}") should be false`);
  }
});

test("Final Gate Gate 4: 全局单播、ULA、IPv4-mapped 及回环基线测试", () => {
  // Public IPv6
  assert.equal(classifyIp("240e:398:123::1"), "public-v6");
  assert.equal(classifyIp("[240e:398:123::1]:443"), "public-v6");
  assert.equal(classifyIp("2001:da8::1"), "public-v6");
  assert.equal(classifyIp("[2001:da8::1]:80"), "public-v6");

  // ULA IPv6
  assert.equal(classifyIp("fc00::1"), "ula-v6");
  assert.equal(classifyIp("fd00::1"), "ula-v6");
  assert.equal(classifyIp("[fd12:3456::1]:8000"), "ula-v6");

  // Loopback
  assert.equal(classifyIp("127.0.0.1"), "loopback");
  assert.equal(classifyIp("127.255.255.254:8080"), "loopback");
  assert.equal(classifyIp("::1"), "loopback");
  assert.equal(classifyIp("[::1]:80"), "loopback");

  // IPv4-mapped IPv6
  assert.equal(classifyIp("::ffff:192.168.1.1"), "private-v4");
  assert.equal(classifyIp("[::ffff:192.168.1.1]:80"), "private-v4");
  assert.equal(classifyIp("::ffff:127.0.0.1"), "loopback");
  assert.equal(classifyIp("::ffff:8.8.8.8"), "public-v4");

  // Format candidate
  assert.equal(formatCandidateAddress("192.168.1.1", 5000), "192.168.1.1:5000");
  assert.equal(formatCandidateAddress("fe80::1", 5000), "[fe80::1]:5000");
  assert.equal(formatCandidateAddress("[fe80::1]:5000"), "[fe80::1]:5000");
  assert.equal(formatCandidateAddress("192.168.1.1:5000"), "192.168.1.1:5000");
});

test("Final Gate Gate 5: 拓扑决策及极限 Fuzzing 防护", () => {
  // P2P Topology Decision
  assert.equal(
    determineP2PConnectionType({
      localIp: "192.168.1.10",
      remoteIp: "192.168.1.20",
      localCandidateType: "host",
      remoteCandidateType: "host",
    }),
    "LAN",
  );
  assert.equal(
    determineP2PConnectionType("fe80::1%eth0", "fe80::2%eth0", "host", "host"),
    "LAN",
  );
  assert.equal(
    determineP2PConnectionType({
      localIp: "127.0.0.1%00.evil.com:80",
      remoteIp: "192.168.1.20",
      localCandidateType: "host",
      remoteCandidateType: "host",
    }),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType({
      localIp: "192.168.1.10",
      remoteIp: "192.168.1.20",
      localCandidateType: "relay",
      remoteCandidateType: "host",
    }),
    "RELAY",
  );

  // Fuzzing boundary types
  const anomalousInputs = [
    "",
    "   ",
    null,
    undefined,
    12345,
    true,
    false,
    {},
    [],
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "240.0.0.1",
    "not-an-ip",
    "http://127.0.0.1",
    "192.168.1.1.1",
    "192.168.1",
    ":",
    "::0",
    "ff02::1",
  ];

  for (const input of anomalousInputs) {
    // @ts-ignore
    assert.doesNotThrow(() => extractIpAddress(input));
    // @ts-ignore
    assert.doesNotThrow(() => classifyIp(input));
    // @ts-ignore
    assert.doesNotThrow(() => isValidIp(input));
    // @ts-ignore
    assert.doesNotThrow(() => isLanCandidateIp(input));
    // @ts-ignore
    assert.doesNotThrow(() =>
      determineP2PConnectionType(input, input, input, input),
    );
  }
});
