import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayManager } from "./gateway.js";
import { prisma } from "./db.js";
import { cacheStore } from "./cache.js";
import { GatewayOpCode } from "@tescord/types";

test("Multi-Session Presence: Multi-session idle and activity wake-up logic", async () => {
  const gateway = new GatewayManager();
  const testUserId = "user-multi-session-test";

  // Mock prisma.user.findUnique and prisma.user.update
  let dbUser = {
    id: testUserId,
    status: "ONLINE",
    customStatus: "Testing presence",
    showActivity: true,
    isBanned: false,
    sessionVersion: 0,
  };

  const origFindUnique = prisma.user.findUnique;
  const origUpdate = prisma.user.update;
  const origFindManyMembers = prisma.guildMember.findMany;
  const origRefreshToken = prisma.refreshToken?.findUnique;

  (prisma.user as any).findUnique = async ({ where }: any) => {
    if (where.id === testUserId) return { ...dbUser };
    return null;
  };
  (prisma.user as any).update = async ({ where, data }: any) => {
    if (where.id === testUserId) {
      dbUser = { ...dbUser, ...data };
      return { ...dbUser };
    }
    return null;
  };
  (prisma.guildMember as any).findMany = async () => [];
  (prisma.refreshToken as any).findUnique = async ({ where }: any) => {
    if (where.id === "auth-session-1" || where.id === "auth-session-2") {
      return {
        id: where.id,
        userId: testUserId,
        expiresAt: new Date(Date.now() + 86400000),
      };
    }
    return null;
  };

  // Mock cacheStore
  let cachedPresence: any = null;
  const origSetPresence = cacheStore.setUserPresence;
  const origGetPresence = cacheStore.getUserPresence;
  cacheStore.setUserPresence = async (_id: string, p: any) => {
    cachedPresence = p;
  };
  cacheStore.getUserPresence = async (_id: string) => cachedPresence;

  try {
    // 1. 设置两个会话：Session 1 (Desktop) 与 Session 2 (Web)
    const conn1: any = {
      userId: testUserId,
      sessionId: "session-1",
      sessionVersion: 0,
      authSessionId: "auth-session-1",
      ws: { readyState: 1, send: () => {}, close: () => {} },
      isAlive: true,
      sessionStatus: "ONLINE",
    };
    const conn2: any = {
      userId: testUserId,
      sessionId: "session-2",
      sessionVersion: 0,
      authSessionId: "auth-session-2",
      ws: { readyState: 1, send: () => {}, close: () => {} },
      isAlive: true,
      sessionStatus: "ONLINE",
    };

    (gateway as any).userSessions.set(
      testUserId,
      new Map([
        ["session-1", conn1],
        ["session-2", conn2],
      ]),
    );

    // 初始裁决：两者均在线 -> 全局状态为 ONLINE
    let status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(status, "ONLINE", "Initial aggregate status should be ONLINE");

    // 2. 会话 1 挂机 10 分钟触发自动闲置 (isManual: false)
    conn1.sessionStatus = "IDLE";
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(
      status,
      "ONLINE",
      "When session 1 is IDLE but session 2 is still active, aggregate status MUST remain ONLINE",
    );
    assert.equal(
      dbUser.status,
      "ONLINE",
      "Automatic session idle must NOT alter database preference",
    );

    // 3. 会话 2 也超时挂机 (isManual: false)
    conn2.sessionStatus = "IDLE";
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(
      status,
      "IDLE",
      "When ALL sessions are IDLE, aggregate status switches to IDLE",
    );

    // 4. 用户在会话 1 动了鼠标 (活跃唤醒，isManual: false)
    conn1.sessionStatus = "ONLINE";
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(
      status,
      "ONLINE",
      "As soon as ANY session detects activity and becomes active, aggregate status wakes up to ONLINE",
    );

    // 5. 用户在设置中手动切换为闲置 (isManual: true)
    await (gateway as any).handlePayload(conn1, {
      op: GatewayOpCode.STATUS_UPDATE,
      d: {
        status: "IDLE",
        isManual: true,
      },
    });
    assert.equal(
      dbUser.status,
      "IDLE",
      "Manual status switch must update database preference to IDLE",
    );
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(
      status,
      "IDLE",
      "Effective status is IDLE due to manual preference",
    );

    // 6. 用户在会话 2 动了鼠标 (isManual: false)
    // 此时因为用户显式手动置为 IDLE，会话活动不能擅自唤醒为 ONLINE！
    await (gateway as any).handlePayload(conn2, {
      op: GatewayOpCode.STATUS_UPDATE,
      d: {
        status: "ONLINE",
        isManual: false,
      },
    });
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(
      status,
      "IDLE",
      "Activity in session must NOT override user's manual IDLE preference",
    );

    // 7. 用户在会话 1 手动切换回在线 (isManual: true)
    await (gateway as any).handlePayload(conn1, {
      op: GatewayOpCode.STATUS_UPDATE,
      d: {
        status: "ONLINE",
        isManual: true,
      },
    });
    assert.equal(dbUser.status, "ONLINE", "Database updated to ONLINE");
    status = await gateway.recalculateUserPresence(testUserId);
    assert.equal(status, "ONLINE", "Aggregate status restored to ONLINE");
  } finally {
    // Restore mocks
    prisma.user.findUnique = origFindUnique;
    prisma.user.update = origUpdate;
    prisma.guildMember.findMany = origFindManyMembers;
    if (prisma.refreshToken) prisma.refreshToken.findUnique = origRefreshToken;
    cacheStore.setUserPresence = origSetPresence;
    cacheStore.getUserPresence = origGetPresence;
  }
});
