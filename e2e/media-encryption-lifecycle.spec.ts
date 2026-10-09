import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type {
  MediaEncryptionJoinRequest,
  MediaEncryptionSnapshot,
  MediaEpochUpdatePushPayload,
  MediaKeyEnvelopePushPayload,
  MediaKeyAckPushPayload,
  MediaEncryptionSyncResult,
} from "@tescord/types";
import { createMultiplayerRoom } from "./helpers/encrypted-multiplayer";
import { exerciseMemberLeave } from "./helpers/member-leave-scenario";

for (const count of [3, 5]) {
  test(`${count} signed devices: member leave preserves remaining keys after retired receiver errors`, async ({
    browser,
    request,
  }, info) => {
    test.setTimeout(180000);
    await exerciseMemberLeave(browser, request, info, count, "p2p_mesh");
  });
}

for (const count of [3, 5]) {
  test(`${count} signed devices recover a lost WebSocket sync without HTTP polling`, async ({
    browser,
    request,
  }, info) => {
    test.setTimeout(150000);
    const syncRequests = Array.from({ length: count }, () => 0);
    let dropped = 0,
      duplicates = 0,
      httpSync = 0;
    let dropEligible = false;
    const room = await createMultiplayerRoom(
      browser,
      request,
      info,
      count,
      "p2p_mesh",
      false,
      async (page, index) => {
        page.on("request", (req) => {
          if (req.url().includes("/media-encryption/sync")) httpSync++;
        });
        await page.routeWebSocket("**/gateway", (socket) => {
          const server = socket.connectToServer();
          socket.onMessage((message) => {
            if (
              typeof message === "string" &&
              JSON.parse(message).t === "MEDIA_ENCRYPTION_SYNC"
            )
              syncRequests[index]++;
            server.send(message);
          });
          server.onMessage((message) => {
            if (
              typeof message === "string" &&
              JSON.parse(message).t === "MEDIA_ENCRYPTION_SYNC_RESULT"
            ) {
              if (index === 0 && dropEligible && dropped === 0) {
                dropped++;
                return;
              }
              socket.send(message);
              duplicates++;
            }
            socket.send(message);
          });
        });
      },
    );
    try {
      await room.join(room.endpoints[0]);
      await room.firstReady(room.endpoints[0]);
      // Lose a response during concurrent membership/key negotiation.
      dropEligible = true;
      await Promise.all(room.endpoints.slice(1).map(room.join));
      await room.waitForMedia(room.endpoints);
      await expect
        .poll(() => syncRequests[0], { timeout: 15000 })
        .toBeGreaterThan(1);
      await room.sustain(room.endpoints, 7000);
      await room.leave(room.endpoints[count - 1]);
      await room.waitForMedia(room.endpoints.slice(0, -1));
      await room.join(room.endpoints[count - 1]);
      await room.waitForMedia(room.endpoints);
      await room.sustain(room.endpoints, 5000);
      expect(dropped).toBe(1);
      expect(duplicates).toBeGreaterThan(0);
      expect(syncRequests.every((value) => value > 0)).toBe(true);
      expect(httpSync).toBe(0);
      expect(room.errors).toEqual([]);
      const proof = {
        count,
        syncRequests,
        dropped,
        duplicates,
        httpSync,
      };
      const path = info.outputPath("websocket-sync-proof.json");
      await writeFile(path, JSON.stringify(proof, null, 2));
      await info.attach("websocket-sync-proof.json", {
        path,
        contentType: "application/json",
      });
    } finally {
      await room.cleanup();
    }
  });
}

test("an older identified Gateway retains HTTP sync compatibility", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let httpSync = 0;
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page) => {
      page.on("request", (req) => {
        if (req.url().includes("/media-encryption/sync")) httpSync++;
      });
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (typeof message === "string") {
            const packet = JSON.parse(message) as {
              t?: string;
              d?: { mediaEncryptionSync?: boolean };
            };
            if (packet.t === "READY" && packet.d) {
              delete packet.d.mediaEncryptionSync;
              return socket.send(JSON.stringify(packet));
            }
          }
          socket.send(message);
        });
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    await Promise.all(room.endpoints.slice(1).map(room.join));
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 6000);
    expect(httpSync).toBeGreaterThan(0);
    expect(room.errors).toEqual([]);
    await info.attach("legacy-gateway-sync-proof.json", {
      body: JSON.stringify({ httpSync }),
      contentType: "application/json",
    });
  } finally {
    await room.cleanup();
  }
});

test("a delayed old room epoch cannot bootstrap a new registration", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let oldEpoch: string | undefined;
  let oldEnvelope: string | undefined;
  let sendOldEpoch: (() => void) | undefined;
  let joins = 0;
  let oldContextId: string | undefined;
  let newContextId: string | undefined;
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 0) return;
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        sendOldEpoch = () => {
          if (oldEpoch) socket.send(oldEpoch);
          if (oldEnvelope) socket.send(oldEnvelope);
        };
        server.onMessage((message) => {
          if (typeof message === "string" && joins === 1) {
            const event = JSON.parse(message) as {
              t?: string;
              d?: MediaEpochUpdatePushPayload;
            };
            if (event.t === "MEDIA_EPOCH_UPDATE" && !oldEpoch)
              oldEpoch = message;
            if (event.t === "MEDIA_KEY_ENVELOPE" && !oldEnvelope)
              oldEnvelope = message;
          }
          socket.send(message);
        });
      });
      await page.route("**/media-encryption/join", async (route) => {
        joins++;
        if (joins > 1) {
          // Neither the new registration nor its authoritative snapshot exists
          // yet. Old packets must not provoke an early unauthorized sync.
          sendOldEpoch?.();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const response = await route.fetch();
        const snapshot = (await response.json()) as MediaEncryptionSnapshot;
        if (joins === 1) {
          oldContextId = snapshot.context.contextId;
          oldEpoch = JSON.stringify({
            op: 0,
            t: "MEDIA_EPOCH_UPDATE",
            d: {
              channelId: snapshot.context.channelId,
              context: snapshot.context,
            },
          });
        } else {
          newContextId = snapshot.context.contextId;
        }
        await route.fulfill({ response });
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    await room.join(room.endpoints[1]);
    await room.waitForMedia(room.endpoints.slice(0, 2));
    expect(oldEnvelope).toBeDefined();
    await room.leave(room.endpoints[1]);
    await room.leave(room.endpoints[0]);
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    expect(newContextId).toBeTruthy();
    expect(newContextId).not.toBe(oldContextId);
    await Promise.all(room.endpoints.slice(1).map(room.join));
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 5000);
    expect(room.errors).toEqual([]);
    await info.attach("bootstrap-registration-proof.json", {
      body: JSON.stringify({ oldContextId, newContextId, joins }),
      contentType: "application/json",
    });
  } finally {
    await room.cleanup();
  }
});

test("lost successful HTTP responses retry the same signed publication and ACK idempotently", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index > 1) return;
      await page.addInitScript(
        ({ operation }) => {
          const original = window.fetch;
          const attempts: string[] = [];
          let lost = false;
          (
            window as unknown as {
              lostMediaResponses: {
                attempts: string[];
                operation: string;
                lostBody?: string;
              };
            }
          ).lostMediaResponses = { attempts, operation };
          window.fetch = async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            if (!url.endsWith(`/media-encryption/${operation}`))
              return original(input, init);
            attempts.push(String(init?.body));
            const response = await original(input, init);
            if (response.ok && !lost) {
              lost = true;
              (
                window as unknown as {
                  lostMediaResponses: { lostBody?: string };
                }
              ).lostMediaResponses.lostBody = String(init?.body);
              // The server already committed this request; only its response is lost.
              throw new TypeError("Injected lost committed media response");
            }
            return response;
          };
        },
        { operation: index === 0 ? "publish" : "acknowledge" },
      );
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    await room.join(room.endpoints[1]);
    await room.waitForMedia(room.endpoints.slice(0, 2));
    await room.join(room.endpoints[2]);
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 5000);
    const evidence = await Promise.all(
      room.endpoints.slice(0, 2).map((endpoint) =>
        endpoint.page.evaluate(
          () =>
            (
              window as unknown as {
                lostMediaResponses: {
                  attempts: string[];
                  operation: string;
                  lostBody?: string;
                };
              }
            ).lostMediaResponses,
        ),
      ),
    );
    for (const item of evidence) {
      expect(item.attempts.length).toBeGreaterThanOrEqual(2);
      expect(item.lostBody).toBeDefined();
      expect(
        item.attempts.filter((body) => body === item.lostBody).length,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(room.errors).toEqual([]);
    await info.attach("idempotent-response-loss-proof.json", {
      body: JSON.stringify(
        evidence.map((item) => ({
          operation: item.operation,
          attempts: item.attempts.length,
          identicalRetry:
            item.attempts.filter((body) => body === item.lostBody).length >= 2,
        })),
      ),
      contentType: "application/json",
    });
  } finally {
    await room.cleanup();
  }
});

/** All envelopes below originate from the real registry and signed devices;
 * only transport ordering and delivery are changed by the test. */
test("signed future envelopes before epoch updates and duplicate ACKs converge", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let hold = false,
    heldEpoch: string | undefined,
    reordered = 0,
    duplicates = 0;
  let releaseEpoch: (() => void) | undefined;
  const heldSync: string[] = [];
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 0) return;
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (typeof message !== "string") return socket.send(message);
          const event = JSON.parse(message) as {
            t?: string;
            d?:
              | MediaEpochUpdatePushPayload
              | MediaKeyEnvelopePushPayload
              | MediaKeyAckPushPayload;
          };
          if (hold && event.t === "MEDIA_EPOCH_UPDATE") {
            heldEpoch = message;
            releaseEpoch = () => {
              if (heldEpoch) socket.send(heldEpoch);
              heldEpoch = undefined;
              hold = false;
              for (const result of heldSync.splice(0)) socket.send(result);
            };
            return;
          }
          if (hold && heldEpoch && event.t === "MEDIA_KEY_ENVELOPE") {
            const envelope = event.d as MediaKeyEnvelopePushPayload;
            const context = (
              JSON.parse(heldEpoch) as { d: MediaEpochUpdatePushPayload }
            ).d.context;
            if (envelope.contextRevision === context.contextRevision) {
              socket.send(message);
              reordered++;
              setTimeout(() => releaseEpoch?.(), 50);
              return;
            }
          }
          if (hold && event.t === "MEDIA_ENCRYPTION_SYNC_RESULT") {
            heldSync.push(message);
            return;
          }
          socket.send(message);
          if (event.t === "MEDIA_KEY_ENVELOPE" || event.t === "MEDIA_KEY_ACK") {
            socket.send(message);
            duplicates++;
          }
        });
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    hold = true;
    await room.join(room.endpoints[1]);
    await expect.poll(() => reordered, { timeout: 15000 }).toBeGreaterThan(0);
    await room.join(room.endpoints[2]);
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 5000);
    expect(duplicates).toBeGreaterThan(0);
    expect(room.errors).toEqual([]);
    await info.attach("ordered-signed-envelope-proof.json", {
      body: JSON.stringify({ reordered, duplicates }),
      contentType: "application/json",
    });
  } finally {
    releaseEpoch?.();
    await room.cleanup();
  }
});

test("a delayed old snapshot cannot roll back a newer signed three-device epoch", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let hold = false,
    capturedRevision = 0,
    newestRevision = 0,
    release: (() => void) | undefined;
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 0) return;
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (typeof message === "string") {
            const event = JSON.parse(message) as {
              t?: string;
              d?: MediaEpochUpdatePushPayload | MediaEncryptionSyncResult;
            };
            if (event.t === "MEDIA_EPOCH_UPDATE")
              newestRevision = Math.max(
                newestRevision,
                (event.d as MediaEpochUpdatePushPayload).context
                  .contextRevision,
              );
            if (
              event.t === "MEDIA_ENCRYPTION_SYNC_RESULT" &&
              hold &&
              !capturedRevision
            ) {
              const result = event.d as MediaEncryptionSyncResult;
              if (result.success) {
                capturedRevision = result.snapshot.context.contextRevision;
                release = () => socket.send(message);
                return;
              }
            }
          }
          socket.send(message);
        });
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    hold = true;
    await expect
      .poll(() => capturedRevision, { timeout: 10000 })
      .toBeGreaterThan(0);
    await room.join(room.endpoints[1]);
    await expect.poll(() => newestRevision).toBeGreaterThan(capturedRevision);
    hold = false;
    release?.();
    await room.join(room.endpoints[2]);
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 5000);
    expect(room.errors).toEqual([]);
    await info.attach("stale-snapshot-proof.json", {
      body: JSON.stringify({ capturedRevision, newestRevision }),
      contentType: "application/json",
    });
  } finally {
    release?.();
    await room.cleanup();
  }
});

test("lost signed envelope and ACK pushes recover through bounded snapshot synchronization", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let droppedEnvelope = 0,
    droppedAck = 0;
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 0) return;
      await page.routeWebSocket("**/gateway", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (typeof message === "string") {
            const event = JSON.parse(message) as { t?: string };
            if (event.t === "MEDIA_KEY_ENVELOPE" && droppedEnvelope === 0) {
              droppedEnvelope++;
              return;
            }
            if (event.t === "MEDIA_KEY_ACK" && droppedAck === 0) {
              droppedAck++;
              return;
            }
          }
          socket.send(message);
        });
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    await Promise.all(room.endpoints.slice(1).map(room.join));
    await room.waitForMedia(room.endpoints);
    await room.sustain(room.endpoints, 5000);
    expect(droppedEnvelope).toBe(1);
    expect(droppedAck).toBe(1);
    expect(room.errors).toEqual([]);
  } finally {
    await room.cleanup();
  }
});

test("retryable registration snapshots and delayed old leave cannot revoke a rejoined device", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(150000);
  let retryableSnapshots = 0;
  let oldLeave: { url: string; body: MediaEncryptionJoinRequest } | undefined;
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 1) return;
      await page.route("**/media-encryption/join", async (route) => {
        if (retryableSnapshots++ < 2)
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "MEDIA_CONTEXT_STALE",
              error: "MEDIA_CONTEXT_STALE",
            }),
          });
        await route.continue();
      });
      await page.route("**/media-encryption/leave", async (route) => {
        oldLeave = {
          url: route.request().url(),
          body: route.request().postDataJSON() as MediaEncryptionJoinRequest,
        };
        await route.continue();
      });
    },
  );
  try {
    await room.join(room.endpoints[0]);
    await room.firstReady(room.endpoints[0]);
    await room.join(room.endpoints[1]);
    await room.waitForMedia(room.endpoints.slice(0, 2));
    await room.join(room.endpoints[2]);
    await room.waitForMedia(room.endpoints);
    const rejoining = room.endpoints[1];
    await room.leave(rejoining);
    await expect.poll(() => Boolean(oldLeave)).toBe(true);
    await room.waitForMedia([room.endpoints[0], room.endpoints[2]]);
    const previous = oldLeave!;
    await room.join(rejoining);
    await room.waitForMedia(room.endpoints);
    const replay = await request.post(previous.url, {
      headers: { Authorization: `Bearer ${rejoining.session.accessToken}` },
      data: previous.body,
    });
    expect(replay.ok()).toBe(true);
    await room.sustain(room.endpoints, 5000);
    expect(retryableSnapshots).toBeGreaterThanOrEqual(3);
    expect(room.errors).toEqual([]);
    await info.attach("registration-incarnation-proof.json", {
      body: JSON.stringify({
        retryableSnapshots,
        staleLeaveAcknowledged: replay.status(),
        registrationId: previous.body.registrationId,
      }),
      contentType: "application/json",
    });
  } finally {
    await room.cleanup();
  }
});
