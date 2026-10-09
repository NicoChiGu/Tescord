const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { app, utilityProcess } = require("electron");

async function run() {
  const profile = await mkdtemp(path.join(tmpdir(), "tescord-storage-worker-"));
  const worker = utilityProcess.fork(
    path.resolve(__dirname, "../dist/storage/storageWorker.js"),
    [],
    {
      env: { ...process.env, TESCORD_STORAGE_USER_DATA_DIR: profile },
      stdio: "pipe",
    },
  );
  let requestId = 0;
  const pending = new Map();
  let exited = false;
  worker.on("message", ({ id, result, error, success }) => {
    const callback = pending.get(id);
    if (!callback) return;
    pending.delete(id);
    if (success) callback.resolve(result);
    else callback.reject(new Error(error));
  });
  worker.on("exit", (code) => {
    exited = true;
    for (const { reject } of pending.values()) {
      reject(new Error(`Storage worker exited: ${code}`));
    }
    pending.clear();
  });
  const request = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const id = `direct-${++requestId}`;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });

  try {
    const messages = [1, 2, 3].map((sequence) => ({
      id: `message-${sequence}`,
      channelId: "channel-a",
      sequence,
      authorId: "user-a",
      content: `message ${sequence}`,
      createdAt: new Date(2026, 8, 28, 0, 0, sequence).toISOString(),
    }));
    await request("messages-save-batch", {
      userId: "user-a",
      channelId: "channel-a",
      messages,
    });
    assert.deepEqual(
      (
        await request("messages-get-latest", {
          userId: "user-a",
          channelId: "channel-a",
          limit: 2,
        })
      ).map(({ sequence }) => sequence),
      [2, 3],
    );
    assert.deepEqual(
      await request("messages-get-latest", {
        userId: "user-b",
        channelId: "channel-a",
      }),
      [],
    );

    // A queued request keeps its own user scope even after requests for B.
    const [a, b, oldA] = await Promise.all([
      request("messages-get-latest", {
        userId: "user-a",
        channelId: "channel-a",
      }),
      request("messages-get-latest", {
        userId: "user-b",
        channelId: "channel-a",
      }),
      request("messages-get-latest", {
        userId: "user-a",
        channelId: "channel-a",
      }),
    ]);
    assert.equal(a.length, 3);
    assert.deepEqual(b, []);
    assert.equal(oldA.length, 3);

    await assert.rejects(
      request("messages-get-latest", {
        userId: "../outside",
        channelId: "channel-a",
      }),
      /Invalid storage user ID/,
    );
    await assert.rejects(
      request("messages-get-latest", { channelId: "channel-a" }),
      /Invalid storage user ID/,
    );
    await assert.rejects(
      request("messages-get-latest", {
        userId: "guest",
        channelId: "channel-a",
      }),
      /Invalid storage user ID/,
    );
    assert.equal(
      (await request("stats-get", { userId: "user-a" })).messageCount,
      3,
    );
    assert.equal(
      (await request("stats-get", { userId: "user-b" })).messageCount,
      0,
    );
    console.log("storage worker: 9 scope/order checks passed");

    await request("messages-save-batch", {
      userId: "user-a",
      channelId: "channel-a",
      messages: [{ ...messages[0], id: "pending", sequence: 0 }],
    });
    await request("messages-save-batch", {
      userId: "user-a",
      channelId: "channel-b",
      messages: [
        { ...messages[1], id: "other-channel", channelId: "channel-b" },
      ],
    });
    assert.equal(
      (
        await request("messages-search-fts", {
          userId: "user-a",
          keyword: "message 2",
          channelId: "channel-a",
        })
      ).length,
      1,
    );
    await request("messages-reconcile", {
      userId: "user-a",
      channelId: "channel-a",
      messages: [],
      range: { minSequence: 2, maxSequence: 2 },
    });
    const bounded = await request("messages-get-latest", {
      userId: "user-a",
      channelId: "channel-a",
    });
    assert.deepEqual(
      bounded.map(({ id }) => id),
      ["pending", "message-1", "message-3"],
    );
    assert.deepEqual(
      await request("messages-search-fts", {
        userId: "user-a",
        keyword: "message 2",
        channelId: "channel-a",
      }),
      [],
    );
    await request("messages-reconcile", {
      userId: "user-a",
      channelId: "channel-a",
      messages: [],
      range: { minSequence: 1, maxSequence: Number.MAX_SAFE_INTEGER },
    });
    assert.deepEqual(
      (
        await request("messages-get-latest", {
          userId: "user-a",
          channelId: "channel-a",
        })
      ).map(({ id }) => id),
      ["pending"],
    );
    assert.deepEqual(
      (
        await request("messages-get-latest", {
          userId: "user-a",
          channelId: "channel-b",
        })
      ).map(({ id }) => id),
      ["other-channel"],
    );
    assert.deepEqual(
      await request("messages-get-latest", {
        userId: "user-b",
        channelId: "channel-a",
      }),
      [],
    );
    console.log(
      "storage worker: 6 real reconciliation/FTS/empty-history checks passed",
    );
  } finally {
    if (!exited) {
      await new Promise((resolve) => {
        worker.once("exit", resolve);
        worker.kill();
      });
    }
    const resolved = path.resolve(profile);
    const parent = path.resolve(tmpdir());
    if (
      path.dirname(resolved) !== parent ||
      !path.basename(resolved).startsWith("tescord-storage-worker-")
    ) {
      throw new Error("Refusing to remove unexpected test directory");
    }
    await rm(resolved, { recursive: true, force: true });
  }
}

app
  .whenReady()
  .then(run)
  .then(
    () => app.quit(),
    (error) => {
      console.error(error);
      process.exitCode = 1;
      app.quit();
    },
  );
