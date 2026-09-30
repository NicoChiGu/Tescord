import assert from "node:assert/strict";
import {
  extractInlineAttachmentUrls,
  isInlineAttachmentImageUrl,
} from "../apps/web/src/utils/url.js";

// This pure test never opens a database, writes uploads or reflects private
// signing functions. Capability expiry/renewal is exercised by the real API E2E.
const serverUrl = "https://chat.example.invalid";
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

check("empty messages", () => {
  assert.deepEqual(extractInlineAttachmentUrls(), []);
  assert.deepEqual(extractInlineAttachmentUrls(""), []);
});

check(
  "relative images, case-insensitive extensions and non-image rejection",
  () => {
    assert.deepEqual(
      extractInlineAttachmentUrls(
        "/attachments/one.PNG /attachments/two.webp?variant=preview /attachments/archive.zip /attachments/no-extension",
      ),
      ["/attachments/one.PNG", "/attachments/two.webp?variant=preview"],
    );
  },
);

check("deduplicate repeated references and trim Markdown punctuation", () => {
  assert.deepEqual(
    extractInlineAttachmentUrls(
      "[image](/attachments/photo.png) /attachments/photo.png /attachments/two.jpg，",
    ),
    ["/attachments/photo.png", "/attachments/two.jpg"],
  );
});

check("percent-encoded filenames", () => {
  assert.deepEqual(
    extractInlineAttachmentUrls("/attachments/%E5%9B%BE%E7%89%87.png"),
    ["/attachments/%E5%9B%BE%E7%89%87.png"],
  );
});

check("malformed URI escapes are skipped without breaking later images", () => {
  assert.deepEqual(
    extractInlineAttachmentUrls(
      "/attachments/%E0%A4%A.png /attachments/%ZZ.png /attachments/good.png",
    ),
    ["/attachments/good.png"],
  );
});

check("encoded traversal, separators and null bytes are rejected", () => {
  for (const path of [
    "/attachments/../secret.png",
    "/attachments/%2e%2e%2fsecret.png",
    "/attachments/bad%5Cimage.png",
    "/attachments/%00image.png",
  ]) {
    assert.equal(isInlineAttachmentImageUrl(path, serverUrl), false, path);
  }
});

check("hidden spoilers and code do not expose image previews", () => {
  assert.deepEqual(
    extractInlineAttachmentUrls(
      "`/attachments/code.png` ||/attachments/spoiler.png|| ```\n/attachments/block.png\n``` /attachments/visible.png",
    ),
    ["/attachments/visible.png"],
  );
});

check(
  "origin filtering accepts local HTTP images and rejects external origins",
  () => {
    assert.equal(
      isInlineAttachmentImageUrl("/attachments/image.png", serverUrl),
      true,
    );
    assert.equal(
      isInlineAttachmentImageUrl(
        `${serverUrl}/attachments/image.png?signature=test`,
        serverUrl,
      ),
      true,
    );
    for (const url of [
      "https://other.example.invalid/attachments/image.png",
      "http://chat.example.invalid/attachments/image.png",
      "https://chat.example.invalid:444/attachments/image.png",
      "https://chat.example.invalid.evil.example/attachments/image.png",
      "//other.example.invalid/attachments/image.png",
    ]) {
      assert.equal(isInlineAttachmentImageUrl(url, serverUrl), false, url);
    }
  },
);

check(
  "credentials, unsupported protocols and noncanonical attachment paths are rejected",
  () => {
    for (const url of [
      "https://user:password@chat.example.invalid/attachments/image.png",
      "javascript:/attachments/image.png",
      "data:image/png;base64,test",
      "file:///attachments/image.png",
      "/other/attachments/image.png",
      "/attachments/folder/image.png",
      "/attachments/document.pdf",
    ]) {
      assert.equal(isInlineAttachmentImageUrl(url, serverUrl), false, url);
    }
  },
);

console.log(`Inline attachment URL checks: ${passed}/${passed} passed`);
