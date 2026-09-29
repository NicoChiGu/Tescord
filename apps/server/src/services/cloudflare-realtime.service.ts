import type {
  CfCallsCreateSessionResponse,
  CfCallsPublishTrackRequest,
  CfCallsPublishTrackResponse,
  CfCallsSubscribeTrackRequest,
  CfCallsSubscribeTrackResponse,
  CfCallsRenegotiateRequest,
  CfCallsCloseTracksRequest,
  CfTurnIceServersResponse,
  CfRealtimeConfigResponse,
  CfMediaPublication,
  CfStreamViewersEvent,
  CfStreamWatchState,
} from "@tescord/types";

/**
 * Cloudflare Realtime (Calls SFU & Calls TURN) 媒体服务代理
 *
 * 职责：
 * 1. 代理调用 Cloudflare Calls 边缘数据面 API，完全规避客户端暴露 App Secret 和 Turn API Token
 * 2. 动态生成全球 Anycast TURN 中继临时凭据
 * 3. 协调基于会话 (Session) 与轨道 (Track) 的 WebRTC 交换
 */
export class CloudflareRealtimeService {
  private readonly baseUrl = "https://rtc.live.cloudflare.com/v1";
  private readonly sessions = new Map<
    string,
    {
      userId: string;
      channelId: string;
      loginSessionId: string;
      callId?: string;
      gatewaySessionId?: string;
      createdAt: number;
      lastSeenAt: number;
    }
  >();
  private readonly publications = new Map<string, CfMediaPublication>();
  private readonly readyPublications = new Set<string>();
  private readonly subscribedMids = new Map<
    string,
    Map<
      string,
      {
        publisherSessionId: string;
        trackName: string;
        confirmed: boolean;
      }
    >
  >();
  private readonly streamWatchers = new Map<string, Set<string>>();
  // A host's removal applies to every media session of that viewer until this
  // publication ends. New sessions must not bypass the removal.
  private readonly kickedStreamViewers = new Map<string, Set<string>>();
  private readonly viewerEvents: CfStreamViewersEvent[] = [];
  private readonly maxSessionsPerUser = 4;

  // TURN 临时凭据内存缓存 (避免同用户高频进入离开频道重复请求 Cloudflare 造成限频)
  private turnCache = new Map<
    string,
    { expiresAt: number; data: CfTurnIceServersResponse }
  >();

  public registerSession(
    sessionId: string,
    userId: string,
    channelId: string,
    loginSessionId: string,
    callId?: string,
    gatewaySessionId?: string,
  ): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > 4 * 60 * 60 * 1000) this.removeSession(id);
    }
    const count = [...this.sessions.values()].filter(
      (s) => s.userId === userId,
    ).length;
    if (count >= this.maxSessionsPerUser)
      throw new Error("Media session limit reached");
    this.sessions.set(sessionId, {
      userId,
      channelId,
      loginSessionId,
      callId,
      gatewaySessionId,
      createdAt: now,
      lastSeenAt: now,
    });
  }

  public getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  public listSessions() {
    return [...this.sessions.entries()];
  }

  public touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastSeenAt = Date.now();
  }

  public recordSubscriptions(
    sessionId: string,
    subscriptions: Array<{
      mid: string;
      publisherSessionId: string;
      trackName: string;
    }>,
  ): void {
    const tracks = this.subscribedMids.get(sessionId) || new Map();
    for (const track of subscriptions)
      tracks.set(track.mid, {
        publisherSessionId: track.publisherSessionId,
        trackName: track.trackName,
        confirmed: false,
      });
    this.subscribedMids.set(sessionId, tracks);
  }

  public confirmSubscriptions(sessionId: string): void {
    for (const track of this.subscribedMids.get(sessionId)?.values() || [])
      track.confirmed = true;
  }

  public getStreamSubscriptionMids(
    sessionId: string,
    publisherSessionId: string,
  ): string[] {
    return [...(this.subscribedMids.get(sessionId)?.entries() || [])]
      .filter(([, subscribed]) => {
        const publication = this.getReadyTrack(
          subscribed.publisherSessionId,
          subscribed.trackName,
        );
        return (
          subscribed.publisherSessionId === publisherSessionId &&
          (publication?.source === "screen" ||
            publication?.source === "screen-audio")
        );
      })
      .map(([mid]) => mid);
  }

  public ownsSubscriptionMid(
    sessionId: string,
    channelId: string,
    mid: string,
  ): boolean {
    const subscribed = this.subscribedMids.get(sessionId)?.get(mid);
    if (!subscribed || this.sessions.get(sessionId)?.channelId !== channelId)
      return false;
    const publication = this.getReadyTrack(
      subscribed.publisherSessionId,
      subscribed.trackName,
    );
    return publication?.channelId === channelId;
  }

  public publisherForSubscriptionMid(
    sessionId: string,
    mid: string,
  ): string | undefined {
    return this.subscribedMids.get(sessionId)?.get(mid)?.publisherSessionId;
  }

  public forgetSubscriptions(sessionId: string, mids: string[]): void {
    const tracks = this.subscribedMids.get(sessionId);
    for (const mid of mids) tracks?.delete(mid);
  }

  public getStreamHost(
    publisherSessionId: string,
  ): CfMediaPublication | undefined {
    return [...this.publications.entries()]
      .filter(([key]) => this.readyPublications.has(key))
      .map(([, publication]) => publication)
      .find(
        (publication) =>
          publication.sessionId === publisherSessionId &&
          publication.source === "screen",
      );
  }

  public isStreamViewerKicked(
    publisherSessionId: string,
    viewerUserId: string,
  ): boolean {
    return (
      this.kickedStreamViewers.get(publisherSessionId)?.has(viewerUserId) ||
      false
    );
  }

  public async kickStreamViewer(
    channelId: string,
    hostUserId: string,
    viewerUserId: string,
  ): Promise<boolean> {
    const hosts = this.getTracks(channelId).filter(
      (track) => track.source === "screen" && track.userId === hostUserId,
    );
    if (!hosts.length || viewerUserId === hostUserId) return false;
    const activeHosts = hosts.filter((host) =>
      [...this.sessions].some(
        ([viewerSessionId, viewer]) =>
          viewer.userId === viewerUserId &&
          viewer.channelId === channelId &&
          (this.streamWatchers.get(host.sessionId)?.has(viewerSessionId) ||
            this.getStreamSubscriptionMids(viewerSessionId, host.sessionId)
              .length > 0),
      ),
    );
    if (!activeHosts.length) return false;
    for (const host of activeHosts) {
      const denied =
        this.kickedStreamViewers.get(host.sessionId) || new Set<string>();
      denied.add(viewerUserId);
      this.kickedStreamViewers.set(host.sessionId, denied);
      for (const [viewerSessionId, viewer] of this.sessions) {
        if (viewer.userId !== viewerUserId || viewer.channelId !== channelId)
          continue;
        const mids = this.getStreamSubscriptionMids(
          viewerSessionId,
          host.sessionId,
        );
        if (mids.length) {
          // The SFU may close some MIDs before a batch reports failure. Keep
          // the denial in that case so a fresh subscription cannot bypass it.
          await this.closeTracks({
            sessionId: viewerSessionId,
            tracks: mids.map((mid) => ({ mid })),
          });
          this.forgetSubscriptions(viewerSessionId, mids);
        }
        this.unwatchStream(viewerSessionId, host.sessionId);
      }
    }
    return true;
  }

  public hasConfirmedScreenSubscription(
    viewerSessionId: string,
    publisherSessionId: string,
  ): boolean {
    return [...(this.subscribedMids.get(viewerSessionId)?.values() || [])].some(
      (subscription) =>
        subscription.confirmed &&
        subscription.publisherSessionId === publisherSessionId &&
        this.getReadyTrack(publisherSessionId, subscription.trackName)
          ?.source === "screen",
    );
  }

  public streamWatchState(
    viewerSessionId: string,
    publisherSessionId: string,
  ): CfStreamWatchState | null {
    const host = this.getStreamHost(publisherSessionId);
    if (!host) return null;
    const viewers = this.streamWatchers.get(publisherSessionId);
    const userIds = new Set<string>();
    for (const sessionId of viewers || []) {
      const viewer = this.sessions.get(sessionId);
      if (
        viewer &&
        viewer.userId !== host.userId &&
        viewer.channelId === host.channelId
      )
        userIds.add(viewer.userId);
    }
    return {
      channelId: host.channelId,
      publisherSessionId,
      hostUserId: host.userId,
      viewerCount: userIds.size,
      watching: viewers?.has(viewerSessionId) || false,
    };
  }

  public watchStream(
    viewerSessionId: string,
    publisherSessionId: string,
  ): CfStreamWatchState | null {
    const host = this.getStreamHost(publisherSessionId);
    const viewer = this.sessions.get(viewerSessionId);
    if (
      !host ||
      !viewer ||
      viewer.channelId !== host.channelId ||
      viewer.userId === host.userId ||
      this.isStreamViewerKicked(publisherSessionId, viewer.userId) ||
      !this.hasConfirmedScreenSubscription(viewerSessionId, publisherSessionId)
    )
      return null;
    const before = this.streamWatchState(
      viewerSessionId,
      publisherSessionId,
    )?.viewerCount;
    const watchers =
      this.streamWatchers.get(publisherSessionId) || new Set<string>();
    watchers.add(viewerSessionId);
    this.streamWatchers.set(publisherSessionId, watchers);
    const state = this.streamWatchState(viewerSessionId, publisherSessionId)!;
    if (state.viewerCount !== before) this.queueViewerEvent(state);
    return state;
  }

  public unwatchStream(
    viewerSessionId: string,
    publisherSessionId: string,
  ): CfStreamWatchState | null {
    const before = this.streamWatchState(viewerSessionId, publisherSessionId);
    this.streamWatchers.get(publisherSessionId)?.delete(viewerSessionId);
    const after = this.streamWatchState(viewerSessionId, publisherSessionId);
    if (before && after && before.viewerCount !== after.viewerCount)
      this.queueViewerEvent(after);
    return after;
  }

  public drainViewerEvents(): CfStreamViewersEvent[] {
    return this.viewerEvents.splice(0);
  }

  private queueViewerEvent(state: CfStreamViewersEvent): void {
    this.viewerEvents.push({
      channelId: state.channelId,
      publisherSessionId: state.publisherSessionId,
      hostUserId: state.hostUserId,
      viewerCount: state.viewerCount,
    });
  }

  public async revokeSession(sessionId: string): Promise<void> {
    const mids = [
      ...this.getTracks(this.sessions.get(sessionId)?.channelId || "")
        .filter((t) => t.sessionId === sessionId)
        .map((t) => t.mid)
        .filter((mid): mid is string => !!mid),
      ...(this.subscribedMids.get(sessionId)?.keys() || []),
    ];
    try {
      if (mids.length)
        await this.closeTracks({
          sessionId,
          tracks: mids.map((mid) => ({ mid })),
        });
    } finally {
      this.removeSession(sessionId);
    }
  }

  public async revokeCallSessions(callId: string): Promise<void> {
    const sessionIds = [...this.sessions.entries()]
      .filter(([, session]) => session.callId === callId)
      .map(([sessionId]) => sessionId);
    const results = await Promise.allSettled(
      sessionIds.map((sessionId) => this.revokeSession(sessionId)),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  public ownsSession(
    sessionId: string,
    userId: string,
    loginSessionId: string,
  ): boolean {
    const session = this.sessions.get(sessionId);
    return (
      !!session &&
      session.userId === userId &&
      session.loginSessionId === loginSessionId
    );
  }

  public getTracks(channelId: string): CfMediaPublication[] {
    return [...this.publications.entries()]
      .filter(
        ([key, track]) =>
          track.channelId === channelId && this.readyPublications.has(key),
      )
      .map(([, track]) => track);
  }

  public getTrack(
    sessionId: string,
    trackName: string,
  ): CfMediaPublication | undefined {
    return this.publications.get(`${sessionId}:${trackName}`);
  }

  public getReadyTrack(
    sessionId: string,
    trackName: string,
  ): CfMediaPublication | undefined {
    const key = `${sessionId}:${trackName}`;
    return this.readyPublications.has(key)
      ? this.publications.get(key)
      : undefined;
  }

  public async publicationStatus(
    sessionId: string,
    trackName: string,
  ): Promise<string> {
    try {
      const response = await fetch(
        `${this.baseUrl}/apps/${this.appId}/sessions/${sessionId}`,
        {
          headers: this.sfuAuthHeaders,
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return `http_${response.status}`;
      const data = (await response.json()) as {
        tracks?: Array<{
          location?: string;
          trackName?: string;
          status?: string;
        }>;
      };
      const track = data.tracks?.find(
        (item) => item.location === "local" && item.trackName === trackName,
      );
      return track?.status || "missing";
    } catch {
      return "inspection_failed";
    }
  }

  public markTracksReady(sessionId: string): void {
    for (const key of this.publications.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.readyPublications.add(key);
    }
  }

  public addTracks(tracks: CfMediaPublication[]): void {
    for (const track of tracks)
      this.publications.set(`${track.sessionId}:${track.trackName}`, track);
  }

  public removeTracks(sessionId: string, trackNames: string[]): void {
    const endingStream = trackNames.some(
      (trackName) =>
        this.getReadyTrack(sessionId, trackName)?.source === "screen",
    );
    const previousState = endingStream
      ? this.streamWatchState("", sessionId)
      : null;
    for (const trackName of trackNames) {
      const key = `${sessionId}:${trackName}`;
      this.publications.delete(key);
      this.readyPublications.delete(key);
    }
    if (endingStream && !this.getStreamHost(sessionId))
      this.clearStream(sessionId, previousState);
  }

  public removeSession(sessionId: string): void {
    const previousState = this.streamWatchState("", sessionId);
    for (const publisherSessionId of this.streamWatchers.keys())
      this.unwatchStream(sessionId, publisherSessionId);
    this.clearStream(sessionId, previousState);
    this.sessions.delete(sessionId);
    this.subscribedMids.delete(sessionId);
    for (const [key, track] of this.publications) {
      if (track.sessionId === sessionId) {
        this.publications.delete(key);
        this.readyPublications.delete(key);
      }
    }
  }

  private clearStream(
    publisherSessionId: string,
    state = this.streamWatchState("", publisherSessionId),
  ): void {
    if (state && state.viewerCount > 0)
      this.queueViewerEvent({ ...state, viewerCount: 0 });
    this.streamWatchers.delete(publisherSessionId);
    this.kickedStreamViewers.delete(publisherSessionId);
  }

  public get appId(): string {
    return process.env.CLOUDFLARE_CALLS_APP_ID?.trim() || "";
  }

  public get appSecret(): string {
    return process.env.CLOUDFLARE_CALLS_APP_SECRET?.trim() || "";
  }

  public get turnKeyId(): string {
    return process.env.CLOUDFLARE_CALLS_TURN_KEY_ID?.trim() || "";
  }

  public get turnKeyToken(): string {
    return process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN?.trim() || "";
  }

  public get isSfuConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  public get isTurnConfigured(): boolean {
    return Boolean(this.turnKeyId && this.turnKeyToken);
  }

  public getConfig(): CfRealtimeConfigResponse {
    return {
      enabled: this.isSfuConfigured || this.turnConfigured,
      sfuEnabled: this.isSfuConfigured,
      turnEnabled: this.isTurnConfigured,
    };
  }

  private get turnConfigured(): boolean {
    return this.isTurnConfigured;
  }

  private get sfuAuthHeaders(): Record<string, string> {
    if (!this.appSecret) {
      throw new Error("CLOUDFLARE_CALLS_APP_SECRET is not configured");
    }
    return {
      Authorization: `Bearer ${this.appSecret}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * 1. 为客户端创建新的 Cloudflare Calls SFU 会话
   */
  public async createSession(): Promise<CfCallsCreateSessionResponse> {
    if (!this.isSfuConfigured) {
      throw new Error("Cloudflare Calls SFU is not configured on this server");
    }

    const response = await fetch(
      `${this.baseUrl}/apps/${this.appId}/sessions/new`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.appSecret}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok)
      throw new Error(`Cloudflare session request failed (${response.status})`);

    const data = (await response.json()) as CfCallsCreateSessionResponse;
    if (
      !data ||
      typeof data.sessionId !== "string" ||
      !/^[a-f0-9-]{20,80}$/i.test(data.sessionId)
    ) {
      throw new Error("Invalid Cloudflare media session response");
    }
    return data;
  }

  /**
   * 2. 本地推流协商 (Publish Track / Local Tracks)
   */
  public async publishTracks(
    req: CfCallsPublishTrackRequest,
  ): Promise<CfCallsPublishTrackResponse> {
    if (!this.isSfuConfigured) {
      throw new Error("Cloudflare Calls SFU is not configured on this server");
    }

    const payload = {
      sessionDescription: req.sessionDescription,
      tracks: req.tracks.map((t) => ({
        location: "local",
        mid: t.mid,
        trackName: t.trackName,
      })),
    };

    const response = await fetch(
      `${this.baseUrl}/apps/${this.appId}/sessions/${req.sessionId}/tracks/new`,
      {
        method: "POST",
        headers: this.sfuAuthHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as {
        errorCode?: unknown;
      };
      const code =
        typeof failure.errorCode === "string" &&
        /^[a-z0-9_]{1,80}$/i.test(failure.errorCode)
          ? failure.errorCode
          : "unknown";
      throw new Error(
        `Cloudflare publish failed (${response.status}, ${code})`,
      );
    }

    const data = (await response.json()) as CfCallsPublishTrackResponse;
    if (
      !data?.sessionDescription ||
      typeof data.sessionDescription.sdp !== "string" ||
      !Array.isArray(data.tracks) ||
      data.tracks.length !== req.tracks.length ||
      data.tracks.some((track) => track.errorCode)
    ) {
      const codes = Array.isArray(data?.tracks)
        ? data.tracks
            .map((track) => track.errorCode)
            .filter(Boolean)
            .join(",")
        : "missing_tracks";
      throw new Error(
        `Cloudflare publication rejected (${codes || "invalid_response"})`,
      );
    }
    return data;
  }

  /**
   * 3. 订阅远端轨道 (Subscribe Tracks / Remote Tracks)
   */
  public async subscribeTracks(
    req: CfCallsSubscribeTrackRequest,
  ): Promise<CfCallsSubscribeTrackResponse> {
    if (!this.isSfuConfigured) {
      throw new Error("Cloudflare Calls SFU is not configured on this server");
    }

    const payload = {
      tracks: req.tracks.map((t) => ({
        location: "remote",
        sessionId: t.publisherSessionId,
        trackName: t.trackName,
      })),
    };

    const response = await fetch(
      `${this.baseUrl}/apps/${this.appId}/sessions/${req.sessionId}/tracks/new`,
      {
        method: "POST",
        headers: this.sfuAuthHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudflare subscribe failed (${response.status})`);
    }

    const data = (await response.json()) as CfCallsSubscribeTrackResponse;
    if (
      !data?.sessionDescription ||
      typeof data.sessionDescription.sdp !== "string" ||
      !Array.isArray(data.tracks) ||
      data.tracks.length !== req.tracks.length ||
      data.tracks.some(
        (track) => track.errorCode || typeof track.mid !== "string",
      )
    ) {
      const codes = Array.isArray(data?.tracks)
        ? data.tracks
            .map((track) => track.errorCode)
            .filter(Boolean)
            .join(",")
        : "missing_tracks";
      throw new Error(
        `Cloudflare subscription rejected (${codes || "invalid_response"})`,
      );
    }
    return data;
  }

  /**
   * 4. 提交重协商 Answer
   */
  public async renegotiate(req: CfCallsRenegotiateRequest): Promise<void> {
    if (!this.isSfuConfigured) {
      throw new Error("Cloudflare Calls SFU is not configured on this server");
    }

    const response = await fetch(
      `${this.baseUrl}/apps/${this.appId}/sessions/${req.sessionId}/renegotiate`,
      {
        method: "PUT",
        headers: this.sfuAuthHeaders,
        body: JSON.stringify({
          sessionDescription: req.sessionDescription,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudflare renegotiate failed (${response.status})`);
    }
  }

  /**
   * 5. 关闭/注销轨道
   */
  public async closeTracks(req: CfCallsCloseTracksRequest): Promise<void> {
    if (!this.isSfuConfigured) {
      throw new Error("Cloudflare Calls SFU is not configured on this server");
    }

    const payload: {
      tracks: Array<{ mid: string }>;
      force: boolean;
      sessionDescription?: CfCallsCloseTracksRequest["sessionDescription"];
    } = {
      tracks: req.tracks
        .filter(
          (track): track is { mid: string } => typeof track.mid === "string",
        )
        .map(({ mid }) => ({ mid })),
      force: !req.sessionDescription,
    };
    if (req.sessionDescription) {
      payload.sessionDescription = req.sessionDescription;
    }
    if (!payload.tracks.length) return;

    const response = await fetch(
      `${this.baseUrl}/apps/${this.appId}/sessions/${req.sessionId}/tracks/close`,
      {
        method: "PUT",
        headers: this.sfuAuthHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudflare close failed (${response.status})`);
    }
    const result = (await response.json()) as {
      errorCode?: string;
      tracks?: Array<{ mid?: string; errorCode?: string }>;
    };
    const requestedMids = new Set(payload.tracks.map((track) => track.mid));
    const reportedMids = new Set(
      Array.isArray(result.tracks)
        ? result.tracks.map((track) => track.mid)
        : [],
    );
    if (
      result.errorCode ||
      !Array.isArray(result.tracks) ||
      result.tracks.length !== requestedMids.size ||
      reportedMids.size !== requestedMids.size ||
      [...requestedMids].some((mid) => !reportedMids.has(mid)) ||
      result.tracks.some(
        (track) => track.errorCode && track.errorCode !== "close_track_error",
      )
    ) {
      throw new Error("Cloudflare track close incomplete");
    }
  }

  /**
   * 6. 生成 Cloudflare Realtime TURN 临时凭据 (动态向 Cloudflare 申请)
   */
  public async generateTurnIceServers(
    userId: string,
    ttl = 86400,
  ): Promise<CfTurnIceServersResponse> {
    if (!this.isTurnConfigured) {
      throw new Error("Cloudflare Calls TURN is not configured on this server");
    }

    const cacheKey = `${userId}:${this.turnKeyId}`;
    const cached = this.turnCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);

    // 如果缓存且离过期还有至少 10 分钟，直接复用
    if (cached && cached.expiresAt > now + 600) {
      return cached.data;
    }

    const response = await fetch(
      `${this.baseUrl}/turn/keys/${this.turnKeyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.turnKeyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl,
          customIdentifier: userId,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudflare TURN failed (${response.status})`);
    }

    const data = (await response.json()) as {
      iceServers?: CfTurnIceServersResponse["iceServers"];
    };
    const expiresAt = now + ttl;

    if (
      !Array.isArray(data?.iceServers) ||
      data.iceServers.length === 0 ||
      data.iceServers.some(
        (server) =>
          !server ||
          !server.urls ||
          (typeof server.urls !== "string" && !Array.isArray(server.urls)),
      )
    ) {
      throw new Error("Invalid Cloudflare TURN credential response");
    }
    const result: CfTurnIceServersResponse = {
      iceServers: data.iceServers,
      expiresAt,
    };

    if (this.turnCache.size > 1000) {
      for (const [key, entry] of this.turnCache) {
        if (entry.expiresAt <= now + 600) this.turnCache.delete(key);
      }
      if (this.turnCache.size > 1000)
        this.turnCache.delete(this.turnCache.keys().next().value!);
    }
    this.turnCache.set(cacheKey, { expiresAt, data: result });
    return result;
  }
}

export const cloudflareRealtimeService = new CloudflareRealtimeService();
