import { test, expect } from "@playwright/test";
import { createMultiplayerRoom } from "./helpers/encrypted-multiplayer";

test("Gateway roster updates survive delayed initial P2P ICE preparation", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  let entered = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    3,
    "p2p_mesh",
    false,
    async (page, index) => {
      if (index !== 0) return;
      await page.route("**/api/network/ice-servers", async (route) => {
        if (!entered) {
          entered = true;
          await gate;
        }
        await route.continue();
      });
    },
  );
  const roster = () =>
    room.endpoints[0].page.evaluate(() =>
      (
        window as unknown as {
          voiceMeshManager: { getOtherMemberCount(): number };
        }
      ).voiceMeshManager.getOtherMemberCount(),
    );
  try {
    await room.join(room.endpoints[0]);
    await expect.poll(() => entered, { timeout: 10000 }).toBe(true);
    await Promise.all([
      room.join(room.endpoints[1]),
      room.join(room.endpoints[2]),
    ]);
    await expect.poll(roster, { timeout: 10000 }).toBe(2);
    release();
    await room.waitForMedia(room.endpoints);
    expect(await roster()).toBe(2);
    await room.sustain(room.endpoints, 5000);
    expect(room.errors).toEqual([]);
    await info.attach("bootstrap-roster-proof.json", {
      body: JSON.stringify({
        heldIce: entered,
        expectedPeers: 2,
        retainedPeers: await roster(),
      }),
      contentType: "application/json",
    });
  } finally {
    release();
    await room.cleanup();
  }
});
