import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudflareRealtimeService } from "./cloudflare-realtime.service.js";

const hostSession = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const viewerSession = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const secondViewerSession = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const screenTrack = "screen-11111111-1111-1111-1111-111111111111";

function setup() {
  const service = new CloudflareRealtimeService();
  service.registerSession(hostSession, "host", "voice-a", "login-host");
  service.registerSession(viewerSession, "viewer", "voice-a", "login-viewer-a");
  service.registerSession(
    secondViewerSession,
    "viewer",
    "voice-a",
    "login-viewer-b",
  );
  service.addTracks([
    {
      channelId: "voice-a",
      sessionId: hostSession,
      userId: "host",
      trackName: screenTrack,
      kind: "video",
      source: "screen",
      mid: "2",
    },
  ]);
  service.markTracksReady(hostSession);
  return service;
}

test("watch count requires confirmed screen subscription and deduplicates user sessions", () => {
  const service = setup();
  assert.equal(service.watchStream(viewerSession, hostSession), null);
  service.recordSubscriptions(viewerSession, [
    {
      mid: "3",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  assert.equal(service.watchStream(viewerSession, hostSession), null);
  service.confirmSubscriptions(viewerSession);
  assert.equal(service.watchStream(viewerSession, hostSession)?.viewerCount, 1);
  assert.equal(service.watchStream(viewerSession, hostSession)?.viewerCount, 1);
  service.recordSubscriptions(secondViewerSession, [
    {
      mid: "4",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(secondViewerSession);
  assert.equal(
    service.watchStream(secondViewerSession, hostSession)?.viewerCount,
    1,
  );
  assert.equal(service.drainViewerEvents().length, 1);
  assert.equal(
    service.unwatchStream(viewerSession, hostSession)?.viewerCount,
    1,
  );
  assert.equal(
    service.unwatchStream(secondViewerSession, hostSession)?.viewerCount,
    0,
  );
  assert.equal(service.drainViewerEvents().at(-1)?.viewerCount, 0);
});

test("watch count clears on viewer and host teardown", () => {
  const service = setup();
  service.recordSubscriptions(viewerSession, [
    {
      mid: "3",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(viewerSession);
  assert.equal(service.watchStream(viewerSession, hostSession)?.viewerCount, 1);
  service.removeSession(viewerSession);
  assert.equal(
    service.streamWatchState(viewerSession, hostSession)?.viewerCount,
    0,
  );
  assert.equal(service.drainViewerEvents().at(-1)?.viewerCount, 0);

  service.recordSubscriptions(secondViewerSession, [
    {
      mid: "4",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(secondViewerSession);
  assert.equal(
    service.watchStream(secondViewerSession, hostSession)?.viewerCount,
    1,
  );
  service.removeTracks(hostSession, [screenTrack]);
  assert.equal(
    service.streamWatchState(secondViewerSession, hostSession),
    null,
  );
  assert.equal(service.drainViewerEvents().at(-1)?.viewerCount, 0);
});

test("cross-channel and unowned subscription MID cannot count or unsubscribe", () => {
  const service = setup();
  const otherSession = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  service.registerSession(
    otherSession,
    "outsider",
    "voice-b",
    "login-outsider",
  );
  service.recordSubscriptions(otherSession, [
    {
      mid: "3",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(otherSession);
  assert.equal(service.watchStream(otherSession, hostSession), null);
  assert.equal(
    service.ownsSubscriptionMid(otherSession, "voice-b", "3"),
    false,
  );
  assert.equal(
    service.ownsSubscriptionMid(viewerSession, "voice-a", "3"),
    false,
  );
  assert.equal(
    service.ownsSubscriptionMid(otherSession, "voice-a", "3"),
    false,
  );
});

test("host kick closes every viewer screen subscription and denies new sessions", async () => {
  const service = setup();
  const closed: Array<{ sessionId: string; mids: string[] }> = [];
  service.closeTracks = async ({ sessionId, tracks }) => {
    closed.push({
      sessionId,
      mids: tracks.map((track) => track.mid!).filter(Boolean),
    });
  };
  for (const [sessionId, mid] of [
    [viewerSession, "3"],
    [secondViewerSession, "4"],
  ]) {
    service.recordSubscriptions(sessionId, [
      {
        mid,
        publisherSessionId: hostSession,
        trackName: screenTrack,
      },
    ]);
    service.confirmSubscriptions(sessionId);
    service.watchStream(sessionId, hostSession);
  }
  assert.equal(
    service.streamWatchState(viewerSession, hostSession)?.viewerCount,
    1,
  );
  assert.equal(
    await service.kickStreamViewer("voice-a", "outsider", "viewer"),
    false,
  );
  assert.equal(
    await service.kickStreamViewer("voice-a", "host", "viewer"),
    true,
  );
  assert.deepEqual(closed, [
    { sessionId: viewerSession, mids: ["3"] },
    { sessionId: secondViewerSession, mids: ["4"] },
  ]);
  assert.equal(
    service.streamWatchState(viewerSession, hostSession)?.viewerCount,
    0,
  );
  assert.equal(service.isStreamViewerKicked(hostSession, "viewer"), true);
  const newSession = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  service.registerSession(newSession, "viewer", "voice-a", "login-viewer-new");
  service.recordSubscriptions(newSession, [
    {
      mid: "5",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(newSession);
  assert.equal(service.watchStream(newSession, hostSession), null);
  service.removeTracks(hostSession, [screenTrack]);
  assert.equal(service.isStreamViewerKicked(hostSession, "viewer"), false);
});

test("failed SFU close keeps the ban so a retry cannot resubscribe", async () => {
  const service = setup();
  service.recordSubscriptions(viewerSession, [
    {
      mid: "3",
      publisherSessionId: hostSession,
      trackName: screenTrack,
    },
  ]);
  service.confirmSubscriptions(viewerSession);
  service.watchStream(viewerSession, hostSession);
  service.closeTracks = async () => {
    throw new Error("SFU close failed");
  };
  await assert.rejects(
    service.kickStreamViewer("voice-a", "host", "viewer"),
    /SFU close failed/,
  );
  assert.equal(service.isStreamViewerKicked(hostSession, "viewer"), true);
  assert.equal(
    service.streamWatchState(viewerSession, hostSession)?.viewerCount,
    1,
  );
});
