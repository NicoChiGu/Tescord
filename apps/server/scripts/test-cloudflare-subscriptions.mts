import assert from "node:assert/strict";
import { CloudflareRealtimeService } from "../src/services/cloudflare-realtime.service.js";
const service = new CloudflareRealtimeService();
const fetchOriginal = globalThis.fetch;
const originalId = process.env.CLOUDFLARE_CALLS_APP_ID;
const originalSecret = process.env.CLOUDFLARE_CALLS_APP_SECRET;
process.env.CLOUDFLARE_CALLS_APP_ID = "isolated-subscription-test";
process.env.CLOUDFLARE_CALLS_APP_SECRET = "isolated-subscription-test-secret";
const request = {
  sessionId: "viewer",
  channelId: "channel",
  tracks: [
    { publisherSessionId: "publisher-a", trackName: "microphone-a" },
    { publisherSessionId: "publisher-b", trackName: "microphone-b" },
  ],
};
let passed = 0;
const response = (tracks: unknown[]) => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ tracks }), {
      headers: { "Content-Type": "application/json" },
    });
};
try {
  response(
    request.tracks.map((track) => ({
      trackName: track.trackName,
      sessionId: track.publisherSessionId,
      errorCode: "not_found_track_error",
    })),
  );
  assert.equal((await service.subscribeTracks(request)).tracks.length, 2);
  console.log(
    "PASS all explicit rejections preserve known non-allocation result",
  );
  passed++;
  response([
    { trackName: "microphone-b", sessionId: "publisher-b", mid: "2" },
    {
      trackName: "microphone-a",
      sessionId: "publisher-a",
      errorCode: "not_found_track_error",
    },
  ]);
  const partial = await service.subscribeTracks(request);
  assert.equal(partial.tracks[0].trackName, "microphone-b");
  assert.equal(partial.tracks[0].mid, "2");
  console.log(
    "PASS reordered partial response preserves verified resource identities",
  );
  passed++;
  for (const tracks of [
    [
      { trackName: "microphone-a", sessionId: "publisher-b", mid: "1" },
      { trackName: "microphone-b", mid: "2" },
    ],
    [
      { trackName: "microphone-a", mid: "1" },
      { trackName: "microphone-a", mid: "2" },
    ],
    [{ trackName: "microphone-a" }, { trackName: "microphone-b", mid: "2" }],
  ]) {
    response(tracks);
    await assert.rejects(() => service.subscribeTracks(request));
    console.log(
      "PASS mismatched, duplicate or ambiguous allocation is rejected",
    );
    passed++;
  }
  service.registerSession(
    "old-session",
    "user",
    "channel",
    "login",
    undefined,
    "gateway",
  );
  service.addTracks([
    {
      sessionId: "old-session",
      userId: "user",
      channelId: "channel",
      trackName: "microphone-old",
      mid: "0",
      kind: "audio",
      source: "microphone",
    },
  ]);
  service.markTracksReady("old-session");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async () => {
    await waiting;
    return new Response(JSON.stringify({ tracks: [{ mid: "0" }] }));
  };
  const cleanup = service.revokeSession("old-session");
  assert.equal(service.ownsSession("old-session", "user", "login"), false);
  assert.deepEqual(service.getTracks("channel"), []);
  release();
  await cleanup;
  assert.equal(
    service.ownsRetiredSession("old-session", "user", "login"),
    true,
  );
  assert.equal(
    service.ownsRetiredSession("old-session", "other-user", "login"),
    false,
  );
  assert.equal(
    service.ownsRetiredSession("old-session", "user", "other-login"),
    false,
  );
  console.log(
    "PASS local ownership and publications revoke before delayed remote cleanup",
  );
  passed++;
  for (const scenario of [
    "valid",
    "revoked",
    "lookup-failed",
    "invalid-before",
  ] as const) {
    const guarded = new CloudflareRealtimeService();
    guarded.registerSession("viewer", "viewer-user", "channel", "viewer-login");
    guarded.registerSession("publisher", "host-user", "channel", "host-login");
    guarded.addTracks([
      {
        sessionId: "publisher",
        userId: "host-user",
        channelId: "channel",
        trackName: "screen",
        mid: "0",
        kind: "video",
        source: "screen",
      },
    ]);
    guarded.markTracksReady("publisher");
    guarded.recordSubscriptions("viewer", [
      {
        mid: "1",
        publisherSessionId: "publisher",
        trackName: "screen",
      },
    ]);
    let permit = scenario !== "invalid-before",
      lookupFailed = false;
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let providerCalls = 0;
    globalThis.fetch = async (input) => {
      providerCalls++;
      if (String(input).endsWith("/renegotiate")) {
        enter();
        await gate;
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ tracks: [{ mid: "1" }] }));
    };
    const answer = guarded.renegotiate(
      {
        sessionId: "viewer",
        sessionDescription: { type: "answer", sdp: "v=0" },
      },
      async () => {
        if (lookupFailed)
          throw new Error("isolated authorization lookup failure");
        return permit;
      },
    );
    if (scenario === "invalid-before") {
      assert.equal(await answer, false);
      assert.equal(providerCalls, 0);
      assert.equal(guarded.watchStream("viewer", "publisher"), null);
    } else {
      await entered;
      assert.equal(guarded.watchStream("viewer", "publisher"), null);
      if (scenario === "revoked") permit = false;
      if (scenario === "lookup-failed") lookupFailed = true;
      resume();
      if (scenario === "lookup-failed")
        await assert.rejects(answer, /isolated authorization lookup failure/);
      else assert.equal(await answer, scenario === "valid");
      if (scenario === "valid")
        assert.equal(
          guarded.watchStream("viewer", "publisher")?.hostUserId,
          "host-user",
        );
      else {
        assert.equal(guarded.getSession("viewer"), undefined);
        assert.equal(guarded.watchStream("viewer", "publisher"), null);
      }
    }
    console.log(
      `PASS ${scenario}: renegotiation rechecks authority before confirming tracks`,
    );
    passed++;
  }
  const late = new CloudflareRealtimeService();
  late.registerSession("late", "user", "channel", "login");
  let enteredLate!: () => void, releaseLate!: () => void;
  const lateEntered = new Promise<void>((resolve) => {
    enteredLate = resolve;
  });
  const lateGate = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  const closed: string[][] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/tracks/new")) {
      enteredLate();
      await lateGate;
      return new Response(
        JSON.stringify({
          sessionDescription: { type: "answer", sdp: "v=0" },
          tracks: [{ mid: "7", trackName: "late-mic" }],
        }),
      );
    }
    const body = JSON.parse(String(init?.body)) as {
      force: boolean;
      tracks: Array<{ mid: string }>;
    };
    assert.equal(body.force, true);
    closed.push(body.tracks.map((track) => track.mid));
    return new Response(JSON.stringify({ tracks: body.tracks }));
  };
  const publication = late.publishTracks({
    sessionId: "late",
    channelId: "channel",
    sessionDescription: { type: "offer", sdp: "v=0" },
    tracks: [
      { mid: "7", trackName: "late-mic", kind: "audio", source: "microphone" },
    ],
  });
  await lateEntered;
  await late.revokeSession("late");
  releaseLate();
  const allocated = await publication;
  await late.revokeSession(
    "late",
    allocated.tracks.flatMap((track) =>
      track.mid ? [track.mid, track.mid] : [],
    ),
  );
  await late.drainTeardowns();
  assert.equal(late.getSession("late"), undefined);
  assert.deepEqual(late.getTracks("channel"), []);
  assert.deepEqual(closed, [["7"]]);
  console.log(
    "PASS known allocations returned after revoke are force-closed without republishing",
  );
  passed++;
} finally {
  globalThis.fetch = fetchOriginal;
  if (originalId === undefined) delete process.env.CLOUDFLARE_CALLS_APP_ID;
  else process.env.CLOUDFLARE_CALLS_APP_ID = originalId;
  if (originalSecret === undefined)
    delete process.env.CLOUDFLARE_CALLS_APP_SECRET;
  else process.env.CLOUDFLARE_CALLS_APP_SECRET = originalSecret;
}
console.log(`cloudflare-subscriptions: ${passed} passed, 0 failed`);
