import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createMultiplayerRoom } from "../e2e/helpers/encrypted-multiplayer";
import { exerciseMemberLeave } from "../e2e/helpers/member-leave-scenario";

for (const count of [3, 5]) {
  test(`${count} signed devices: member leave preserves remaining keys after retired receiver errors`, async ({
    browser,
    request,
  }, info) => {
    test.setTimeout(180000);
    await exerciseMemberLeave(browser, request, info, count, "cloudflare_sfu");
  });
}

test.afterAll(async ({ request }, info) => {
  const denied = await request.post("http://127.0.0.1:3102/__e2e/media/drain", {
    headers: { Authorization: "Bearer invalid-cleanup-token" },
  });
  expect(denied.status()).toBe(403);
  const response = await request.post(
    "http://127.0.0.1:3102/__e2e/media/drain",
    {
      headers: {
        Authorization: `Bearer ${process.env.TESCORD_REAL_MEDIA_CLEANUP_TOKEN}`,
      },
      timeout: 30000,
    },
  );
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ drained: true });
  await info.attach("remote-sfu-cleanup.json", {
    body: Buffer.from(JSON.stringify({ drained: true, at: Date.now() })),
    contentType: "application/json",
  });
});

// Deliberately never points at a target deployment; all accounts are in a UUID database.
for (const count of [3, 5]) {
  test(`${count} signed devices: sequential SFU joins, 60 seconds encrypted audio, rejoin and transfer`, async ({
    browser,
    request,
  }, info) => {
    test.setTimeout(300000);
    const room = await createMultiplayerRoom(
      browser,
      request,
      info,
      count,
      "cloudflare_sfu",
      info.project.name === "relay",
    );
    try {
      const active = [];
      for (const endpoint of room.endpoints) {
        await room.join(endpoint);
        active.push(endpoint);
        if (active.length === 1) await room.firstReady(endpoint);
        else await room.waitForMedia(active);
      }
      await room.sustain(active, 60000);
      console.log(
        `[multiplayer-real] ${info.project.name}: ${count} devices sustained encrypted audio for 60 seconds`,
      );
      const last = active[active.length - 1];
      await room.leave(last);
      await room.waitForMedia(active.slice(0, -1));
      await room.join(last);
      await room.waitForMedia(active);
      await room.leave(active[0]);
      await room.waitForMedia(active.slice(1));
      await room.join(active[0]);
      await room.waitForMedia(active);
      await room.transfer(active[1], active);
      expect(room.errors).toEqual([]);
    } finally {
      await room.cleanup();
    }
  });

  test(`${count} signed devices: ten concurrent SFU joins and ten rotation joins with latency gates`, async ({
    browser,
    request,
  }, info) => {
    test.setTimeout(1800000);
    const relay = info.project.name === "relay";
    const timings: number[] = [];
    const allRemoteTimings: number[] = [];
    const firstUserTimings: number[] = [];
    for (let iteration = 0; iteration < 20; iteration++) {
      const room = await createMultiplayerRoom(
        browser,
        request,
        info,
        count,
        "cloudflare_sfu",
        relay,
      );
      try {
        // Odd rounds deliberately join new devices while the first two are rotating.
        await room.join(room.endpoints[0]);
        await room.firstReady(room.endpoints[0]);
        firstUserTimings.push(
          room.endpoints[0].readyAt! - room.endpoints[0].joinedAt!,
        );
        if (iteration % 2) {
          const gate = await room.holdNextPublication(room.endpoints[0]);
          try {
            await room.join(room.endpoints[1]);
            await gate.wait();
            await Promise.all(room.endpoints.slice(2).map(room.join));
          } finally {
            await gate.release();
          }
        } else await Promise.all(room.endpoints.slice(1).map(room.join));
        await room.waitForMedia(room.endpoints);
        for (const endpoint of room.endpoints.slice(1)) {
          expect(endpoint.firstPlayableAt).toBeDefined();
          timings.push(endpoint.firstPlayableAt! - endpoint.joinedAt!);
          allRemoteTimings.push(endpoint.playableAt! - endpoint.joinedAt!);
        }
        await room.sustain(room.endpoints, 5000);
        expect(room.errors).toEqual([]);
        console.log(
          `[multiplayer-real] ${info.project.name}: ${count} devices completed round ${iteration + 1}/20, first ready ${firstUserTimings[firstUserTimings.length - 1]} ms`,
        );
      } finally {
        await room.cleanup();
      }
    }
    timings.sort((a, b) => a - b);
    const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    allRemoteTimings.sort((a, b) => a - b);
    const allRemoteP95Ms =
      allRemoteTimings[Math.ceil(allRemoteTimings.length * 0.95) - 1];
    firstUserTimings.sort((a, b) => a - b);
    const firstUserP95Ms =
      firstUserTimings[Math.ceil(firstUserTimings.length * 0.95) - 1];
    const latencyPath = info.outputPath(
      `join-latency-${count}-${info.project.name}.json`,
    );
    await writeFile(
      latencyPath,
      JSON.stringify(
        {
          count,
          relay,
          samples: timings.length,
          timings,
          p95Ms,
          timingDefinition: "firstPlayableEncryptedAudio",
          allRemoteTimings,
          allRemoteP95Ms,
          firstUserTimings,
          firstUserP95Ms,
          limitMs: relay ? 10000 : 5000,
        },
        null,
        2,
      ),
    );
    await info.attach(`join-latency-${count}-${info.project.name}.json`, {
      path: latencyPath,
      contentType: "application/json",
    });
    expect(timings.length).toBeGreaterThanOrEqual(10);
    expect(p95Ms).toBeLessThanOrEqual(relay ? 10000 : 5000);
    expect(firstUserP95Ms).toBeLessThanOrEqual(relay ? 10000 : 5000);
  });
}
