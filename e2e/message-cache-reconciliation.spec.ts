import { expect, test } from "@playwright/test";

for (const empty of [true, false]) {
  test(`authoritative ${empty ? "empty" : "bounded"} history removes stale cache while retaining pending messages`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const channelId = "chn_default_text_01";
    const authoritative = {
      id: "cache-authoritative",
      channelId,
      content: "Cache authoritative message",
      sequence: 10,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date().toISOString(),
    };
    let refresh = false;
    await page.route(`**/api/channels/${channelId}/messages*`, (route) =>
      route.fulfill({
        json: {
          messages: refresh && empty ? [] : [authoritative],
          hasOlder: refresh && !empty,
          hasNewer: refresh && !empty,
        },
      }),
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: /Tescord 极客总部|极客/ })
      .first()
      .click();
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect(
      page.getByText(authoritative.content, { exact: true }),
    ).toBeVisible();

    const readIds = () =>
      page.evaluate(async () => {
        const name = (await indexedDB.databases()).find(
          (entry) =>
            entry.name?.startsWith("tescord-client-db-") &&
            !entry.name.endsWith("-guest"),
        )?.name;
        if (!name) return [];
        return new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("messages", "readonly");
            const rows = tx.objectStore("messages").getAllKeys();
            tx.oncomplete = () => {
              db.close();
              resolve(rows.result.map(String).sort());
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        });
      });
    await expect.poll(readIds).toContain(authoritative.id);
    await page
      .getByRole("button", { name: "crypto-vault", exact: true })
      .click();
    await page.evaluate(async (message) => {
      const name = (await indexedDB.databases()).find(
        (entry) =>
          entry.name?.startsWith("tescord-client-db-") &&
          !entry.name.endsWith("-guest"),
      )?.name;
      if (!name) throw new Error("Signed user's cache was not initialized");
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("messages", "readwrite");
          const store = tx.objectStore("messages");
          for (const [id, sequence] of [
            ["cache-stale", 10],
            ["cache-before", 5],
            ["cache-after", 11],
            ["cache-pending", 0],
          ] as const) {
            store.put({ ...message, id, sequence, content: id });
          }
          store.put({
            ...message,
            id: "cache-other-channel",
            channelId: "cache-other-channel",
            content: "Other channel",
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    }, authoritative);
    refresh = true;
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect.poll(readIds).not.toContain("cache-stale");
    const ids = await readIds();
    expect(ids).toContain("cache-pending");
    expect(ids).toContain("cache-other-channel");
    if (empty) {
      expect(ids).not.toContain(authoritative.id);
      expect(ids).not.toContain("cache-before");
      expect(ids).not.toContain("cache-after");
      await expect(
        page.getByText(authoritative.content, { exact: true }),
      ).not.toBeVisible();
    } else {
      expect(ids).toContain(authoritative.id);
      expect(ids).toContain("cache-before");
      expect(ids).toContain("cache-after");
      await expect(
        page.getByText(authoritative.content, { exact: true }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
