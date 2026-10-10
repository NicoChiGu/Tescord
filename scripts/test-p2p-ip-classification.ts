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

test("IP 地址提取与规范化 (extractIpAddress)", () => {
  assert.equal(extractIpAddress("192.168.1.1"), "192.168.1.1");
  assert.equal(extractIpAddress("192.168.1.1:5000"), "192.168.1.1");
  assert.equal(extractIpAddress("  10.0.0.1:8080  "), "10.0.0.1");

  assert.equal(extractIpAddress("240e:398:123:456::1"), "240e:398:123:456::1");
  assert.equal(
    extractIpAddress("[240e:398:123:456::1]:5000"),
    "240e:398:123:456::1",
  );
  assert.equal(
    extractIpAddress("[240E:398:123:456::1]"),
    "240e:398:123:456::1",
  );

  // 带 Scope/Zone 索引
  assert.equal(extractIpAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(extractIpAddress("[fe80::1%12]:5000"), "fe80::1");
  assert.equal(extractIpAddress("[fe80::1%eth0]:80"), "fe80::1");

  // 回环
  assert.equal(extractIpAddress("127.0.0.1:9000"), "127.0.0.1");
  assert.equal(extractIpAddress("[::1]:3000"), "::1");

  // 空值防崩
  assert.equal(extractIpAddress(""), "");
  assert.equal(extractIpAddress(null), "");
  assert.equal(extractIpAddress(undefined), "");
});

test("候选物理地址格式化呈现 (formatCandidateAddress)", () => {
  assert.equal(formatCandidateAddress("192.168.1.1", 5000), "192.168.1.1:5000");
  assert.equal(
    formatCandidateAddress("240e:398:123::1", 5000),
    "[240e:398:123::1]:5000",
  );
  assert.equal(formatCandidateAddress("192.168.1.1"), "192.168.1.1");
  assert.equal(formatCandidateAddress("240e:398:123::1"), "240e:398:123::1");
  assert.equal(
    formatCandidateAddress("[240e:398:123::1]:6000"),
    "[240e:398:123::1]:6000",
  );
  assert.equal(formatCandidateAddress("192.168.1.1:6000"), "192.168.1.1:6000");
  assert.equal(formatCandidateAddress(undefined), undefined);
});

test("IPv4 解析与 RFC 1918 私网检测 (parseIpv4, isPrivateIpv4)", () => {
  assert.deepEqual(parseIpv4("192.168.1.1"), [192, 168, 1, 1]);
  assert.equal(parseIpv4("256.0.0.1"), null);
  assert.equal(parseIpv4("192.168.01.1"), null); // 禁止前导零
  assert.equal(parseIpv4("not.an.ip.address"), null);

  // RFC 1918 私网
  assert.equal(isPrivateIpv4("10.0.0.1"), true);
  assert.equal(isPrivateIpv4("10.255.255.254"), true);
  assert.equal(isPrivateIpv4("172.16.0.1"), true);
  assert.equal(isPrivateIpv4("172.31.255.254"), true);
  assert.equal(isPrivateIpv4("192.168.0.1"), true);
  assert.equal(isPrivateIpv4("192.168.100.254:5000"), true);

  // 非私网
  assert.equal(isPrivateIpv4("172.15.255.255"), false);
  assert.equal(isPrivateIpv4("172.32.0.1"), false);
  assert.equal(isPrivateIpv4("8.8.8.8"), false);
  assert.equal(isPrivateIpv4("1.1.1.1"), false);
  assert.equal(isPrivateIpv4("127.0.0.1"), false);
});

test("回环与链路本地检测 (isLoopback, isLinkLocal)", () => {
  assert.equal(isLoopbackIpv4("127.0.0.1"), true);
  assert.equal(isLoopbackIpv4("127.255.0.1"), true);
  assert.equal(isLoopbackIpv6("::1"), true);
  assert.equal(isLoopback("127.0.0.1:80"), true);
  assert.equal(isLoopback("[::1]:443"), true);
  assert.equal(isLoopback("192.168.1.1"), false);

  assert.equal(isLinkLocalIpv4("169.254.1.1"), true);
  assert.equal(isLinkLocalIpv4("192.168.1.1"), false);

  assert.equal(isLinkLocalIpv6("fe80::1"), true);
  assert.equal(isLinkLocalIpv6("fe80::1ff:fe00:1%eth0"), true);
  assert.equal(isLinkLocalIpv6("febf::ffff"), true);
  assert.equal(isLinkLocalIpv6("fec0::1"), false); // 过时 site-local，非 link-local
  assert.equal(isLinkLocalIpv6("240e::1"), false);
});

test("RFC 4193 ULA IPv6 (fc00::/7) 检测 (isUlaIpv6)", () => {
  assert.equal(isUlaIpv6("fc00::1"), true);
  assert.equal(isUlaIpv6("fd00::1"), true);
  assert.equal(isUlaIpv6("fd12:3456:789a::1"), true);
  assert.equal(isUlaIpv6("[fdff:ffff:ffff:ffff::1]:5000"), true);

  assert.equal(isUlaIpv6("fe80::1"), false);
  assert.equal(isUlaIpv6("240e::1"), false);
  assert.equal(isUlaIpv6("::1"), false);
});

test("RFC 3587 / 4291 公网全局单播 IPv6 (2000::/3) 精准识别 (isPublicIpv6)", () => {
  // 中国电信
  assert.equal(isPublicIpv6("240e:398:123:456::1"), true);
  assert.equal(isPublicIpv6("[240e:398:123:456::1]:5000"), true);

  // 中国联通
  assert.equal(isPublicIpv6("2408:8207:123::1"), true);

  // 中国移动
  assert.equal(isPublicIpv6("2409:8a00:123::1"), true);

  // 教育网 CERNET
  assert.equal(isPublicIpv6("2001:da8::1"), true);
  assert.equal(isPublicIpv6("2001:0da8:0208:0000:0000:0000:0000:0001"), true);

  // 非公网 IPv6
  assert.equal(isPublicIpv6("fd12:3456::1"), false);
  assert.equal(isPublicIpv6("fe80::1"), false);
  assert.equal(isPublicIpv6("::1"), false);
  assert.equal(isPublicIpv6("::"), false);
});

test("分类类型枚举映射 (classifyIp)", () => {
  assert.equal(classifyIp("192.168.1.1"), "private-v4");
  assert.equal(classifyIp("10.10.10.10:8000"), "private-v4");
  assert.equal(classifyIp("172.20.1.1"), "private-v4");
  assert.equal(classifyIp("127.0.0.1"), "loopback");
  assert.equal(classifyIp("8.8.8.8"), "public-v4");
  assert.equal(classifyIp("1.1.1.1:53"), "public-v4");

  assert.equal(classifyIp("::1"), "loopback");
  assert.equal(classifyIp("fd12:3456::1"), "ula-v6");
  assert.equal(classifyIp("fe80::1%eth0"), "link-local-v6");
  assert.equal(classifyIp("240e:398:123::1"), "public-v6");
  assert.equal(classifyIp("2001:da8::1"), "public-v6");

  assert.equal(classifyIp("not-an-ip"), "unknown");
  assert.equal(classifyIp(""), "unknown");
});

test("局域网候选 IP 判定 (isLanCandidateIp)", () => {
  assert.equal(isLanCandidateIp("192.168.1.1"), true);
  assert.equal(isLanCandidateIp("10.0.0.1"), true);
  assert.equal(isLanCandidateIp("172.16.0.1"), true);
  assert.equal(isLanCandidateIp("127.0.0.1"), true);
  assert.equal(isLanCandidateIp("::1"), true);
  assert.equal(isLanCandidateIp("fd12:3456::1"), true);
  assert.equal(isLanCandidateIp("fe80::1"), true);

  // 公网 IP 绝不可作为局域网候选
  assert.equal(isLanCandidateIp("240e:398:123::1"), false);
  assert.equal(isLanCandidateIp("2001:da8::1"), false);
  assert.equal(isLanCandidateIp("8.8.8.8"), false);
  assert.equal(isLanCandidateIp("1.1.1.1"), false);
  assert.equal(isLanCandidateIp("unknown"), false);
});

test("P2P / LAN / RELAY 拓扑判定 (determineP2PConnectionType)", () => {
  // 1. 私网 IPv4 host-to-host -> LAN
  assert.equal(
    determineP2PConnectionType("192.168.1.1", "192.168.1.2", "host", "host"),
    "LAN",
  );
  assert.equal(
    determineP2PConnectionType("10.0.0.5", "10.0.0.6", "host", "host"),
    "LAN",
  );

  // 2. ULA IPv6 host-to-host -> LAN
  assert.equal(
    determineP2PConnectionType("fd12:3456::1", "fd12:3456::2", "host", "host"),
    "LAN",
  );

  // 3. 链路本地 IPv6 host-to-host -> LAN
  assert.equal(
    determineP2PConnectionType("fe80::1", "fe80::2", "host", "host"),
    "LAN",
  );

  // 4. 回环 host-to-host -> LAN
  assert.equal(
    determineP2PConnectionType("127.0.0.1", "127.0.0.1", "host", "host"),
    "LAN",
  );

  // 5. 【核心修复验证】：三大运营商公网单播 IPv6 作为 host 候选直连 -> 必须断言为 "P2P" 而非 "LAN"！
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
      "2408:8207:456::2",
      "host",
      "host",
    ),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType(
      "2409:8a00:123::1",
      "2409:8a00:456::2",
      "host",
      "host",
    ),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType("2001:da8::1", "2001:da8::2", "host", "host"),
    "P2P",
  );

  // 6. 公网 IPv4 host-to-host 直连 -> "P2P"
  assert.equal(
    determineP2PConnectionType("114.114.114.114", "8.8.8.8", "host", "host"),
    "P2P",
  );

  // 7. NAT 反射候选 (srflx/prflx) -> "P2P"
  assert.equal(
    determineP2PConnectionType("192.168.1.1", "1.2.3.4", "host", "srflx"),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType("1.2.3.4", "5.6.7.8", "srflx", "srflx"),
    "P2P",
  );

  // 8. 任意一方包含 relay 中继 -> 必须为 "RELAY"
  assert.equal(
    determineP2PConnectionType("192.168.1.1", "1.2.3.4", "host", "relay"),
    "RELAY",
  );
  assert.equal(
    determineP2PConnectionType("1.2.3.4", "192.168.1.1", "relay", "host"),
    "RELAY",
  );
  assert.equal(
    determineP2PConnectionType("1.2.3.4", "5.6.7.8", "relay", "relay"),
    "RELAY",
  );

  // 9. 对象参数形态支持
  assert.equal(
    determineP2PConnectionType({
      localAddress: "192.168.1.1:5000",
      remoteAddress: "192.168.1.2:5000",
      localCandidateType: "host",
      remoteCandidateType: "host",
    }),
    "LAN",
  );
  assert.equal(
    determineP2PConnectionType({
      localAddress: "[240e:398:123::1]:5000",
      remoteAddress: "[240e:398:456::2]:5000",
      localCandidateType: "host",
      remoteCandidateType: "host",
    }),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType({
      localAddress: "1.2.3.4:5000",
      remoteAddress: "5.6.7.8:5000",
      localCandidateType: "relay",
      remoteCandidateType: "host",
    }),
    "RELAY",
  );

  // 10. 边界与空值安全
  assert.equal(
    determineP2PConnectionType(undefined, undefined, undefined, undefined),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType("invalid", "invalid", "host", "host"),
    "P2P",
  );
});

test("对抗加固与边界防御 (三冒号拒绝 / IPv4 非法 % 不截断 / 运行时类型守卫)", () => {
  // 1. 三冒号及多连冒号畸形 IPv6 解析防御 (RFC 4291)
  assert.equal(parseIpv6(":::"), null);
  assert.equal(isValidIpv6(":::"), false);
  assert.equal(classifyIp(":::"), "unknown");

  assert.equal(parseIpv6("fe80:::1"), null);
  assert.equal(isValidIpv6("fe80:::1"), false);
  assert.equal(classifyIp("fe80:::1"), "unknown");

  assert.equal(parseIpv6("240e:::1"), null);
  assert.equal(isValidIpv6("240e:::1"), false);
  assert.equal(classifyIp("240e:::1"), "unknown");

  assert.equal(parseIpv6("::::"), null);
  assert.equal(isValidIpv6("::::"), false);
  assert.equal(classifyIp("::::"), "unknown");

  assert.equal(parseIpv6("1:2:3:::4:5"), null);
  assert.equal(isValidIpv6("1:2:3:::4:5"), false);
  assert.equal(classifyIp("1:2:3:::4:5"), "unknown");

  // 2. IPv4 非法 % 污染防御 (绝不截断 IPv4 的 %，保留污染字符串并判定为 unknown)
  assert.equal(
    extractIpAddress("127.0.0.1%00.example.com"),
    "127.0.0.1%00.example.com",
  );
  assert.equal(isValidIp("127.0.0.1%00.example.com"), false);
  assert.equal(classifyIp("127.0.0.1%00.example.com"), "unknown");

  assert.equal(
    extractIpAddress("192.168.1.1%20evil.com"),
    "192.168.1.1%20evil.com",
  );
  assert.equal(isValidIp("192.168.1.1%20evil.com"), false);
  assert.equal(classifyIp("192.168.1.1%20evil.com"), "unknown");

  assert.equal(extractIpAddress("10.0.0.1%eth0"), "10.0.0.1%eth0");
  assert.equal(isValidIp("10.0.0.1%eth0"), false);
  assert.equal(classifyIp("10.0.0.1%eth0"), "unknown");

  // 携带端口冒号的受污染 IPv4 (绝不误触发 IPv6 Scope 剥离而洗白为回环或私网 IP)
  assert.equal(
    extractIpAddress("127.0.0.1%00.evil.com:80"),
    "127.0.0.1%00.evil.com:80",
  );
  assert.equal(isValidIp("127.0.0.1%00.evil.com:80"), false);
  assert.equal(classifyIp("127.0.0.1%00.evil.com:80"), "unknown");

  assert.equal(
    extractIpAddress("192.168.1.1%attacker:5000"),
    "192.168.1.1%attacker:5000",
  );
  assert.equal(isValidIp("192.168.1.1%attacker:5000"), false);
  assert.equal(classifyIp("192.168.1.1%attacker:5000"), "unknown");

  // 对比测试：IPv6 包含冒号时的合法 Scope Zone 仍然正常支持
  assert.equal(extractIpAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(classifyIp("fe80::1%eth0"), "link-local-v6");
  assert.equal(extractIpAddress("[fe80::1%12]:5000"), "fe80::1");
  assert.equal(classifyIp("[fe80::1%12]:5000"), "link-local-v6");
  assert.equal(extractIpAddress("[fe80::1%eth0]:80"), "fe80::1");
  assert.equal(classifyIp("[fe80::1%eth0]:80"), "link-local-v6");

  // 3. 非字符串运行时类型守卫 (防未捕获 TypeError 崩溃)
  assert.equal(extractIpAddress(123 as any), "");
  assert.equal(extractIpAddress({} as any), "");
  assert.equal(extractIpAddress([] as any), "");
  assert.equal(extractIpAddress(true as any), "");
  assert.equal(classifyIp(123 as any), "unknown");
  assert.equal(isValidIp(123 as any), false);
  assert.equal(isLanCandidateIp(123 as any), false);

  // candidateType 非字符串时安全回退，不抛出 TypeError
  assert.equal(
    determineP2PConnectionType({ localCandidateType: 123 as any }),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType({ remoteCandidateType: 456 as any }),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType({
      localCandidateType: {} as any,
      remoteCandidateType: [] as any,
    }),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType(123 as any, 456 as any, 789 as any, 999 as any),
    "P2P",
  );
});
