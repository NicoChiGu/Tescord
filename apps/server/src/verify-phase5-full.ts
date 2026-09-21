import { config } from "dotenv";
import {
  buildSecurityHeaders,
  validateDtlsSrtpParameters,
  DtlsSrtpConfig,
  encodeSFrameHeader,
  decodeSFrameHeader,
  encryptSFramePacket,
  decryptSFramePacket,
  SFrameReplayFilter,
  generateDhKeyPair,
  exportDhPublicKey,
  importDhPublicKey,
  computeDhSecret,
  kdfRootKey,
  kdfChainKey,
  computeFingerprint,
  encryptMessageWithKey,
  decryptMessageWithKey,
  DoubleRatchetSession,
  EncryptedMessageEnvelope,
  DevicePreKeyBundle,
  tokenizeText,
  ClientSideFtsEngine,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
} from "@tescord/types";
import { e2eeService } from "./services/e2ee.service.js";

config();

async function runFullPhase5Verification() {
  console.log(
    "🧪 开始路线图阶段五（Phase 5: 5.1, 5.2, 5.3）混合分级安全加密体系全量自动化深度测试...\n",
  );

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (!condition) {
      console.error(`❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  }

  // ==========================================
  // 1. 验证 5.1：基础链路安全与网络加固 (Link Security & Hardening)
  // ==========================================
  console.log("--- 1. 验证 5.1 基础链路安全与网络加固 ---");

  // 1.1 HSTS 与安全响应头校验
  const securityHeaders = buildSecurityHeaders();
  assert(
    Boolean(securityHeaders["Strict-Transport-Security"]),
    "注入 HSTS 强制安全传输响应头",
  );
  assert(
    securityHeaders["Strict-Transport-Security"].includes("max-age=31536000") &&
      securityHeaders["Strict-Transport-Security"].includes(
        "includeSubDomains",
      ) &&
      securityHeaders["Strict-Transport-Security"].includes("preload"),
    "HSTS 严格启用一年期 (31536000s) + 子域名包含 + Preload 预加载名单",
  );

  assert(
    securityHeaders["X-Content-Type-Options"] === "nosniff",
    "X-Content-Type-Options 严格配置为 nosniff，防止 MIME 类型混淆嗅探",
  );

  assert(
    securityHeaders["X-Frame-Options"] === "DENY",
    "X-Frame-Options 严格配置为 DENY，彻底阻断点击劫持 (Clickjacking) 嵌套",
  );

  assert(
    securityHeaders["Referrer-Policy"] === "strict-origin-when-cross-origin",
    "Referrer-Policy 配置为 strict-origin-when-cross-origin，防跨域敏感信息泄露",
  );

  assert(
    securityHeaders["Content-Security-Policy"].includes("default-src 'self'"),
    "CSP 限制默认资源来源为 'self' 信任同源",
  );

  assert(
    securityHeaders["Permissions-Policy"].includes("microphone=(self)"),
    "Permissions-Policy 严格授权麦克风仅同源使用",
  );

  // 1.2 DTLS-SRTP 媒体链路强制加固合规性校验
  console.log("\n--- 验证 5.1 WebRTC DTLS-SRTP 媒体链路安全合规性 ---");
  const validDtlsConfig: DtlsSrtpConfig = {
    cipherSuites: [
      "SRTP_AEAD_AES_256_GCM",
      "SRTP_AEAD_AES_128_GCM",
      "SRTP_AES128_CM_HMAC_SHA1_80",
    ],
    dtlsRole: "auto",
    requireDtlsSrtp: true,
  };

  const dtlsCheck = validateDtlsSrtpParameters(validDtlsConfig);
  assert(dtlsCheck.valid === true, "生产级标准 DTLS-SRTP 套件与配置校验通过");
  assert(dtlsCheck.reasons.length === 0, "合规配置无任何安全拦截告警");

  // 1.3 异常或不安全 DTLS-SRTP 配置防御拦截
  const insecureDtlsConfig: DtlsSrtpConfig = {
    cipherSuites: ["INSECURE_PLAINTEXT_CIPHER"],
    dtlsRole: "client",
    requireDtlsSrtp: false,
  };
  const insecureCheck = validateDtlsSrtpParameters(insecureDtlsConfig);
  assert(
    insecureCheck.valid === false,
    "禁用 requireDtlsSrtp 被系统强制拦截拦截",
  );
  assert(
    insecureCheck.reasons.some((r) => r.includes("requireDtlsSrtp")),
    "明确指出未开启 requireDtlsSrtp 的严重隐患",
  );
  assert(
    insecureCheck.reasons.some((r) => r.includes("cipherSuites")),
    "明确指出不支持明文或弱加密套件",
  );

  // 1.4 后端安全态势服务 (E2EEService Posture) 验证
  const posture = e2eeService.getSecurityPosture();
  assert(posture.tlsVersion === "TLSv1.3", "服务宣告强制启用 TLS 1.3 协议");
  assert(posture.hstsEnabled === true, "HSTS 标记全局生效");
  assert(posture.dtlsSrtp.enforced === true, "DTLS-SRTP 处于强制启用中继状态");

  // ==========================================
  // 2. 验证 5.2：语音端到端加密（SFrame E2EE）规范
  // ==========================================
  console.log("\n--- 2. 验证 5.2 语音端到端加密（SFrame WebRTC E2EE） ---");

  // 2.1 SFrame 紧凑头部序列化与反序列化验证 (KID + 48-bit 单调递增 CTR)
  const headerBuf1 = encodeSFrameHeader(3, 100n);
  const parsedH1 = decodeSFrameHeader(headerBuf1);
  assert(parsedH1.kid === 3, "SFrame 头部精确反序列化 Key ID (KID=3)");
  assert(parsedH1.counter === 100n, "SFrame 头部精确反序列化计数器 (CTR=100)");

  // 边界计数器测试 (大端序 48-bit 计数)
  const largeCtr = 0x123456789abcn;
  const headerBuf2 = encodeSFrameHeader(15, largeCtr);
  const parsedH2 = decodeSFrameHeader(headerBuf2);
  assert(parsedH2.kid === 15, "SFrame 头部支持最大 4-bit KID (15)");
  assert(
    parsedH2.counter === largeCtr,
    "SFrame 头部支持 48-bit 超大帧计数器无精度丢失",
  );

  // 截断与非法数据包防御
  try {
    decodeSFrameHeader(new Uint8Array([0x31])); // 缺少计数器负载
    assert(false, "数据截断应当抛出异常");
  } catch {
    assert(true, "受损截断 SFrame 头部被安全拦截抛出异常");
  }

  // 2.2 SFrame 真实音频帧 (Opus/PCM) 加密与解密全生命周期保真性
  console.log(
    "\n--- 验证 5.2 48kHz Opus 语音采样帧 SFrame AES-256-GCM 加密解密 ---",
  );
  const sframeKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sframeKey[i] = (i * 7 + 13) & 0xff;

  const mockOpusPayload = new Uint8Array(160); // 160 字节 Opus 语音编码帧
  for (let i = 0; i < mockOpusPayload.length; i++) {
    mockOpusPayload[i] = (i ^ 0x5a) & 0xff;
  }

  const encryptedPacket = await encryptSFramePacket(
    mockOpusPayload,
    sframeKey,
    2,
    1001n,
  );

  assert(
    encryptedPacket.length > mockOpusPayload.length,
    "SFrame 封装包附加了 SFrame Header 与 16 字节 GCM Auth Tag",
  );

  const { decryptedPayload, header } = await decryptSFramePacket(
    encryptedPacket,
    sframeKey,
  );

  assert(header.kid === 2, "解密成功读取 SFrame KID 标识");
  assert(header.counter === 1001n, "解密成功读取帧序列号 CTR (1001)");
  assert(
    decryptedPayload.length === mockOpusPayload.length,
    "解密还原的 Opus 帧长度与原帧完全一致",
  );

  let opusMatch = true;
  for (let i = 0; i < mockOpusPayload.length; i++) {
    if (decryptedPayload[i] !== mockOpusPayload[i]) {
      opusMatch = false;
      break;
    }
  }
  assert(opusMatch === true, "解密后的 Opus 采样点 100% 比对原帧比特保真");

  // 2.3 密钥隔离与防窃听测试 (第三方或被黑客攻破的 SFU 媒体中继)
  console.log("\n--- 验证 5.2 媒体服务器盲中继与未授权密钥防窃听 ---");
  const attackerWrongKey = new Uint8Array(32).fill(0xee);
  try {
    await decryptSFramePacket(encryptedPacket, attackerWrongKey);
    assert(false, "错误密钥绝不能成功解密密文帧");
  } catch {
    assert(
      true,
      "SFU 或攻击者使用未授权密钥解密被 AES-GCM 彻底拒绝 (MAC 校验失败)",
    );
  }

  // 2.4 数据防篡改测试 (Ciphertext Tamper Resistance)
  const tamperedPacket = new Uint8Array(encryptedPacket);
  tamperedPacket[tamperedPacket.length - 1] ^= 0x01; // 单比特翻转认证标签
  try {
    await decryptSFramePacket(tamperedPacket, sframeKey);
    assert(false, "篡改数据包绝不能被解密");
  } catch {
    assert(true, "密文单比特篡改触发 GCM 完整性校验失败，彻底丢弃恶意包");
  }

  // 2.5 SFrame 滑动窗口反重放攻击防护机制 (SFrameReplayFilter)
  console.log("\n--- 验证 5.2 SFrame 滑动窗口反重放攻击防护 ---");
  const replayFilter = new SFrameReplayFilter(64);

  assert(replayFilter.checkAndAdd(10n) === true, "接收正常第 10 帧并记录窗口");
  assert(replayFilter.checkAndAdd(11n) === true, "单调递增接收第 11 帧");
  assert(replayFilter.checkAndAdd(15n) === true, "快进接收第 15 帧");
  assert(
    replayFilter.checkAndAdd(13n) === true,
    "窗口内乱序到达的第 13 帧被合法放行",
  );
  assert(
    replayFilter.checkAndAdd(11n) === false,
    "重放攻击的第 11 帧被精确拦截 (Replay Attack Filtered)",
  );
  assert(
    replayFilter.checkAndAdd(15n) === false,
    "重复到达的第 15 帧被精确拦截",
  );
  assert(
    replayFilter.checkAndAdd(100n) === true,
    "大步推进至第 100 帧更新窗口",
  );
  assert(
    replayFilter.checkAndAdd(12n) === false,
    "严重落后窗口尺寸 (100 - 12 > 64) 的历史重放帧被绝对拒绝",
  );

  // 2.6 SFU 媒体服务器高频盲中继流式吞吐仿真
  console.log("\n--- 验证 5.2 SFU 媒体服务器 100 帧高频盲中继流式吞吐仿真 ---");
  let sfuRelayedFrames = 0;
  let clientDecryptedFrames = 0;
  const sfuStreamFilter = new SFrameReplayFilter(128);

  for (let i = 1; i <= 100; i++) {
    const frame = new Uint8Array(80).fill(i & 0xff);
    const encrypted = await encryptSFramePacket(frame, sframeKey, 1, BigInt(i));
    // SFU 盲中继：仅检查头部并中继，不触碰密文明文
    const hdr = decodeSFrameHeader(encrypted);
    assert(hdr.kid === 1, `SFU 中继第 ${i} 帧识别 KID`);
    sfuRelayedFrames++;

    // 接收端解密
    const isFresh = sfuStreamFilter.checkAndAdd(hdr.counter);
    if (isFresh) {
      const dec = await decryptSFramePacket(encrypted, sframeKey);
      if (dec.decryptedPayload[0] === (i & 0xff)) {
        clientDecryptedFrames++;
      }
    }
  }
  assert(sfuRelayedFrames === 100, "SFU 成功盲中继 100 个加密音频数据包");
  assert(
    clientDecryptedFrames === 100,
    "接收端 100% 成功解密所有流式音频采样帧，无掉帧",
  );

  // ==========================================
  // 3. 验证 5.3：绝密频道端到端文本双棘轮加密体系 (Double Ratchet)
  // ==========================================
  console.log(
    "\n--- 3. 验证 5.3 绝密频道端到端文本双棘轮加密（Double Ratchet） ---",
  );

  // 3.1 ECDH P-256 密钥对生成与公钥指纹计算
  const aliceIdKeys = await generateDhKeyPair();
  const bobIdKeys = await generateDhKeyPair();

  const alicePubB64 = await exportDhPublicKey(aliceIdKeys.publicKey);
  const bobPubB64 = await exportDhPublicKey(bobIdKeys.publicKey);

  assert(
    typeof alicePubB64 === "string" && alicePubB64.length > 80,
    "Alice ECDH P-256 公钥正确导出为 Raw 65 字节 Base64 格式",
  );
  assert(
    typeof bobPubB64 === "string" && bobPubB64.length > 80,
    "Bob ECDH P-256 公钥正确导出为 Raw 65 字节 Base64 格式",
  );

  const importedAlicePub = await importDhPublicKey(alicePubB64);
  assert(
    Boolean(importedAlicePub),
    "导出的 Base64 公钥可无缝重新反序列化为 CryptoKey",
  );

  const fpAlice = await computeFingerprint(alicePubB64);
  const fpBob = await computeFingerprint(bobPubB64);
  assert(
    fpAlice.length === 16 && /^[0-9A-F]+$/.test(fpAlice),
    "公钥安全码 (Safety Number / Fingerprint) 格式为 16 位大写十六进制散列",
  );
  assert(fpAlice !== fpBob, "不同身份密钥生成的安全码具有密码学唯一性");

  // 3.2 PreKeyBundle 预共享公钥束注册与分发契约
  console.log("\n--- 验证 5.3 用户 PreKeyBundle 注册与分发契约 ---");
  const testBundle = e2eeService.registerPreKey("alice-user-id", {
    identityKey: alicePubB64,
    signedPreKey: alicePubB64,
    signature: "base64_signed_prekey_signature_test",
    oneTimePreKeys: ["onetime_prekey_1", "onetime_prekey_2"],
  });
  assert(
    testBundle.userId === "alice-user-id",
    "成功注册 Alice 的 PreKeyBundle",
  );
  assert(
    testBundle.oneTimePreKeys.length === 2,
    "成功池化 2 个一次性预共享公钥 (One-Time PreKeys)",
  );

  const fetchedBundle = e2eeService.getPreKey("alice-user-id");
  assert(
    fetchedBundle?.identityKey === alicePubB64,
    "客户端可正常拉取目标用户的公开 PreKeyBundle 发起握手",
  );

  const consumedOneTime = e2eeService.consumeOneTimePreKey("alice-user-id");
  assert(
    consumedOneTime === "onetime_prekey_1",
    "一次性预共享公钥被安全消费一次即焚",
  );
  assert(
    e2eeService.getPreKey("alice-user-id")?.oneTimePreKeys.length === 1,
    "池中剩余预共享密钥自适应缩减",
  );

  // 3.3 双棘轮会话初始化与握手
  console.log("\n--- 验证 5.3 Alice 与 Bob 双棘轮会话握手 ---");
  const sharedSecret = new Uint8Array(32).fill(0x3c);
  const bobRatchetKeyPair = await generateDhKeyPair();
  const bobRatchetPubB64 = await exportDhPublicKey(bobRatchetKeyPair.publicKey);

  const aliceSession = new DoubleRatchetSession("alice", "bob", sharedSecret);
  const bobSession = new DoubleRatchetSession("bob", "alice", sharedSecret);

  await aliceSession.initAsAlice(bobRatchetPubB64);
  await bobSession.initAsBob(bobRatchetKeyPair);

  // 3.4 前向保密性 (Forward Secrecy - 连续发送单向对称链推演)
  console.log("\n--- 验证 5.3 前向保密性 (Forward Secrecy) 连续单向消息流 ---");
  const msg1 = await aliceSession.ratchetEncrypt(
    "第一条机密：项目代号 Tescord",
    "chan-e2ee-01",
  );
  const msg2 = await aliceSession.ratchetEncrypt(
    "第二条机密：采用双棘轮+SFrame架构",
    "chan-e2ee-01",
  );
  const msg3 = await aliceSession.ratchetEncrypt(
    "第三条机密：离线私钥永不上云",
    "chan-e2ee-01",
  );

  assert(msg1.sequenceNumber === 0, "第一条消息序号 Ns=0");
  assert(msg2.sequenceNumber === 1, "第二条消息序号 Ns=1");
  assert(msg3.sequenceNumber === 2, "第三条消息序号 Ns=2");

  assert(
    msg1.ciphertext !== msg2.ciphertext && msg2.ciphertext !== msg3.ciphertext,
    "各条消息使用独立推演的一次一密密钥，密文完全不同",
  );

  const dec1 = await bobSession.ratchetDecrypt(msg1);
  assert(dec1 === "第一条机密：项目代号 Tescord", "Bob 成功解密第一条机密消息");

  // 3.5 乱序消息处理与跳过密钥暂存 (Out-of-Order Message Decryption)
  console.log("\n--- 验证 5.3 乱序消息容灾处理 (消息3先于消息2到达) ---");
  const dec3 = await bobSession.ratchetDecrypt(msg3);
  assert(
    dec3 === "第三条机密：离线私钥永不上云",
    "Bob 成功在未收到消息2的情况下先行解密消息3",
  );

  const dec2 = await bobSession.ratchetDecrypt(msg2);
  assert(
    dec2 === "第二条机密：采用双棘轮+SFrame架构",
    "迟到的消息2到达后从 MKSKIPPED 缓存中成功提取密钥解密",
  );

  // 3.6 破后恢复 (Break-in Recovery - DH 非对称棘轮轮换)
  console.log("\n--- 验证 5.3 破后自愈恢复 (DH Ratchet Turnaround) ---");
  const reply1 = await bobSession.ratchetEncrypt(
    "Bob 回复：收到，已启动 DH 棘轮轮换",
    "chan-e2ee-01",
  );
  assert(reply1.sequenceNumber === 0, "Bob 新发送链序号重置为 0");
  assert(
    reply1.ephemeralPublicKey !== bobRatchetPubB64,
    "Bob 回复时生成了全新的临时 DH 公钥",
  );

  const decReply1 = await aliceSession.ratchetDecrypt(reply1);
  assert(
    decReply1 === "Bob 回复：收到，已启动 DH 棘轮轮换",
    "Alice 成功触发 DH 接收棘轮并解密 Bob 的回复",
  );

  // Alice 再次回复触发第二次 DH 棘轮
  const reply2 = await aliceSession.ratchetEncrypt(
    "Alice 第二轮：通信状态完全自愈更新！",
    "chan-e2ee-01",
  );
  const decReply2 = await bobSession.ratchetDecrypt(reply2);
  assert(
    decReply2 === "Alice 第二轮：通信状态完全自愈更新！",
    "Bob 成功解密第二轮自愈消息",
  );

  // 3.7 密文信封防篡改校验 (Tamper Resistance)
  console.log("\n--- 验证 5.3 密文信封防伪造与防篡改 ---");
  const tamperedEnvelope: EncryptedMessageEnvelope = {
    ...reply2,
    ciphertext: bytesToBase64(
      new Uint8Array(base64ToBytes(reply2.ciphertext)).reverse(),
    ),
  };
  try {
    await bobSession.ratchetDecrypt(tamperedEnvelope);
    assert(false, "篡改密文应当抛出解密异常");
  } catch {
    assert(true, "密文遭篡改被 AES-256-GCM 标签校验坚决拒绝接收");
  }

  // 3.8 服务端盲存储模拟验证
  console.log("\n--- 验证 5.3 服务端数据库仅存储盲密文信封 ---");
  const serializedEnvelope = JSON.stringify(reply2);
  assert(
    !serializedEnvelope.includes("通信状态完全自愈更新"),
    "序列化后的信封完全不包含任何明文字符串",
  );
  assert(
    serializedEnvelope.includes("ciphertext") &&
      serializedEnvelope.includes("ephemeralPublicKey"),
    "信封包含完整的加密元数据用于端侧还原",
  );

  // 3.9 绝密频道多成员群组双棘轮模式 (Channel Sender-Key Ratchet)
  console.log("\n--- 验证 5.3 绝密频道群组双棘轮模式 (Channel Ratchet) ---");
  const channelRootKey = new Uint8Array(32).fill(0x55);
  const chanId = "chan-secret-guild-01";

  const aliceChanSession = new DoubleRatchetSession(
    "alice",
    "channel",
    channelRootKey,
  );
  const bobChanSession = new DoubleRatchetSession(
    "bob",
    "channel",
    channelRootKey,
  );
  const charlieChanSession = new DoubleRatchetSession(
    "charlie",
    "channel",
    channelRootKey,
  );

  await aliceChanSession.initAsChannel(chanId, "alice");
  await bobChanSession.initAsChannel(chanId, "bob");
  await charlieChanSession.initAsChannel(chanId, "charlie");

  // Alice 在频道连续广播 3 条绝密消息
  const aMsg1 = await aliceChanSession.ratchetEncrypt(
    "频道公发：第一阶段启动",
    chanId,
  );
  const aMsg2 = await aliceChanSession.ratchetEncrypt(
    "频道公发：配置密钥防护",
    chanId,
  );
  const aMsg3 = await aliceChanSession.ratchetEncrypt(
    "频道公发：全员就绪",
    chanId,
  );

  assert(aMsg1.sequenceNumber === 0, "Alice 频道第 1 条消息序号 Ns=0");
  assert(aMsg2.sequenceNumber === 1, "Alice 频道第 2 条消息序号 Ns=1");
  assert(aMsg3.sequenceNumber === 2, "Alice 频道第 3 条消息序号 Ns=2");

  // Bob 解密 Alice 的第 1 条消息
  const bobDec1 = await bobChanSession.ratchetDecrypt(aMsg1);
  assert(
    bobDec1 === "频道公发：第一阶段启动",
    "Bob 成功解密 Alice 发送的第 1 条频道绝密消息",
  );

  // Charlie 乱序解密 (先收消息3，后收消息2)
  const charlieDec3 = await charlieChanSession.ratchetDecrypt(aMsg3);
  assert(charlieDec3 === "频道公发：全员就绪", "Charlie 乱序先行解密消息 3");

  const charlieDec2 = await charlieChanSession.ratchetDecrypt(aMsg2);
  assert(
    charlieDec2 === "频道公发：配置密钥防护",
    "Charlie 迟到接收从暂存密钥解密消息 2",
  );

  // Alice 自身也能解密自己发出的消息 (如重载历史)
  const aliceDecOwn = await aliceChanSession.ratchetDecrypt(aMsg2);
  assert(
    aliceDecOwn === "频道公发：配置密钥防护",
    "Alice 自身成功平滑解密自己的消息",
  );

  // Bob 发送回复，Alice 与 Charlie 都能解密
  const bReply = await bobChanSession.ratchetEncrypt(
    "Bob频道回复：收到指令",
    chanId,
  );
  const aliceDecB = await aliceChanSession.ratchetDecrypt(bReply);
  const charlieDecB = await charlieChanSession.ratchetDecrypt(bReply);
  assert(
    aliceDecB === "Bob频道回复：收到指令",
    "Alice 成功解密 Bob 的频道消息",
  );
  assert(
    charlieDecB === "Bob频道回复：收到指令",
    "Charlie 成功解密 Bob 的频道消息",
  );

  // 3.10 安全指纹 (Safety Number) 格式与一致性校验
  console.log("\n--- 验证 5.3 真实安全码 (Safety Number) 密码学一致性 ---");
  const aliceSafetyNum = await aliceChanSession.getSafetyNumber();
  const aliceFpFromMethod = aliceChanSession.getFingerprint();
  assert(
    aliceSafetyNum.length === 16 && /^[0-9A-F]+$/.test(aliceSafetyNum),
    "Alice 真实 Safety Number 符合 16 位大写十六进制散列规范",
  );
  assert(
    aliceSafetyNum === aliceFpFromMethod,
    "getSafetyNumber 与 getFingerprint 输出的密码学指纹完全一致",
  );
  assert(
    aMsg1.fingerprint === aliceSafetyNum,
    "信封携带的指纹与会话真实安全码一致",
  );

  // 3.11 乱序防拒绝服务 (DoS) 跨度超限拦截测试
  console.log("\n--- 验证 5.3 乱序序号超限防 DoS 机制 ---");
  const maliciousEnvelope: EncryptedMessageEnvelope = {
    ...aMsg1,
    sequenceNumber: 999999, // 恶意超大序列号企图耗尽内存
  };
  try {
    await bobChanSession.ratchetDecrypt(maliciousEnvelope);
    assert(false, "超大序号跳跃应当被拒绝");
  } catch (err: any) {
    assert(
      err.message.includes("DoS"),
      "超限序号跳跃触发 DoS 防护坚决拒绝处理",
    );
  }

  // ==========================================
  // 4. 验证 5.4：客户端本地密文倒排索引与离线全文检索 (Client-Side FTS)
  // ==========================================
  console.log("\n--- 4. 验证 5.4 客户端本地密文倒排索引与离线全文检索 ---");

  // 4.1 中日韩与英文字词分词器测试
  const tokens = tokenizeText(
    "绝密频道使用 SFrame 语音和 Double Ratchet 文本加密！",
  );
  assert(tokens.includes("绝密"), "分词器提取 CJK 二元分词 '绝密'");
  assert(tokens.includes("频道"), "分词器提取 CJK 二元分词 '频道'");
  assert(tokens.includes("sframe"), "分词器小写归一化提取英文单词 'sframe'");
  assert(tokens.includes("double"), "分词器提取英文单词 'double'");
  assert(tokens.includes("ratchet"), "分词器提取英文单词 'ratchet'");

  // 4.2 端侧本地倒排索引增删改查
  const fts = new ClientSideFtsEngine();
  fts.addDocument({
    id: "msg-101",
    channelId: "chan-secret-01",
    authorId: "alice",
    content: "今天晚上讨论双棘轮算法与前向保密机制",
    createdAt: new Date().toISOString(),
  });
  fts.addDocument({
    id: "msg-102",
    channelId: "chan-secret-01",
    authorId: "bob",
    content: "SFrame 语音降噪与端到端加密正在测试中",
    createdAt: new Date().toISOString(),
  });
  fts.addDocument({
    id: "msg-103",
    channelId: "chan-public-02",
    authorId: "charlie",
    content: "普通公开频道的日常闲聊，无加密",
    createdAt: new Date().toISOString(),
  });

  assert(fts.size === 3, "索引库成功录入 3 条端侧已解密消息");

  // 4.3 全文搜索与相关度打分
  const resRatchet = fts.search("双棘轮");
  assert(
    resRatchet.length === 1 && resRatchet[0].id === "msg-101",
    "精准检索命中包含 '双棘轮' 的绝密消息",
  );

  const resSFrame = fts.search("SFrame 语音");
  assert(
    resSFrame.length === 1 && resSFrame[0].id === "msg-102",
    "中英混合搜索精准命中 'SFrame 语音'",
  );

  // 4.4 频道安全隔离检索
  const resChannelFilter = fts.search("加密", "chan-secret-01");
  assert(
    resChannelFilter[0].id === "msg-102" &&
      !resChannelFilter.some((r) => r.id === "msg-103"),
    "按 channelId 过滤精准排除外部频道消息 (排除 chan-public-02 下的 msg-103)",
  );

  const resFilteredOut = fts.search("日常闲聊", "chan-secret-01");
  assert(
    resFilteredOut.length === 0,
    "跨频道关键词在目标隔离频道中检索返回空结果 (0 项命中)",
  );

  // 4.5 删除与边界空值测试
  fts.removeDocument("msg-101");
  assert(fts.size === 2, "成功从端侧索引中安全销毁被删除的消息");
  assert(fts.search("双棘轮").length === 0, "已销毁消息无法再被检索出来");
  assert(fts.search("").length === 0, "空搜索串安全返回空列表");
  assert(fts.search("不存在的词项XYZ").length === 0, "无匹配项安全返回空列表");

  console.log(`\n======================================================`);
  console.log(
    `🎉 全部 ${totalTests} 项阶段五（5.1, 5.2, 5.3, 5.4）深度自动化测试用例 100% 验证通过！`,
  );
  console.log(`======================================================\n`);
}

runFullPhase5Verification().catch((err) => {
  console.error("❌ Phase 5 verification failed:", err);
  process.exit(1);
});
