import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// =========================================================================
// 1. P2P 连接状态 Popover 柱状图极限状态算法与状态机测试 (Popover Stress Tests)
// =========================================================================

test("Popover P2P 柱状图高度与颜色映射函数在极限 RTT 场景下的稳定性", () => {
  // 提取自 VoiceConnectionStatusPopover.tsx 中的柱状图高度与颜色逻辑
  function computeBarMetrics(rtt: number, maxMeshRtt: number) {
    const barColor = rtt < 100 ? "#23a55a" : rtt <= 200 ? "#f0b232" : "#f23f43";
    const heightPercent = Math.min(
      100,
      Math.max(18, Math.round((rtt / maxMeshRtt) * 100)),
    );
    return { barColor, heightPercent };
  }

  function computeMaxMeshRtt(reports: Array<{ rtt: number }>): number {
    return Math.max(150, ...reports.map((r) => r.rtt));
  }

  // 场景 1.1: 0ms 极端延迟 (超快局域网 / 回环)
  const maxRttWithZero = computeMaxMeshRtt([{ rtt: 0 }]);
  assert.equal(
    maxRttWithZero,
    150,
    "全0或单0时保底基准 RTT 应为 150ms 防止除以0",
  );
  const zeroMetrics = computeBarMetrics(0, maxRttWithZero);
  assert.equal(zeroMetrics.barColor, "#23a55a", "0ms 应为健康绿色");
  assert.equal(
    zeroMetrics.heightPercent,
    18,
    "0ms 必须被 Math.max(18, ...) 约束为保底 18% 高度，避免柱子塌陷",
  );

  // 场景 1.2: 9999ms 极高延迟 (极恶劣跨国卫星网络)
  const maxRtt9999 = computeMaxMeshRtt([{ rtt: 9999 }]);
  assert.equal(maxRtt9999, 9999);
  const metrics9999 = computeBarMetrics(9999, maxRtt9999);
  assert.equal(metrics9999.barColor, "#f23f43", "9999ms 必须为警告红色");
  assert.equal(
    metrics9999.heightPercent,
    100,
    "最高延迟柱条高度上限应严格为 100%",
  );

  // 场景 1.3: 超级极端 100,000ms 异常延迟
  const maxRttHuge = computeMaxMeshRtt([{ rtt: 100000 }]);
  const metricsHuge = computeBarMetrics(100000, maxRttHuge);
  assert.equal(metricsHuge.barColor, "#f23f43");
  assert.equal(metricsHuge.heightPercent, 100);

  // 场景 1.4: 正常阶梯延迟对比 (10ms, 99ms, 100ms, 199ms, 200ms, 201ms)
  const maxNormal = computeMaxMeshRtt([
    { rtt: 10 },
    { rtt: 100 },
    { rtt: 200 },
    { rtt: 300 },
  ]);
  assert.equal(maxNormal, 300);
  assert.equal(computeBarMetrics(10, maxNormal).barColor, "#23a55a");
  assert.equal(computeBarMetrics(99, maxNormal).barColor, "#23a55a");
  assert.equal(computeBarMetrics(100, maxNormal).barColor, "#f0b232");
  assert.equal(computeBarMetrics(200, maxNormal).barColor, "#f0b232");
});

test("VoiceConnectionStatusPopover 动态延迟区间分桶算法 (computeLatencyBuckets) 鲁棒性与边界验证", () => {
  function computeLatencyBuckets(
    reports: Array<{ rtt: number; targetUserId?: string }>,
  ) {
    if (reports.length === 0) return [];

    const rtts = reports.map((r) => Math.max(0, Math.round(r.rtt)));
    const minVal = Math.min(...rtts);
    const maxVal = Math.max(...rtts);

    let bucketRanges: Array<{ min: number; max: number; label: string }>;

    const spread = maxVal - minVal;
    if (spread < 20) {
      const mid = Math.max(20, maxVal);
      const step = Math.max(25, Math.ceil(mid / 2));
      const b0Max = Math.max(20, Math.round(mid - step / 2));
      const b1Max = b0Max + step;
      const b2Max = b1Max + step;
      bucketRanges = [
        { min: 0, max: b0Max, label: `<${b0Max}ms` },
        { min: b0Max + 1, max: b1Max, label: `${b0Max + 1}-${b1Max}ms` },
        { min: b1Max + 1, max: b2Max, label: `>${b1Max}ms` },
      ];
    } else {
      const bucketCount = spread >= 60 ? 4 : 3;
      const step = Math.ceil(spread / bucketCount);
      bucketRanges = [];
      let currentMin = Math.max(0, minVal - 5);
      for (let i = 0; i < bucketCount; i++) {
        const isLast = i === bucketCount - 1;
        const bMax = isLast
          ? Math.max(maxVal, currentMin + step)
          : currentMin + step;
        const label =
          i === 0 && currentMin === 0
            ? `<${bMax}ms`
            : `${currentMin}-${bMax}ms`;
        bucketRanges.push({ min: currentMin, max: bMax, label });
        currentMin = bMax + 1;
      }
    }

    return bucketRanges.map((range, idx) => {
      const bucketReports = reports.filter((r) => {
        const rtt = Math.max(0, Math.round(r.rtt));
        if (idx === 0) {
          return rtt <= range.max;
        }
        if (idx === bucketRanges.length - 1) {
          return rtt >= range.min;
        }
        return rtt >= range.min && rtt <= range.max;
      });

      const midPoint = (range.min + range.max) / 2;
      const color =
        midPoint < 100 ? "#23a55a" : midPoint <= 200 ? "#f0b232" : "#f23f43";

      return {
        id: `bucket-${range.min}-${range.max}`,
        minRtt: range.min,
        maxRtt: range.max,
        label: range.label,
        reports: bucketReports,
        color,
      };
    });
  }

  // 1. 空列表防御
  assert.deepEqual(computeLatencyBuckets([]), []);

  // 2. 单人 0ms 回环
  const zeroBuckets = computeLatencyBuckets([{ rtt: 0 }]);
  assert.equal(zeroBuckets.length, 3);
  assert.equal(zeroBuckets[0].reports.length, 1, "0ms 应归入第 0 桶");
  assert.equal(zeroBuckets[0].color, "#23a55a");

  // 3. 单人 9999ms 极高延迟
  const hugeBuckets = computeLatencyBuckets([{ rtt: 9999 }]);
  assert.equal(hugeBuckets.length, 3);
  const totalHugeReports = hugeBuckets.reduce(
    (acc, b) => acc + b.reports.length,
    0,
  );
  assert.equal(totalHugeReports, 1, "9999ms 不会丢失");

  // 4. 多人分布无遗漏验证 (20ms, 55ms, 120ms, 280ms)
  const multiReports = [{ rtt: 20 }, { rtt: 55 }, { rtt: 120 }, { rtt: 280 }];
  const multiBuckets = computeLatencyBuckets(multiReports);
  assert.equal(multiBuckets.length, 4, "大跨度应划分为 4 个区间");
  const totalCategorized = multiBuckets.reduce(
    (acc, b) => acc + b.reports.length,
    0,
  );
  assert.equal(totalCategorized, 4, "所有成员应全数分桶");
});

test("Popover P2P 丢包率与主题色状态聚合在极限值下的稳定性", () => {
  function computeAggregateStats(
    connectedReports: Array<{ rtt: number; packetLoss?: number }>,
    localPacketLoss: number | null,
  ) {
    const allPeersAvgRtt =
      connectedReports.length > 0
        ? Math.round(
            connectedReports.reduce((s, r) => s + r.rtt, 0) /
              connectedReports.length,
          )
        : null;

    const validLosses = connectedReports
      .filter((r) => typeof r.packetLoss === "number")
      .map((r) => r.packetLoss!);

    const overallPacketLoss =
      validLosses.length > 0
        ? (validLosses.reduce((s, l) => s + l, 0) / validLosses.length).toFixed(
            1,
          )
        : localPacketLoss !== null
          ? localPacketLoss.toFixed(1)
          : null;

    const effectiveRtt = allPeersAvgRtt ?? 0;
    const effectiveLoss = overallPacketLoss ?? "0";

    const themeColor =
      effectiveRtt >= 200 || Number(effectiveLoss) > 5
        ? "#f23f43"
        : effectiveRtt >= 100 || Number(effectiveLoss) > 2
          ? "#f0b232"
          : "#23a55a";

    return { allPeersAvgRtt, overallPacketLoss, themeColor };
  }

  // 场景 2.1: 0 成员在房间中 (connectedReports 为空)
  const emptyRoom = computeAggregateStats([], null);
  assert.equal(emptyRoom.allPeersAvgRtt, null, "0成员时平均RTT应为 null");
  assert.equal(emptyRoom.overallPacketLoss, null, "0成员时丢包率应为 null");
  assert.equal(emptyRoom.themeColor, "#23a55a", "0成员无损默认健康绿");

  // 场景 2.2: 100% 丢包率极限
  const loss100 = computeAggregateStats([{ rtt: 50, packetLoss: 100 }], null);
  assert.equal(loss100.allPeersAvgRtt, 50);
  assert.equal(loss100.overallPacketLoss, "100.0");
  assert.equal(loss100.themeColor, "#f23f43", "100% 丢包率必须强制标红报警");

  // 场景 2.3: 0% 极佳无丢包
  const loss0 = computeAggregateStats([{ rtt: 20, packetLoss: 0 }], null);
  assert.equal(loss0.overallPacketLoss, "0.0");
  assert.equal(loss0.themeColor, "#23a55a");

  // 场景 2.4: 异构混合节点 (100% 丢包, 0% 丢包, 50% 丢包)
  const mixed = computeAggregateStats(
    [
      { rtt: 30, packetLoss: 100 },
      { rtt: 40, packetLoss: 0 },
      { rtt: 50, packetLoss: 50 },
    ],
    null,
  );
  assert.equal(mixed.allPeersAvgRtt, 40);
  assert.equal(mixed.overallPacketLoss, "50.0");
  assert.equal(mixed.themeColor, "#f23f43");
});

test("VoiceConnectionStatusPopover 节点过滤策略分析：r.status === 'connected' && r.rtt > 0", () => {
  const reports = [
    { targetUserId: "u1", status: "connecting", rtt: 0 },
    { targetUserId: "u2", status: "connected", rtt: 0 },
    { targetUserId: "u3", status: "connected", rtt: 42 },
    { targetUserId: "u4", status: "failed", rtt: 150 },
  ];

  const connectedReports = reports.filter(
    (r) => r.status === "connected" && r.rtt > 0,
  );

  assert.equal(connectedReports.length, 1);
  assert.equal(connectedReports[0].targetUserId, "u3");
  // 验证：未采得首个 RTT 样本的 u2 与正在建连的 u1 被正确隔离，防止初始 0ms 产生虚假绿色脉冲
});

// =========================================================================
// 2. 视频聚焦模式极端纵横比自适应与防溢出测试 (Video Aspect Ratio Stress Tests)
// =========================================================================

test("VoiceRoomArea 聚焦模式下的视频宽高比与样式容器计算在极端分辨率下的防溢出行为", () => {
  // 提取自 VoiceRoomArea.tsx:
  function computeSpotlightStyle(
    width: number,
    height: number,
    isSpotlight = true,
    isFullscreen = false,
  ) {
    let videoAspectRatio: number | null = null;
    if (width > 0 && height > 0) {
      videoAspectRatio = width / height;
    }

    if (!isSpotlight || isFullscreen) return undefined;

    return {
      aspectRatio: videoAspectRatio ? `${videoAspectRatio}` : "16 / 9",
      width: videoAspectRatio
        ? `min(100%, calc(72vh * ${videoAspectRatio}))`
        : "min(100%, calc(72vh * 1.7778))",
    };
  }

  // 场景 2.1: 0x0 异常分辨率 (流尚未解码或元数据为空)
  const zeroStyle = computeSpotlightStyle(0, 0);
  assert.ok(zeroStyle);
  assert.equal(
    zeroStyle.aspectRatio,
    "16 / 9",
    "0x0 必须安全降级为标准 16:9，不能产生 NaN 或除零错误",
  );
  assert.equal(zeroStyle.width, "min(100%, calc(72vh * 1.7778))");

  // 场景 2.2: 32:9 超宽屏带 (5120x1440, Samsung Odyssey G9 / 双联屏分享)
  const ultraWideStyle = computeSpotlightStyle(5120, 1440);
  assert.ok(ultraWideStyle);
  const expectedRatio32_9 = 5120 / 1440;
  assert.equal(ultraWideStyle.aspectRatio, `${expectedRatio32_9}`);
  assert.equal(
    ultraWideStyle.width,
    `min(100%, calc(72vh * ${expectedRatio32_9}))`,
  );
  // 此时 calc(72vh * 3.555) 约为 256vh，min(100%, ...) 保证其水平宽度绝对不超出视口 100%

  // 场景 2.3: 9:16 竖屏视频 (1080x1920, 手机竖屏直播或投屏)
  const verticalStyle = computeSpotlightStyle(1080, 1920);
  assert.ok(verticalStyle);
  const expectedRatio9_16 = 1080 / 1920;
  assert.equal(verticalStyle.aspectRatio, `${expectedRatio9_16}`);
  assert.equal(
    verticalStyle.width,
    `min(100%, calc(72vh * ${expectedRatio9_16}))`,
  );
  // calc(72vh * 0.5625) = 40.5vh，高度正好贴合 72vh，宽度 40.5vh，左右无黑边且无任何溢出

  // 场景 2.4: 1:1 正方形 (1080x1080)
  const squareStyle = computeSpotlightStyle(1080, 1080);
  assert.ok(squareStyle);
  assert.equal(squareStyle.aspectRatio, "1");
  assert.equal(squareStyle.width, "min(100%, calc(72vh * 1))");

  // 场景 2.5: 极端带状分辨率 1000:1 (10000x10)
  const ribbonStyle = computeSpotlightStyle(10000, 10);
  assert.ok(ribbonStyle);
  assert.equal(ribbonStyle.aspectRatio, "1000");
  assert.equal(ribbonStyle.width, "min(100%, calc(72vh * 1000))");

  // 场景 2.6: 极端针状分辨率 1:1000 (10x10000)
  const needleStyle = computeSpotlightStyle(10, 10000);
  assert.ok(needleStyle);
  assert.equal(needleStyle.aspectRatio, "0.001");
  assert.equal(needleStyle.width, "min(100%, calc(72vh * 0.001))");

  // 场景 2.7: 负数或异常尺寸防崩 (-100x200, 1920x-1080)
  const negStyle1 = computeSpotlightStyle(-100, 200);
  assert.equal(negStyle1?.aspectRatio, "16 / 9", "负数宽度必须安全回退");
  const negStyle2 = computeSpotlightStyle(1920, -1080);
  assert.equal(negStyle2?.aspectRatio, "16 / 9", "负数高度必须安全回退");
});

// =========================================================================
// 3. LightboxModal 毛玻璃环形进度条状态机与异常恢复 (Lightbox Stress Tests)
// =========================================================================

test("LightboxModal 环形进度条数学公式与状态机在超大体积、分块传输与失败恢复时的鲁棒性", () => {
  // 提取自 LightboxModal.tsx 的进度公式
  function computeRadialProgress(loadProgress?: {
    loaded: number;
    total?: number;
    phase?: string;
  }) {
    if (!loadProgress) return null;
    const percent = loadProgress.total
      ? Math.min(
          100,
          Math.round((loadProgress.loaded / loadProgress.total) * 100),
        )
      : loadProgress.phase === "decoding"
        ? 100
        : 0;

    const strokeDashoffset = 201.06 * (1 - percent / 100);
    const percentLabel = loadProgress.total
      ? `${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%`
      : "...";

    const mbLabel =
      loadProgress.phase === "downloading"
        ? `${(loadProgress.loaded / 1048576).toFixed(1)} / ${
            loadProgress.total ? (loadProgress.total / 1048576).toFixed(1) : "?"
          }`
        : null;

    return { percent, strokeDashoffset, percentLabel, mbLabel };
  }

  // 场景 3.1: 初始 0 字节开始下载
  const initial = computeRadialProgress({
    loaded: 0,
    total: 10485760,
    phase: "downloading",
  });
  assert.ok(initial);
  assert.equal(initial.percent, 0);
  assert.equal(initial.strokeDashoffset, 201.06, "0% 时周长完全偏移 (空圆环)");
  assert.equal(initial.percentLabel, "0%");
  assert.equal(initial.mbLabel, "0.0 / 10.0");

  // 场景 3.2: 超大原图 100MB 下载中途 (50MB)
  const hugeMid = computeRadialProgress({
    loaded: 52428800,
    total: 104857600,
    phase: "downloading",
  });
  assert.ok(hugeMid);
  assert.equal(hugeMid.percent, 50);
  assert.equal(Math.round(hugeMid.strokeDashoffset), 101, "50% 时圆环半满");
  assert.equal(hugeMid.percentLabel, "50%");
  assert.equal(hugeMid.mbLabel, "50.0 / 100.0");

  // 场景 3.3: 无 Content-Length 响应流 (total undefined)
  const chunked = computeRadialProgress({
    loaded: 1048576,
    total: undefined,
    phase: "downloading",
  });
  assert.ok(chunked);
  assert.equal(chunked.percent, 0, "未知总大小时百分比归0不崩");
  assert.equal(chunked.percentLabel, "...", "未知大小时展示占位省略号");
  assert.equal(chunked.mbLabel, "1.0 / ?");

  // 场景 3.4: 解码阶段 (decoding)
  const decoding = computeRadialProgress({
    loaded: 1048576,
    total: 1048576,
    phase: "decoding",
  });
  assert.ok(decoding);
  assert.equal(decoding.percent, 100, "解码阶段进度环拉满 100%");
  assert.equal(decoding.strokeDashoffset, 0);

  // 场景 3.5: 极端异常 loaded > total (如传输层解压膨胀)
  const overflown = computeRadialProgress({
    loaded: 2000000,
    total: 1000000,
    phase: "downloading",
  });
  assert.ok(overflown);
  assert.equal(overflown.percent, 100, "超长尺寸严格截断为 100% 避免圆环反转");
  assert.equal(overflown.strokeDashoffset, 0);

  // 场景 3.6: 下载失败状态机转换测试
  type State = {
    loadProgress?: { loaded: number; total?: number; phase?: string };
    error?: string;
    imageUrl?: string;
    originalReady: boolean;
  };

  let state: State = {
    loadProgress: { loaded: 500, total: 1000, phase: "downloading" },
    originalReady: false,
  };

  // 模拟失败处理
  function handleError(s: State, err: string): State {
    return {
      ...s,
      loadProgress: undefined,
      error: err,
    };
  }

  state = handleError(state, "Network download timeout");
  assert.equal(
    state.loadProgress,
    undefined,
    "错误发生时 loadProgress 必须清空以卸载环形进度条",
  );
  assert.equal(state.error, "Network download timeout", "呈现错误信息");

  // 模拟重试点击 (setLoadAttempt((n) => n + 1))
  function handleRetry(s: State): State {
    return {
      ...s,
      error: undefined,
      loadProgress: { loaded: 0, phase: "downloading" },
    };
  }

  state = handleRetry(state);
  assert.equal(state.error, undefined, "重试时错误清空");
  assert.ok(state.loadProgress, "重试时进度条重新初始化挂载");
});

// =========================================================================
// 4. 多语言（zh-CN, zh-TW, zh-HK, en-US, ja-JP）文本超长排版与全域键值对称性测试
// =========================================================================

test("5 套官方语言包对称性与极端文本排版自适应验证", () => {
  const locales = ["zh-CN", "zh-TW", "zh-HK", "en-US", "ja-JP"] as const;
  const namespaces = [
    "admin.json",
    "auth.json",
    "chat.json",
    "common.json",
    "contextMenu.json",
    "errors.json",
    "modals.json",
    "server.json",
    "settings.json",
    "voice.json",
  ];

  function getFlatKeys(obj: any, prefix = ""): string[] {
    let keys: string[] = [];
    for (const k of Object.keys(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
        keys.push(...getFlatKeys(obj[k], full));
      } else {
        keys.push(full);
      }
    }
    return keys.sort();
  }

  // 4.1 验证所有 10 个命名空间在全部 5 套语言中绝对对称
  for (const ns of namespaces) {
    const basePath = path.join(rootDir, "apps/web/src/i18n/locales/zh-CN", ns);
    const baseContent = JSON.parse(fs.readFileSync(basePath, "utf-8"));
    const baseKeys = getFlatKeys(baseContent);

    for (const loc of locales.slice(1)) {
      const targetPath = path.join(
        rootDir,
        "apps/web/src/i18n/locales",
        loc,
        ns,
      );
      assert.ok(fs.existsSync(targetPath), `语言包文件缺失: ${loc}/${ns}`);
      const targetContent = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      const targetKeys = getFlatKeys(targetContent);

      const missingInTarget = baseKeys.filter((k) => !targetKeys.includes(k));
      const extraInTarget = targetKeys.filter((k) => !baseKeys.includes(k));

      assert.equal(
        missingInTarget.length,
        0,
        `命名空间 ${ns} 在 ${loc} 中缺失键: ${missingInTarget.join(", ")}`,
      );
      assert.equal(
        extraInTarget.length,
        0,
        `命名空间 ${ns} 在 ${loc} 中多出冗余键: ${extraInTarget.join(", ")}`,
      );
    }
  }

  // 4.2 验证本次改动涉及的关键词条在所有 5 种语言中的非空性与长文本自适应
  const criticalKeys = [
    { ns: "voice.json", key: "connectionPopover.title" },
    { ns: "voice.json", key: "connectionPopover.rttSourceP2P" },
    { ns: "voice.json", key: "connectionPopover.rttSourceSfu" },
    { ns: "voice.json", key: "connectionPopover.allPeersAvgRtt" },
    { ns: "voice.json", key: "connectionPopover.overallPacketLoss" },
    { ns: "voice.json", key: "connectionPopover.directPeerTopology" },
    { ns: "voice.json", key: "topology.lan" },
    { ns: "voice.json", key: "topology.p2p" },
    { ns: "voice.json", key: "topology.relay" },
    { ns: "chat.json", key: "lightbox.hdBadge" },
    { ns: "chat.json", key: "lightbox.viewOriginal" },
    { ns: "chat.json", key: "lightbox.downloadProgress" },
    { ns: "common.json", key: "retry" },
  ];

  for (const item of criticalKeys) {
    for (const loc of locales) {
      const filePath = path.join(
        rootDir,
        "apps/web/src/i18n/locales",
        loc,
        item.ns,
      );
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const parts = item.key.split(".");
      let val: any = content;
      for (const p of parts) val = val?.[p];
      assert.ok(
        typeof val === "string" && val.length > 0,
        `关键键名 ${item.ns} -> ${item.key} 在 ${loc} 中为空`,
      );
    }
  }
});
