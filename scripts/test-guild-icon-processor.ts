import assert from "node:assert/strict";
import sharp from "../apps/server/node_modules/sharp";
import { GuildIconProcessor } from "../apps/server/src/services/guild-icon.service.js";

const processor = new GuildIconProcessor();
let assertions = 0;
async function animated(
  width: number,
  height: number,
  colors: number[][],
  delays: number[],
) {
  const raw = Buffer.alloc(width * height * colors.length * 4);
  colors.forEach((color, frame) => {
    for (let pixel = 0; pixel < width * height; pixel++) {
      raw.set([...color, 255], (frame * width * height + pixel) * 4);
    }
  });
  return sharp(raw, {
    raw: {
      width,
      height: height * colors.length,
      channels: 4,
      pageHeight: height,
    },
  })
    .gif({ delay: delays, loop: 3, effort: 1, keepDuplicateFrames: true })
    .toBuffer();
}
async function pixel(bytes: Buffer, left: number, top: number, page = 0) {
  const { data } = await sharp(bytes, { page, pages: 1 })
    .ensureAlpha()
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [...data];
}
async function rejects(job: () => Promise<unknown>, message?: RegExp) {
  await assert.rejects(job, message);
  assertions++;
}

async function main() {
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const source = await animated(32, 16, colors, [40, 90, 150]);
  await processor.run(() => processor.validateUpload(source));
  assertions++;
  await rejects(() =>
    processor.validateUpload(Buffer.from("GIF89a invalid body")),
  );
  const largeOutputSource = await animated(
    8,
    8,
    Array.from({ length: 160 }, (_, i) => [i, 100, 200]),
    Array(160).fill(40),
  );
  const largeOutput = await processor.process(largeOutputSource, {
    fileUrl: "unit",
    output: "animated",
  });
  assert.equal((await processor.metadata(largeOutput.bytes, true)).frames, 160);
  assertions++;
  assert.equal(
    (
      await sharp(
        await processor.frame(largeOutput.bytes, 159, true),
      ).metadata()
    ).width,
    512,
  );
  assertions++;
  await rejects(() => processor.metadata(largeOutput.bytes));
  const meta = await processor.metadata(source);
  assert.deepEqual(meta, {
    width: 32,
    height: 16,
    frames: 3,
    delays: [40, 90, 150],
  });
  assertions++;
  const result = await processor.process(source, {
    fileUrl: "unused-unit-fixture",
    output: "animated",
    crop: { left: 8, top: 0, size: 16 },
  });
  const outputMeta = await sharp(result.bytes, { animated: true }).metadata();
  assert.equal(outputMeta.width, 512);
  assertions++;
  assert.equal(outputMeta.pageHeight, 512);
  assertions++;
  assert.equal(outputMeta.pages, 3);
  assertions++;
  assert.deepEqual(outputMeta.delay, [40, 90, 150]);
  assertions++;
  assert.equal(outputMeta.loop, 3);
  assertions++;
  for (let index = 0; index < colors.length; index++) {
    assert.deepEqual(await pixel(result.bytes, 256, 256, index), [
      ...colors[index],
      255,
    ]);
    assertions++;
    const preview = await processor.frame(source, index);
    assert.deepEqual(await pixel(preview, 10, 6), [...colors[index], 255]);
    assertions++;
    const screenshot = await processor.process(source, {
      fileUrl: "unused",
      output: "frame",
      frame: index,
      crop: { left: 8, top: 0, size: 16 },
    });
    assert.deepEqual(await pixel(screenshot.bytes, 256, 256), [
      ...colors[index],
      255,
    ]);
    assertions++;
    assert.deepEqual(screenshot.metadata, {
      width: 512,
      height: 512,
      frames: 1,
      delays: [0],
    });
    assertions++;
  }
  // Encoder optimizes partial updates. Validate random access with earlier-page disposal/compositing.
  const partialRaw = Buffer.alloc(16 * 16 * 3 * 4);
  for (let frame = 0; frame < 3; frame++)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const foreground = frame === 1 && x >= 4 && x < 12 && y >= 4 && y < 12;
        partialRaw.set(
          foreground ? [0, 255, 0, 255] : [255, 0, 0, 255],
          (frame * 256 + y * 16 + x) * 4,
        );
      }
  const partial = await sharp(partialRaw, {
    raw: { width: 16, height: 48, channels: 4, pageHeight: 16 },
  })
    .gif({ delay: [40, 80, 120], loop: 0 })
    .toBuffer();
  assert.equal((await processor.metadata(partial)).frames, 3);
  assertions++;
  assert.deepEqual(
    await pixel(await processor.frame(partial, 1), 8, 8),
    [0, 255, 0, 255],
  );
  assertions++;
  assert.deepEqual(
    await pixel(await processor.frame(partial, 1), 1, 1),
    [255, 0, 0, 255],
  );
  assertions++;
  assert.deepEqual(
    await pixel(await processor.frame(partial, 2), 8, 8),
    [255, 0, 0, 255],
  );
  assertions++;
  for (const frame of [-1, 3, 1.5, NaN])
    await rejects(() => processor.frame(source, frame), /INVALID_PARAMS/);
  for (const crop of [
    { left: -1, top: 0, size: 16 },
    { left: 0, top: 1, size: 16 },
    { left: 30, top: 0, size: 16 },
    { left: 0, top: 0, size: 0 },
    { left: NaN, top: 0, size: 2 },
  ])
    await rejects(
      () =>
        processor.process(source, {
          fileUrl: "unused",
          output: "animated",
          crop,
        }),
      /INVALID_PARAMS/,
    );
  await rejects(
    () =>
      processor.process(source, {
        fileUrl: "unused",
        output: "frame",
        frame: 3,
      }),
    /INVALID_PARAMS/,
  );
  await rejects(
    () => processor.metadata(Buffer.alloc(10 * 1024 * 1024 + 1)),
    /FILE_TOO_LARGE/,
  );
  await rejects(() => processor.metadata(Buffer.from("not an image")));
  const tooMany = await animated(
    2,
    2,
    Array.from({ length: 301 }, (_, index) => [
      index % 256,
      Math.floor(index / 256),
      200,
    ]),
    Array(301).fill(20),
  );
  await rejects(() => processor.metadata(tooMany), /FILE_TYPE_UNSUPPORTED/);
  const maximumFrames = await animated(
    2,
    2,
    Array.from({ length: 300 }, (_, index) => [
      index % 256,
      Math.floor(index / 256),
      200,
    ]),
    Array(300).fill(20),
  );
  assert.equal((await processor.metadata(maximumFrames)).frames, 300);
  assertions++;
  const duplicates = await animated(
    2,
    2,
    [
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
    ],
    [40, 80, 120],
  );
  const duplicateOutput = await processor.process(duplicates, {
    fileUrl: "unused",
    output: "animated",
  });
  const duplicateMeta = await sharp(duplicateOutput.bytes, {
    animated: true,
  }).metadata();
  assert.equal(
    duplicateMeta.pages,
    duplicateOutput.metadata.frames,
    "Response frame count must match encoded GIF",
  );
  assertions++;
  assert.deepEqual(
    duplicateMeta.delay,
    [40, 80, 120],
    "Repeated frames retain selected timing",
  );
  assertions++;
  // Valid PNG header declaring >40 million decoded pixels; reject before expensive decoding.
  const oversizedHeader = await sharp({
    create: { width: 1, height: 1, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  oversizedHeader.writeUInt32BE(8000, 16);
  oversizedHeader.writeUInt32BE(6000, 20);
  let crc = 0xffffffff;
  for (const byte of oversizedHeader.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  oversizedHeader.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await rejects(() => processor.metadata(oversizedHeader));
  let running = 0,
    maximumRunning = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const jobs = Array.from({ length: 10 }, () =>
    processor.run(async () => {
      running++;
      maximumRunning = Math.max(maximumRunning, running);
      await held;
      running--;
    }),
  );
  await rejects(() => processor.run(async () => undefined), /RATE_LIMITED/);
  release();
  await Promise.all(jobs);
  assert.equal(maximumRunning, 2);
  assertions++;
  console.log(
    `PASS ${assertions} guild icon processor assertions: real animated crop, timing, frame screenshot/disposal, dimensions/frame/byte limits, validation and concurrency`,
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
