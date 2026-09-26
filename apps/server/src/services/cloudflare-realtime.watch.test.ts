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
