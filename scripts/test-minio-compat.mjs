import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
);
const minioRoot = dirname(require.resolve("minio/package.json"));
const esm = await import(pathToFileURL(join(minioRoot, "dist/esm/minio.mjs")));
const cjs = require(join(minioRoot, "dist/main/minio.js"));

assert.equal(typeof esm.Client, "function");
assert.equal(typeof cjs.Client, "function");

const notificationModules = [
  [
    "ESM",
    await import(pathToFileURL(join(minioRoot, "dist/esm/notification.mjs"))),
  ],
  ["CommonJS", require(join(minioRoot, "dist/main/notification.js"))],
];

for (const [format, { NotificationPoller }] of notificationModules) {
  let requests = 0;
  const client = {
    region: "us-east-1",
    async makeRequestAsync() {
      requests += 1;
      return Readable.from([
        "\n",
        '{"Records":[{"eventName":"s3:ObjectCreated:Put"}]}\n',
      ]);
    },
  };

  await new Promise((resolve, reject) => {
    const poller = new NotificationPoller(client, "test-bucket", "", "", []);
    const timeout = setTimeout(() => {
      poller.stop();
      reject(new Error(`${format} notification parser timed out`));
    }, 5000);
    poller.on("notification", (record) => {
      poller.stop();
      clearTimeout(timeout);
      try {
        assert.equal(record.eventName, "s3:ObjectCreated:Put");
        assert.equal(requests, 1);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    poller.on("error", (error) => {
      poller.stop();
      clearTimeout(timeout);
      reject(error);
    });
    poller.start();
  });
  console.log(`${format} MinIO notification parser passed`);
}
