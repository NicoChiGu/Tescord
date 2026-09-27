import { test, expect } from "@playwright/test";
import path from "node:path";

test.describe("账号切换网关身份隔离", () => {
  test("A 切换到 B 后，B 的语音状态不会接管另一客户端中的 A", async ({
    browser,
    request,
  }) => {
    const adminLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    const aliceLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "alice@tescord.local",
        password: "alicepassword123",
      },
    });
    expect(adminLogin.ok()).toBeTruthy();
    expect(aliceLogin.ok()).toBeTruthy();
    const admin = await adminLogin.json();
    const alice = await aliceLogin.json();

    const guildResponse = await request.get("/api/guilds", {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });
    expect(guildResponse.ok()).toBeTruthy();
    const guilds = await guildResponse.json();
    const guild = guilds.find((item: any) =>
      item.channels?.some((channel: any) => channel.type === "VOICE"),
    );
    expect(guild).toBeTruthy();
    const voiceChannel = guild.channels.find(
      (channel: any) => channel.type === "VOICE",
    );

    const inviteResponse = await request.post(
      `/api/guilds/${guild.id}/invites`,
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { maxUses: 1, maxAge: 600 },
      },
    );
    expect(inviteResponse.ok()).toBeTruthy();
    const invite = await inviteResponse.json();
    const joinResponse = await request.post(
      `/api/invites/${invite.code}/join`,
      {
        headers: { Authorization: `Bearer ${alice.accessToken}` },
      },
    );
    expect(joinResponse.ok()).toBeTruthy();

    const storageState = path.join(
      process.cwd(),
      "test-results",
      "e2e-admin-storage.json",
    );
    const remoteContext = await browser.newContext({
      storageState,
      ignoreHTTPSErrors: true,
    });
    const switchingContext = await browser.newContext({
      storageState,
      ignoreHTTPSErrors: true,
    });
    const remoteA = await remoteContext.newPage();
    const switchingPage = await switchingContext.newPage();

    try {
      await Promise.all([remoteA.goto("/"), switchingPage.goto("/")]);
      await expect
        .poll(() =>
          remoteA.evaluate(
            (userId) =>
              (window as any).__gatewayClient?.isReadyForUser(userId) === true,
            admin.user.id,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          switchingPage.evaluate(
            (userId) =>
              (window as any).__gatewayClient?.isReadyForUser(userId) === true,
            admin.user.id,
          ),
        )
        .toBe(true);

      await remoteA.evaluate(
        ({ guildId, channelId }) => {
          (window as any).__voiceTransferEvents = [];
          (window as any).__gatewayClient.on(
            "VOICE_SERVER_DISCONNECT",
            (event: unknown) =>
              (window as any).__voiceTransferEvents.push(event),
          );
          const accepted = (window as any).__gatewayClient.updateVoiceState(
            guildId,
            channelId,
          );
          if (!accepted) throw new Error("A voice state was not accepted");
        },
        { guildId: guild.id, channelId: voiceChannel.id },
      );

      const oldSessionId = await switchingPage.evaluate(() =>
        (window as any).__gatewayClient.getSessionId(),
      );
      await switchingPage.evaluate(async () => {
        const store = (window as any).useAuthStore;
        store.getState().switchAccount();
      });
      await expect
        .poll(() =>
          switchingPage.evaluate(() =>
            (window as any).__gatewayClient.getConnectionState(),
          ),
        )
        .toBe("disconnected");

      // 超过旧实现的 3 秒重连窗口，确认 A 不会在登录页偷偷恢复连接。
      await switchingPage.waitForTimeout(3500);
      expect(
        await switchingPage.evaluate(
          (userId) => (window as any).__gatewayClient.isReadyForUser(userId),
          admin.user.id,
        ),
      ).toBe(false);

      await switchingPage.evaluate(async () => {
        await (window as any).useAuthStore.getState().login({
          emailOrUsername: "alice@tescord.local",
          password: "alicepassword123",
          rememberMe: true,
        });
      });
      await expect
        .poll(() =>
          switchingPage.evaluate(
            (userId) =>
              (window as any).__gatewayClient?.isReadyForUser(userId) === true,
            alice.user.id,
          ),
        )
        .toBe(true);
      const newSessionId = await switchingPage.evaluate(() =>
        (window as any).__gatewayClient.getSessionId(),
      );
      expect(newSessionId).not.toBe(oldSessionId);

      const accepted = await switchingPage.evaluate(
        ({ guildId, channelId }) =>
          (window as any).__gatewayClient.updateVoiceState(guildId, channelId),
        { guildId: guild.id, channelId: voiceChannel.id },
      );
      expect(accepted).toBe(true);
      await switchingPage.waitForTimeout(750);
      expect(
        await remoteA.evaluate(
          () => (window as any).__voiceTransferEvents.length,
        ),
      ).toBe(0);

      await remoteA.evaluate((guildId) => {
        (window as any).__gatewayClient.updateVoiceState(guildId, null);
      }, guild.id);
      await switchingPage.evaluate((guildId) => {
        (window as any).__gatewayClient.updateVoiceState(guildId, null);
      }, guild.id);
    } finally {
      await remoteContext.close();
      await switchingContext.close();
      await request.delete(`/api/guilds/${guild.id}/members/${alice.user.id}`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });
    }
  });
});
