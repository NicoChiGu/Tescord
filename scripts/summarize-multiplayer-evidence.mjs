import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

// Reads only direct evidence and numeric latency files, never trace resources, tokens,
// SDP, HTTP headers or raw NetLogs. Keep failures in descriptive statistics.
const [inputArgument, logArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !logArgument || !outputArgument)
  throw new Error(
    "Usage: pnpm node scripts/summarize-multiplayer-evidence.mjs INPUT LOG OUTPUT",
  );
const root = process.cwd();
const input = resolve(inputArgument),
  logPath = resolve(logArgument);
const pathLabel = (path) => relative(root, path).replaceAll("\\", "/");
const statistic = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
};
const validProof = (proof, count, relay) =>
  proof?.phase === "active" &&
  proof.encrypted > 0 &&
  proof.decrypted > 0 &&
  proof.peers?.length === count - 1 &&
  new Set(proof.peers.map((peer) => peer.id)).size === count - 1 &&
  proof.peers.every(
    (peer) =>
      peer.codec === "audio/opus" &&
      peer.sent > 0 &&
      peer.received > 0 &&
      (peer.encrypted === undefined || peer.encrypted > 0) &&
      (peer.decrypted === undefined || peer.decrypted > 0) &&
      peer.rms > 0.001 &&
      peer.connected &&
      peer.pair?.local &&
      peer.pair.remote &&
      (!relay || peer.pair.local === "relay"),
  );
const validSustain = (event, count, relay) =>
  event.before?.length === count &&
  event.after?.length === count &&
  event.after.every((proof, index) => {
    const before = event.before[index];
    return (
      validProof(proof, count, relay) &&
      validProof(before, count, relay) &&
      proof.encrypted > before.encrypted &&
      proof.decrypted > before.decrypted &&
      proof.peers.every((peer) => {
        const previous = before.peers.find((row) => row.id === peer.id);
        return (
          previous &&
          peer.sent > previous.sent &&
          peer.received > previous.received &&
          (peer.encrypted === undefined ||
            peer.encrypted > previous.encrypted) &&
          (peer.decrypted === undefined || peer.decrypted > previous.decrypted)
        );
      })
    );
  });
const tests = [];
const latencyGates = [];
const groups = new Map();
for (const directory of await readdir(input, { withFileTypes: true })) {
  if (!directory.isDirectory() || directory.name.startsWith(".")) continue;
  const matrix = /(?:latency-gates|rotati)/.test(directory.name);
  const folder = join(input, directory.name);
  const rooms = [];
  for (const file of await readdir(folder)) {
    if (/^join-latency-\d+-(auto|relay)\.json$/.test(file)) {
      const value = JSON.parse(await readFile(join(folder, file), "utf8"));
      latencyGates.push({
        evidence: pathLabel(join(folder, file)),
        count: value.count,
        relay: value.relay,
        laterFirstPlayable: statistic(value.timings),
        allRemotePlayable: statistic(value.allRemoteTimings),
        firstParticipantReady: statistic(value.firstUserTimings),
        limitMs: value.limitMs,
        passed:
          value.samples >= 10 &&
          value.p95Ms <= value.limitMs &&
          value.firstUserP95Ms <= value.limitMs,
        scope:
          "Complete matrix latency gate, following all strict round assertions",
      });
      continue;
    }
    if (!/^multiplayer-.*\.json$/.test(file)) continue;
    const filePath = join(folder, file);
    const evidence = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(evidence.events) || !Array.isArray(evidence.endpoints))
      continue;
    const sustain = evidence.events.filter((event) => event.sustainedMs);
    const validBlocks = sustain.filter((event) =>
      validSustain(event, evidence.count, evidence.relay),
    );
    const room = {
      evidence: pathLabel(filePath),
      count: evidence.count,
      mode: evidence.mode,
      relay: evidence.relay,
      allRoutesSustained: validBlocks.map((event) => event.sustainedMs),
      perRemoteCryptoCounters:
        evidence.evidenceSchemaVersion >= 2 && validBlocks.length > 0,
      consoleErrorCount: evidence.errors.length,
      deviceTransferCount: evidence.events.filter(
        (event) => event.deviceTransfer,
      ).length,
      failedRequests: evidence.events
        .filter((event) => event.status >= 400 || event.failure)
        .map((event) => ({
          path: event.path,
          status: event.status ?? null,
          durationMs: event.durationMs ?? null,
          networkFailure: !!event.failure,
        })),
      stalledTransports: evidence.endpoints
        .filter(
          (endpoint) =>
            endpoint.proof?.timing?.stages?.published !== undefined &&
            endpoint.proof.timing.stages.connected === undefined,
        )
        .map((endpoint) => ({
          publishedMs: endpoint.proof.timing.stages.published,
          encrypted: endpoint.proof.encrypted,
          uplinkBytes: endpoint.proof.uplink?.sent ?? null,
        })),
    };
    rooms.push(room);
    const groupKey = `${evidence.mode}:${evidence.relay ? "relay" : "auto"}:${evidence.count}`;
    if (!groups.has(groupKey))
      groups.set(groupKey, {
        later: [],
        first: [],
        stages: {},
        candidatePairs: new Set(),
      });
    const group = groups.get(groupKey);
    for (const block of validBlocks)
      for (const proof of block.after)
        for (const peer of proof.peers)
          group.candidatePairs.add(`${peer.pair.local}->${peer.pair.remote}`);
    if (matrix && validBlocks.length) {
      // A failed HTTP request may recover media; keep those samples while the
      // strict test remains failed. Never infer a passed gate from this subset.
      for (const endpoint of evidence.endpoints.slice(1)) {
        if (Number.isFinite(endpoint.joinToFirstPlayableMs))
          group.later.push(endpoint.joinToFirstPlayableMs);
        const stages = endpoint.proof?.timing?.stages;
        if (stages)
          for (const [stage, offset] of Object.entries(stages)) {
            (group.stages[stage] ||= []).push(offset);
          }
      }
      for (const event of evidence.events)
        if (Number.isFinite(event.emptyRoomReadyMs))
          group.first.push(event.emptyRoomReadyMs);
    }
  }
  if (rooms.length) tests.push({ directory: pathLabel(folder), matrix, rooms });
}
const log = await readFile(logPath, "utf8");
const completedTests = [
  ...log.matchAll(/^\s+(ok|x)\s+\d+\s+\[([^\]]+)\].*$/gm),
].map((match) => ({
  passed: match[1] === "ok",
  project: match[2],
  label: match[0].trim(),
}));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  input: pathLabel(input),
  log: pathLabel(logPath),
  noDeployment: true,
  microphone: "browser oscillator",
  sameHostBrowsers: true,
  pass: completedTests.filter((test) => test.passed).length,
  fail: completedTests.filter((test) => !test.passed).length,
  acceptance:
    "Do not infer release acceptance from descriptive partial media statistics",
  completedTests,
  latencyGates,
  tests,
  latencyGroups: [...groups].map(([key, group]) => ({
    key,
    actualCandidatePairs: [...group.candidatePairs].sort(),
    laterFirstPlayable: statistic(group.later),
    firstParticipantReady: statistic(group.first),
    stageOffsets: Object.fromEntries(
      Object.entries(group.stages).map(([key, values]) => [
        key,
        statistic(values),
      ]),
    ),
    statisticsScope:
      "Matrix rooms with verified all-route sustained media, including recovered HTTP failures. Incomplete rounds remain failed and are not playable samples.",
  })),
};
await writeFile(
  resolve(outputArgument),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    pass: report.pass,
    fail: report.fail,
    roomEvidenceFiles: tests.reduce((sum, test) => sum + test.rooms.length, 0),
    output: outputArgument,
  }),
);
