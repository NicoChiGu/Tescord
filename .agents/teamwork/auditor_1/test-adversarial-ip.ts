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

let assertionsCount = 0;
function check(expr: boolean, msg: string) {
  assert(expr, msg);
  assertionsCount++;
}

console.log("Starting Adversarial Integrity Tests for ipClassifier.ts...");

// 1. Bitmask boundary tests for ULA (fc00::/7 -> fc00 to fdff)
check(!isUlaIpv6("fbff:ffff:ffff:ffff::1"), "fbff should NOT be ULA");
check(isUlaIpv6("fc00::1"), "fc00::1 should be ULA");
check(isUlaIpv6("fdff:ffff:ffff:ffff::1"), "fdff:: should be ULA");
check(!isUlaIpv6("fe00::1"), "fe00::1 should NOT be ULA");

// 2. Bitmask boundary tests for Link-Local (fe80::/10 -> fe80 to febf)
check(
  !isLinkLocalIpv6("fe7f:ffff:ffff:ffff::1"),
  "fe7f should NOT be Link-Local",
);
check(isLinkLocalIpv6("fe80::1"), "fe80::1 should be Link-Local");
check(isLinkLocalIpv6("febf:ffff:ffff:ffff::1"), "febf should be Link-Local");
check(!isLinkLocalIpv6("fec0::1"), "fec0 should NOT be Link-Local");

// 3. Bitmask boundary tests for Public Global Unicast (2000::/3 -> 2000 to 3fff)
check(
  !isPublicIpv6("1fff:ffff:ffff:ffff::1"),
  "1fff should NOT be Public IPv6",
);
check(isPublicIpv6("2000::1"), "2000::1 should be Public IPv6");
check(isPublicIpv6("240e::1"), "240e::1 should be Public IPv6");
check(isPublicIpv6("2408::1"), "2408::1 should be Public IPv6");
check(isPublicIpv6("2409::1"), "2409::1 should be Public IPv6");
check(isPublicIpv6("3fff:ffff:ffff:ffff::1"), "3fff should be Public IPv6");
check(!isPublicIpv6("4000::1"), "4000::1 should NOT be in 2000::/3");

// 4. RFC 1918 Boundaries
check(!isPrivateIpv4("9.255.255.255"), "9.255.255.255 is not private");
check(isPrivateIpv4("10.0.0.0"), "10.0.0.0 is private");
check(isPrivateIpv4("10.255.255.255"), "10.255.255.255 is private");
check(!isPrivateIpv4("11.0.0.0"), "11.0.0.0 is not private");

check(!isPrivateIpv4("172.15.255.255"), "172.15 is not private");
check(isPrivateIpv4("172.16.0.0"), "172.16 is private");
check(isPrivateIpv4("172.31.255.255"), "172.31 is private");
check(!isPrivateIpv4("172.32.0.0"), "172.32 is not private");

check(!isPrivateIpv4("192.167.255.255"), "192.167 is not private");
check(isPrivateIpv4("192.168.0.0"), "192.168 is private");
check(isPrivateIpv4("192.168.255.255"), "192.168 is private");
check(!isPrivateIpv4("192.169.0.0"), "192.169 is not private");

// 5. Malformed inputs and edge cases
check(classifyIp(":::") === "unknown", "::: should be unknown");
check(classifyIp("1.2.3.4.5") === "unknown", "5 octets should be unknown");
check(classifyIp("256.1.1.1") === "unknown", "256 octet should be unknown");
check(
  classifyIp("01.02.03.04") === "unknown",
  "leading zero should be unknown",
);
check(
  classifyIp("fe80::1%eth0") === "link-local-v6",
  "Scope zone fe80::1%eth0 should be link-local-v6",
);
check(
  classifyIp("::ffff:192.168.1.1") === "private-v4",
  "IPv4-mapped private IPv6",
);
check(classifyIp("::ffff:8.8.8.8") === "public-v4", "IPv4-mapped public IPv6");
check(
  classifyIp("<script>alert(1)</script>") === "unknown",
  "XSS string should be unknown",
);
check(classifyIp("") === "unknown", "Empty string should be unknown");
check(classifyIp(null as any) === "unknown", "null should be unknown");

// 6. determineP2PConnectionType adversarial combinations
check(
  determineP2PConnectionType("192.168.1.1", "240e:398:1::1", "host", "host") ===
    "P2P",
  "Mixed LAN and public IPv6 host-host must be P2P",
);
check(
  determineP2PConnectionType("192.168.1.1", "10.0.0.1", "host", "host") ===
    "LAN",
  "Both LAN host-host must be LAN",
);
check(
  determineP2PConnectionType("fd00::1", "fc00::2", "host", "host") === "LAN",
  "Both ULA host-host must be LAN",
);
check(
  determineP2PConnectionType("192.168.1.1", "192.168.1.2", "host", "srflx") ===
    "P2P",
  "Non-host candidate must be P2P",
);
check(
  determineP2PConnectionType("192.168.1.1", "192.168.1.2", "relay", "host") ===
    "RELAY",
  "Any relay candidate must be RELAY",
);
check(
  determineP2PConnectionType("192.168.1.1", "192.168.1.2", "relay", "relay") ===
    "RELAY",
  "Both relay must be RELAY",
);

console.log(
  `[PASS] ALL ${assertionsCount} ADVERSARIAL STRESS TEST ASSERTIONS VERIFIED!`,
);
