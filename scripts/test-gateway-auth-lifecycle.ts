import "../apps/server/src/env.js";
import { prisma } from "../apps/server/src/db.js";
import { GatewayManager } from "../apps/server/src/gateway.js";
import { AuthService } from "../apps/server/src/services/auth.service.js";
import { GatewayOpCode, GatewayCloseCode } from "@tescord/types";
import { EventEmitter } from "events";

class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  closedWith?: { code: number; reason?: string };
  sentPayloads: any[] = [];

  send(data: string) {
    this.sentPayloads.push(JSON.parse(data));
  }

  close(code?: number, reason?: string) {
    this.readyState = 3; // CLOSED
    this.closedWith = { code: code || 1000, reason };
    this.emit("close", code, reason);
  }
}

async function runTest() {
  console.log("🚀 开始执行网关会话生命周期与心跳鉴权深度验证...");

  const fakeFastify: any = {
    jwt: {
      sign: () => "mock_token",
      verify: () => ({ sub: "test" }),
    },
  };

  const authService = new AuthService(fakeFastify);
  const timestamp = Date.now().toString().slice(-6);
  const email = `gw_test_${timestamp}@example.com`;

  // 1. 创建测试用户
  const regResult = await authService.register({
    email,
    password: "Password123!",
    nickname: "GatewayTester",
  });
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: regResult.user.id },
  });
  console.log(
    `✅ 创建测试用户成功: id=${dbUser.id}, email=${dbUser.email}, sessionVersion=${dbUser.sessionVersion}`,
  );

  // 2. 初始化 Gateway
  const gateway = new GatewayManager();
  gateway.setTokenVerifier(async (token: string) => {
    const fresh = await prisma.user.findUnique({ where: { id: dbUser.id } });
    return {
      sub: dbUser.id,
      sessionVersion: fresh?.sessionVersion ?? dbUser.sessionVersion,
      exp: Math.floor(Date.now() / 1000) - 10, // 模拟已经过期的 JWT 时间戳
    };
  });

  try {
    // ----------------------------------------------------
    // 测试场景 1: 长连接建立后超过 15 分钟，心跳保活不再被误掐
    // ----------------------------------------------------
    console.log(
      "\n【测试 1】长连接存续超过 15 分钟时发送心跳（验证行业长连接标准）...",
    );
    const mockWs1 = new MockWebSocket() as any;
    (gateway as any).handleConnection(mockWs1);

    // 握手 IDENTIFY
    mockWs1.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          op: GatewayOpCode.IDENTIFY,
          d: {
            token: "valid_jwt_token",
            sessionId: "sess_1",
          },
        }),
      ),
    );

    // 等待握手异步处理完成
    await new Promise((r) => setTimeout(r, 100));

    const conn1 = Array.from((gateway as any).connections as Set<any>).find(
      (c: any) => c.ws === mockWs1,
    );
    if (!conn1 || conn1.userId !== dbUser.id) {
      throw new Error("客户端 1 握手失败，未正确绑定 userId");
    }

    // 故意将 tokenExpiresAt 设为过去的时间（模拟已过去 15 分钟）
    conn1.tokenExpiresAt = Date.now() - 60000;

    // 发送 HEARTBEAT 心跳
    mockWs1.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          op: GatewayOpCode.HEARTBEAT,
          d: { clientTimestamp: Date.now() },
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 100));

    if (mockWs1.closedWith) {
      throw new Error(
        `测试 1 失败：超过 15 分钟的心跳被意外掐断！关闭码: ${mockWs1.closedWith.code}, reason: ${mockWs1.closedWith.reason}`,
      );
    }

    const hasHeartbeatAck = mockWs1.sentPayloads.some(
      (p: any) => p.op === GatewayOpCode.HEARTBEAT_ACK,
    );
    if (!hasHeartbeatAck) {
      throw new Error("测试 1 失败：服务端未返回 HEARTBEAT_ACK");
    }
    console.log(
      "✅ 测试 1 通过：在线超过 15 分钟发送心跳依然稳定保持连接并返回 HEARTBEAT_ACK！",
    );

    // ----------------------------------------------------
    // 测试场景 2: 真实 Session 吊销（sessionVersion 变更）
    // ----------------------------------------------------
    console.log(
      "\n【测试 2】用户修改密码/会话重置使得 sessionVersion 递增（真吊销）...",
    );
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { sessionVersion: { increment: 1 } },
    });

    // 发送任意 payload 触发心跳
    mockWs1.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          op: GatewayOpCode.HEARTBEAT,
          d: { clientTimestamp: Date.now() },
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 100));

    if (!mockWs1.closedWith) {
      throw new Error("测试 2 失败：sessionVersion 变更后长连接未被吊销！");
    }
    if (mockWs1.closedWith.code !== GatewayCloseCode.SESSION_INVALID) {
      throw new Error(
        `测试 2 失败：预期关闭码为 SESSION_INVALID (4004)，实际为 ${mockWs1.closedWith.code}`,
      );
    }
    if (mockWs1.closedWith.reason !== "Session revoked") {
      throw new Error(
        `测试 2 失败：预期 reason 为 'Session revoked'，实际为 ${mockWs1.closedWith.reason}`,
      );
    }
    console.log(
      `✅ 测试 2 通过：会话版本号变更时准确下发 4004 (SESSION_INVALID) 与 'Session revoked'！`,
    );

    // ----------------------------------------------------
    // 测试场景 3: 用户被封禁（isBanned = true）
    // ----------------------------------------------------
    console.log("\n【测试 3】用户被管理员封禁 (isBanned = true)...");
    const mockWs2 = new MockWebSocket() as any;
    (gateway as any).handleConnection(mockWs2);

    // 刷新 user 状态，将 tokenVerifier 设为匹配新 sessionVersion
    const updatedUser = await prisma.user.findUnique({
      where: { id: dbUser.id },
    });
    gateway.setTokenVerifier(async () => ({
      sub: dbUser.id,
      sessionVersion: updatedUser!.sessionVersion,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));

    mockWs2.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          op: GatewayOpCode.IDENTIFY,
          d: { token: "token_user", sessionId: "sess_2" },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 100));

    // 封禁用户
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { isBanned: true },
    });

    mockWs2.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          op: GatewayOpCode.HEARTBEAT,
          d: { clientTimestamp: Date.now() },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 100));

    if (!mockWs2.closedWith) {
      throw new Error("测试 3 失败：用户被封禁后长连接未被掐断！");
    }
    if (mockWs2.closedWith.code !== GatewayCloseCode.ACCOUNT_BANNED) {
      throw new Error(
        `测试 3 失败：预期关闭码为 ACCOUNT_BANNED (4003)，实际为 ${mockWs2.closedWith.code}`,
      );
    }
    console.log(`✅ 测试 3 通过：用户封禁时准确下发 4003 (ACCOUNT_BANNED)！`);

    console.log("\n🎉 网关长连接生命周期所有核心测试用例 100% 通过！");
  } finally {
    // 清理测试数据
    try {
      await prisma.refreshToken.deleteMany({ where: { userId: dbUser.id } });
      await prisma.user.delete({ where: { id: dbUser.id } });
    } catch {}
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error("❌ 测试执行失败:", err);
  process.exit(1);
});
