import { randomUUID } from "node:crypto";
import { DMCallSession } from "@tescord/types";
import { prisma } from "../db.js";

type ActiveCall = DMCallSession & { timeout: NodeJS.Timeout };

export class DMCallService {
  private calls = new Map<string, ActiveCall>();
  private activeByUser = new Map<string, string>();
  private endSink: ((call: DMCallSession) => void) | null = null;

  setEndSink(sink: (call: DMCallSession) => void): void {
    this.endSink = sink;
  }

  async start(userId: string, sessionId: string, channelId: string, hasVideo: boolean): Promise<DMCallSession> {
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, type: "DM", recipients: { some: { userId } } },
      include: { recipients: { include: { user: true } } },
    });
    if (!channel || channel.recipients.length !== 2) throw new Error("无权发起此私信通话");
    const callee = channel.recipients.find((item) => item.userId !== userId)?.user;
    if (!callee || callee.isBanned) throw new Error("对方账号当前不可用");

    const callerCallId = this.activeByUser.get(userId);
    const calleeCallId = this.activeByUser.get(callee.id);
    if (callerCallId && callerCallId === calleeCallId) return this.public(this.calls.get(callerCallId)!);
    if (callerCallId) throw new Error("当前账号已有进行中的通话");
    if (calleeCallId) {
      const existing = this.calls.get(calleeCallId);
      if (existing?.state === "ringing" && existing.channelId === channelId && existing.callerId === callee.id) {
        return this.public(existing);
      }
      throw new Error("对方正在通话中");
    }

    const now = Date.now();
    const session: ActiveCall = {
      callId: randomUUID(), channelId, callerId: userId, calleeId: callee.id,
      hasVideo: Boolean(hasVideo), state: "ringing",
      callerSessionId: sessionId,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(),
      timeout: setTimeout(() => {
        const ended = this.endInternal(session.callId, "timeout");
        this.endSink?.(ended);
      }, 30_000),
    };
    this.calls.set(session.callId, session);
    this.activeByUser.set(userId, session.callId);
    this.activeByUser.set(callee.id, session.callId);
    return this.public(session);
  }

  answer(userId: string, sessionId: string, callId: string): DMCallSession {
    const call = this.requireParticipant(userId, callId);
    if (call.calleeId !== userId || call.state !== "ringing") throw new Error("该呼叫已失效或无权接听");
    clearTimeout(call.timeout);
    call.state = "active";
    call.acceptedSessionId = sessionId;
    return this.public(call);
  }

  reject(userId: string, callId: string, reason = "rejected"): DMCallSession {
    const call = this.requireParticipant(userId, callId);
    if (call.calleeId !== userId || call.state !== "ringing") throw new Error("该呼叫已失效或无权拒绝");
    return this.endInternal(callId, reason);
  }

  end(userId: string, callId: string, reason = "ended"): DMCallSession {
    this.requireParticipant(userId, callId);
    return this.endInternal(callId, reason);
  }

  authorizeMedia(userId: string, sessionId: string | undefined, callId: string, channelId: string): DMCallSession {
    const call = this.requireParticipant(userId, callId);
    if (call.channelId !== channelId || call.state !== "active") throw new Error("通话尚未接通或已结束");
    if (userId === call.callerId && call.callerSessionId !== sessionId) throw new Error("仅发起呼叫的设备可以取得媒体资格");
    if (userId === call.calleeId && call.acceptedSessionId !== sessionId) throw new Error("媒体资格已由另一台设备取得");
    return this.public(call);
  }

  authorizeKeyExchange(userId: string, callId: string, channelId: string): DMCallSession {
    const call = this.requireParticipant(userId, callId);
    if (call.channelId !== channelId || (call.state !== "ringing" && call.state !== "active")) {
      throw new Error("密钥协商上下文已失效");
    }
    return this.public(call);
  }

  onDisconnect(userId: string, sessionId?: string): DMCallSession | null {
    const callId = this.activeByUser.get(userId);
    if (!callId) return null;
    const call = this.calls.get(callId);
    if (!call) return null;
    if (call.callerId === userId && call.callerSessionId !== sessionId) return null;
    if (call.acceptedSessionId && call.calleeId === userId && call.acceptedSessionId !== sessionId) return null;
    return this.endInternal(callId, "disconnected");
  }

  terminateForUser(userId: string, reason: string): DMCallSession | null {
    const callId = this.activeByUser.get(userId);
    if (!callId) return null;
    const ended = this.endInternal(callId, reason);
    this.endSink?.(ended);
    return ended;
  }

  private requireParticipant(userId: string, callId: string): ActiveCall {
    const call = this.calls.get(callId);
    if (!call || call.state === "ended" || (call.callerId !== userId && call.calleeId !== userId)) {
      throw new Error("呼叫不存在、已结束或无权操作");
    }
    return call;
  }

  private endInternal(callId: string, reason: string): DMCallSession {
    const call = this.calls.get(callId);
    if (!call) throw new Error("呼叫不存在");
    clearTimeout(call.timeout);
    call.state = "ended";
    call.endedReason = reason;
    this.activeByUser.delete(call.callerId);
    this.activeByUser.delete(call.calleeId);
    setTimeout(() => this.calls.delete(callId), 60_000).unref?.();
    return this.public(call);
  }

  private public(call: ActiveCall): DMCallSession {
    const { timeout: _timeout, ...result } = call;
    return { ...result };
  }
}

export const dmCallService = new DMCallService();
