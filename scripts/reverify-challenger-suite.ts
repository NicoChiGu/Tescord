import test from "node:test";
import assert from "node:assert/strict";
import * as classifier from "../apps/web/src/services/p2p/ipClassifier.js";

const {
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
} = classifier;

test("1. 三冒号与多连冒号畸形 IPv6 解析深度复验", () => {
  // 基础三冒号
  assert.equal(parseIpv6(":::"), null);
  assert.equal(isValidIpv6(":::"), false);
  assert.equal(classifyIp(":::"), "unknown");

  // 前缀/后缀与中间三冒号
  assert.equal(parseIpv6("fe80:::1"), null);
  assert.equal(isValidIpv6("fe80:::1"), false);
  assert.equal(classifyIp("fe80:::1"), "unknown");

  assert.equal(parseIpv6("240e:::1"), null);
  assert.equal(isValidIpv6("240e:::1"), false);
  assert.equal(classifyIp("240e:::1"), "unknown");

  assert.equal(parseIpv6("::::"), null);
  assert.equal(isValidIpv6("::::"), false);
  assert.equal(classifyIp("::::"), "unknown");

  assert.equal(parseIpv6(":::::"), null);
  assert.equal(isValidIpv6(":::::"), false);
  assert.equal(classifyIp(":::::"), "unknown");

  assert.equal(parseIpv6(":::1"), null);
  assert.equal(isValidIpv6(":::1"), false);
  assert.equal(classifyIp(":::1"), "unknown");

  assert.equal(parseIpv6("1:::"), null);
  assert.equal(isValidIpv6("1:::"), false);
  assert.equal(classifyIp("1:::"), "unknown");

  assert.equal(parseIpv6("1:2:3:::4:5"), null);
  assert.equal(isValidIpv6("1:2:3:::4:5"), false);
  assert.equal(classifyIp("1:2:3:::4:5"), "unknown");

  // 多处双冒号
  assert.equal(parseIpv6("1::2::3"), null);
  assert.equal(isValidIpv6("1::2::3"), false);
  assert.equal(classifyIp("1::2::3"), "unknown");

  assert.equal(parseIpv6("::1::"), null);
  assert.equal(isValidIpv6("::1::"), false);
  assert.equal(classifyIp("::1::"), "unknown");

  assert.equal(parseIpv6("1::2::"), null);
  assert.equal(isValidIpv6("1::2::"), false);
  assert.equal(classifyIp("1::2::"), "unknown");

  // 合法 IPv6 双冒号与单播基线保持完好
  assert.notEqual(parseIpv6("::"), null);
  assert.equal(isValidIpv6("::"), true);
  assert.notEqual(parseIpv6("::1"), null);
  assert.equal(isValidIpv6("::1"), true);
  assert.equal(classifyIp("::1"), "loopback");
  assert.notEqual(parseIpv6("1::"), null);
  assert.equal(isValidIpv6("1::"), true);
});

test("2. IPv4 污染清洗与合法 IPv6 Scope Zone 复验", () => {
  // 无端口的 IPv4 污染字符串：不得截断 %，保留原污染串，判定为 unknown
  assert.equal(
    extractIpAddress("127.0.0.1%00.evil.com"),
    "127.0.0.1%00.evil.com",
  );
  assert.equal(classifyIp("127.0.0.1%00.evil.com"), "unknown");
  assert.equal(isValidIp("127.0.0.1%00.evil.com"), false);

  assert.equal(
    extractIpAddress("192.168.1.1%20evil.com"),
    "192.168.1.1%20evil.com",
  );
  assert.equal(classifyIp("192.168.1.1%20evil.com"), "unknown");

  assert.equal(extractIpAddress("10.0.0.1%eth0"), "10.0.0.1%eth0");
  assert.equal(classifyIp("10.0.0.1%eth0"), "unknown");

  // 合法 IPv6 链路本地带 Scope/Zone 仍正常支持
  assert.equal(extractIpAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(classifyIp("fe80::1%eth0"), "link-local-v6");

  assert.equal(extractIpAddress("[fe80::1%12]:5000"), "fe80::1");
  assert.equal(classifyIp("[fe80::1%12]:5000"), "link-local-v6");
});

test("3. 极限对抗：带端口/特殊伪装的 IPv4 污染截断探测", () => {
  // 观察：当污染串末尾带有端口冒号（如 :80 或 :5000）时，当前实现的清洗行为
  const portPolluted = "127.0.0.1%00.evil.com:80";
  const extractedPortPolluted = extractIpAddress(portPolluted);
  const classifiedPortPolluted = classifyIp(portPolluted);

  // 记录实测结果（用于手稿证据）
  console.log("  [CHALLENGE-EVIDENCE] portPolluted:", portPolluted);
  console.log("  [CHALLENGE-EVIDENCE] extracted:", extractedPortPolluted);
  console.log("  [CHALLENGE-EVIDENCE] classified:", classifiedPortPolluted);

  const directPort = "127.0.0.1%00:5000";
  console.log(
    "  [CHALLENGE-EVIDENCE] directPort:",
    directPort,
    "->",
    extractIpAddress(directPort),
    "classified as:",
    classifyIp(directPort),
  );
});

test("4. 运行时类型守卫安全复验 (防 TypeError 奔溃)", () => {
  assert.equal(extractIpAddress(123 as any), "");
  assert.equal(extractIpAddress(null as any), "");
  assert.equal(extractIpAddress(undefined as any), "");
  assert.equal(extractIpAddress({} as any), "");
  assert.equal(extractIpAddress([] as any), "");
  assert.equal(extractIpAddress(true as any), "");
  assert.equal(extractIpAddress(false as any), "");

  assert.equal(classifyIp(123 as any), "unknown");
  assert.equal(classifyIp(null as any), "unknown");
  assert.equal(classifyIp(undefined as any), "unknown");
  assert.equal(classifyIp({} as any), "unknown");

  assert.equal(isValidIp(123 as any), false);
  assert.equal(isLanCandidateIp(123 as any), false);

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
  assert.equal(
    determineP2PConnectionType(
      null as any,
      null as any,
      null as any,
      null as any,
    ),
    "P2P",
  );
  assert.equal(
    determineP2PConnectionType(undefined, undefined, undefined, undefined),
    "P2P",
  );
});

test("5. 全函数导出鲁棒性 Fuzzing 测试", () => {
  const badInputs = [
    null,
    undefined,
    "",
    "   ",
    0,
    123,
    -1,
    NaN,
    Infinity,
    true,
    false,
    {},
    [],
    { a: 1 },
    [1, 2],
    () => {},
  ];

  for (const [name, fn] of Object.entries(classifier)) {
    if (typeof fn !== "function") continue;
    for (const input of badInputs) {
      assert.doesNotThrow(
        () => {
          // @ts-ignore
          fn(input);
        },
        `Function ${name} should not throw when called with ${String(input)}`,
      );
    }
  }
});
