import { useToastStore } from "./stores/useToastStore.js";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Channel,
  ChannelCategory,
  Guild,
  Role,
  GuildMember,
  Message,
  VoiceState,
  VoiceServerDisconnectPayload,
  Attachment,
  parseRoleIds,
  NoiseSuppressionMode,
  VideoCodecType,
  VoiceConnectionStatus,
  User,
  UserStatus,
  PresenceUpdateEvent,
  DMCallEndedPayload,
  ClientCallState,
  ChannelUnreadInfo,
  ChannelUnreadMap,
  MEDIA_ENCRYPTION_VERSION,
} from "@tescord/types";
import { TitleBar } from "./components/TitleBar.js";
import { GatewayConnectionBanner } from "./components/GatewayConnectionBanner.js";
import { AudioInterruptedBanner } from "./components/AudioInterruptedBanner.js";
import { Sidebar } from "./components/Sidebar.js";
import {
  ChannelSidebar,
  VoiceTransferNotice,
} from "./components/ChannelSidebar.js";
import { ChatArea } from "./components/ChatArea.js";
import { clearFastMarkdownCache } from "./components/chat/fastMarkdown.js";
import { VoiceRoomArea } from "./components/VoiceRoomArea.js";
import { MemberList } from "./components/MemberList.js";
import { UserProfilePopout } from "./components/profile/UserProfilePopout.js";
import { useUserProfilePopoutStore } from "./stores/useUserProfilePopoutStore.js";
import { AuthModal } from "./components/auth/AuthModal.js";
import { ReauthModal } from "./components/auth/ReauthModal.js";
import { ForcedPasswordChangeModal } from "./components/auth/ForcedPasswordChangeModal.js";
import { GlobalContextMenu } from "./components/context-menu/GlobalContextMenu.js";
import { GlobalDialogContainer } from "./components/ui/dialog/GlobalDialogContainer.js";
import { GlobalToastContainer } from "./components/ui/dialog/GlobalToastContainer.js";
import { GlobalMiniPlayer } from "./components/audio/GlobalMiniPlayer.js";
import { dialog } from "./stores/useDialogStore.js";
import { useTranslation } from "react-i18next";
import { installFetchInterceptor } from "./services/apiClient.js";
import { getUserDisplayName } from "./utils/userDisplay.js";

installFetchInterceptor();
import { UserSettingsModal } from "./components/settings/UserSettingsModal.js";
import { ServerSettingsModal } from "./components/server-settings/ServerSettingsModal.js";
import { CreateGuildModal } from "./components/modals/CreateGuildModal.js";
import { DiscoveryModal } from "./components/modals/DiscoveryModal.js";
import { InviteLandingModal } from "./components/modals/InviteLandingModal.js";
import { EmptyGuildsWelcome } from "./components/EmptyGuildsWelcome.js";
import { CreateChannelModal } from "./components/modals/CreateChannelModal.js";
import { EditChannelModal } from "./components/modals/EditChannelModal.js";
import { CreateCategoryModal } from "./components/modals/CreateCategoryModal.js";
import { EditCategoryModal } from "./components/modals/EditCategoryModal.js";
import { ScreenShareModal } from "./components/modals/ScreenShareModal.js";
import { NetworkQualityModal } from "./components/modals/NetworkQualityModal.js";
import { InviteFriendsModal } from "./components/modals/InviteFriendsModal.js";
import { P2PFallbackModal } from "./components/modals/P2PFallbackModal.js";
import { AdminDashboardModal } from "./components/admin/AdminDashboardModal.js";
import { IncomingCallModal } from "./components/dm/IncomingCallModal.js";
import { DMCallStage } from "./components/dm/DMCallStage.js";
import { DMPictureInPicture } from "./components/dm/DMPictureInPicture.js";
import { useDMCallStore } from "./stores/dmCallStore.js";
import { FloatingPiP } from "./components/FloatingPiP.js";
import { MaintenanceScreen } from "./components/maintenance/MaintenanceScreen.js";
import { MaintenanceAdminBanner } from "./components/maintenance/MaintenanceAdminBanner.js";
import { FriendsDashboard } from "./components/friends/FriendsDashboard.js";
import { useFriendStore } from "./stores/useFriendStore.js";
import { UpdateNotificationBanner } from "./components/updater/UpdateNotificationBanner.js";
import { WhatsNewModal } from "./components/modals/WhatsNewModal.js";
import { useWhatsNewAutoPopup } from "./hooks/useWhatsNewAutoPopup.js";
import { useMaintenanceStore } from "./stores/useMaintenanceStore.js";
import { useChannelNavStore } from "./stores/useChannelNavStore.js";
import {
  resolveGuildChannel,
  getDefaultGuildChannel,
} from "./utils/channelNavigation.js";

import { useAuthStore } from "./stores/useAuthStore.js";
import { usePresenceStore } from "./stores/usePresenceStore.js";
import { gatewayClient } from "./services/gateway.js";
import { audioOutput } from "./services/audioOutput.js";
import { audioEngine } from "./services/audioEngine.js";
import { useMessageHistory } from "./hooks/useMessageHistory.js";
import { livekitService, ActiveScreenShare } from "./services/livekit.js";
import { cloudflareRealtimeService } from "./services/cloudflare_realtime/index.js";
import { doubleRatchetManager } from "./services/doubleRatchet.js";
import { sframeManager } from "./services/sframe.js";
import { mediaEncryptionService } from "./services/mediaEncryption.js";
import { captureDisplay } from "./services/displayCapture.js";
import { getErrorMessage } from "./i18n/index.js";
import { soundManager } from "./services/soundManager.js";
import { p2pStreamManager } from "./services/p2p/P2PStreamManager.js";
import { voiceMeshManager } from "./services/p2p/VoiceMeshManager.js";
import { useSettingsStore } from "./stores/useSettingsStore.js";
import {
  SCREEN_SHARE_PRESETS,
  StreamTransmissionMode,
  GatewayEvents,
  GatewayOpCode,
} from "@tescord/types";
import { API_BASE, VOICE_ENGINE } from "./config.js";

import { useViewport } from "./hooks/useViewport.js";
import { useSwipeGesture } from "./hooks/useSwipeGesture.js";
import { X, AlertTriangle, Info } from "lucide-react";
import { deviceKeyService } from "./services/deviceKeys.js";
import { messageDb } from "./services/messageDb.js";
import { preheatManager } from "./services/preheatManager.js";

type DMCallHistorySnapshot = {
  channelId: string;
  callState: ClientCallState;
  callStartTime: number | null;
  isCaller: boolean;
};

export const App: React.FC = () => {
  const { t } = useTranslation([
    "common",
    "server",
    "modals",
    "contextMenu",
    "chat",
  ]);
  const {
    user: currentUser,
    isAuthenticated,
    isLoading,
    initAuth,
  } = useAuthStore();

  const isMaintenance = useMaintenanceStore((s) => s.isMaintenance);

  const { isMobile, isTablet, isDesktop } = useViewport();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isMobileMemberOpen, setIsMobileMemberOpen] = useState(false);

  // 核心数据状态（同步从本地持久化缓存水合，首帧 0ms 秒开）
  const [initialNavState] = useState(() => {
    const navStore = useChannelNavStore.getState();
    const cached = navStore.loadCachedGuilds(navStore.userId);
    const initialNav = navStore.getInitialNavigation(navStore.userId, cached);
    return { cachedGuilds: cached, ...initialNav };
  });

  const [guilds, setGuilds] = useState<Guild[]>(initialNavState.cachedGuilds);
  const guildPositions = useSettingsStore((s) => s.guildPositions);
  const setGuildPositions = useSettingsStore((s) => s.setGuildPositions);

  const sortedGuilds = React.useMemo(() => {
    if (!guildPositions || guildPositions.length === 0) return guilds;
    const posMap = new Map<string, number>();
    guildPositions.forEach((id, idx) => posMap.set(id, idx));

    return [...guilds].sort((a, b) => {
      const aPos = posMap.has(a.id) ? posMap.get(a.id)! : 9999;
      const bPos = posMap.has(b.id) ? posMap.get(b.id)! : 9999;
      return aPos - bPos;
    });
  }, [guilds, guildPositions]);

  const handleReorderGuilds = useCallback(
    (newGuilds: Guild[]) => {
      const newPositions = newGuilds.map((g) => g.id);
      setGuildPositions(newPositions);
      setGuilds(newGuilds);
    },
    [setGuildPositions],
  );

  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    initialNavState.selectedGuildId,
  );
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(
    initialNavState.selectedChannel,
  );
  const [isFriendsTabActive, setIsFriendsTabActive] = useState<boolean>(
    initialNavState.isFriendsTabActive,
  );

  // 切换频道或切换至宽屏桌面端时，自动收起移动端/平板端右侧抽屉
  useEffect(() => {
    setIsMobileMemberOpen(false);
  }, [selectedChannel?.id, isDesktop]);

  const {
    isOpen: isProfilePopoutOpen,
    payload: profilePopoutPayload,
    closePopout: closeProfilePopout,
  } = useUserProfilePopoutStore();

  // 移动端与平板端左右滑动呼出与收起抽屉手势
  useSwipeGesture(
    {
      onOpenLeftDrawer: () => {
        if (isMobile) {
          setIsMobileDrawerOpen(true);
          setIsMobileMemberOpen(false);
        }
      },
      onCloseLeftDrawer: () => {
        if (isMobile) setIsMobileDrawerOpen(false);
      },
      onOpenRightDrawer: () => {
        if (!isDesktop && selectedChannel?.type === "TEXT") {
          setIsMobileMemberOpen(true);
          if (isMobile) setIsMobileDrawerOpen(false);
        }
      },
      onCloseRightDrawer: () => {
        if (!isDesktop) setIsMobileMemberOpen(false);
      },
      isLeftDrawerOpen: isMobileDrawerOpen,
      isRightDrawerOpen: isMobileMemberOpen,
    },
    !isDesktop && !isProfilePopoutOpen,
  );
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<
    string | null
  >(null);
  const rejoinVoiceRef = useRef<(channelId: string) => Promise<void>>(
    async () => {},
  );
  const [voiceConnectionStatus, setVoiceConnectionStatus] =
    useState<VoiceConnectionStatus>(() => livekitService.getConnectionStatus());
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState<boolean>(false);
  const messageHistory = useMessageHistory(
    selectedChannel,
    currentUser?.id,
    messages,
    setMessages,
    setIsMessagesLoading,
  );
  const messageHistoryRef = useRef(messageHistory);
  messageHistoryRef.current = messageHistory;
  const [voiceStates, setVoiceStatesState] = useState<VoiceState[]>([]);
  const voiceStatesRef = useRef<VoiceState[]>([]);
  const setVoiceStates = useCallback(
    (update: React.SetStateAction<VoiceState[]>) => {
      const next =
        typeof update === "function" ? update(voiceStatesRef.current) : update;
      voiceStatesRef.current = next;
      setVoiceStatesState(next);
    },
    [],
  );
  const voiceRevisionRef = useRef<Map<string, number>>(new Map());
  const [voiceTransferNotice, setVoiceTransferNotice] =
    useState<VoiceTransferNotice | null>(null);

  // 音频与多媒体状态
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>(() =>
    livekitService.getActiveSpeakers(),
  );
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const displayCaptureCleanupRef = useRef<(() => void) | null>(null);
  const screenShareGenerationRef = useRef(0);
  const dmJoinInProgressRef = useRef<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [activeScreenShare, setActiveScreenShare] =
    useState<ActiveScreenShare | null>(null);
  const [showFloatingPiP, setShowFloatingPiP] = useState(true);
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] =
    useState(true);
  const [noiseSuppressionMode, setNoiseSuppressionMode] =
    useState<NoiseSuppressionMode>(
      audioEngine.config.noiseSuppressionMode || "rnnoise",
    );
  const [showMemberList, setShowMemberList] = useState(true);

  // 内部引用，保证长存事件与异步回调中始终读取最新状态
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const voiceOperationEpochRef = useRef(0);
  const isVoiceSwitchingRef = useRef(false);
  const accountEpochRef = useRef(0);
  const isAccountTransitionRef = useRef(false);
  const accountCleanupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  activeVoiceChannelIdRef.current = activeVoiceChannelId;
  if (typeof window !== "undefined") {
    (window as any).__activeVoiceChannelId = activeVoiceChannelId;
    (window as any).__selectedChannelId = selectedChannel?.id;
  }
  const guildsRef = useRef<Guild[]>([]);
  guildsRef.current = guilds;
  const selectedGuildIdRef = useRef<string | null>(null);
  selectedGuildIdRef.current = selectedGuildId;

  // 实时同步公会列表到本地持久化缓存（按当前用户隔离）
  useEffect(() => {
    const currentUserId =
      currentUser?.id || useChannelNavStore.getState().userId;
    if (currentUserId && !isAccountTransitionRef.current) {
      useChannelNavStore.getState().saveCachedGuilds(guilds, currentUserId);
    }
  }, [guilds, currentUser?.id]);

  // 记忆用户最后访问的服务器（或私信/好友主页）
  useEffect(() => {
    const currentUserId =
      currentUser?.id || useChannelNavStore.getState().userId;
    const navigation = useChannelNavStore.getState();
    if (
      currentUserId &&
      !isAccountTransitionRef.current &&
      (selectedGuildId !== null ||
        navigation.getLastSelectedGuild(currentUserId) !== undefined)
    ) {
      // Do not persist the initial placeholder as an explicit Friends choice
      // before the first guild response resolves the user's navigation.
      navigation.recordLastSelectedGuild(selectedGuildId);
    }
  }, [selectedGuildId, currentUser?.id]);
  const getVoiceGuildId = (channelId: string | null) =>
    channelId
      ? (guildsRef.current
          .flatMap((guild) => guild.channels)
          .find((channel) => channel.id === channelId)?.guildId ?? null)
      : null;
  const selectedChannelRef = useRef<Channel | null>(null);
  selectedChannelRef.current = selectedChannel;
  const pendingDMCallHistoryRef = useRef(
    new Map<string, DMCallHistorySnapshot>(),
  );
  const recordedDMCallIdsRef = useRef(new Set<string>());
  useEffect(() => {
    pendingDMCallHistoryRef.current.clear();
    recordedDMCallIdsRef.current.clear();
  }, [currentUser?.id]);
  const rememberDMCallHistory = (
    callId: string | null,
    channelId: string | null,
  ) => {
    if (!callId || !channelId) return;
    const call = useDMCallStore.getState();
    pendingDMCallHistoryRef.current.set(callId, {
      channelId,
      callState: call.callState,
      callStartTime: call.callStartTime,
      isCaller: call.isCaller,
    });
  };
  const sfuFallbackInProgressRef = useRef(false);
  const connectSfuFallbackRef = useRef<
    (
      channelId: string,
      callId?: string | null,
      force?: boolean,
    ) => Promise<boolean>
  >(async () => false);
  connectSfuFallbackRef.current = async (channelId, callId, force = false) => {
    if (
      activeVoiceChannelIdRef.current !== channelId ||
      sfuFallbackInProgressRef.current
    )
      return false;

    // 守卫：若当前频道除自己外已无其他成员，严禁降级回退至 SFU，保持 P2P 就绪待命
    if (!force && !callId && voiceMeshManager.getOtherMemberCount() === 0) {
      console.log(
        `[Voice] 频道 ${channelId} 仅剩当前用户，拦截 SFU 回退，保持 P2P 就绪待命`,
      );
      return false;
    }

    if (
      VOICE_ENGINE === "cloudflare_realtime" &&
      cloudflareRealtimeService.status === "connected"
    )
      return true;
    if (livekitService.isConnected) return true;
    sfuFallbackInProgressRef.current = true;
    try {
      const user = useAuthStore.getState().user;
      const token = useAuthStore.getState().token;
      const channel = guildsRef.current
        .flatMap((guild) => guild.channels)
        .find((candidate) => candidate.id === channelId);
      const requireE2EE = true;
      if (
        !user ||
        !token ||
        (!callId && !channel) ||
        !sframeManager.hasActiveContext
      ) {
        throw new Error("媒体身份或 E2EE 密钥尚未就绪");
      }
      const stream = audioEngine.getStream();
      if (!stream) throw new Error("麦克风媒体流不可用");
      if (VOICE_ENGINE === "cloudflare_realtime") {
        await cloudflareRealtimeService.connect(channelId, {
          audioStream: stream,
          audioBitrate:
            channel?.bitrate || audioEngine.config.audioBitrate || 64000,
          gatewaySessionId: gatewayClient.getSessionId(),
          ...(callId ? { callId } : {}),
        });
        if (activeVoiceChannelIdRef.current !== channelId)
          throw new Error("频道已切换");
        voiceMeshManager.stopAll();
        livekitService.setConnectionStatus("connected");
        showGlobalToast("已连接 Cloudflare SFU 媒体服务", "info");
        return true;
      }
      const endpoint = callId
        ? `${API_BASE}/api/channels/dm/${channelId}/call-token`
        : `${API_BASE}/api/livekit/token`;
      const currentGuild = guildsRef.current.find((g) =>
        g.channels.some((c) => c.id === channelId),
      );
      const currentMember = currentGuild?.members?.find(
        (m) => m.userId === user.id,
      );
      const participantName = getUserDisplayName(
        user,
        currentMember,
        user.username,
      );
      const body = callId
        ? { callId, sessionId: gatewayClient.getSessionId() }
        : {
            roomName: channelId,
            identity: user.id,
            gatewaySessionId: gatewayClient.getSessionId(),
            name: participantName,
            bitrate:
              channel?.bitrate || audioEngine.config.audioBitrate || 64000,
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(`SFU 令牌请求失败 (${response.status})`);
      const media = await response.json();
      const joined = await livekitService.joinRoom(
        media.serverUrl || media.url,
        media.token,
        media.roomName || channelId,
        stream,
        channel?.bitrate || audioEngine.config.audioBitrate || 64000,
        requireE2EE,
      );
      if (!joined || activeVoiceChannelIdRef.current !== channelId) {
        if (joined) await livekitService.leaveRoom();
        throw new Error("SFU 媒体连接失败或频道已切换");
      }
      voiceMeshManager.stopAll();
      livekitService.setConnectionStatus("connected");
      showGlobalToast("已连接 LiveKit SFU 媒体服务", "info");
      return true;
    } catch (error) {
      livekitService.setConnectionStatus("disconnected");
      showGlobalToast(
        `SFU 切换失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
      return false;
    } finally {
      sfuFallbackInProgressRef.current = false;
    }
  };
  const isMutedRef = useRef<boolean>(false);
  isMutedRef.current = isMuted;
  const isDeafenedRef = useRef<boolean>(false);
  isDeafenedRef.current = isDeafened;
  const handleToggleMuteRef = useRef<() => void>(() => {});

  // 模态框显隐状态
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  // 用户已开始设置操作时，本次登录不再自动叠加更新公告。
  useWhatsNewAutoPopup(isAuthenticated, isLoading, isUserSettingsOpen);
  const [userSettingsInitialTab, setUserSettingsInitialTab] = useState<
    "profile" | "audio"
  >("profile");
  const [userSettingsSubSection, setUserSettingsSubSection] = useState<
    "voice" | "video" | undefined
  >(undefined);
  const handleOpenUserSettings = (
    tab: "profile" | "audio" = "profile",
    subSection?: "voice" | "video",
  ) => {
    setUserSettingsInitialTab(tab);
    setUserSettingsSubSection(subSection);
    setIsUserSettingsOpen(true);
  };
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [serverSettingsTargetGuild, setServerSettingsTargetGuild] =
    useState<Guild | null>(null);
  const [isCreateGuildOpen, setIsCreateGuildOpen] = useState(false);
  const [isJoinGuildOpen, setIsJoinGuildOpen] = useState(false);
  const [pendingInviteCode, setPendingInviteCode] = useState(
    () =>
      window.location.pathname.match(/^\/invite\/([a-zA-Z0-9_-]+)\/?$/)?.[1] ||
      "",
  );
  // 登录后自动消费暂存的邀请码并加入对应服务器
  useEffect(() => {
    if (!isAuthenticated || !currentUser || isLoading) return;
    try {
      const pending = sessionStorage.getItem("tescord_pending_invite");
      if (pending) {
        sessionStorage.removeItem("tescord_pending_invite");
        fetch(`${API_BASE}/api/invites/${pending}/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...useAuthStore.getState().getAuthHeaders(),
          },
          body: JSON.stringify({}),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((result) => {
            if (result) {
              const targetGuildId =
                result.guildId || result.guild?.id || result.id;
              if (targetGuildId) {
                refreshGuilds();
                setSelectedGuildId(targetGuildId);
              }
            }
          })
          .catch(() => {});
      }
    } catch {
      // 忽略存储或解析异常
    }
  }, [isAuthenticated, currentUser, isLoading]);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [selectedCategoryForChannel, setSelectedCategoryForChannel] =
    useState<ChannelCategory | null>(null);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<ChannelCategory | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);
  const [screenShareModeByChannel, setScreenShareModeByChannel] = useState<
    Record<string, StreamTransmissionMode>
  >({});
  const [isNetworkQualityModalOpen, setIsNetworkQualityModalOpen] =
    useState(false);
  const [isP2PFallbackModalOpen, setIsP2PFallbackModalOpen] = useState(false);
  const [p2pFallbackReason, setP2PFallbackReason] = useState<string>("");
  const [inviteFriendsGuild, setInviteFriendsGuild] = useState<Guild | null>(
    null,
  );

  // 私信、呼叫与超级管理员状态
  const [dmChannels, setDmChannels] = useState<Channel[]>([]);
  const [guildUnreadMap, setGuildUnreadMap] = useState<
    Record<string, { hasUnread: boolean; mentionCount: number }>
  >({});
  const [channelUnreadMap, setChannelUnreadMap] = useState<ChannelUnreadMap>(
    {},
  );
  const channelUnreadMapRef = useRef<ChannelUnreadMap>(channelUnreadMap);
  channelUnreadMapRef.current = channelUnreadMap;

  const markChannelReadOnServer = useCallback(
    async (channelId: string, sequence?: number) => {
      const auth = useAuthStore.getState();
      const token = auth.token;
      if (!token) return;
      try {
        await fetch(`${API_BASE}/api/channels/${channelId}/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sequence }),
        });
      } catch (err) {
        console.error("Failed to mark channel as read on server:", err);
      }
    },
    [],
  );

  const totalDmUnread = React.useMemo(() => {
    return dmChannels.reduce((sum, ch) => sum + (ch.unreadCount || 0), 0);
  }, [dmChannels]);
  const hasAnyUnread = React.useMemo(
    () =>
      totalDmUnread > 0 ||
      Object.values(guildUnreadMap).some((entry) => entry.hasUnread) ||
      Object.values(channelUnreadMap).some((entry) => entry.hasUnread),
    [totalDmUnread, guildUnreadMap, channelUnreadMap],
  );
  useEffect(() => {
    window.electronAPI?.syncTrayUnread?.({
      hasUnread: Boolean(isAuthenticated && currentUser && hasAnyUnread),
    });
  }, [isAuthenticated, currentUser?.id, hasAnyUnread]);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    caller: User;
    channelId: string;
    hasVideo: boolean;
  } | null>(null);
  const [activeDMCall, setActiveDMCall] = useState<{
    callId: string;
    channelId: string;
    hasVideo: boolean;
  } | null>(null);
  const activeDMCallRef = useRef<typeof activeDMCall>(null);
  const [callEncryption, setCallEncryption] = useState<{
    status: "idle" | "negotiating" | "tofu" | "trusted" | "failed";
    fingerprint?: string;
  }>({ status: "idle" });
  const dmCallStoreState = useDMCallStore();
  const [systemBroadcast, setSystemBroadcast] = useState<{
    id: string;
    title?: string;
    content: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    expiresAt?: string;
  } | null>(null);

  // 全局 Toast 浮窗提示状态（伴音降级、异常警告等）
  const [globalToast, setGlobalToast] = useState<{
    message: string;
    type?: "info" | "warning" | "error";
  } | null>(null);
  const globalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showGlobalToast = (
    message: string,
    type: "info" | "warning" | "error" = "info",
    duration = 5000,
  ) => {
    if (globalToastTimerRef.current) clearTimeout(globalToastTimerRef.current);
    setGlobalToast({ message, type });
    globalToastTimerRef.current = setTimeout(() => {
      setGlobalToast(null);
    }, duration);
  };

  // 初始化鉴权状态
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // 全局右键菜单控制：保留业务右键菜单，放行输入框、选中文本、链接与媒体，仅屏蔽空白背景
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      // 1. 如果已被内部组件 (如 Radix UI 业务右键菜单) 消费并阻止默认行为，直接放行
      if (e.defaultPrevented) {
        return;
      }

      // 2. Shift+右键：开发者/用户逃生通道，直接放行
      if (e.shiftKey) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 3. 原生输入控件或可编辑区域：放行剪切/复制/粘贴
      const isEditable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest("input, textarea, [contenteditable='true']"));

      if (isEditable) {
        return;
      }

      // 4. 用户正在选中文本（非空选区）：放行复制
      const selection = window.getSelection()?.toString();
      if (selection && selection.trim().length > 0) {
        return;
      }

      // 5. 超链接：放行以支持复制链接地址/外部打开
      if (target.closest("a[href]")) {
        return;
      }

      // 6. 独立图片元素：放行以支持复制图片链接
      if (target.tagName === "IMG" || Boolean(target.closest("img"))) {
        return;
      }

      // 7. 其余空白与常规展示区域：屏蔽浏览器默认菜单（避免弹出浏览器的前进/后退/打印等）
      e.preventDefault();
    };

    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  // 监听用户身份切换或退出登录：彻底清理所有私有状态，杜绝跨账号数据残留
  const lastActiveUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = currentUser?.id || null;
    useChannelNavStore.getState().setUserId(currentId);
    if (lastActiveUserIdRef.current !== currentId) {
      accountEpochRef.current += 1;
      if (lastActiveUserIdRef.current !== null) {
        // 用户身份发生变动（从 User A 变为 User B，或者从 User A 变为登出）
        isAccountTransitionRef.current = true;
        window.electronAPI?.syncTrayUnread?.({ hasUnread: false });
        gatewayClient.disconnect();
        preheatManager.reset();
        clearFastMarkdownCache();
        voiceMeshManager.setContext(null);
        p2pStreamManager.setContext(null);
        audioEngine.stop();
        mediaEncryptionService.stop();
        deviceKeyService.clear();
        screenShareGenerationRef.current++;
        displayCaptureCleanupRef.current?.();
        displayCaptureCleanupRef.current = null;
        livekitService.setNegotiatedE2EEKey(null);
        cloudflareRealtimeService.setNegotiatedE2EEKey(null);
        accountCleanupPromiseRef.current = Promise.allSettled([
          cloudflareRealtimeService.disconnect(),
          livekitService.leaveRoom(),
        ]).then(() => undefined);
        setMessages([]);
        setDmChannels([]);
        setChannelUnreadMap({});
        setGuildUnreadMap({});
        setVoiceStates([]);
        setActiveVoiceChannelId(null);
        setActiveDMCall(null);
        setIncomingCall(null);
        setIsScreenSharing(false);
        setIsVideoEnabled(false);
        setActiveScreenShare(null);
        setVoiceTransferNotice(null);
        voiceRevisionRef.current.clear();
        usePresenceStore.getState().clearPresences();
        useFriendStore.setState({
          relationships: [],
          isLoading: false,
          error: null,
          searchQuery: "",
        });
        if (currentId !== null) {
          const navStore = useChannelNavStore.getState();
          const cached = navStore.loadCachedGuilds(currentId);
          const nextNav = navStore.getInitialNavigation(currentId, cached);
          setGuilds(cached);
          setSelectedGuildId(nextNav.selectedGuildId);
          setSelectedChannel(nextNav.selectedChannel);
          setIsFriendsTabActive(nextNav.isFriendsTabActive);
        } else {
          setGuilds([]);
          setSelectedGuildId(null);
          setSelectedChannel(null);
          setIsFriendsTabActive(true);
        }
      }
      lastActiveUserIdRef.current = currentId;
      isAccountTransitionRef.current = false;
      messageDb.switchUser(currentId);
    }
  }, [currentUser?.id]);

  // 拉取公会列表
  const refreshGuilds = (selectedGuildOverride?: string | null) => {
    const auth = useAuthStore.getState();
    const token = auth.token;
    const requestedUserId = auth.user?.id;
    const requestedEpoch = accountEpochRef.current;
    if (!token || !requestedUserId) return;
    fetch(`${API_BASE}/api/guilds`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((res) => res.json())
      .then((data: Guild[]) => {
        const latestAuth = useAuthStore.getState();
        if (
          requestedEpoch !== accountEpochRef.current ||
          latestAuth.user?.id !== requestedUserId ||
          latestAuth.token !== token
        )
          return;
        if (
          selectedGuildOverride !== undefined &&
          selectedGuildIdRef.current !== selectedGuildOverride
        )
          return;
        setGuilds(data);
        setChannelUnreadMap(() => {
          const next: ChannelUnreadMap = {};
          for (const g of data) {
            for (const ch of g.channels || []) {
              if (ch.type === "TEXT") {
                const unreadCount = ch.unreadCount || 0;
                next[ch.id] = {
                  channelId: ch.id,
                  guildId: g.id,
                  hasUnread: unreadCount > 0,
                  unreadCount,
                  mentionCount: 0,
                  lastReadSequence: ch.lastReadSequence || 0,
                };
              }
            }
          }
          return next;
        });
        setGuildUnreadMap(
          Object.fromEntries(
            data
              .filter((guild) =>
                guild.channels?.some(
                  (channel) =>
                    channel.type === "TEXT" && (channel.unreadCount || 0) > 0,
                ),
              )
              .map((guild) => [guild.id, { hasUnread: true, mentionCount: 0 }]),
          ),
        );
        useChannelNavStore.getState().saveCachedGuilds(data, requestedUserId);

        // 验证当前选中的公会
        const currentSelectedId =
          selectedGuildOverride === undefined
            ? selectedGuildIdRef.current
            : selectedGuildOverride;
        const rememberedGuild = useChannelNavStore
          .getState()
          .getLastSelectedGuild(requestedUserId);

        if (currentSelectedId === null) {
          // 若用户显式处于好友/私信主页（或记忆为 null），坚决保持在好友主页
          // 仅当从未有任何记忆（undefined 首次启动）且存在公会时，才默认选中第 1 个公会
          if (rememberedGuild === undefined && data.length > 0) {
            const firstGuild = data[0];
            setSelectedGuildId(firstGuild.id);
            setIsFriendsTabActive(false);
            const lastChannelId = useChannelNavStore
              .getState()
              .getLastVisitedChannel(firstGuild.id);
            const targetChannel = resolveGuildChannel(
              firstGuild,
              lastChannelId,
              true,
            );
            setSelectedChannel(targetChannel);
            if (targetChannel?.guildId) {
              useChannelNavStore
                .getState()
                .recordChannelVisit(targetChannel.guildId, targetChannel.id);
            }
            useChannelNavStore
              .getState()
              .recordLastSelectedGuild(firstGuild.id);
          }
        } else {
          const currentSelectedGuild = data.find(
            (g) => g.id === currentSelectedId,
          );
          if (currentSelectedGuild) {
            // 当前公会仍存在，校验并更新频道对象
            setSelectedChannel((prevChannel) => {
              if (!prevChannel) {
                const lastChannelId = useChannelNavStore
                  .getState()
                  .getLastVisitedChannel(currentSelectedGuild.id);
                return resolveGuildChannel(
                  currentSelectedGuild,
                  lastChannelId,
                  true,
                );
              }
              const channelStillExists = currentSelectedGuild.channels?.some(
                (c) => c.id === prevChannel.id,
              );
              if (channelStillExists) {
                return (
                  currentSelectedGuild.channels?.find(
                    (c) => c.id === prevChannel.id,
                  ) || prevChannel
                );
              }
              return resolveGuildChannel(currentSelectedGuild, null, true);
            });
          } else {
            // 当前公会已不存在（被解散或被移出）：平滑降级至好友主页（无需弹 Toast）
            setSelectedGuildId(null);
            setIsFriendsTabActive(true);
            setSelectedChannel(null);
            useChannelNavStore.getState().recordLastSelectedGuild(null);
          }
        }

        // 调度后台预热各公会文字频道
        const candidateChannels: { id: string; type: string }[] = [];
        data.forEach((g) => {
          const textChannels = g.channels.filter((c) => c.type !== "VOICE");
          candidateChannels.push(...textChannels.slice(0, 2));
        });
        preheatManager.startPreheat(candidateChannels, token);
      })
      .catch((err) => console.error("Failed to load guilds:", err));
  };

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!isAuthenticated || !currentUser?.id || !token || !window.indexedDB)
      return;
    deviceKeyService.ensureAndRegister(currentUser.id, token).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to initialize account-scoped device keys:", error);
      showGlobalToast("设备身份密钥初始化失败，E2EE 媒体将保持禁用", "error");
    });
  }, [isAuthenticated, currentUser?.id]);

  // 本机资料更新先同步至已加载的成员缓存；网关事件随后仍按用户 ID 幂等合并。
  // 这样短暂重连期间切换 Presence 也不会让自己的状态指示滞后。
  useEffect(() => {
    if (!currentUser) return;
    setGuilds((previous) =>
      previous.map((guild) => ({
        ...guild,
        members: guild.members?.map((member) =>
          member.userId === currentUser.id && member.user
            ? {
                ...member,
                user: {
                  ...member.user,
                  status: currentUser.status,
                  customStatus: currentUser.customStatus,
                },
              }
            : member,
        ),
      })),
    );
  }, [currentUser?.id, currentUser?.status, currentUser?.customStatus]);

  // 拉取私信列表
  const refreshDMChannels = useCallback(async () => {
    try {
      const auth = useAuthStore.getState();
      const token = auth.token;
      const requestedUserId = auth.user?.id;
      const requestedEpoch = accountEpochRef.current;
      if (!token || !requestedUserId) return;
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: Channel[] | { items: Channel[] } = await res.json();
        const latestAuth = useAuthStore.getState();
        if (
          requestedEpoch !== accountEpochRef.current ||
          latestAuth.user?.id !== requestedUserId ||
          latestAuth.token !== token
        )
          return;
        const dms = Array.isArray(data) ? data : data.items;
        setDmChannels(dms);

        // 同步私信参与者在线状态至全局 usePresenceStore
        const dmPresences: Record<string, any> = {};
        for (const ch of dms) {
          for (const r of ch.recipients || []) {
            if (r.id) {
              dmPresences[r.id] = {
                status: r.status,
                customStatus: r.customStatus,
                activities: r.activities,
              };
            }
          }
        }
        usePresenceStore.getState().batchSetPresences(dmPresences);

        // 调度后台预热活跃私信会话
        preheatManager.startPreheat(dms.slice(0, 3), token);
      }
    } catch (err) {
      console.error("Failed to load DM channels:", err);
    }
  }, []);

  // 当用户鉴权登入后建立连接
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    isAccountTransitionRef.current = false;

    refreshGuilds();
    refreshDMChannels();
    window.electronAPI?.syncUserStatus(currentUser.status);
    p2pStreamManager.setContext(currentUser.id);

    // 初始化端到端双棘轮身份密钥对并同步 PreKeyBundle
    const token = localStorage.getItem("tescord_access_token") || undefined;
    doubleRatchetManager.init(currentUser.id, token);

    // 连接 WebSocket 网关
    const gatewayToken = useAuthStore.getState().accessToken;
    if (gatewayToken) gatewayClient.connect(gatewayToken, currentUser.id);
    voiceMeshManager.setContext(currentUser.id);
    useSettingsStore.getState().fetchCloudSettings();
    if (typeof window !== "undefined") {
      (window as any).voiceMeshManager = voiceMeshManager;
      (window as any).p2pStreamManager = p2pStreamManager;
      (window as any).useSettingsStore = useSettingsStore;
      (window as any).__gatewayClient = gatewayClient;
      (window as any).__livekitService = livekitService;
      (window as any).__dmCallStore = useDMCallStore;
      (window as any).__soundManager = soundManager;
    }

    // 浏览器关闭前主动断开网关，加速服务端 3.5s 防抖下线
    const handleBeforeUnload = () => {
      gatewayClient.disconnect();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // 页面切回前台时，主动触发状态轻量对齐，防止息屏/休眠漏包失步
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshGuilds();
        refreshDMChannels();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 监听 P2P 直连信令与拓扑调度 (区分纯语音 Mesh 与屏幕直播流)
    const unbindP2PSignal = gatewayClient.on(
      GatewayEvents.P2P_SIGNAL,
      (signal) => {
        if (
          signal?.type === "VOICE_OFFER" ||
          signal?.type === "VOICE_ANSWER" ||
          signal?.type === "VOICE_ICE_CANDIDATE" ||
          signal?.type === "VOICE_LEAVE"
        ) {
          if (!signal.callId) {
            const remote = voiceStatesRef.current.find(
              (state) =>
                state.userId === signal.senderId &&
                state.channelId === signal.channelId,
            );
            if (
              !signal.senderSessionId ||
              !remote ||
              (remote.sessionId && remote.sessionId !== signal.senderSessionId)
            )
              return;
          }
          voiceMeshManager.handleVoiceSignal(signal);
        } else {
          p2pStreamManager.handleP2PSignal(signal);
        }
      },
    );

    const unbindP2PTopology = gatewayClient.on(
      GatewayEvents.P2P_TOPOLOGY_UPDATE,
      (topology) => {
        p2pStreamManager.handleTopologyUpdate(topology);
      },
    );

    const unbindP2PFallback = p2pStreamManager.onFallbackNeeded((reason) => {
      setP2PFallbackReason(reason);
      setIsP2PFallbackModalOpen(true);
    });
    const unbindVoiceMeshFallback = voiceMeshManager.onFallbackNeeded(
      (context) => {
        void connectSfuFallbackRef.current(context.channelId, context.callId);
      },
    );

    // 监听网关信令事件
    const unbindReady = gatewayClient.on("READY", (data) => {
      if (data.guilds) {
        setGuilds(data.guilds);
        const currentUserId = useAuthStore.getState().user?.id;
        if (currentUserId) {
          useChannelNavStore
            .getState()
            .saveCachedGuilds(data.guilds, currentUserId);
        }
        const initialPresences: Record<string, any> = {};
        for (const guild of data.guilds) {
          for (const member of guild.members || []) {
            if (member.userId && member.user) {
              initialPresences[member.userId] = {
                status: member.user.status,
                customStatus: member.user.customStatus,
                activities: member.user.activities,
              };
            }
          }
        }
        usePresenceStore.getState().batchSetPresences(initialPresences);
      }
      if (data.voiceStates) {
        voiceRevisionRef.current = new Map(
          data.voiceStates
            .filter((state: VoiceState) => state.revision !== undefined)
            .map((state: VoiceState) => [state.userId, state.revision!]),
        );
        setVoiceStates(data.voiceStates);
      }
    });

    // 监听实时在线状态广播
    const unbindPresenceUpdate = gatewayClient.on(
      GatewayEvents.PRESENCE_UPDATE,
      (data: PresenceUpdateEvent) => {
        // 1. 同步注入全局唯一权威 usePresenceStore
        usePresenceStore.getState().setPresence(data.userId, {
          status: data.status,
          customStatus: data.customStatus,
          activities: data.activities,
        });

        // 2. 同步更新 guilds
        setGuilds((prev) =>
          prev.map((g) => {
            if (!g.members?.some((m) => m.userId === data.userId)) return g;
            return {
              ...g,
              members: g.members.map((m) =>
                m.userId === data.userId && m.user
                  ? {
                      ...m,
                      user: {
                        ...m.user,
                        status: data.status,
                        customStatus:
                          data.customStatus !== undefined
                            ? data.customStatus
                            : m.user.customStatus,
                        activities: data.activities,
                      },
                    }
                  : m,
              ),
            };
          }),
        );

        // 3. 同步更新 dmChannels (修复私信列表状态灯响应式丢失)
        setDmChannels((prev) =>
          prev.map((c) => {
            if (!c.recipients?.some((r) => r.id === data.userId)) return c;
            return {
              ...c,
              recipients: c.recipients.map((r) =>
                r.id === data.userId
                  ? {
                      ...r,
                      status: data.status,
                      customStatus:
                        data.customStatus !== undefined
                          ? data.customStatus
                          : r.customStatus,
                      activities: data.activities,
                    }
                  : r,
              ),
            };
          }),
        );

        // 4. 若为自身端的状态更新（包括跨端同步或自身隐身），同步当前用户信息
        if (currentUser && data.userId === currentUser.id) {
          useAuthStore.getState().setUser({
            ...currentUser,
            status: data.status,
            customStatus:
              data.customStatus !== undefined
                ? data.customStatus
                : currentUser.customStatus,
            activities: data.activities,
          });
        }
      },
    );

    // 监听 Electron 桌面端游戏进程侦测变动
    let unbindGameActivity: (() => void) | undefined;
    if (window.electronAPI?.onGameActivityChanged) {
      unbindGameActivity = window.electronAPI.onGameActivityChanged(
        (activity) => {
          const u = useAuthStore.getState().user;
          if (!u) return;
          const activities = activity ? [activity] : [];
          useAuthStore.getState().setUser({
            ...u,
            activities,
          });
          gatewayClient.updateStatus(
            u.status || "ONLINE",
            u.customStatus,
            activities,
          );
        },
      );
    }

    // 监听全量用户信息变更广播
    const unbindUserUpdate = gatewayClient.on(
      GatewayEvents.USER_UPDATE,
      (updatedUser: User) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (!g.members?.some((m) => m.userId === updatedUser.id)) return g;
            return {
              ...g,
              members: g.members.map((m) =>
                m.userId === updatedUser.id && m.user
                  ? {
                      ...m,
                      user: {
                        ...m.user,
                        ...updatedUser,
                      },
                    }
                  : m,
              ),
            };
          }),
        );

        if (currentUser && updatedUser.id === currentUser.id) {
          useAuthStore.getState().setUser({
            ...currentUser,
            ...updatedUser,
          });
        }
      },
    );

    const unbindMsgCreate = gatewayClient.on(
      "MESSAGE_CREATE",
      (msg: Message) => {
        // 旁路静默沉淀入本地 IndexedDB，保障后台各频道时刻保持最新离线缓存
        preheatManager.onGatewayMessage(msg);

        // 仅当消息属于当前选中的频道时追加至 messages，防止全服公屏广播串台污染
        if (msg.channelId === selectedChannelRef.current?.id) {
          const appended = messageHistoryRef.current.receiveMessage(msg);
          if (appended && msg.authorId !== currentUser?.id) {
            markChannelReadOnServer(msg.channelId, msg.sequence);
          }
        }

        // 查找该消息频道所属的服务器 (若存在)
        const targetGuild = guilds.find((g) =>
          g.channels?.some((c) => c.id === msg.channelId),
        );
        const msgGuildId = targetGuild?.id;

        // 若属于服务器消息，且当前未在此频道，累计频道与服务器未读与提及计数
        if (msgGuildId && msg.channelId !== selectedChannelRef.current?.id) {
          const isMentioned = Boolean(
            currentUser &&
            (msg.content.includes(`@${currentUser.username}`) ||
              msg.content.includes("@everyone") ||
              msg.content.includes("@here")),
          );
          setChannelUnreadMap((prev) => {
            const cur = prev[msg.channelId] || {
              channelId: msg.channelId,
              guildId: msgGuildId,
              hasUnread: false,
              unreadCount: 0,
              mentionCount: 0,
              lastReadSequence: 0,
            };
            return {
              ...prev,
              [msg.channelId]: {
                ...cur,
                hasUnread: true,
                unreadCount: cur.unreadCount + 1,
                mentionCount: isMentioned
                  ? cur.mentionCount + 1
                  : cur.mentionCount,
                guildId: msgGuildId,
              },
            };
          });
          setGuildUnreadMap((prev) => {
            const cur = prev[msgGuildId] || {
              hasUnread: false,
              mentionCount: 0,
            };
            return {
              ...prev,
              [msgGuildId]: {
                hasUnread: true,
                mentionCount: isMentioned
                  ? cur.mentionCount + 1
                  : cur.mentionCount,
              },
            };
          });
        }

        // 若属于私信会话，同步最新消息与未读计数（若不存在则自动拉取加入列表）
        setDmChannels((prev) => {
          const index = prev.findIndex((dm) => dm.id === msg.channelId);
          const isCurrentActive =
            selectedChannelRef.current?.id === msg.channelId;
          if (index !== -1) {
            const target = prev[index];
            const updated = {
              ...target,
              lastMessage: msg,
              unreadCount: isCurrentActive ? 0 : (target.unreadCount || 0) + 1,
            };
            const next = [...prev];
            next.splice(index, 1);
            return [updated, ...next];
          } else {
            // 本地尚无此会话（例如好友首次发来私信），自动向后端拉取并加入列表头部
            const token = useAuthStore.getState().token;
            fetch(`${API_BASE}/api/users/@me/channels`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.items) {
                  const found = data.items.find(
                    (c: Channel) => c.id === msg.channelId,
                  );
                  if (found) {
                    setDmChannels((curr) => {
                      if (curr.some((c) => c.id === found.id)) return curr;
                      return [
                        {
                          ...found,
                          lastMessage: msg,
                          unreadCount: isCurrentActive ? 0 : 1,
                        },
                        ...curr,
                      ];
                    });
                  }
                }
              })
              .catch(() => {});
            return prev;
          }
        });

        if (
          selectedChannelRef.current?.type === "DM" &&
          selectedChannelRef.current.id === msg.channelId &&
          msg.sequence
        ) {
          const token = useAuthStore.getState().token;
          fetch(`${API_BASE}/api/channels/${msg.channelId}/read`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ lastReadSequence: msg.sequence }),
          }).catch(() => undefined);
        }

        // 4.3 原生桌面通知推送 (当窗口未聚焦或有 @ 提及，且频道与发件人均未被静音)
        if (msg.authorId !== currentUser.id) {
          const isMentioned = msg.content.includes(`@${currentUser.username}`);
          const isChannelMuted = useSettingsStore
            .getState()
            .isChannelMuted(msg.channelId);
          const isUserMuted = useSettingsStore
            .getState()
            .isUserMuted(msg.authorId);
          const isHidden =
            document.hidden || selectedChannelRef.current?.id !== msg.channelId;

          if (!isUserMuted && !isChannelMuted && (isMentioned || isHidden)) {
            window.electronAPI?.showNotification({
              title: `${msg.author?.username || "Tescord"}`,
              body: (() => {
                const c = msg.content;
                if (c.startsWith("[CALL_EVENT:")) {
                  if (c.includes(":missed"))
                    return t("chat:dm.callHistory.missed", {
                      defaultValue: "未接来电",
                    });
                  if (c.includes(":declined"))
                    return t("chat:dm.callHistory.declined", {
                      defaultValue: "已拒绝通话",
                    });
                  if (c.includes(":canceled"))
                    return t("chat:dm.callHistory.canceled", {
                      defaultValue: "已取消呼叫",
                    });
                  if (c.includes(":ended:")) {
                    const dur = c.split(":ended:")[1]?.replace("]", "");
                    return dur
                      ? `${t("chat:dm.callHistory.ended", { defaultValue: "通话已结束" })} (${dur})`
                      : t("chat:dm.callHistory.ended", {
                          defaultValue: "通话已结束",
                        });
                  }
                  return t("chat:dm.callHistory.ended", {
                    defaultValue: "通话已结束",
                  });
                }
                return c.length > 80 ? c.slice(0, 80) + "..." : c;
              })(),
              channelId: msg.channelId,
              guildId: msgGuildId || selectedGuildIdRef.current || undefined,
              avatarUrl: msg.author?.avatarUrl || undefined,
              senderName: msg.author?.username,
              timestamp: Date.now(),
            });
          }
        }
      },
    );

    const unbindMsgDelete = gatewayClient.on(
      "MESSAGE_DELETE",
      (data: { channelId?: string; messageId: string }) => {
        preheatManager.onGatewayMessageDelete(data.messageId);
        void messageDb.deleteMessage(data.messageId);
        if (
          !data.channelId ||
          data.channelId === selectedChannelRef.current?.id
        ) {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        }
      },
    );

    const unbindReactionAdd = gatewayClient.on(
      "MESSAGE_REACTION_ADD",
      (data: any) => {
        if (
          !data.channelId ||
          data.channelId === selectedChannelRef.current?.id
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId ? { ...m, reactions: data.reactions } : m,
            ),
          );
        }
      },
    );

    const unbindReactionRemove = gatewayClient.on(
      "MESSAGE_REACTION_REMOVE",
      (data: any) => {
        if (
          !data.channelId ||
          data.channelId === selectedChannelRef.current?.id
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId ? { ...m, reactions: data.reactions } : m,
            ),
          );
        }
      },
    );

    const unbindPinUpdate = gatewayClient.on(
      "MESSAGE_PIN_UPDATE",
      (data: any) => {
        if (
          !data.channelId ||
          data.channelId === selectedChannelRef.current?.id
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m,
            ),
          );
        }
      },
    );

    const unbindGuildCreate = gatewayClient.on(
      "GUILD_CREATE",
      (newGuild: Guild) => {
        setGuilds((prev) =>
          prev.some((g) => g.id === newGuild.id) ? prev : [...prev, newGuild],
        );
      },
    );

    const unbindChannelCreate = gatewayClient.on(
      "CHANNEL_CREATE",
      (newChannel: Channel) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (g.id !== newChannel.guildId) return g;
            const exists = g.channels.some((c) => c.id === newChannel.id);
            if (exists) {
              return {
                ...g,
                channels: g.channels.map((c) =>
                  c.id === newChannel.id ? newChannel : c,
                ),
              };
            }
            return { ...g, channels: [...g.channels, newChannel] };
          }),
        );
        // 仅当当前用户处于该公会且未选中任何频道时才自动聚焦，避免打扰正在其他频道聊天的成员
        if (
          newChannel.guildId === selectedGuildIdRef.current &&
          !selectedChannelRef.current
        ) {
          setSelectedChannel(newChannel);
        }
      },
    );

    const unbindChannelDelete = gatewayClient.on(
      "CHANNEL_DELETE",
      (data: { channelId: string; guildId: string }) => {
        if (
          useChannelNavStore.getState().getLastVisitedChannel(data.guildId) ===
          data.channelId
        ) {
          useChannelNavStore.getState().removeGuildMemory(data.guildId);
        }
        setGuilds((prev) => {
          const updated = prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  channels: g.channels.filter((c) => c.id !== data.channelId),
                }
              : g,
          );
          if (selectedChannelRef.current?.id === data.channelId) {
            const currentG = updated.find((g) => g.id === data.guildId);
            if (currentG && currentG.channels.length > 0) {
              const fallback = resolveGuildChannel(currentG, null, true);
              setSelectedChannel(fallback);
              if (fallback?.guildId) {
                useChannelNavStore
                  .getState()
                  .recordChannelVisit(fallback.guildId, fallback.id);
              }
            } else {
              setSelectedChannel(null);
            }
          }
          return updated;
        });
      },
    );

    const unbindChannelUpdate = gatewayClient.on(
      "CHANNEL_UPDATE",
      (updatedChannel: Channel) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === updatedChannel.guildId
              ? {
                  ...g,
                  channels: g.channels.map((c) =>
                    c.id === updatedChannel.id ? updatedChannel : c,
                  ),
                }
              : g,
          ),
        );
        if (selectedChannelRef.current?.id === updatedChannel.id) {
          setSelectedChannel(updatedChannel);
        }
      },
    );

    const unbindCategoryCreate = gatewayClient.on(
      GatewayEvents.CATEGORY_CREATE,
      (newCategory: ChannelCategory) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (g.id !== newCategory.guildId) return g;
            const exists = g.categories?.some((c) => c.id === newCategory.id);
            if (exists) {
              return {
                ...g,
                categories: g.categories?.map((c) =>
                  c.id === newCategory.id ? newCategory : c,
                ),
              };
            }
            return {
              ...g,
              categories: [...(g.categories || []), newCategory].sort(
                (a, b) => a.position - b.position,
              ),
            };
          }),
        );
      },
    );

    const unbindCategoryUpdate = gatewayClient.on(
      GatewayEvents.CATEGORY_UPDATE,
      (updatedCategory: ChannelCategory) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === updatedCategory.guildId
              ? {
                  ...g,
                  categories: (g.categories || [])
                    .map((c) =>
                      c.id === updatedCategory.id ? updatedCategory : c,
                    )
                    .sort((a, b) => a.position - b.position),
                }
              : g,
          ),
        );
      },
    );

    const unbindCategoryDelete = gatewayClient.on(
      GatewayEvents.CATEGORY_DELETE,
      (data: { categoryId: string; guildId: string }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  categories: (g.categories || []).filter(
                    (c) => c.id !== data.categoryId,
                  ),
                  channels: g.channels.map((ch) =>
                    ch.parentId === data.categoryId
                      ? { ...ch, parentId: null }
                      : ch,
                  ),
                }
              : g,
          ),
        );
      },
    );

    const unbindCategoryPositions = gatewayClient.on(
      GatewayEvents.CATEGORY_POSITIONS_UPDATE,
      (data: {
        guildId: string;
        categories: { id: string; position: number }[];
      }) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (g.id !== data.guildId) return g;
            const posMap = new Map(
              data.categories.map((c) => [c.id, c.position]),
            );
            return {
              ...g,
              categories: (g.categories || [])
                .map((c) => ({
                  ...c,
                  position: posMap.has(c.id) ? posMap.get(c.id)! : c.position,
                }))
                .sort((a, b) => a.position - b.position),
            };
          }),
        );
      },
    );

    const unbindChannelPositions = gatewayClient.on(
      GatewayEvents.CHANNEL_POSITIONS_UPDATE,
      (data: {
        guildId: string;
        channels: { id: string; position: number; parentId?: string | null }[];
      }) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (g.id !== data.guildId) return g;
            const updateMap = new Map(data.channels.map((c) => [c.id, c]));
            return {
              ...g,
              channels: g.channels
                .map((ch) => {
                  const updated = updateMap.get(ch.id);
                  if (!updated) return ch;
                  return {
                    ...ch,
                    position: updated.position,
                    ...(updated.parentId !== undefined
                      ? { parentId: updated.parentId }
                      : {}),
                  };
                })
                .sort((a, b) => a.position - b.position),
            };
          }),
        );
      },
    );

    const unbindMemberAdd = gatewayClient.on(
      GatewayEvents.GUILD_MEMBER_ADD,
      (data: { guildId: string; member: GuildMember }) => {
        setGuilds((prev) =>
          prev.map((g) => {
            if (g.id !== data.guildId) return g;
            const currentMembers = g.members || [];
            if (currentMembers.some((m) => m.userId === data.member.userId)) {
              return {
                ...g,
                members: currentMembers.map((m) =>
                  m.userId === data.member.userId ? data.member : m,
                ),
              };
            }
            return {
              ...g,
              members: [...currentMembers, data.member],
            };
          }),
        );

        setServerSettingsTargetGuild((prev) => {
          if (!prev || prev.id !== data.guildId) return prev;
          const currentMembers = prev.members || [];
          if (currentMembers.some((m) => m.userId === data.member.userId)) {
            return {
              ...prev,
              members: currentMembers.map((m) =>
                m.userId === data.member.userId ? data.member : m,
              ),
            };
          }
          return {
            ...prev,
            members: [...currentMembers, data.member],
          };
        });

        if (currentUser && data.member.userId === currentUser.id) {
          refreshGuilds();
        }
      },
    );

    const unbindMemberRemove = gatewayClient.on(
      "GUILD_MEMBER_REMOVE",
      (data: { guildId: string; userId: string }) => {
        if (currentUser && data.userId === currentUser.id) {
          // 当前用户自身离开或被移出公会：从公会列表中彻底移除
          useChannelNavStore.getState().removeGuildMemory(data.guildId);
          setGuilds((prev) => prev.filter((g) => g.id !== data.guildId));
          if (selectedGuildIdRef.current === data.guildId) {
            setSelectedGuildId(null);
            setSelectedChannel(null);
            showGlobalToast("您已离开或被移出该服务器", "info");
          }
          return;
        }

        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  members:
                    g.members?.filter((m) => m.userId !== data.userId) || [],
                }
              : g,
          ),
        );
        setServerSettingsTargetGuild((prev) => {
          if (!prev || prev.id !== data.guildId) return prev;
          return {
            ...prev,
            members:
              prev.members?.filter((m) => m.userId !== data.userId) || [],
          };
        });
      },
    );

    const unbindVoice = gatewayClient.on(
      "VOICE_STATE_UPDATE",
      (vs: VoiceState) => {
        const lastRevision = voiceRevisionRef.current.get(vs.userId);
        if (
          vs.revision !== undefined &&
          lastRevision !== undefined &&
          vs.revision <= lastRevision
        )
          return;
        if (vs.revision !== undefined) {
          voiceRevisionRef.current.set(vs.userId, vs.revision);
        }
        // 若变动成员是当前用户自身：校验是否有其他设备接管或被退出
        if (currentUser && vs.userId === currentUser.id) {
          const isOtherSession =
            Boolean(vs.sessionId) &&
            vs.sessionId !== gatewayClient.getSessionId();
          if (!vs.channelId || isOtherSession) {
            // 防误杀逻辑：若不是异地接管，且处于切频过渡期或收到的离开信令是旧频道过渡信令，则安全忽略本地断开
            const isSwitchingTransition =
              !isOtherSession &&
              (isVoiceSwitchingRef.current ||
                (Boolean(vs.previousChannelId) &&
                  Boolean(activeVoiceChannelIdRef.current) &&
                  activeVoiceChannelIdRef.current !== vs.previousChannelId));

            if (!isSwitchingTransition) {
              console.warn(
                "[Voice] 收到本账号异地登录接管或离线信令，彻底清理本地 WebRTC 与音频硬件...",
              );
              voiceOperationEpochRef.current++;
              isVoiceSwitchingRef.current = false;
              mediaEncryptionService.stop();
              screenShareGenerationRef.current++;
              displayCaptureCleanupRef.current?.();
              displayCaptureCleanupRef.current = null;
              voiceMeshManager.stopAll();
              p2pStreamManager.stopAll();
              audioEngine.stop();
              void cloudflareRealtimeService.disconnect();
              void livekitService.leaveRoom();
              activeVoiceChannelIdRef.current = null;
              setActiveVoiceChannelId(null);
              setIsSpeaking(false);
              setIsScreenSharing(false);
              setIsVideoEnabled(false);
              if (isOtherSession) {
                const prevCh =
                  guildsRef.current
                    .flatMap((g) => g.channels)
                    .find((c) => c.id === activeVoiceChannelIdRef.current) ||
                  selectedChannelRef.current;
                setVoiceTransferNotice({
                  targetPlatform: vs.platform || t("voice:otherDevice"),
                  previousChannel: prevCh || null,
                });
              }
            } else {
              console.log(
                `[Voice] 收到频道切换过渡离开信令 (${vs.previousChannelId} -> ${activeVoiceChannelIdRef.current})，安全忽略本地清理`,
              );
            }
          }
          // A delayed join acknowledgement must never resurrect a locally cancelled
          // or transferred session. Joins set the intended channel before signalling;
          // an unsolicited channel also has no negotiated media context.
        }

        setVoiceStates((prev) => {
          // 若变动成员不是自身，且自身当前处于语音频道中，播放进出提示音
          const currentVoiceId = activeVoiceChannelIdRef.current;
          if (currentUser && vs.userId !== currentUser.id && currentVoiceId) {
            const oldState = prev.find((p) => p.userId === vs.userId);
            const wasInMyChannel = oldState?.channelId === currentVoiceId;
            const isNowInMyChannel = vs.channelId === currentVoiceId;
            const replacedDevice =
              wasInMyChannel &&
              isNowInMyChannel &&
              Boolean(vs.sessionId) &&
              Boolean(oldState?.sessionId) &&
              vs.sessionId !== oldState?.sessionId;
            if (replacedDevice) voiceMeshManager.closePeer(vs.userId);

            if ((!wasInMyChannel && isNowInMyChannel) || replacedDevice) {
              if (!replacedDevice) soundManager.play("USER_JOIN");
              // 同步更新 VoiceMeshManager 成员列表
              const nextOtherMembers = [
                ...prev
                  .filter(
                    (p) =>
                      p.channelId === currentVoiceId &&
                      p.userId !== currentUser.id &&
                      p.userId !== vs.userId,
                  )
                  .map((p) => p.userId),
                vs.userId,
              ];
              voiceMeshManager.updateChannelMembers(nextOtherMembers);
            } else if (wasInMyChannel && !isNowInMyChannel) {
              soundManager.play("USER_LEAVE");
              // 联动 VoiceMeshManager 即刻清理离线节点并取消重试
              voiceMeshManager.handlePeerLeave(vs.userId);
              const remainingOtherMembers = prev
                .filter(
                  (p) =>
                    p.channelId === currentVoiceId &&
                    p.userId !== currentUser.id &&
                    p.userId !== vs.userId,
                )
                .map((p) => p.userId);
              voiceMeshManager.updateChannelMembers(remainingOtherMembers);
            }
          }

          // 1. 用户退出语音频道：从列表中移除
          if (!vs.channelId) {
            return prev.filter((p) => p.userId !== vs.userId);
          }

          const existingIndex = prev.findIndex((p) => p.userId === vs.userId);
          // 2. 成员已在列表中且属于同一频道（闭麦、开麦、静音等状态变动）：
          // 严格保持原数组索引不变（原地更新），杜绝列表重新排序与跳动
          if (
            existingIndex !== -1 &&
            prev[existingIndex].channelId === vs.channelId
          ) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...vs };
            return next;
          }

          // 3. 新加入成员或切换频道：先过滤旧状态，再追加到新频道列表中
          return [...prev.filter((p) => p.userId !== vs.userId), vs];
        });
      },
    );

    const unbindGuildUpdate = gatewayClient.on("GUILD_UPDATE", (data: any) => {
      setGuilds((prev) =>
        prev.map((g) => (g.id === data.id ? { ...g, ...data } : g)),
      );
    });

    const unbindGuildDelete = gatewayClient.on(
      "GUILD_DELETE",
      (data: { guildId: string }) => {
        useChannelNavStore.getState().removeGuildMemory(data.guildId);
        setGuilds((prev) => prev.filter((g) => g.id !== data.guildId));
        if (selectedGuildIdRef.current === data.guildId) {
          setSelectedGuildId(null);
          setSelectedChannel(null);
        }
      },
    );

    const unbindRoleCreate = gatewayClient.on(
      "GUILD_ROLE_CREATE",
      (data: { guildId: string; role: Role }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? { ...g, roles: [...(g.roles || []), data.role] }
              : g,
          ),
        );
      },
    );

    const unbindRoleUpdate = gatewayClient.on(
      "GUILD_ROLE_UPDATE",
      (data: { guildId: string; role: Role }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  roles: (g.roles || []).map((r) =>
                    r.id === data.role.id ? data.role : r,
                  ),
                }
              : g,
          ),
        );
      },
    );

    const unbindRoleDelete = gatewayClient.on(
      "GUILD_ROLE_DELETE",
      (data: { guildId: string; roleId: string }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  roles: (g.roles || []).filter((r) => r.id !== data.roleId),
                  members: (g.members || []).map((m) => ({
                    ...m,
                    roleIds: parseRoleIds(m.roleIds).filter(
                      (id) => id !== data.roleId,
                    ),
                  })),
                }
              : g,
          ),
        );
      },
    );

    const unbindMemberUpdate = gatewayClient.on(
      "GUILD_MEMBER_UPDATE",
      (data: { guildId: string; member: GuildMember }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  members: (g.members || []).map((m) =>
                    m.userId === data.member.userId ? data.member : m,
                  ),
                }
              : g,
          ),
        );
      },
    );

    const unbindBanAdd = gatewayClient.on(
      "GUILD_BAN_ADD",
      (data: { guildId: string; ban: any }) => {
        if (data.ban?.userId === currentUser?.id) {
          useChannelNavStore.getState().removeGuildMemory(data.guildId);
          setGuilds((prev) => prev.filter((g) => g.id !== data.guildId));
          if (selectedGuildIdRef.current === data.guildId) {
            setSelectedGuildId(null);
            setSelectedChannel(null);
          }
        }
      },
    );

    const unbindVoiceDisconnect = gatewayClient.on(
      "VOICE_SERVER_DISCONNECT",
      async (data: VoiceServerDisconnectPayload) => {
        if (data.reason === "MEDIA_NEGOTIATION_TIMEOUT") {
          showGlobalToast(
            getErrorMessage({ code: "MEDIA_NEGOTIATION_TIMEOUT" }),
            "error",
          );
          await handleLeaveVoiceChannel();
          return;
        }
        if (data.reason === "KICKED") {
          showGlobalToast(
            t("voice:kickedFromVoiceNotice", "您已被管理员移出语音频道"),
            "warning",
          );
          await handleLeaveVoiceChannel();
          return;
        }
        if (data.reason === "VOICE_TRANSFER") {
          const prevChannel =
            guildsRef.current
              .flatMap((g) => g.channels)
              .find((c) => c.id === activeVoiceChannelIdRef.current) ||
            selectedChannelRef.current;

          // 1. 彻底释放麦克风硬件与媒体流
          mediaEncryptionService.stop();
          screenShareGenerationRef.current++;
          displayCaptureCleanupRef.current?.();
          displayCaptureCleanupRef.current = null;
          voiceOperationEpochRef.current++;
          isVoiceSwitchingRef.current = false;
          activeVoiceChannelIdRef.current = null;
          voiceMeshManager.stopAll();
          p2pStreamManager.stopAll();
          audioEngine.stop();

          // 2. 播放挂断提示音
          soundManager.play("VOICE_LEAVE");

          // 3. 重置本地活跃状态
          setActiveVoiceChannelId(null);
          setIsSpeaking(false);
          setIsScreenSharing(false);
          setIsVideoEnabled(false);

          // 4. 展示转移提示卡片
          setVoiceTransferNotice({
            targetPlatform: data.targetPlatform || t("voice:otherDevice"),
            previousChannel: prevChannel || null,
          });
          await Promise.allSettled([
            cloudflareRealtimeService.disconnect(),
            livekitService.leaveRoom(),
          ]);
        }
      },
    );

    // 监听 1v1 私信通话与系统信令
    const unbindCallOffer = gatewayClient.on(
      GatewayEvents.CALL_OFFER,
      (data: {
        callId: string;
        channelId: string;
        caller: Pick<User, "id" | "username" | "avatarUrl">;
        hasVideo?: boolean;
      }) => {
        const activeCall = {
          callId: data.callId,
          channelId: data.channelId,
          hasVideo: !!data.hasVideo,
        };
        activeDMCallRef.current = activeCall;
        setActiveDMCall(activeCall);
        setCallEncryption({ status: "negotiating" });
        useDMCallStore.getState().receiveIncoming({
          callId: data.callId,
          channelId: data.channelId,
          caller: data.caller as User,
          hasVideo: !!data.hasVideo,
        });
        setIncomingCall({
          callId: data.callId,
          caller: data.caller as User,
          channelId: data.channelId,
          hasVideo: !!data.hasVideo,
        });
      },
    );

    const unbindCallAnswer = gatewayClient.on(
      GatewayEvents.CALL_ANSWER,
      (data: { callId: string; channelId: string }) => {
        soundManager.stopLoop();
        soundManager.play("CALL_CONNECT");
        useDMCallStore.getState().setConnected(data.callId);
        showGlobalToast("对方已接听通话", "info");
        if (activeDMCallRef.current?.callId === data.callId) {
          handleJoinDMCall(
            data.channelId,
            activeDMCallRef.current.hasVideo,
            data.callId,
          );
        }
      },
    );

    const unbindCallReject = gatewayClient.on(GatewayEvents.CALL_REJECT, () => {
      soundManager.stopLoop();
      soundManager.play("CALL_DISCONNECT");
      showGlobalToast("对方已挂断或拒绝了通话", "warning");
      useDMCallStore.getState().reset();
      activeDMCallRef.current = null;
      setActiveDMCall(null);
      setCallEncryption({ status: "idle" });
      handleLeaveVoiceChannel();
    });

    const unbindCallState = gatewayClient.on(
      GatewayEvents.CALL_STATE_UPDATE,
      async (data: {
        callId: string;
        channelId: string;
        callerId: string;
        hasVideo: boolean;
        state: string;
      }) => {
        if (data.state === "ringing" || data.state === "active") {
          const call = {
            callId: data.callId,
            channelId: data.channelId,
            hasVideo: data.hasVideo,
          };
          activeDMCallRef.current = call;
          setActiveDMCall(call);

          if (data.state === "ringing") {
            if (data.callerId === currentUser?.id) {
              soundManager.startLoop("CALL_CALLING");
              useDMCallStore.getState().setConnecting(data.callId);
            }
          } else if (data.state === "active") {
            soundManager.stopLoop();
            soundManager.play("CALL_CONNECT");
            useDMCallStore.getState().setConnected(data.callId);
          }

          if (data.state === "active") {
            void handleJoinDMCall(data.channelId, data.hasVideo, data.callId);
          }
        }
      },
    );

    const unbindMediaKey = () => {};

    const unbindCallEnd = gatewayClient.on(
      GatewayEvents.CALL_END,
      (data: DMCallEndedPayload) => {
        if (recordedDMCallIdsRef.current.has(data.callId)) return;
        const currentDMStore = useDMCallStore.getState();
        const pending = pendingDMCallHistoryRef.current.get(data.callId);
        if (
          currentDMStore.callId !== data.callId &&
          activeDMCallRef.current?.callId !== data.callId &&
          !pending
        )
          return;
        recordedDMCallIdsRef.current.add(data.callId);
        if (recordedDMCallIdsRef.current.size > 256) {
          const oldestCallId = recordedDMCallIdsRef.current
            .values()
            .next().value;
          if (oldestCallId) recordedDMCallIdsRef.current.delete(oldestCallId);
        }
        pendingDMCallHistoryRef.current.delete(data.callId);
        soundManager.stopLoop();
        soundManager.play("CALL_DISCONNECT");
        const callChId =
          data.channelId ||
          pending?.channelId ||
          currentDMStore.channelId ||
          activeDMCallRef.current?.channelId;
        const callState = pending?.callState || currentDMStore.callState;
        const callStartTime =
          pending?.callStartTime || currentDMStore.callStartTime;
        const isCaller = pending?.isCaller ?? currentDMStore.isCaller;
        const shouldRecord =
          data.reason === "timeout"
            ? isCaller
            : data.reason === "disconnected"
              ? data.endedBy !== currentUser?.id
              : data.endedBy === currentUser?.id;
        if (callChId && shouldRecord) {
          if (data.reason === "rejected") {
            handleSendDMCallHistoryMessage(callChId, "[CALL_EVENT:declined]");
          } else if (data.reason === "canceled") {
            handleSendDMCallHistoryMessage(callChId, "[CALL_EVENT:canceled]");
          } else if (data.reason === "timeout") {
            handleSendDMCallHistoryMessage(callChId, "[CALL_EVENT:missed]");
          } else if (callState === "connected" && callStartTime) {
            const elapsedSeconds = Math.floor(
              (Date.now() - callStartTime) / 1000,
            );
            const mins = Math.floor(elapsedSeconds / 60)
              .toString()
              .padStart(2, "0");
            const secs = (elapsedSeconds % 60).toString().padStart(2, "0");
            handleSendDMCallHistoryMessage(
              callChId,
              `[CALL_EVENT:ended:${mins}:${secs}]`,
            );
          } else if (isCaller) {
            handleSendDMCallHistoryMessage(callChId, "[CALL_EVENT:canceled]");
          } else {
            handleSendDMCallHistoryMessage(callChId, "[CALL_EVENT:missed]");
          }
        }
        useDMCallStore.getState().reset();
        setIncomingCall(null);
        activeDMCallRef.current = null;
        setActiveDMCall(null);
        setCallEncryption({ status: "idle" });
        if (activeVoiceChannelIdRef.current === data.channelId) {
          handleLeaveVoiceChannel();
        }
      },
    );

    const unbindSystemBroadcast = gatewayClient.on(
      GatewayEvents.SYSTEM_BROADCAST,
      (data: {
        id: string;
        title?: string;
        content: string;
        severity: "INFO" | "WARNING" | "CRITICAL";
        expiresAt?: string;
      }) => {
        setSystemBroadcast(data);
      },
    );

    const unbindMaintenanceUpdate = gatewayClient.on(
      GatewayEvents.MAINTENANCE_UPDATE,
      (data: { enabled: boolean; announcement?: string }) => {
        if (data.enabled) {
          const userRole = useAuthStore.getState().user?.role;
          if (userRole !== "SUPER_ADMIN" && activeVoiceChannelIdRef.current) {
            handleLeaveVoiceChannel();
          }
        } else {
          showGlobalToast("系统维护已结束，服务已恢复正常！", "info");
        }
      },
    );

    const unbindDMCreate = gatewayClient.on(
      GatewayEvents.DM_CHANNEL_CREATE,
      (newChannel: Channel) => {
        setDmChannels((prev) => {
          if (prev.some((c) => c.id === newChannel.id)) return prev;
          return [newChannel, ...prev];
        });
      },
    );

    const unbindDMUpdate = gatewayClient.on(
      GatewayEvents.DM_CHANNEL_UPDATE,
      (
        update: Channel & {
          channelId?: string;
          unreadIncrement?: number;
          lastReadSequence?: number;
        },
      ) => {
        const channelId = update.channelId || update.id;
        setDmChannels((prev) =>
          prev.map((channel) =>
            channel.id === channelId
              ? {
                  ...channel,
                  ...update,
                  id: channel.id,
                  unreadCount:
                    selectedChannelRef.current?.id === channelId
                      ? 0
                      : (update.unreadCount ??
                        Math.max(
                          0,
                          (channel.unreadCount || 0) +
                            (update.unreadIncrement || 0),
                        )),
                }
              : channel,
          ),
        );

        if (selectedChannelRef.current?.id === channelId && update.id) {
          setSelectedChannel((current) =>
            current ? { ...current, ...update, id: current.id } : current,
          );
        }
      },
    );

    const unbindDMDelete = gatewayClient.on(
      GatewayEvents.DM_CHANNEL_DELETE,
      (data: { channelId: string }) => {
        setDmChannels((prev) => prev.filter((c) => c.id !== data.channelId));
        if (selectedChannelRef.current?.id === data.channelId) {
          setSelectedChannel(null);
        }
      },
    );

    const unbindAuthExpired = gatewayClient.on(
      GatewayEvents.AUTH_SESSION_EXPIRED,
      (data: { reason?: string }) => {
        useAuthStore
          .getState()
          .openReauthModal(data?.reason || "网关会话失效，请重新登录");
      },
    );

    const unbindRelAdd = gatewayClient.on(
      GatewayEvents.RELATIONSHIP_ADD,
      (rel: any) => {
        useFriendStore.getState().onRelationshipAdd(rel);
        if (rel.type === "PENDING_INCOMING") {
          showGlobalToast(
            `收到来自 ${rel.targetUser?.displayName || rel.targetUser?.username} 的好友申请！`,
            "info",
          );
        }
      },
    );

    const unbindRelUpdate = gatewayClient.on(
      GatewayEvents.RELATIONSHIP_UPDATE,
      (rel: any) => {
        useFriendStore.getState().onRelationshipUpdate(rel);
        if (rel.type === "FRIEND") {
          showGlobalToast(
            `你与 ${rel.targetUser?.displayName || rel.targetUser?.username} 已成为好友！`,
            "info",
          );
        }
      },
    );

    const unbindRelRemove = gatewayClient.on(
      GatewayEvents.RELATIONSHIP_REMOVE,
      (data: { userId: string; targetUserId: string }) => {
        useFriendStore.getState().onRelationshipRemove(data);
      },
    );

    return () => {
      unbindRelAdd();
      unbindRelUpdate();
      unbindRelRemove();
      unbindMaintenanceUpdate();
      unbindAuthExpired();
      unbindReady();
      unbindPresenceUpdate();
      unbindUserUpdate();
      unbindGameActivity?.();
      unbindMsgCreate();
      unbindMsgDelete();
      unbindReactionAdd();
      unbindReactionRemove();
      unbindPinUpdate();
      unbindGuildCreate();
      unbindGuildUpdate();
      unbindGuildDelete();
      unbindRoleCreate();
      unbindRoleUpdate();
      unbindRoleDelete();
      unbindMemberUpdate();
      unbindBanAdd();
      unbindChannelCreate();
      unbindChannelDelete();
      unbindChannelUpdate();
      unbindCategoryCreate();
      unbindCategoryUpdate();
      unbindCategoryDelete();
      unbindCategoryPositions();
      unbindChannelPositions();
      unbindMemberAdd();
      unbindMemberRemove();
      unbindVoice();
      unbindVoiceDisconnect();
      unbindP2PSignal();
      unbindP2PTopology();
      unbindP2PFallback();
      unbindVoiceMeshFallback();
      unbindCallOffer();
      unbindCallAnswer();
      unbindCallReject();
      unbindCallEnd();
      unbindCallState();
      unbindMediaKey();
      unbindSystemBroadcast();
      unbindDMCreate();
      unbindDMUpdate();
      unbindDMDelete();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      gatewayClient.disconnect();
    };
  }, [isAuthenticated, currentUser?.id]);

  // 监听打开邀请弹窗与切换服务器等全局自定义事件
  useEffect(() => {
    const handleOpenInvite = (e: any) => {
      if (e.detail?.guild) {
        setInviteFriendsGuild(e.detail.guild);
      }
    };
    const handleSwitchGuild = async (e: any) => {
      const targetGuildId = e.detail?.guildId;
      if (!targetGuildId) return;

      setIsFriendsTabActive(false);
      setSelectedGuildId(targetGuildId);
      useChannelNavStore.getState().recordLastSelectedGuild(targetGuildId);

      // 1. 若当前 guilds 缓存中已存在该公会，立即聚焦第一条频道以提供即时响应
      const existingGuild = guildsRef.current.find(
        (g) => g.id === targetGuildId,
      );
      if (
        existingGuild &&
        existingGuild.channels &&
        existingGuild.channels.length > 0
      ) {
        const preferFirst = e.detail?.preferFirst ?? true;
        const targetChannel = preferFirst
          ? getDefaultGuildChannel(existingGuild, true)
          : resolveGuildChannel(
              existingGuild,
              useChannelNavStore
                .getState()
                .getLastVisitedChannel(existingGuild.id),
              true,
            );
        if (targetChannel) {
          setSelectedChannel(targetChannel);
          if (targetChannel.guildId) {
            useChannelNavStore
              .getState()
              .recordChannelVisit(targetChannel.guildId, targetChannel.id);
          }
        }
      }

      // 2. 刷新公会列表（特别是通过邀请加入的新服务器，拉取最新数据并定位至第一条频道）
      const token = useAuthStore.getState().token;
      try {
        const res = await fetch(`${API_BASE}/api/guilds`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (res.ok) {
          const data: Guild[] = await res.json();
          setGuilds(data);
          const target = data.find((g) => g.id === targetGuildId);
          if (
            selectedGuildIdRef.current === targetGuildId &&
            target &&
            target.channels &&
            target.channels.length > 0
          ) {
            const currentChan = selectedChannelRef.current;
            const currentBelongsToGuild =
              currentChan &&
              target.channels.some((c) => c.id === currentChan.id);
            if (!currentBelongsToGuild) {
              const preferFirst = e.detail?.preferFirst ?? true;
              const targetChannel = preferFirst
                ? getDefaultGuildChannel(target, true)
                : resolveGuildChannel(
                    target,
                    useChannelNavStore
                      .getState()
                      .getLastVisitedChannel(target.id),
                    true,
                  );
              if (targetChannel) {
                setSelectedChannel(targetChannel);
                if (targetChannel.guildId) {
                  useChannelNavStore
                    .getState()
                    .recordChannelVisit(
                      targetChannel.guildId,
                      targetChannel.id,
                    );
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to refresh guilds on switch-guild:", err);
      }
    };
    window.addEventListener(
      "tescord:open-invite-modal" as any,
      handleOpenInvite,
    );
    window.addEventListener("tescord:switch-guild" as any, handleSwitchGuild);
    return () => {
      window.removeEventListener(
        "tescord:open-invite-modal" as any,
        handleOpenInvite,
      );
      window.removeEventListener(
        "tescord:switch-guild" as any,
        handleSwitchGuild,
      );
    };
  }, []);

  // 10 分钟无操作自动离开 (AFK Auto-Idle) 检测与活跃会话唤醒
  useEffect(() => {
    if (!currentUser || !isAuthenticated) return;

    let afkTimer: any = null;
    let isAutoIdled = false;

    const resetAfkTimer = () => {
      const wasAutoIdled = isAutoIdled;
      if (isAutoIdled) {
        isAutoIdled = false;
        // 只要当前会话检测到用户操作，即向网关上报恢复为在线 (isManual = false)
        gatewayClient.updateStatus(
          "ONLINE",
          currentUser.customStatus,
          undefined,
          false,
        );
      }

      if (afkTimer) clearTimeout(afkTimer);

      const latestUser = useAuthStore.getState().user;
      // 只要处于 ONLINE 状态（或刚刚从自动离开中被操作唤醒），重新排队 10 分钟闲置倒计时
      if (wasAutoIdled || (latestUser && latestUser.status === "ONLINE")) {
        afkTimer = setTimeout(
          () => {
            const u = useAuthStore.getState().user;
            if (u && u.status === "ONLINE") {
              isAutoIdled = true;
              gatewayClient.updateStatus(
                "IDLE",
                u.customStatus,
                undefined,
                false,
              );
            }
          },
          10 * 60 * 1000,
        ); // 10分钟
      }
    };

    const activityEvents = ["mousemove", "keydown", "mousedown", "touchstart"];
    const handleActivity = () => resetAfkTimer();

    activityEvents.forEach((ev) =>
      window.addEventListener(ev, handleActivity, { passive: true }),
    );
    resetAfkTimer();

    return () => {
      if (afkTimer) clearTimeout(afkTimer);
      activityEvents.forEach((ev) =>
        window.removeEventListener(ev, handleActivity),
      );
    };
  }, [currentUser?.id, currentUser?.status, isAuthenticated]);

  // 监听 LiveKit SFU 底层断开回调（服务器断线、异常掉线、多端冲突被踢时权威收敛状态并向网关上报）
  useEffect(
    () =>
      cloudflareRealtimeService.onStatusChange((status) => {
        if (VOICE_ENGINE !== "cloudflare_realtime") return;
        if (status === "connected")
          livekitService.setConnectionStatus("connected");
        else if (status === "connecting" || status === "reconnecting")
          livekitService.setConnectionStatus("connecting");
        else if (status === "failed") {
          livekitService.setConnectionStatus("disconnected");
          audioEngine.stop();
          setActiveVoiceChannelId(null);
          setIsScreenSharing(false);
          setIsVideoEnabled(false);
        }
      }),
    [],
  );

  useEffect(() => {
    if (VOICE_ENGINE !== "cloudflare_realtime") return;
    let pendingChannelId: string | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const unbind = gatewayClient.onConnectionStateChange((state) => {
      if (
        state === "disconnected" &&
        !isAccountTransitionRef.current &&
        activeVoiceChannelIdRef.current &&
        cloudflareRealtimeService.currentSessionId
      ) {
        pendingChannelId = activeVoiceChannelIdRef.current;
        voiceOperationEpochRef.current++;
        mediaEncryptionService.stop();
        audioEngine.stop();
        screenShareGenerationRef.current++;
        displayCaptureCleanupRef.current?.();
        displayCaptureCleanupRef.current = null;
        setIsScreenSharing(false);
        setIsVideoEnabled(false);
        void cloudflareRealtimeService.disconnect();
        livekitService.setConnectionStatus("connecting");
        clearTimer();
        reconnectTimer = setTimeout(() => {
          if (pendingChannelId) {
            pendingChannelId = null;
            livekitService.setConnectionStatus("disconnected");
            setActiveVoiceChannelId(null);
          }
        }, 30_000);
      } else if (state === "connected" && pendingChannelId) {
        const activeUserId = useAuthStore.getState().user?.id;
        if (
          isAccountTransitionRef.current ||
          !activeUserId ||
          !gatewayClient.isReadyForUser(activeUserId)
        ) {
          pendingChannelId = null;
          clearTimer();
          return;
        }
        const channelId = pendingChannelId;
        pendingChannelId = null;
        clearTimer();
        if (activeVoiceChannelIdRef.current !== channelId) return;
        void rejoinVoiceRef.current(channelId).catch(() => {
          if (activeVoiceChannelIdRef.current === channelId) {
            livekitService.setConnectionStatus("disconnected");
            activeVoiceChannelIdRef.current = null;
            setActiveVoiceChannelId(null);
          }
        });
      }
    });
    return () => {
      clearTimer();
      unbind();
    };
  }, []);

  // 监听 LiveKit SFU 底层断开回调（服务器断线、异常掉线、多端冲突被踢时权威收敛状态并向网关上报）
  useEffect(() => {
    const unbindLiveKitDisconnect = livekitService.onDisconnected((reason) => {
      const channelId = activeVoiceChannelIdRef.current;
      if (!channelId) return;

      // 1 代表 DisconnectReason.CLIENT_INITIATED（用户主动挂断），由 handleLeaveVoiceChannel 正常清理
      const isClientInitiated =
        reason === 1 ||
        String(reason).toLowerCase().includes("client_initiated");
      if (isClientInitiated) return;

      console.warn(
        `[LiveKit] Abnormal disconnection detected (reason: ${reason}), reconciling voice state with gateway...`,
      );

      // 1. 查找当前语音频道所属的真实 guildId
      const currentChannel = guildsRef.current
        .flatMap((g) => g.channels)
        .find((c) => c.id === channelId);
      const targetGuildId =
        currentChannel?.guildId || selectedGuildIdRef.current;

      // 2. 立即向后端 WebSocket 网关同步发送离开信令，防止界面幽灵残留
      if (targetGuildId) {
        gatewayClient.updateVoiceState(targetGuildId, null, {
          selfMute: false,
          selfDeaf: false,
          selfVideo: false,
          streaming: false,
        });
      } else if (activeDMCallRef.current) {
        gatewayClient.send({
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CALL_END,
          d: { callId: activeDMCallRef.current.callId, reason: "disconnected" },
        });
      }

      // 3. 清理本地媒体与加密管线
      mediaEncryptionService.stop();
      screenShareGenerationRef.current++;
      displayCaptureCleanupRef.current?.();
      displayCaptureCleanupRef.current = null;
      livekitService.setNegotiatedE2EEKey(null);
      voiceMeshManager.stopAll();
      audioEngine.stop();

      // 4. 播放退出语音频道提示音
      soundManager.play("VOICE_LEAVE");

      // 5. 重置本地所有 UI 与发言状态
      setActiveVoiceChannelId(null);
      setIsSpeaking(false);
      setActiveSpeakers([]);
      setIsScreenSharing(false);
      setIsVideoEnabled(false);
    });
    return () => {
      unbindLiveKitDisconnect();
    };
  }, []);

  // 麦克风音量 VAD 感应与说话状态驱动 (纯本地 Web Audio 处理，独立于网关长连接生命周期)
  useEffect(() => {
    const unbindSpeaking = audioEngine.onSpeakingChange((speaking) => {
      if (!isMutedRef.current && activeVoiceChannelIdRef.current) {
        setIsSpeaking(speaking);
      } else {
        setIsSpeaking(false);
      }
    });

    return () => {
      unbindSpeaking();
    };
  }, []);

  // 4.3 桌面端通知点击定位与系统托盘状态双向同步
  useEffect(() => {
    const unbindNotif = window.electronAPI?.onNotificationClick((data) => {
      if (data.guildId) setSelectedGuildId(data.guildId);
      if (data.channelId) {
        for (const g of guilds) {
          const ch = g.channels.find((c) => c.id === data.channelId);
          if (ch) {
            setSelectedGuildId(g.id);
            setSelectedChannel(ch);
            useChannelNavStore.getState().recordChannelVisit(g.id, ch.id);
            break;
          }
        }
      }
    });

    const unbindGlobalMute = window.electronAPI?.onGlobalMuteToggle(() => {
      handleToggleMuteRef.current?.();
    });

    const unbindTray = window.electronAPI?.onStatusChangeFromTray(
      (newStatus) => {
        useAuthStore.getState().updateProfile({ status: newStatus });
      },
    );

    const unbindShare = livekitService.onScreenShareChange((share) => {
      setActiveScreenShare(share);
      if (share) {
        setShowFloatingPiP(true);
      }
      if (share?.isLocal) {
        setIsScreenSharing(true);
      } else if (!share) {
        const isBroadcastingP2P = p2pStreamManager.isBroadcasting(
          activeVoiceChannelIdRef.current || undefined,
        );
        if (!isBroadcastingP2P) {
          setIsScreenSharing(false);
          const voiceGuildId = getVoiceGuildId(activeVoiceChannelIdRef.current);
          if (voiceGuildId && activeVoiceChannelIdRef.current) {
            gatewayClient.updateVoiceState(
              voiceGuildId,
              activeVoiceChannelIdRef.current,
              {
                streaming: false,
              },
            );
          }
        }
      }
    });

    const unbindP2P = p2pStreamManager.onStreamChange((stream, ownerId) => {
      if (stream && ownerId === currentUser?.id) {
        setIsScreenSharing(true);
      } else if (!stream && ownerId === currentUser?.id) {
        if (!livekitService.isSharingScreen) {
          setIsScreenSharing(false);
        }
      }
    });

    const unbindSpeakers =
      VOICE_ENGINE === "cloudflare_realtime"
        ? cloudflareRealtimeService.onActiveSpeakersChange((speakers) => {
            if (!voiceMeshManager.getIsMeshActive()) {
              setActiveSpeakers([...speakers]);
            }
          })
        : livekitService.onActiveSpeakersChange((speakers) => {
            if (!voiceMeshManager.getIsMeshActive()) {
              setActiveSpeakers([...speakers]);
            }
          });

    const unbindMeshSpeakers = voiceMeshManager.onActiveSpeakersChange(
      (meshSpeakers) => {
        if (voiceMeshManager.getIsMeshActive()) {
          setActiveSpeakers([...meshSpeakers]);
        }
      },
    );

    const unbindConnStatus = livekitService.onConnectionStatusChange(
      (status) => {
        setVoiceConnectionStatus(status);
      },
    );

    return () => {
      unbindNotif?.();
      unbindGlobalMute?.();
      unbindTray?.();
      unbindShare?.();
      unbindP2P?.();
      unbindSpeakers?.();
      unbindMeshSpeakers?.();
      unbindConnStatus?.();
    };
  }, [guilds, isScreenSharing]);

  const handleReloadLatestMessages = messageHistory.reloadLatest;

  const currentGuild = guilds.find((g) => g.id === selectedGuildId) || null;
  const currentChannels = currentGuild ? currentGuild.channels : [];

  // 业务：发送富文本与附件消息
  const handleSendMessage = async (
    content: string,
    isEncrypted?: boolean,
    replyToId?: string,
    attachments?: Attachment[],
  ) => {
    if (!selectedChannel || !currentUser) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(
        `${API_BASE}/api/channels/${selectedChannel.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            content,
            authorId: currentUser.id,
            isEncrypted: !!isEncrypted,
            replyToId: replyToId || undefined,
            attachments:
              attachments && attachments.length > 0 ? attachments : undefined,
          }),
        },
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `发送消息失败 (${res.status})`;
        showGlobalToast(errorMsg, "error");
        console.error("Failed to send message:", errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err?.message || "网络请求异常，消息发送失败";
      showGlobalToast(errorMsg, "error");
      console.error("Failed to send message:", err);
    }
  };

  // 业务：添加表情反应
  const handleReactionAdd = async (messageId: string, emoji: string) => {
    if (!selectedChannel) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/channels/${selectedChannel.id}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
        {
          method: "PUT",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to add reaction:", err);
    }
  };

  // 业务：取消表情反应
  const handleReactionRemove = async (messageId: string, emoji: string) => {
    if (!selectedChannel) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/channels/${selectedChannel.id}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to remove reaction:", err);
    }
  };

  // 业务：置顶/取消置顶
  const handleTogglePin = async (messageId: string) => {
    if (!selectedChannel) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/channels/${selectedChannel.id}/messages/${messageId}/pin`,
        {
          method: "PATCH",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  // 业务：删除/撤回消息
  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChannel) return;
    // 乐观立即清理：立即从 React 状态和本地离线存储中剔除该消息，杜绝断线或切频道回魂
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    void messageDb.deleteMessage(messageId);
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/channels/${selectedChannel.id}/messages/${messageId}`,
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
  };

  // 业务：删除频道 (右键菜单调用)
  const handleDeleteChannel = async (channel: Channel) => {
    const confirmed = await dialog.confirm({
      title: t("modals:editChannel.deleteConfirmTitle", "删除频道"),
      description: t("modals:editChannel.deleteConfirmDesc", {
        name: channel.name,
        defaultValue: `确定要删除频道 #${channel.name} 吗？此操作无法撤销，所有聊天记录将被永久移除。`,
      }),
      variant: "danger",
      confirmText: t("modals:editChannel.deleteChannel", "删除频道"),
    });
    if (!confirmed) {
      return;
    }
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === channel.guildId
              ? {
                  ...g,
                  channels: g.channels.filter((c) => c.id !== channel.id),
                }
              : g,
          ),
        );
        if (channel.guildId) {
          if (
            useChannelNavStore
              .getState()
              .getLastVisitedChannel(channel.guildId) === channel.id
          ) {
            useChannelNavStore.getState().removeGuildMemory(channel.guildId);
          }
        }
        if (selectedChannel?.id === channel.id) {
          const guild = guilds.find((g) => g.id === channel.guildId);
          const remaining =
            guild?.channels.filter((c) => c.id !== channel.id) || [];
          if (guild && remaining.length > 0) {
            const fallbackGuild = { ...guild, channels: remaining };
            const fallback = resolveGuildChannel(fallbackGuild, null, true);
            setSelectedChannel(fallback);
            if (fallback?.guildId) {
              useChannelNavStore
                .getState()
                .recordChannelVisit(fallback.guildId, fallback.id);
            }
          } else {
            setSelectedChannel(null);
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  };

  // 业务：上报与同步频道已读进度
  const handleSyncChannelReadProgress = useCallback(
    (channelId: string, sequence: number) => {
      // 只有当前处于 DM 私信频道时才上报服务端已读游标
      const isDM =
        selectedChannelRef.current?.id === channelId &&
        selectedChannelRef.current?.type === "DM";
      if (!isDM) {
        return;
      }
      setDmChannels((prev) =>
        prev.map((dm) =>
          dm.id === channelId ? { ...dm, unreadCount: 0 } : dm,
        ),
      );
      const token = useAuthStore.getState().token;
      fetch(`${API_BASE}/api/channels/${channelId}/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lastReadSequence: sequence }),
      }).catch(() => undefined);
    },
    [],
  );

  // 业务：编辑频道名称与信息 (打开编辑频道 Modal)
  const handleEditChannel = (channel: Channel) => {
    setEditingChannel(channel);
  };

  const handleChannelUpdated = (updated: Channel) => {
    setGuilds((prev) =>
      prev.map((g) =>
        g.id === updated.guildId
          ? {
              ...g,
              channels: g.channels.map((c) =>
                c.id === updated.id ? updated : c,
              ),
            }
          : g,
      ),
    );
    if (selectedChannel?.id === updated.id) {
      setSelectedChannel(updated);
    }
  };

  const handleChannelDeletedFromModal = (channelId: string) => {
    if (selectedGuildId) {
      if (
        useChannelNavStore.getState().getLastVisitedChannel(selectedGuildId) ===
        channelId
      ) {
        useChannelNavStore.getState().removeGuildMemory(selectedGuildId);
      }
    }
    setGuilds((prev) =>
      prev.map((g) => ({
        ...g,
        channels: g.channels.filter((c) => c.id !== channelId),
      })),
    );
    if (selectedChannel?.id === channelId) {
      const remaining = currentChannels.filter((c) => c.id !== channelId);
      if (currentGuild && remaining.length > 0) {
        const fallbackGuild = { ...currentGuild, channels: remaining };
        const fallback = resolveGuildChannel(fallbackGuild, null, true);
        setSelectedChannel(fallback);
        if (fallback?.guildId) {
          useChannelNavStore
            .getState()
            .recordChannelVisit(fallback.guildId, fallback.id);
        }
      } else {
        setSelectedChannel(null);
      }
    }
  };

  // 业务：退出公会 (右键菜单调用)
  const handleLeaveGuild = async (guild: Guild) => {
    const confirmed = await dialog.confirm({
      title: t("contextMenu:server.leaveConfirmTitle"),
      description: t("contextMenu:server.leaveConfirmDesc", {
        name: guild.name,
      }),
      variant: "danger",
      confirmText: t("contextMenu:server.leave"),
    });
    if (!confirmed) {
      return;
    }
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/leave`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        useChannelNavStore.getState().removeGuildMemory(guild.id);
        setGuilds((prev) => prev.filter((g) => g.id !== guild.id));
        if (selectedGuildId === guild.id) {
          const remaining = guilds.filter((g) => g.id !== guild.id);
          if (remaining.length > 0) {
            const nextGuild = remaining[0];
            setSelectedGuildId(nextGuild.id);
            const lastChId = useChannelNavStore
              .getState()
              .getLastVisitedChannel(nextGuild.id);
            const targetChannel = resolveGuildChannel(
              nextGuild,
              lastChId,
              true,
            );
            setSelectedChannel(targetChannel);
            if (targetChannel?.guildId) {
              useChannelNavStore
                .getState()
                .recordChannelVisit(targetChannel.guildId, targetChannel.id);
            }
          } else {
            setSelectedGuildId(null);
            setSelectedChannel(null);
          }
        }
      }
    } catch (err) {
      console.error("Failed to leave guild:", err);
    }
  };

  // 业务：踢出成员 (右键菜单调用)
  const handleKickMember = async (userId: string, username: string) => {
    if (!selectedGuildId) return;
    const confirmed = await dialog.confirm({
      title: t("server:members.kickConfirmTitle"),
      description: t("server:members.kickConfirmDesc", {
        name: username,
      }),
      variant: "warning",
      confirmText: t("server:members.kick"),
    });
    if (!confirmed) {
      return;
    }
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/guilds/${selectedGuildId}/members/${userId}`,
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to kick member:", err);
    }
  };

  // 业务：封禁成员 (右键菜单调用)
  const handleBanMember = async (userId: string, username: string) => {
    if (!selectedGuildId) return;
    const confirmed = await dialog.confirm({
      title: t("server:members.banConfirmTitle"),
      description: t("server:members.banConfirmDesc", {
        name: username,
      }),
      variant: "danger",
      confirmText: t("server:members.ban"),
    });
    if (!confirmed) {
      return;
    }
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(
        `${API_BASE}/api/guilds/${selectedGuildId}/members/${userId}`,
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
    } catch (err) {
      console.error("Failed to ban member:", err);
    }
  };

  // 业务：断开成员语音连接 (右键菜单调用)
  const handleDisconnectVoiceMember = async (
    userId: string,
    username: string,
  ) => {
    if (!selectedGuildId || !currentUser) return;
    const accountEpoch = accountEpochRef.current;
    const confirmed = await dialog.confirm({
      title: t("server:members.disconnectVoiceConfirmTitle"),
      description: t("server:members.disconnectVoiceConfirmDesc", {
        name: username,
      }),
      variant: "warning",
      confirmText: t("server:members.disconnectVoice"),
    });
    if (!confirmed) {
      return;
    }
    try {
      if (
        accountEpochRef.current !== accountEpoch ||
        useAuthStore.getState().user?.id !== currentUser.id
      )
        return;
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(
        `${API_BASE}/api/guilds/${selectedGuildId}/members/${userId}/disconnect-voice`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showGlobalToast(getErrorMessage(err), "error");
        return;
      }
      showGlobalToast(t("server:members.disconnectVoiceSuccess"), "info");
    } catch (err) {
      console.error("Failed to disconnect voice member:", err);
      showGlobalToast(t("server:members.disconnectVoiceFailed"), "error");
    }
  };

  // 业务：标记服务器为已读
  const handleMarkGuildAsRead = async (guild: Guild) => {
    // 1. 清空服务器未读
    setGuildUnreadMap((prev) => {
      if (!prev[guild.id]) return prev;
      const next = { ...prev };
      delete next[guild.id];
      return next;
    });

    // 2. 清空该服务器下所有频道的未读与 Mention
    setChannelUnreadMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (
          next[key].guildId === guild.id &&
          (next[key].hasUnread || next[key].mentionCount > 0)
        ) {
          next[key] = {
            ...next[key],
            hasUnread: false,
            unreadCount: 0,
            mentionCount: 0,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // 3. 异步向服务端请求批量 ACK
    const auth = useAuthStore.getState();
    const token = auth.token;
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/guilds/${guild.id}/ack`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error("Failed to mark guild as read on server:", err);
    }
  };

  // 业务：标记频道为已读
  const handleMarkChannelAsRead = (channel: Channel) => {
    setChannelUnreadMap((prev) => {
      const cur = prev[channel.id];
      if (!cur || (!cur.hasUnread && cur.mentionCount === 0)) return prev;
      return {
        ...prev,
        [channel.id]: {
          ...cur,
          hasUnread: false,
          unreadCount: 0,
          mentionCount: 0,
        },
      };
    });
    markChannelReadOnServer(channel.id);
    if (channel.guildId) {
      // 检查当前公会是否还有其他频道未读
      const otherUnread = Object.values(channelUnreadMapRef.current).some(
        (item) =>
          item.guildId === channel.guildId &&
          item.channelId !== channel.id &&
          (item.hasUnread || item.mentionCount > 0),
      );
      if (!otherUnread) {
        setGuildUnreadMap((prev) => {
          if (!prev[channel.guildId!]) return prev;
          const next = { ...prev };
          delete next[channel.guildId!];
          return next;
        });
      }
    }
  };

  // 加入语音频道
  const handleJoinVoiceChannel = async (channel: Channel) => {
    if (!currentUser) return;
    const joiningUserId = currentUser.id;
    const joiningEpoch = accountEpochRef.current;
    const isCurrentJoiningAccount = () =>
      accountEpochRef.current === joiningEpoch &&
      useAuthStore.getState().user?.id === joiningUserId &&
      gatewayClient.isReadyForUser(joiningUserId);
    await accountCleanupPromiseRef.current;
    if (
      accountEpochRef.current !== joiningEpoch ||
      useAuthStore.getState().user?.id !== joiningUserId
    )
      return;
    if (!(await gatewayClient.waitUntilReady(joiningUserId))) return;
    if (!isCurrentJoiningAccount()) return;

    // 递增语音操作 Epoch 令牌，并标记切频进行中
    const currentVoiceEpoch = ++voiceOperationEpochRef.current;
    isVoiceSwitchingRef.current = true;
    const isCurrentVoiceOp = () =>
      voiceOperationEpochRef.current === currentVoiceEpoch &&
      isCurrentJoiningAccount();

    // 若当前已在该频道且处于 connected 状态，直接退出
    if (
      activeVoiceChannelIdRef.current === channel.id &&
      (voiceConnectionStatus === "connected" ||
        voiceConnectionStatus === "p2p_active")
    ) {
      isVoiceSwitchingRef.current = false;
      return;
    }

    setVoiceTransferNotice(null);

    // 若当前已在另一个语音频道，立即同步清理旧房间音频连接与 WebRTC 状态，杜绝 1 秒声音残留
    if (
      activeVoiceChannelIdRef.current &&
      activeVoiceChannelIdRef.current !== channel.id
    ) {
      await cloudflareRealtimeService.disconnect();
      await livekitService.leaveRoom(true);
      voiceMeshManager.stopAll();
      audioEngine.stop();
      setIsVideoEnabled(false);
      setIsScreenSharing(false);
      if (!isCurrentVoiceOp()) return;
    }

    activeVoiceChannelIdRef.current = channel.id;
    setActiveVoiceChannelId(channel.id);
    setSelectedChannel(channel);
    livekitService.setConnectionStatus("connecting");
    const effectiveVoiceMode =
      channel.voiceMode ||
      useSettingsStore.getState().voiceTransmissionMode ||
      "sfu";
    const isP2PMesh = effectiveVoiceMode === "p2p_mesh";
    const isCloudflareActive =
      !isP2PMesh &&
      (effectiveVoiceMode === "cloudflare_realtime" ||
        VOICE_ENGINE === "cloudflare_realtime");
    const icePreparation = isCloudflareActive
      ? cloudflareRealtimeService.prepareIceServers()
      : null;
    void icePreparation?.catch(() => {});

    try {
      cloudflareRealtimeService.beginJoinTiming(channel.id);
      if (
        !channel.guildId ||
        !(await gatewayClient.updateVoiceStateAndWait(
          channel.guildId,
          channel.id,
          { selfMute: isMutedRef.current, selfDeaf: isDeafened },
        ))
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      if (!isCurrentVoiceOp()) return;
      const token = useAuthStore.getState().token;
      if (!token) throw new Error("UNAUTHORIZED");
      await Promise.all([
        audioEngine.initMicrophone(),
        mediaEncryptionService.prepare({
          channelId: channel.id,
          gatewaySessionId: gatewayClient.getSessionId(),
          userId: joiningUserId,
          token,
          onStage: (stage) => {
            if (isCurrentVoiceOp())
              cloudflareRealtimeService.markJoinStage(stage);
          },
          onFailure: (error) => {
            if (!isCurrentVoiceOp()) return;
            showGlobalToast(getErrorMessage({ code: error.message }), "error");
            void handleLeaveVoiceChannel();
          },
        }),
      ]);
      if (!isCurrentVoiceOp()) return;
    } catch (error) {
      if (isCurrentVoiceOp()) {
        showGlobalToast(
          getErrorMessage({
            code:
              error instanceof Error ? error.message : "MEDIA_KEY_UNAVAILABLE",
          }),
          "error",
        );
        await handleLeaveVoiceChannel();
        isVoiceSwitchingRef.current = false;
      }
      return;
    }

    if (!isCurrentVoiceOp()) return;
    // A rebuilt capture graph must inherit the current mute before it is published.
    audioEngine.setMute(isMutedRef.current);

    const bitrate = channel.bitrate || audioEngine.config.audioBitrate || 64000;
    const processedStream = audioEngine.getStream();

    let joinSuccess = false;
    if (isP2PMesh && processedStream && channel.guildId) {
      const otherMembers = voiceStatesRef.current
        .filter(
          (state) =>
            state.channelId === channel.id && state.userId !== currentUser.id,
        )
        .map((state) => state.userId);
      try {
        await voiceMeshManager.startVoiceMesh(
          channel.id,
          channel.guildId,
          processedStream,
          otherMembers,
          undefined,
          { allowFallbackToSFU: true },
        );
        if (isCurrentVoiceOp()) {
          joinSuccess = true;
          // P2P is an active voice session, but it is not a LiveKit/SFU
          // connection. Keeping a distinct status prevents the fallback guard
          // from mistaking Mesh readiness for an already connected SFU.
          livekitService.setConnectionStatus("p2p_active");
        }
      } catch (error) {
        console.warn("公会 Mesh P2P 启动异常:", error);
      }
    }

    // 仅在 SFU 模式下进入 Cloudflare Realtime 边缘转发
    if (!isP2PMesh && isCloudflareActive && processedStream) {
      try {
        const cfSessionId = await cloudflareRealtimeService.connect(
          channel.id,
          {
            audioStream: processedStream,
            audioBitrate: bitrate,
            iceServers: icePreparation ? await icePreparation : undefined,
            gatewaySessionId: gatewayClient.getSessionId(),
          },
        );
        if (!isCurrentVoiceOp()) return;
        cloudflareRealtimeService.setMicrophoneMute(isMutedRef.current);
        joinSuccess = Boolean(cfSessionId);
        if (joinSuccess && isCurrentVoiceOp()) {
          livekitService.setConnectionStatus("connected");
        }
      } catch (cfErr) {
        console.error("Cloudflare Realtime 加入频道失败:", cfErr);
      }
    }

    try {
      if (!isP2PMesh && !isCloudflareActive && !joinSuccess) {
        const currentGuild = guildsRef.current.find((g) =>
          g.channels.some((c) => c.id === channel.id),
        );
        const currentMember = currentGuild?.members?.find(
          (m) => m.userId === currentUser.id,
        );
        const participantName = getUserDisplayName(
          currentUser,
          currentMember,
          currentUser.username,
        );
        const currentToken = useAuthStore.getState().token;
        const res = await fetch(`${API_BASE}/api/livekit/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(currentToken
              ? { Authorization: `Bearer ${currentToken}` }
              : {}),
          },
          body: JSON.stringify({
            roomName: channel.id,
            identity: currentUser.id,
            gatewaySessionId: gatewayClient.getSessionId(),
            name: participantName,
            bitrate,
          }),
        });
        if (!res.ok) throw new Error("Failed to get guild media token");
        const data = await res.json();
        if (!isCurrentVoiceOp()) return;
        joinSuccess = await livekitService.joinRoom(
          data.url,
          data.token,
          channel.id,
          processedStream,
          bitrate,
          true,
        );
        if (!isCurrentVoiceOp()) return;
      }
    } catch (e) {
      console.error("Failed to join livekit room:", e);
      joinSuccess = false;
    }

    if (!joinSuccess) {
      console.warn("语音服务连接未成功，自动复位语音频道状态");
      if (isCurrentVoiceOp()) {
        await handleLeaveVoiceChannel();
        livekitService.setConnectionStatus("disconnected");
        isVoiceSwitchingRef.current = false;
      }
      return;
    }

    if (!isCurrentVoiceOp()) {
      return;
    }

    // 播放加入语音频道提示音
    soundManager.play("VOICE_JOIN");

    if (channel.guildId) {
      const voiceStateAccepted = gatewayClient.updateVoiceState(
        channel.guildId,
        channel.id,
        {
          selfMute: isMuted,
          selfDeaf: isDeafened,
          selfVideo: isVideoEnabled,
          streaming: isScreenSharing,
        },
      );
      if (!voiceStateAccepted) {
        if (isCurrentVoiceOp()) {
          await handleLeaveVoiceChannel();
        }
        return;
      }
    }

    if (isCurrentVoiceOp()) {
      isVoiceSwitchingRef.current = false;
    }
  };

  // 取消正在进行的语音连接
  const handleCancelVoiceJoin = async () => {
    voiceOperationEpochRef.current++;
    mediaEncryptionService.stop();
    screenShareGenerationRef.current++;
    displayCaptureCleanupRef.current?.();
    displayCaptureCleanupRef.current = null;
    isVoiceSwitchingRef.current = false;
    const cancellingChannelId =
      activeVoiceChannelIdRef.current || activeVoiceChannelId;
    activeVoiceChannelIdRef.current = null;
    setActiveVoiceChannelId(null);
    livekitService.setConnectionStatus("disconnected");
    voiceMeshManager.broadcastLeaveSignal();
    voiceMeshManager.stopAll();
    audioEngine.stop();
    await cloudflareRealtimeService.disconnect();
    await livekitService.leaveRoom();
    const currentChannel = guildsRef.current
      .flatMap((g) => g.channels)
      .find((c) => c.id === cancellingChannelId);
    const targetGuildId = currentChannel?.guildId || selectedGuildId;

    if (targetGuildId) {
      gatewayClient.updateVoiceState(targetGuildId, null, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: false,
        streaming: false,
      });
    }
  };

  // 离开语音频道或结束 1v1 私信通话
  const handleLeaveVoiceChannel = async () => {
    voiceOperationEpochRef.current++;
    isVoiceSwitchingRef.current = false;
    const currentDMStoreEarly = useDMCallStore.getState();
    if (
      !activeVoiceChannelId &&
      !activeVoiceChannelIdRef.current &&
      currentDMStoreEarly.callState === "idle"
    ) {
      return;
    }

    const leavingChannelId =
      activeVoiceChannelIdRef.current ||
      activeVoiceChannelId ||
      currentDMStoreEarly.channelId;
    activeVoiceChannelIdRef.current = null;

    if (isVideoEnabled) {
      if (VOICE_ENGINE === "cloudflare_realtime")
        await cloudflareRealtimeService.unpublishSource("camera");
      else if (voiceMeshManager.getIsMeshActive())
        await voiceMeshManager.setLocalVideoTrack(null);
      else await livekitService.setCameraEnabled(false);
      setIsVideoEnabled(false);
    }

    // 清理 SFrame 语音加密管线状态与纯语音 Mesh P2P
    mediaEncryptionService.stop();
    screenShareGenerationRef.current++;
    displayCaptureCleanupRef.current?.();
    displayCaptureCleanupRef.current = null;
    livekitService.setNegotiatedE2EEKey(null);
    cloudflareRealtimeService.setNegotiatedE2EEKey(null);
    // 向频道内对端广播 VOICE_LEAVE 离开信令，使其毫秒级释放连接并取消重试
    voiceMeshManager.broadcastLeaveSignal();
    voiceMeshManager.stopAll();
    audioEngine.stop();
    await cloudflareRealtimeService.disconnect();
    await livekitService.leaveRoom();

    // 播放退出提示音并停止可能的回铃/振铃循环
    soundManager.stopLoop();
    const currentDMStore = useDMCallStore.getState();
    if (currentDMStore.callState !== "idle") {
      soundManager.play("CALL_DISCONNECT");
      const callChId =
        currentDMStore.channelId || activeDMCallRef.current?.channelId;
      rememberDMCallHistory(
        currentDMStore.callId || activeDMCallRef.current?.callId || null,
        callChId || null,
      );
      useDMCallStore.getState().reset();
    } else {
      soundManager.play("VOICE_LEAVE");
    }

    const currentChannel = guildsRef.current
      .flatMap((g) => g.channels)
      .find((c) => c.id === leavingChannelId);
    const leavingDM =
      activeDMCallRef.current?.channelId === leavingChannelId ||
      currentDMStoreEarly.callState !== "idle";
    const targetGuildId = leavingDM
      ? null
      : currentChannel?.guildId || selectedGuildId;

    if (targetGuildId) {
      gatewayClient.updateVoiceState(targetGuildId, null, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: false,
        streaming: false,
      });
    } else {
      // 1v1 私信通话信令通知对方挂断
      if (activeDMCallRef.current) {
        gatewayClient.send({
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CALL_END,
          d: {
            callId: activeDMCallRef.current.callId,
            channelId: activeDMCallRef.current.channelId,
            reason: "hangup",
          },
        });
      }
    }

    setActiveVoiceChannelId(null);
    setIsSpeaking(false);
    setActiveSpeakers([]);
    setIsScreenSharing(false);
    setVoiceTransferNotice(null);
    activeDMCallRef.current = null;
    setActiveDMCall(null);
    setCallEncryption({ status: "idle" });

    // 退出语音频道视角：优先平滑切换回进入语音前最后浏览的文字频道，若无记录才回退至默认文字频道
    if (
      selectedGuildId &&
      (selectedChannel?.id === leavingChannelId ||
        selectedChannel?.type === "VOICE")
    ) {
      const lastVisitedTextId = useChannelNavStore
        .getState()
        .getLastVisitedTextChannel(selectedGuildId);
      const targetTextChannel =
        (lastVisitedTextId
          ? currentChannels.find(
              (c) => c.id === lastVisitedTextId && c.type === "TEXT",
            )
          : null) ||
        (currentGuild
          ? getDefaultGuildChannel(currentGuild, true)
          : currentChannels.find((c) => c.type === "TEXT") || null);

      setSelectedChannel(targetTextChannel);
      if (targetTextChannel?.guildId) {
        useChannelNavStore
          .getState()
          .recordChannelVisit(targetTextChannel.guildId, targetTextChannel.id);
        useChannelNavStore
          .getState()
          .recordTextChannelVisit(
            targetTextChannel.guildId,
            targetTextChannel.id,
          );
      }
    }
  };

  // 发起/跳转私信会话
  const handleStartDM = async (targetUserId: string) => {
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recipientId: targetUserId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showGlobalToast(
          errData.error || errData.message || "无法发起私信会话",
          "warning",
        );
        return;
      }
      const dmChannel: Channel = await res.json();
      setDmChannels((prev) => {
        if (prev.some((c) => c.id === dmChannel.id)) {
          return prev.map((c) => (c.id === dmChannel.id ? dmChannel : c));
        }
        return [dmChannel, ...prev];
      });
      setSelectedGuildId(null);
      setIsFriendsTabActive(false);
      setSelectedChannel(dmChannel);
    } catch (err) {
      console.error("Failed to start DM:", err);
      showGlobalToast("发起私信会话失败", "error");
    }
  };

  // 好友列表快捷发起通话
  const handleStartCallFromFriend = async (targetUserId: string) => {
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recipientId: targetUserId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showGlobalToast(errData.error || "无法发起呼叫", "warning");
        return;
      }
      const dmChannel: Channel = await res.json();
      setDmChannels((prev) => [
        dmChannel,
        ...prev.filter((c) => c.id !== dmChannel.id),
      ]);
      setSelectedGuildId(null);
      setIsFriendsTabActive(false);
      setSelectedChannel(dmChannel);
      handleStartCall(dmChannel.id, false);
    } catch {
      showGlobalToast("发起呼叫失败", "error");
    }
  };

  // 发送快捷私信并自动跳转至私信聊天 (图2资料卡使用)
  const handleSendQuickDM = async (targetUserId: string, content: string) => {
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recipientId: targetUserId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showGlobalToast(
          errData.error || errData.message || "无法发起私信会话",
          "warning",
        );
        return;
      }
      const dmChannel: Channel = await res.json();
      setDmChannels((prev) => {
        if (prev.some((c) => c.id === dmChannel.id)) {
          return prev.map((c) => (c.id === dmChannel.id ? dmChannel : c));
        }
        return [dmChannel, ...prev];
      });
      setSelectedGuildId(null);
      setSelectedChannel(dmChannel);

      if (content.trim() && currentUser) {
        await fetch(`${API_BASE}/api/channels/${dmChannel.id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            content: content.trim(),
            authorId: currentUser.id,
          }),
        });
      }
    } catch (err) {
      console.error("Failed to send quick DM:", err);
      showGlobalToast("发送私信失败", "error");
    }
  };

  // 关闭私信会话 (从左侧列表中移除)
  const handleCloseDMChannel = async (channelId: string) => {
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(`${API_BASE}/api/users/@me/channels/${channelId}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      setDmChannels((prev) => prev.filter((c) => c.id !== channelId));
      if (selectedChannel?.id === channelId) {
        setSelectedChannel(null);
      }
    } catch (err) {
      console.error("Failed to close DM channel:", err);
    }
  };

  // 加入 1v1 私信音视频通话
  const handleJoinDMCall = async (
    channelId: string,
    hasVideo: boolean = false,
    callId: string,
  ) => {
    if (!currentUser) return;
    if (
      dmJoinInProgressRef.current === callId ||
      (activeVoiceChannelIdRef.current === channelId &&
        sframeManager.hasActiveContext)
    )
      return;
    dmJoinInProgressRef.current = callId;
    const accountEpoch = accountEpochRef.current;
    const voiceEpoch = ++voiceOperationEpochRef.current;
    const isCurrent = () =>
      accountEpochRef.current === accountEpoch &&
      voiceOperationEpochRef.current === voiceEpoch &&
      activeDMCallRef.current?.callId === callId &&
      useAuthStore.getState().user?.id === currentUser.id;
    try {
      if (!(await gatewayClient.waitUntilReady(currentUser.id)))
        throw new Error("MEDIA_CONTEXT_STALE");
      const token = useAuthStore.getState().token;
      if (!token || !isCurrent()) return;
      const previousChannelId = activeVoiceChannelIdRef.current;
      if (previousChannelId && previousChannelId !== channelId) {
        const previousGuild = getVoiceGuildId(previousChannelId);
        if (previousGuild) gatewayClient.updateVoiceState(previousGuild, null);
        mediaEncryptionService.stop();
        screenShareGenerationRef.current++;
        displayCaptureCleanupRef.current?.();
        displayCaptureCleanupRef.current = null;
        voiceMeshManager.stopAll();
        audioEngine.stop();
        await cloudflareRealtimeService.disconnect();
        await livekitService.leaveRoom();
        if (!isCurrent()) return;
      }
      activeVoiceChannelIdRef.current = channelId;
      setActiveVoiceChannelId(channelId);
      livekitService.setConnectionStatus("connecting");
      cloudflareRealtimeService.beginJoinTiming(channelId);
      await Promise.all([
        audioEngine.initMicrophone(),
        mediaEncryptionService.prepare({
          channelId,
          callId,
          gatewaySessionId: gatewayClient.getSessionId(),
          userId: currentUser.id,
          token,
          onStage: (stage) => {
            if (isCurrent()) cloudflareRealtimeService.markJoinStage(stage);
          },
          onFailure: (error) => {
            if (!isCurrent()) return;
            setCallEncryption({ status: "failed" });
            showGlobalToast(getErrorMessage({ code: error.message }), "error");
            void handleLeaveVoiceChannel();
          },
        }),
      ]);
      if (!isCurrent()) return;
      setCallEncryption({ status: "tofu" });
      audioEngine.setMute(isMutedRef.current);
      if (!isCurrent()) return;
      const bitrate = 64000;
      const processedStream = audioEngine.getStream();

      let joinSuccess = false;
      const dmChannel =
        dmChannels.find((candidate) => candidate.id === channelId) ||
        (selectedChannel?.id === channelId ? selectedChannel : null);
      const currentCall = useDMCallStore.getState();
      const peerId =
        (currentCall.callId === callId &&
        currentCall.channelId === channelId &&
        currentCall.targetUser?.id !== currentUser.id
          ? currentCall.targetUser?.id
          : undefined) ||
        dmChannel?.recipients?.find(
          (recipient) => recipient.id !== currentUser.id,
        )?.id;

      // 1v1 默认先建立端到端加密的 WebRTC 直连；ICE 配置中包含自建 TURN，
      // 因此 host/srflx/relay 都属于 P2P 阶段。只有该阶段确认失败才进入 SFU。
      if (processedStream && peerId) {
        try {
          await voiceMeshManager.startVoiceMesh(
            channelId,
            "",
            processedStream,
            [peerId],
            callId,
          );
          joinSuccess = await voiceMeshManager.waitForConnectedPeer(8_000);
          if (!isCurrent()) return;
          if (joinSuccess) livekitService.setConnectionStatus("p2p_active");
        } catch (error) {
          console.warn("DM P2P/TURN 协商失败，准备回退 SFU:", error);
        }
      }

      if (!isCurrent()) return;
      if (!joinSuccess) voiceMeshManager.stopAll();

      const isCloudflareActive = VOICE_ENGINE === "cloudflare_realtime";
      if (!joinSuccess && isCloudflareActive && processedStream) {
        try {
          console.log(
            "[VoiceEngine] DM 呼叫回退使用 Cloudflare Realtime SFU 建立连接:",
            channelId,
          );
          const cfSessionId = await cloudflareRealtimeService.connect(
            channelId,
            {
              audioStream: processedStream,
              audioBitrate: bitrate,
              callId,
              gatewaySessionId: gatewayClient.getSessionId(),
            },
          );
          if (!isCurrent()) return;
          joinSuccess = Boolean(cfSessionId);
          if (joinSuccess) livekitService.setConnectionStatus("connected");
        } catch (cfErr) {
          console.error("Cloudflare Realtime 加入 DM 呼叫失败:", cfErr);
        }
      }

      try {
        if (!joinSuccess && !isCloudflareActive) {
          const token = useAuthStore.getState().token;
          const res = await fetch(
            `${API_BASE}/api/channels/dm/${channelId}/call-token`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                callId,
                sessionId: gatewayClient.getSessionId(),
              }),
            },
          );
          if (!res.ok) throw new Error("Failed to get DM call token");
          const data = await res.json();
          joinSuccess = await livekitService.joinRoom(
            data.serverUrl || data.url,
            data.token,
            data.roomName || `dm_${channelId}`,
            processedStream,
            bitrate,
            true,
          );
        }
      } catch (e) {
        console.error("Failed to join DM call:", e);
        joinSuccess = false;
      }

      if (!isCurrent()) return;
      if (!joinSuccess) {
        console.warn("语音服务连接未成功，自动复位呼叫状态");
        await handleLeaveVoiceChannel();
        return;
      }

      soundManager.play("VOICE_JOIN");
      if (hasVideo) {
        handleToggleCamera();
      }
    } catch (error) {
      if (isCurrent()) {
        showGlobalToast(
          getErrorMessage({
            code:
              error instanceof Error ? error.message : "MEDIA_KEY_UNAVAILABLE",
          }),
          "error",
        );
        await handleLeaveVoiceChannel();
      }
    } finally {
      if (dmJoinInProgressRef.current === callId)
        dmJoinInProgressRef.current = null;
    }
  };

  rejoinVoiceRef.current = async (channelId) => {
    const channel = guildsRef.current
      .flatMap((guild) => guild.channels)
      .find((channel) => channel.id === channelId);
    if (channel) await handleJoinVoiceChannel(channel);
    else {
      // A disconnected Gateway ends its device-bound DM session on the server.
      // A new call must negotiate a new call id and keys instead of reusing it.
      await handleLeaveVoiceChannel();
    }
  };

  // 发送私信通话历史系统消息 (Discord 原生体验)
  const handleSendDMCallHistoryMessage = async (
    channelId: string,
    eventContent: string,
  ) => {
    if (!currentUser) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      await fetch(`${API_BASE}/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content: eventContent,
          authorId: currentUser.id,
        }),
      });
    } catch (e) {
      console.warn("Failed to post call history event message:", e);
    }
  };

  // 主动发起 1v1 私信呼叫
  const handleStartCall = async (channelId: string, hasVideo: boolean) => {
    if (!currentUser) return;
    if (!sframeManager.isSupported()) {
      showGlobalToast(
        getErrorMessage({ code: "MEDIA_E2EE_UNSUPPORTED" }),
        "error",
      );
      return;
    }
    const callEpoch = accountEpochRef.current;
    if (activeVoiceChannelIdRef.current) await handleLeaveVoiceChannel();
    if (
      callEpoch !== accountEpochRef.current ||
      useAuthStore.getState().user?.id !== currentUser.id
    )
      return;
    mediaEncryptionService.stop();
    screenShareGenerationRef.current++;
    displayCaptureCleanupRef.current?.();
    displayCaptureCleanupRef.current = null;
    livekitService.setNegotiatedE2EEKey(null);
    cloudflareRealtimeService.setNegotiatedE2EEKey(null);
    setCallEncryption({ status: "negotiating" });
    const ch = dmChannels.find((c) => c.id === channelId) || selectedChannel;
    if (!ch) return;
    const targetUser = ch.recipients?.find((r) => r.id !== currentUser.id);
    useDMCallStore.getState().startOutgoing({
      channelId,
      targetUser:
        targetUser ||
        ({
          id: "peer",
          username: ch.name || "Friend",
        } as any),
      hasVideo,
    });
    soundManager.startLoop("CALL_CALLING");
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_OFFER,
      d: {
        channelId,
        hasVideo,
        mediaEncryptionVersion: MEDIA_ENCRYPTION_VERSION,
      },
    });
  };

  // 主动取消呼叫 (拨号中取消)
  const handleCancelCall = () => {
    soundManager.stopLoop();
    soundManager.play("CALL_DISCONNECT");
    const dmStore = useDMCallStore.getState();
    const callId = dmStore.callId || activeDMCallRef.current?.callId;
    const channelId = dmStore.channelId || activeDMCallRef.current?.channelId;
    if (channelId) {
      if (callId) {
        rememberDMCallHistory(callId, channelId);
        gatewayClient.send({
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.CALL_END,
          d: {
            callId,
            channelId,
            reason: "canceled",
          },
        });
      }
    }
    useDMCallStore.getState().reset();
    activeDMCallRef.current = null;
    setActiveDMCall(null);
    setCallEncryption({ status: "idle" });
  };

  // 接听呼叫
  const handleAcceptCall = async () => {
    if (!incomingCall) return;
    soundManager.stopLoop();
    const call = incomingCall;
    if (activeDMCallRef.current?.callId !== call.callId) return;
    setIncomingCall(null);
    useDMCallStore.getState().setConnecting(call.callId);
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_ANSWER,
      d: {
        callId: call.callId,
        mediaEncryptionVersion: MEDIA_ENCRYPTION_VERSION,
      },
    });
    const ch = dmChannels.find((c) => c.id === call.channelId);
    if (ch) {
      setSelectedGuildId(null);
      setIsFriendsTabActive(false);
      setSelectedChannel(ch);
    }
    const activeCall = {
      callId: call.callId,
      channelId: call.channelId,
      hasVideo: call.hasVideo,
    };
    activeDMCallRef.current = activeCall;
    setActiveDMCall(activeCall);
  };

  // 拒绝呼叫
  const handleRejectCall = () => {
    if (!incomingCall) return;
    soundManager.stopLoop();
    soundManager.play("CALL_DISCONNECT");
    const call = incomingCall;
    setIncomingCall(null);
    rememberDMCallHistory(call.callId, call.channelId);
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_REJECT,
      d: {
        callId: call.callId,
      },
    });
    useDMCallStore.getState().reset();
    activeDMCallRef.current = null;
    setActiveDMCall(null);
    setCallEncryption({ status: "idle" });
  };

  // 切换静音
  const handleToggleMute = () => {
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    audioEngine.setMute(nextMuted);
    cloudflareRealtimeService.setMicrophoneMute(nextMuted);
    // 播放麦克风开/关提示音
    soundManager.play(nextMuted ? "MUTE" : "UNMUTE");

    const voiceGuildId = getVoiceGuildId(activeVoiceChannelId);
    if (voiceGuildId && activeVoiceChannelId) {
      gatewayClient.updateVoiceState(voiceGuildId, activeVoiceChannelId, {
        selfMute: nextMuted,
        selfDeaf: isDeafenedRef.current,
        selfVideo: isVideoEnabled,
        streaming: isScreenSharing,
      });
    }
  };
  handleToggleMuteRef.current = handleToggleMute;

  // 切换拒听
  const handleToggleDeafen = () => {
    const nextDeafened = !isDeafenedRef.current;
    isDeafenedRef.current = nextDeafened;
    setIsDeafened(nextDeafened);
    audioOutput.setDeafened(nextDeafened);
    // 播放关闭/开启声音提示音
    soundManager.play(nextDeafened ? "DEAFEN" : "UNDEAFEN");
    if (!isMutedRef.current && nextDeafened) {
      isMutedRef.current = true;
      setIsMuted(true);
      audioEngine.setMute(true);
      cloudflareRealtimeService.setMicrophoneMute(true);
    }
    const voiceGuildId = getVoiceGuildId(activeVoiceChannelId);
    if (voiceGuildId && activeVoiceChannelId) {
      gatewayClient.updateVoiceState(voiceGuildId, activeVoiceChannelId, {
        selfMute: nextDeafened ? true : isMutedRef.current,
        selfDeaf: nextDeafened,
        selfVideo: isVideoEnabled,
        streaming: isScreenSharing,
      });
    }
  };

  // 切换摄像头直播推流
  const handleToggleCamera = async () => {
    if (!activeVoiceChannelId) return;
    const nextVideo = !isVideoEnabled;
    try {
      if (
        VOICE_ENGINE === "cloudflare_realtime" &&
        cloudflareRealtimeService.status === "connected"
      ) {
        if (nextVideo) {
          const deviceId = livekitService.getCameraDeviceId();
          const stream = await navigator.mediaDevices.getUserMedia({
            video:
              deviceId && deviceId !== "default"
                ? { deviceId: { exact: deviceId } }
                : true,
            audio: false,
          });
          try {
            await cloudflareRealtimeService.publishMediaTrack(
              stream.getVideoTracks()[0],
              stream,
              "camera",
            );
          } catch (error) {
            stream.getTracks().forEach((track) => track.stop());
            throw error;
          }
        } else {
          await cloudflareRealtimeService.unpublishSource("camera");
        }
      } else if (voiceMeshManager.getIsMeshActive()) {
        if (nextVideo) {
          const deviceId = livekitService.getCameraDeviceId();
          const stream = await navigator.mediaDevices.getUserMedia({
            video:
              deviceId && deviceId !== "default"
                ? { deviceId: { exact: deviceId } }
                : true,
            audio: false,
          });
          const videoTrack = stream.getVideoTracks()[0];
          await voiceMeshManager.setLocalVideoTrack(videoTrack);
        } else {
          await voiceMeshManager.setLocalVideoTrack(null);
        }
      } else {
        await livekitService.setCameraEnabled(nextVideo);
      }
    } catch (error) {
      showGlobalToast(
        `摄像头切换失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
      return;
    }
    setIsVideoEnabled(nextVideo);
    const voiceGuildId = getVoiceGuildId(activeVoiceChannelId);
    if (voiceGuildId) {
      gatewayClient.updateVoiceState(voiceGuildId, activeVoiceChannelId, {
        selfVideo: nextVideo,
      });
    }
  };

  // 切换 AI 降噪 (支持四档轮转：RNNoise 标准轻量 -> DTLN 深度消键盘音 -> DFNv3 旗舰全频 -> 关闭)
  const handleToggleNoiseSuppression = () => {
    const currentMode = noiseSuppressionMode;

    let nextMode: NoiseSuppressionMode = "rnnoise";
    if (currentMode === "rnnoise") {
      nextMode = "dtln";
    } else if (currentMode === "dtln") {
      nextMode = "dfn3";
    } else if (currentMode === "dfn3") {
      nextMode = "off";
    } else {
      nextMode = "rnnoise";
    }

    const nextEnabled = nextMode !== "off";
    setIsNoiseSuppressionEnabled(nextEnabled);
    setNoiseSuppressionMode(nextMode);
    audioEngine.setNoiseSuppressionMode(nextMode);
  };

  // 精准点选 AI 降噪模式
  const handleSelectNoiseSuppressionMode = (mode: NoiseSuppressionMode) => {
    const nextEnabled = mode !== "off";
    setIsNoiseSuppressionEnabled(nextEnabled);
    setNoiseSuppressionMode(mode);
    audioEngine.setNoiseSuppressionMode(mode);
  };

  // 全面核对当前用户是否正处于屏幕推流状态 (多重事实源兜底校验，防止任何状态不同步)
  const isCurrentUserStreaming = useCallback(() => {
    const isLocalP2P =
      Boolean(p2pStreamManager.getLocalStream()) &&
      Boolean(currentUser?.id) &&
      p2pStreamManager.getStreamOwnerId() === currentUser?.id;
    const isP2PBroadcasting = activeVoiceChannelId
      ? p2pStreamManager.isBroadcasting(activeVoiceChannelId)
      : false;
    const isLiveKitLocal =
      livekitService.isSharingScreen ||
      Boolean(livekitService.localScreenShare) ||
      Boolean(livekitService.activeScreenShare?.isLocal);
    const isVoiceStateStreaming = voiceStates.some(
      (vs) =>
        Boolean(currentUser?.id) &&
        vs.userId === currentUser?.id &&
        vs.channelId === activeVoiceChannelId &&
        vs.streaming,
    );

    return Boolean(
      isScreenSharing ||
      Boolean(livekitService.localScreenShare) ||
      activeScreenShare?.isLocal ||
      isLocalP2P ||
      isP2PBroadcasting ||
      isLiveKitLocal ||
      isVoiceStateStreaming,
    );
  }, [
    currentUser?.id,
    activeVoiceChannelId,
    isScreenSharing,
    activeScreenShare,
    voiceStates,
  ]);

  // 显式停止屏幕推流 (无论底层处于何种状态，绝不弹出选择码率的 Modal)
  const handleStopScreenShare = useCallback(async () => {
    setIsScreenShareModalOpen(false); // 强制关闭任何选择弹窗，绝不弹出
    screenShareGenerationRef.current++;
    displayCaptureCleanupRef.current?.();
    displayCaptureCleanupRef.current = null;
    setIsScreenSharing(false);
    setActiveScreenShare((prev) => (prev?.isLocal ? null : prev));

    try {
      if (VOICE_ENGINE === "cloudflare_realtime") {
        await cloudflareRealtimeService.unpublishSource("screen");
        await cloudflareRealtimeService.unpublishSource("screen-audio");
      } else {
        await livekitService.stopScreenShare();
      }
    } catch (err) {
      console.warn("livekit stopScreenShare error:", err);
    }

    try {
      p2pStreamManager.stopAll();
    } catch (err) {
      console.warn("p2p stopAll error:", err);
    }

    const targetChannelId =
      activeVoiceChannelIdRef.current || activeVoiceChannelId;
    const targetGuildId = getVoiceGuildId(targetChannelId);

    if (targetGuildId && targetChannelId) {
      gatewayClient.updateVoiceState(targetGuildId, targetChannelId, {
        streaming: false,
        streamMode: "sfu",
      });
    }

    showGlobalToast("已停止屏幕直播", "info");
  }, [activeVoiceChannelId, showGlobalToast]);

  // 切换屏幕分享 (打开选择弹窗或停止分享)
  const handleToggleScreenShare = async () => {
    if (
      !activeVoiceChannelId ||
      (!getVoiceGuildId(activeVoiceChannelId) &&
        activeDMCallRef.current?.channelId !== activeVoiceChannelId)
    )
      return;
    if (isCurrentUserStreaming()) {
      await handleStopScreenShare();
    } else {
      setIsScreenShareModalOpen(true);
    }
  };

  // 4.1 & 4.2 从弹窗启动屏幕推流、Simulcast 与伴音混音
  const handleStartScreenShare = async (
    sourceId: string | null,
    presetId: string,
    captureAudio: boolean,
    videoCodec?: VideoCodecType,
    customBitrate?: number,
    transmissionMode: StreamTransmissionMode = "sfu",
  ) => {
    const voiceGuildId = getVoiceGuildId(activeVoiceChannelId);
    const callId =
      activeDMCallRef.current?.channelId === activeVoiceChannelId
        ? activeDMCallRef.current.callId
        : undefined;
    if (!activeVoiceChannelId || (!voiceGuildId && !callId)) return;
    if (callId) transmissionMode = "sfu";

    const preset =
      SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS["1080p60"];

    const shareGeneration = ++screenShareGenerationRef.current;
    let ownCleanup: (() => void) | undefined;
    const isCurrentShare = () =>
      screenShareGenerationRef.current === shareGeneration;
    try {
      sframeManager.assertReady();
      const captureEpoch = accountEpochRef.current;
      const captureVoiceEpoch = voiceOperationEpochRef.current;
      const captured = await captureDisplay({
        sourceId: sourceId || undefined,
        captureAudio,
        onAudioUnavailable: (reason) =>
          useToastStore
            .getState()
            .updateToast(
              `display-audio-${shareGeneration}`,
              `voice:capture.${reason}`,
              {},
              "warning",
              undefined,
              7000,
            ),
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
      });
      if (
        captureEpoch !== accountEpochRef.current ||
        captureVoiceEpoch !== voiceOperationEpochRef.current ||
        !isCurrentShare()
      ) {
        captured.cleanup();
        return;
      }
      displayCaptureCleanupRef.current?.();
      ownCleanup = captured.cleanup;
      displayCaptureCleanupRef.current = captured.cleanup;
      const stream = captured.stream;
      if (captureAudio && captured.reason)
        useToastStore
          .getState()
          .updateToast(
            `display-audio-${shareGeneration}`,
            `voice:capture.${captured.reason}`,
            {},
            "warning",
            undefined,
            7000,
          );
      const actualHasAudioTrack = stream.getAudioTracks().length > 0;
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (isCurrentShare()) void handleStopScreenShare();
        },
        { once: true },
      );

      if (
        transmissionMode === "p2p_direct" ||
        transmissionMode === "p2p_relay"
      ) {
        await p2pStreamManager.startBroadcasting(
          activeVoiceChannelId,
          voiceGuildId!,
          stream,
          transmissionMode,
          videoCodec || "h264",
          customBitrate,
        );
        showGlobalToast(
          transmissionMode === "p2p_direct"
            ? "🚀 已通过 P2P 直连模式开启直播（零服务器流量占用）"
            : "🌳 已通过 P2P 智能接力模式开启直播（观众接力转发省流）",
          "info",
        );
      } else {
        // 4.2 保持原生双轨推流架构：屏幕伴音作为独立音轨发送，麦克风人声保持独立推流，避免静音冲突
        if (VOICE_ENGINE === "cloudflare_realtime") {
          if (
            cloudflareRealtimeService.status !== "connected" &&
            !(await connectSfuFallbackRef.current(
              activeVoiceChannelId,
              callId,
              true,
            ))
          )
            throw new Error("MEDIA_KEY_UNAVAILABLE");
          const videoTrack = stream.getVideoTracks()[0];
          if (!videoTrack) throw new Error("屏幕视频轨道不可用");
          await cloudflareRealtimeService.publishMediaTrack(
            videoTrack,
            stream,
            "screen",
          );
          if (actualHasAudioTrack)
            await cloudflareRealtimeService.publishMediaTrack(
              stream.getAudioTracks()[0],
              stream,
              "screen-audio",
            );
        } else {
          const started = await livekitService.startScreenShareWithStream(
            stream,
            {
              sourceId: sourceId || undefined,
              preset: presetId,
              captureAudio: actualHasAudioTrack,
              simulcast: true,
              videoCodec,
              customBitrate,
            },
          );
          if (!started) throw new Error("MEDIA_E2EE_UNSUPPORTED");
        }
      }

      if (
        !isCurrentShare() ||
        captureEpoch !== accountEpochRef.current ||
        captureVoiceEpoch !== voiceOperationEpochRef.current
      ) {
        captured.cleanup();
        return;
      }
      setIsScreenSharing(true);
      setScreenShareModeByChannel((previous) => ({
        ...previous,
        [activeVoiceChannelId]: transmissionMode,
      }));
      if (voiceGuildId)
        gatewayClient.updateVoiceState(voiceGuildId, activeVoiceChannelId, {
          streaming: true,
          streamMode: transmissionMode,
        });
    } catch (err: unknown) {
      ownCleanup?.();
      if (!isCurrentShare()) return;
      screenShareGenerationRef.current++;
      displayCaptureCleanupRef.current?.();
      displayCaptureCleanupRef.current = null;
      await cloudflareRealtimeService.unpublishSource("screen").catch(() => {});
      await cloudflareRealtimeService
        .unpublishSource("screen-audio")
        .catch(() => {});
      if (
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "AbortError")
      ) {
        console.info("用户取消了屏幕共享授权");
        return;
      }
      console.error("Failed to start screen share:", err);
      showGlobalToast(t("voice:capture.capture_failed"), "error");
    }
  };

  // 观众端 P2P 穿透受阻时一键切换回服务器中继模式
  const handleP2PFallbackToSFU = async () => {
    if (
      activeVoiceChannelId &&
      (await connectSfuFallbackRef.current(activeVoiceChannelId))
    ) {
      p2pStreamManager.stopAll();
      gatewayClient.sendRaw({
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.P2P_FALLBACK_REQUEST,
        d: { channelId: activeVoiceChannelId },
      });
      showGlobalToast(
        VOICE_ENGINE === "cloudflare_realtime"
          ? "已切换为 Cloudflare SFU 模式观看"
          : "已切换为 LiveKit SFU 模式观看",
        "info",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen w-screen bg-discord-chat">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <div
            className="w-[200px] h-[3px] bg-[#2b2d31] rounded-full overflow-hidden relative"
            role="progressbar"
            aria-label="Loading"
          >
            <div className="absolute top-0 bottom-0 w-[40%] bg-gradient-to-r from-discord-brand to-[#7983f5] rounded-full animate-indeterminate-bar" />
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return (
      <div className="flex flex-col h-screen w-screen bg-discord-chat overflow-hidden">
        <TitleBar />
        <div className="flex-1 overflow-hidden relative">
          <AuthModal />
          {pendingInviteCode && (
            <InviteLandingModal
              code={pendingInviteCode}
              onClose={() => {
                setPendingInviteCode("");
                window.history.replaceState(
                  null,
                  "",
                  "/" + window.location.search + window.location.hash,
                );
              }}
              onJoinedServer={() => {}}
              onRequireAuth={() => {
                setPendingInviteCode("");
                window.history.replaceState(
                  null,
                  "",
                  "/" + window.location.search + window.location.hash,
                );
              }}
            />
          )}
        </div>
      </div>
    );
  }

  const handleOpenServerSettings = (targetGuild?: Guild) => {
    setServerSettingsTargetGuild(targetGuild || currentGuild || null);
    setIsServerSettingsOpen(true);
  };

  const activeVoiceChannelObj = activeVoiceChannelId
    ? guilds
        .flatMap((g) => g.channels || [])
        .find((c) => c.id === activeVoiceChannelId) ||
      (() => {
        const dm = dmChannels.find((d) => d.id === activeVoiceChannelId);
        if (!dm) return null;
        const otherUser = dm.recipients?.find((r) => r.id !== currentUser?.id);
        return {
          ...dm,
          name: dm.name || otherUser?.username || "私信通话",
        };
      })()
    : null;

  const handleSelectChannel = (ch: Channel, isDrawer: boolean = false) => {
    setIsFriendsTabActive(false);
    setSelectedChannel(ch);
    if (ch.guildId) {
      setSelectedGuildId(ch.guildId);
      useChannelNavStore.getState().recordLastSelectedGuild(ch.guildId);
      useChannelNavStore.getState().recordChannelVisit(ch.guildId, ch.id);
      if (ch.type === "TEXT") {
        useChannelNavStore.getState().recordTextChannelVisit(ch.guildId, ch.id);
        setChannelUnreadMap((prev) => {
          const cur = prev[ch.id];
          if (!cur || (!cur.hasUnread && cur.mentionCount === 0)) return prev;
          return {
            ...prev,
            [ch.id]: {
              ...cur,
              hasUnread: false,
              unreadCount: 0,
              mentionCount: 0,
            },
          };
        });
        markChannelReadOnServer(ch.id);
        if (ch.guildId) {
          const otherUnread = Object.values(channelUnreadMapRef.current).some(
            (item) =>
              item.guildId === ch.guildId &&
              item.channelId !== ch.id &&
              (item.hasUnread || item.mentionCount > 0),
          );
          if (!otherUnread) {
            setGuildUnreadMap((prev) => {
              if (!prev[ch.guildId!]) return prev;
              const next = { ...prev };
              delete next[ch.guildId!];
              return next;
            });
          }
        }
      }
    }
    if (ch.type === "DM" || !ch.guildId) {
      setSelectedGuildId(null);
      useChannelNavStore.getState().recordLastSelectedGuild(null);
      setDmChannels((prev) =>
        prev.map((dm) => (dm.id === ch.id ? { ...dm, unreadCount: 0 } : dm)),
      );
    }
    if (isDrawer || isMobileDrawerOpen) {
      setIsMobileDrawerOpen(false);
    }
  };

  const renderSidebarElements = (isDrawer: boolean = false) => (
    <>
      {/* 1. 最左侧公会导航侧栏 */}
      <Sidebar
        guilds={sortedGuilds}
        selectedGuildId={selectedGuildId}
        totalDmUnread={totalDmUnread}
        guildUnreadMap={guildUnreadMap}
        isSuperAdmin={currentUser?.role === "SUPER_ADMIN"}
        onOpenAdminDashboard={() => setIsAdminModalOpen(true)}
        onSelectGuild={(id) => {
          setSelectedGuildId(id);
          useChannelNavStore.getState().recordLastSelectedGuild(id);
          if (id === null) {
            setIsFriendsTabActive(true);
            setSelectedChannel(null);
          } else {
            setIsFriendsTabActive(false);
            // 切换进入该服务器时清空未读与提及状态
            setGuildUnreadMap((prev) => {
              if (!prev[id]) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
            const g = guilds.find((item) => item.id === id);
            if (g) {
              const lastChannelId = useChannelNavStore
                .getState()
                .getLastVisitedChannel(g.id);
              const targetChannel = resolveGuildChannel(g, lastChannelId, true);
              setSelectedChannel(targetChannel);
              if (targetChannel?.guildId) {
                useChannelNavStore
                  .getState()
                  .recordChannelVisit(targetChannel.guildId, targetChannel.id);
              }
              if (targetChannel && targetChannel.type === "TEXT") {
                setChannelUnreadMap((prev) => {
                  const cur = prev[targetChannel.id];
                  if (!cur || (!cur.hasUnread && cur.mentionCount === 0))
                    return prev;
                  return {
                    ...prev,
                    [targetChannel.id]: {
                      ...cur,
                      hasUnread: false,
                      unreadCount: 0,
                      mentionCount: 0,
                    },
                  };
                });
                markChannelReadOnServer(targetChannel.id);
              }
            }
            // Guild metadata may have changed while another guild was open.
            // Reconcile the remembered channel against the current server list.
            refreshGuilds(id);
          }
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
        onReorderGuilds={handleReorderGuilds}
        onOpenCreateGuild={() => setIsCreateGuildOpen(true)}
        onOpenJoinGuild={() => setIsJoinGuildOpen(true)}
        onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
        onOpenServerSettings={(targetG) => handleOpenServerSettings(targetG)}
        onLeaveGuild={handleLeaveGuild}
        onMarkGuildAsRead={handleMarkGuildAsRead}
      />

      {/* 2. 次级频道列表与底部控制栏 */}
      <ChannelSidebar
        guild={currentGuild}
        guilds={guilds}
        channels={currentChannels}
        dmChannels={dmChannels}
        isFriendsActive={selectedGuildId === null && isFriendsTabActive}
        onStartDMCall={(targetUserId) =>
          handleStartCallFromFriend(targetUserId)
        }
        onOpenProfile={(targetUserId) => {
          const targetFriend = useFriendStore
            .getState()
            .relationships.find(
              (r) => r.targetUserId === targetUserId,
            )?.targetUser;
          if (targetFriend) {
            const rect = new DOMRect(
              window.innerWidth / 2 - 150,
              window.innerHeight / 2 - 200,
              300,
              400,
            );
            useUserProfilePopoutStore.getState().openPopout({
              user: targetFriend,
              targetRect: rect,
            });
          }
        }}
        onOpenInviteFriends={(g) => setInviteFriendsGuild(g)}
        onSelectFriends={() => {
          setSelectedGuildId(null);
          useChannelNavStore.getState().recordLastSelectedGuild(null);
          setIsFriendsTabActive(true);
          setSelectedChannel(null);
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
        onCloseDMChannel={handleCloseDMChannel}
        onDMChannelCreated={(ch) => {
          setDmChannels((prev) => [ch, ...prev.filter((c) => c.id !== ch.id)]);
          setSelectedGuildId(null);
          useChannelNavStore.getState().recordLastSelectedGuild(null);
          setIsFriendsTabActive(false);
          setSelectedChannel(ch);
        }}
        selectedChannelId={selectedChannel?.id || ""}
        activeVoiceChannelId={activeVoiceChannelId}
        activeVoiceChannelObj={activeVoiceChannelObj}
        voiceConnectionStatus={voiceConnectionStatus}
        voiceStates={voiceStates}
        currentUser={currentUser}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isSpeaking={isSpeaking}
        activeSpeakers={activeSpeakers}
        isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
        voiceTransferNotice={voiceTransferNotice}
        onDismissVoiceTransferNotice={() => setVoiceTransferNotice(null)}
        onReclaimVoice={(ch) => handleJoinVoiceChannel(ch)}
        onSelectChannel={(ch) => handleSelectChannel(ch, isDrawer)}
        onJoinVoiceChannel={(ch) => {
          handleJoinVoiceChannel(ch);
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
        onLeaveVoiceChannel={handleLeaveVoiceChannel}
        onToggleMute={handleToggleMute}
        onToggleDeafen={handleToggleDeafen}
        onOpenSettings={() => handleOpenUserSettings("audio")}
        onOpenUserSettings={() => handleOpenUserSettings("profile")}
        onOpenNetworkStats={() => setIsNetworkQualityModalOpen(true)}
        isScreenSharing={isCurrentUserStreaming()}
        onToggleScreenShare={handleToggleScreenShare}
        onStopScreenShare={handleStopScreenShare}
        isVideoEnabled={isVideoEnabled}
        onToggleVideo={handleToggleCamera}
        onOpenCreateChannel={(cat) => {
          setSelectedCategoryForChannel(cat || null);
          setIsCreateChannelOpen(true);
        }}
        onOpenCreateCategory={() => setIsCreateCategoryOpen(true)}
        onEditCategory={(cat) => setEditingCategory(cat)}
        onDeleteCategory={(cat) => setEditingCategory(cat)}
        onChannelsReordered={(newChannels) => {
          if (!selectedGuildId) return;
          setGuilds((prev) =>
            prev.map((g) =>
              g.id === selectedGuildId ? { ...g, channels: newChannels } : g,
            ),
          );
        }}
        onCategoriesReordered={(newCategories) => {
          if (!selectedGuildId) return;
          setGuilds((prev) =>
            prev.map((g) =>
              g.id === selectedGuildId
                ? { ...g, categories: newCategories }
                : g,
            ),
          );
        }}
        onDeleteChannel={handleDeleteChannel}
        onEditChannel={handleEditChannel}
        onOpenServerSettings={(targetG) => handleOpenServerSettings(targetG)}
        onLeaveGuild={handleLeaveGuild}
        onMarkGuildAsRead={handleMarkGuildAsRead}
        onMarkChannelAsRead={handleMarkChannelAsRead}
        onDisconnectVoice={handleDisconnectVoiceMember}
        channelUnreadMap={channelUnreadMap}
      />
    </>
  );

  const renderDMCallStage = () => {
    if (
      selectedChannel?.type !== "DM" ||
      dmCallStoreState.callState === "idle" ||
      dmCallStoreState.channelId !== selectedChannel.id ||
      !dmCallStoreState.targetUser ||
      !currentUser
    ) {
      return null;
    }

    return (
      <DMCallStage
        channelId={selectedChannel.id}
        currentUser={currentUser}
        targetUser={dmCallStoreState.targetUser}
        callState={dmCallStoreState.callState}
        hasVideo={dmCallStoreState.hasVideo}
        onCancelCall={handleCancelCall}
        onHangup={handleLeaveVoiceChannel}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isVideoEnabled={isVideoEnabled}
        isScreenSharing={isCurrentUserStreaming()}
        onToggleMute={handleToggleMute}
        onToggleDeafen={handleToggleDeafen}
        onToggleCamera={handleToggleCamera}
        onToggleScreenShare={handleToggleScreenShare}
        isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
        noiseSuppressionMode={noiseSuppressionMode}
        onToggleNoiseSuppression={handleToggleNoiseSuppression}
        isSpeakingLocal={isSpeaking}
        isSpeakingRemote={activeSpeakers.includes(
          dmCallStoreState.targetUser.id,
        )}
        localVideoTrack={livekitService.localCameraTrack}
        remoteVideoTrack={
          livekitService.cameraTracksMap.get(dmCallStoreState.targetUser.id) ||
          p2pStreamManager.getRemoteStream()
        }
        screenShareTrack={
          activeScreenShare?.track || p2pStreamManager.getRemoteStream()
        }
        encryption={callEncryption}
      />
    );
  };

  return (
    <div className="flex flex-col h-dvh h-[var(--visual-viewport-height,100dvh)] w-screen overflow-hidden bg-discord-chat relative">
      {/* 顶部自定义标题栏 (仅在 Electron 桌面环境下展示，Web 端自动隐藏) */}
      <TitleBar />

      {/* 超级管理员维护模式横幅 */}
      {isMaintenance && currentUser?.role === "SUPER_ADMIN" && (
        <MaintenanceAdminBanner
          onOpenAdminModal={() => setIsAdminModalOpen(true)}
        />
      )}

      {/* Discord 风格网关长连接状态指示条 */}
      <GatewayConnectionBanner />

      {/* iOS / WebKit 音频中断恢复与生命周期唤醒横幅 */}
      <AudioInterruptedBanner />

      {/* 全网系统置顶公告条 */}
      {systemBroadcast && (
        <div
          className={`w-full px-4 py-2 flex items-center justify-between text-xs font-semibold select-none z-50 animate-in fade-in slide-in-from-top-2 duration-200 ${
            systemBroadcast.severity === "CRITICAL"
              ? "bg-red-600 text-white shadow-lg"
              : systemBroadcast.severity === "WARNING"
                ? "bg-amber-500 text-black shadow"
                : "bg-discord-brand text-white shadow"
          }`}
          data-testid="system-broadcast-banner"
        >
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              [{systemBroadcast.title || "系统公告"}] {systemBroadcast.content}
            </span>
          </div>
          <button
            onClick={() => setSystemBroadcast(null)}
            className="p-1 hover:bg-black/20 rounded transition cursor-pointer"
            title="关闭公告"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主工作区视图 (侧边栏、聊天/语音面板与成员列表) */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* 桌面与平板端常驻侧边栏 */}
        {!isMobile && renderSidebarElements(false)}

        {/* 移动端左侧全屏滑出抽屉 */}
        {isMobile && isMobileDrawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
              onClick={() => setIsMobileDrawerOpen(false)}
            />
            <div className="relative z-10 flex h-full max-w-[90vw] shadow-2xl animate-slide-right overflow-hidden">
              {renderSidebarElements(true)}
            </div>
          </div>
        )}

        {/* 中间主要内容区：文字聊天 vs 语音直播间 */}
        {selectedChannel?.type === "VOICE" ? (
          <VoiceRoomArea
            channel={selectedChannel}
            guild={currentGuild}
            currentUser={currentUser}
            voiceStates={voiceStates}
            isConnected={
              activeVoiceChannelId === selectedChannel.id &&
              (voiceConnectionStatus === "connected" ||
                voiceConnectionStatus === "p2p_active")
            }
            voiceConnectionStatus={
              activeVoiceChannelId === selectedChannel.id
                ? voiceConnectionStatus
                : "disconnected"
            }
            isMuted={isMuted}
            isSpeaking={isSpeaking}
            activeSpeakers={activeSpeakers}
            isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
            noiseSuppressionMode={noiseSuppressionMode}
            isScreenSharing={isCurrentUserStreaming()}
            isVideoEnabled={isVideoEnabled}
            onToggleMute={handleToggleMute}
            onToggleScreenShare={handleToggleScreenShare}
            onStopScreenShare={handleStopScreenShare}
            onToggleVideo={handleToggleCamera}
            onToggleNoiseSuppression={handleToggleNoiseSuppression}
            onSelectNoiseSuppressionMode={handleSelectNoiseSuppressionMode}
            onLeave={handleLeaveVoiceChannel}
            onJoin={() => handleJoinVoiceChannel(selectedChannel)}
            onCancelJoin={handleCancelVoiceJoin}
            onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
            onOpenVideoSettings={() => handleOpenUserSettings("audio", "video")}
          />
        ) : selectedGuildId === null && isFriendsTabActive ? (
          <FriendsDashboard
            currentUser={currentUser}
            guilds={guilds}
            onOpenServerMenu={() => setIsMobileDrawerOpen(true)}
            onStartDM={handleStartDM}
            onStartCall={handleStartCallFromFriend}
            onOpenProfile={(targetUserId) => {
              // 根据 targetUserId 查找好友或在线状态
              const targetFriend = useFriendStore
                .getState()
                .relationships.find(
                  (r) => r.targetUserId === targetUserId,
                )?.targetUser;
              if (targetFriend) {
                const rect = new DOMRect(
                  window.innerWidth / 2 - 150,
                  window.innerHeight / 2 - 200,
                  300,
                  400,
                );
                useUserProfilePopoutStore.getState().openPopout({
                  user: targetFriend,
                  targetRect: rect,
                });
              }
            }}
          />
        ) : selectedChannel ? (
          <ChatArea
            key={`${currentUser.id}:${selectedChannel.id}`}
            channel={selectedChannel}
            guild={currentGuild}
            messages={messages}
            isLoadingMessages={isMessagesLoading}
            history={messageHistory.history}
            onLoadOlderMessages={messageHistory.loadOlder}
            onLoadNewerMessages={messageHistory.loadNewer}
            currentUser={currentUser}
            onSendMessage={handleSendMessage}
            onReactionAdd={handleReactionAdd}
            onReactionRemove={handleReactionRemove}
            onTogglePin={handleTogglePin}
            onDeleteMessage={handleDeleteMessage}
            showMemberList={isDesktop ? showMemberList : isMobileMemberOpen}
            onToggleMemberList={() => setShowMemberList(!showMemberList)}
            onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
            onToggleMobileMemberList={() =>
              setIsMobileMemberOpen((prev) => !prev)
            }
            onStartCall={handleStartCall}
            onStartDM={handleStartDM}
            onStartDMCall={handleStartCallFromFriend}
            callEncryption={
              activeDMCall?.channelId === selectedChannel.id
                ? callEncryption
                : undefined
            }
            onMarkChannelAsRead={handleSyncChannelReadProgress}
            onReloadLatestMessages={handleReloadLatestMessages}
            onSelectChannel={(ch) => handleSelectChannel(ch)}
            dmCallElement={renderDMCallStage()}
          />
        ) : guilds.length === 0 ? (
          <EmptyGuildsWelcome
            onOpenDiscovery={() => setIsJoinGuildOpen(true)}
            onOpenCreateGuild={() => setIsCreateGuildOpen(true)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-discord-textMuted p-4 text-center">
            {isMobile && (
              <button
                data-testid="mobile-open-drawer-btn"
                onClick={() => setIsMobileDrawerOpen(true)}
                className="mb-4 px-4 py-2 bg-discord-brand text-white rounded-lg font-medium shadow-md md:hidden"
              >
                打开频道列表
              </button>
            )}
            <span>请选择左侧频道以开始沟通</span>
          </div>
        )}

        {/* 桌面端常驻右侧成员列表：外层剪裁平滑宽度过渡（Reflow-free） */}
        {isDesktop && selectedChannel?.type === "TEXT" && (
          <aside
            data-testid="member-list-aside"
            className={`h-full overflow-hidden transition-[width] duration-300 ease-in-out flex-shrink-0 ${
              showMemberList ? "w-60" : "w-0"
            }`}
            aria-hidden={!showMemberList}
          >
            <div className="w-60 h-full">
              <MemberList
                guild={currentGuild}
                currentUser={currentUser}
                onSendMessage={handleSendMessage}
                onStartDM={handleStartDM}
                onStartCall={handleStartCallFromFriend}
                onOpenUserSettings={() => handleOpenUserSettings("profile")}
                onMention={(username) => {
                  window.dispatchEvent(
                    new CustomEvent("tescord:mention", {
                      detail: { username },
                    }),
                  );
                }}
                onKickMember={handleKickMember}
                onBanMember={handleBanMember}
              />
            </div>
          </aside>
        )}

        {/* 移动端与平板端右侧成员抽屉：双向平滑进出过渡动画 */}
        {!isDesktop && selectedChannel?.type === "TEXT" && (
          <div
            data-testid="member-list-drawer"
            className={`fixed inset-0 z-[60] flex justify-end transition-all duration-300 ${
              isMobileMemberOpen
                ? "pointer-events-auto visible"
                : "pointer-events-none invisible delay-300"
            }`}
            aria-hidden={!isMobileMemberOpen}
          >
            {/* 背景毛玻璃遮罩 */}
            <div
              data-testid="member-list-backdrop"
              className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out ${
                isMobileMemberOpen ? "opacity-100" : "opacity-0"
              }`}
              onClick={() => {
                if (!useUserProfilePopoutStore.getState().isOpen)
                  setIsMobileMemberOpen(false);
              }}
            />
            {/* 抽屉面板主体 */}
            <div
              data-testid="member-list-drawer-panel"
              className={`relative z-10 h-full w-72 max-w-[80vw] shadow-2xl bg-discord-channelList border-l border-[#3f4147] transition-transform duration-300 ease-out transform flex flex-col ${
                isMobileMemberOpen ? "translate-x-0" : "translate-x-full"
              }`}
            >
              {/* 移动/平板端抽屉顶部标题与关闭按钮 */}
              <div className="h-12 border-b border-[#232428] px-4 flex items-center justify-between flex-shrink-0 text-discord-textHeader font-semibold">
                <span className="text-sm">频道成员</span>
                <button
                  type="button"
                  data-testid="close-member-drawer-btn"
                  onClick={() => {
                    if (!useUserProfilePopoutStore.getState().isOpen)
                      setIsMobileMemberOpen(false);
                  }}
                  className="p-1 rounded text-discord-textMuted hover:text-white hover:bg-[#35373c] transition"
                  title="关闭成员列表"
                  aria-label="关闭成员列表"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <MemberList
                  className="w-full border-l-0"
                  guild={currentGuild}
                  currentUser={currentUser}
                  onSendMessage={handleSendMessage}
                  onStartDM={handleStartDM}
                  onStartCall={handleStartCallFromFriend}
                  onOpenUserSettings={() => handleOpenUserSettings("profile")}
                  onMention={(username) => {
                    window.dispatchEvent(
                      new CustomEvent("tescord:mention", {
                        detail: { username },
                      }),
                    );
                  }}
                  onKickMember={handleKickMember}
                  onBanMember={handleBanMember}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. 用户个人与系统设置中心 (包含个人资料与全新音频菜单) */}
      <UserSettingsModal
        isOpen={isUserSettingsOpen}
        initialTab={userSettingsInitialTab}
        initialSubSection={userSettingsSubSection}
        onClose={() => {
          setIsUserSettingsOpen(false);
          setNoiseSuppressionMode(
            audioEngine.config.noiseSuppressionMode || "rnnoise",
          );
          setIsNoiseSuppressionEnabled(
            audioEngine.config.noiseSuppression !== false,
          );
        }}
        isInCall={!!activeVoiceChannelId}
      />

      {/* 7. 创建服务器弹窗 */}
      <CreateGuildModal
        isOpen={isCreateGuildOpen}
        onClose={() => setIsCreateGuildOpen(false)}
        onGuildCreated={(newGuild) => {
          setGuilds((prev) =>
            prev.some((g) => g.id === newGuild.id) ? prev : [...prev, newGuild],
          );
          setSelectedGuildId(newGuild.id);
          const targetChannel = resolveGuildChannel(newGuild, null, true);
          setSelectedChannel(targetChannel);
          if (targetChannel?.guildId) {
            useChannelNavStore
              .getState()
              .recordChannelVisit(targetChannel.guildId, targetChannel.id);
          }
        }}
        onOpenJoinModal={() => setIsJoinGuildOpen(true)}
      />

      {/* 8. 探索与加入服务器弹窗 */}
      <DiscoveryModal
        isOpen={isJoinGuildOpen}
        initialInviteCode=""
        onClose={() => {
          setIsJoinGuildOpen(false);
        }}
        onGuildJoined={(guildId) => {
          const token = useAuthStore.getState().token;
          fetch(`${API_BASE}/api/guilds`, {
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          })
            .then((res) => res.json())
            .then((data: Guild[]) => {
              setGuilds(data);
              setSelectedGuildId(guildId);
              const target = data.find((g) => g.id === guildId);
              if (target) {
                const lastChId = useChannelNavStore
                  .getState()
                  .getLastVisitedChannel(target.id);
                const targetChannel = resolveGuildChannel(
                  target,
                  lastChId,
                  true,
                );
                setSelectedChannel(targetChannel);
                if (targetChannel?.guildId) {
                  useChannelNavStore
                    .getState()
                    .recordChannelVisit(
                      targetChannel.guildId,
                      targetChannel.id,
                    );
                }
              }
            })
            .catch(() => {
              refreshGuilds();
              setSelectedGuildId(guildId);
            });
        }}
        onOpenCreateModal={() => setIsCreateGuildOpen(true)}
      />

      {/* 8.1 独立 Discord 风格全屏邀请卡片落地弹窗 (已登录直接访问 /invite/:code) */}
      {pendingInviteCode && (
        <InviteLandingModal
          code={pendingInviteCode}
          onClose={() => {
            setPendingInviteCode("");
            window.history.replaceState(
              null,
              "",
              "/" + window.location.search + window.location.hash,
            );
          }}
          onJoinedServer={(guildId) => {
            setPendingInviteCode("");
            window.history.replaceState(
              null,
              "",
              "/" + window.location.search + window.location.hash,
            );
            refreshGuilds();
            setSelectedGuildId(guildId);
            const token = useAuthStore.getState().token;
            fetch(`${API_BASE}/api/guilds`, {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            })
              .then((res) => res.json())
              .then((data: Guild[]) => {
                setGuilds(data);
                setSelectedGuildId(guildId);
                const target = data.find((g) => g.id === guildId);
                if (target) {
                  const lastChId = useChannelNavStore
                    .getState()
                    .getLastVisitedChannel(target.id);
                  const targetChannel = resolveGuildChannel(
                    target,
                    lastChId,
                    true,
                  );
                  setSelectedChannel(targetChannel);
                  if (targetChannel?.guildId) {
                    useChannelNavStore
                      .getState()
                      .recordChannelVisit(
                        targetChannel.guildId,
                        targetChannel.id,
                      );
                  }
                }
              })
              .catch(() => {});
          }}
        />
      )}

      {/* 9. 创建频道弹窗 */}
      {selectedGuildId && (
        <CreateChannelModal
          isOpen={isCreateChannelOpen}
          guildId={selectedGuildId}
          categories={currentGuild?.categories}
          initialCategoryId={selectedCategoryForChannel?.id}
          onClose={() => {
            setIsCreateChannelOpen(false);
            setSelectedCategoryForChannel(null);
          }}
          onChannelCreated={(newChannel) => {
            // REST 响应立即落入本地权威缓存；随后到达的网关事件按 ID 合并，
            // 即使创建瞬间网关重连也不会出现频道只在聊天区、未出现在侧栏的状态。
            setGuilds((prev) =>
              prev.map((guild) => {
                if (guild.id !== newChannel.guildId) return guild;
                const exists = guild.channels.some(
                  (channel) => channel.id === newChannel.id,
                );
                return {
                  ...guild,
                  channels: exists
                    ? guild.channels.map((channel) =>
                        channel.id === newChannel.id ? newChannel : channel,
                      )
                    : [...guild.channels, newChannel],
                };
              }),
            );
            setSelectedChannel(newChannel);
            if (newChannel.guildId) {
              useChannelNavStore
                .getState()
                .recordChannelVisit(newChannel.guildId, newChannel.id);
            }
          }}
        />
      )}

      {/* 9.01 创建分类弹窗 */}
      {selectedGuildId && (
        <CreateCategoryModal
          isOpen={isCreateCategoryOpen}
          guildId={selectedGuildId}
          onClose={() => setIsCreateCategoryOpen(false)}
          onCategoryCreated={(newCat) => {
            setGuilds((prev) =>
              prev.map((g) =>
                g.id === selectedGuildId
                  ? {
                      ...g,
                      categories: [
                        ...(g.categories || []).filter(
                          (category) => category.id !== newCat.id,
                        ),
                        newCat,
                      ].sort((a, b) => a.position - b.position),
                    }
                  : g,
              ),
            );
          }}
        />
      )}

      {/* 9.02 编辑分类弹窗 */}
      <EditCategoryModal
        isOpen={!!editingCategory}
        category={editingCategory}
        onClose={() => setEditingCategory(null)}
        onCategoryUpdated={(updatedCat) => {
          setGuilds((prev) =>
            prev.map((g) =>
              g.id === updatedCat.guildId
                ? {
                    ...g,
                    categories: (g.categories || []).map((c) =>
                      c.id === updatedCat.id ? updatedCat : c,
                    ),
                  }
                : g,
            ),
          );
        }}
        onCategoryDeleted={(catId) => {
          setGuilds((prev) =>
            prev.map((g) =>
              g.categories?.some((c) => c.id === catId)
                ? {
                    ...g,
                    categories: (g.categories || []).filter(
                      (c) => c.id !== catId,
                    ),
                    channels: g.channels.map((ch) =>
                      ch.parentId === catId ? { ...ch, parentId: null } : ch,
                    ),
                  }
                : g,
            ),
          );
        }}
      />

      {/* 9.1 编辑频道弹窗 */}
      <EditChannelModal
        isOpen={!!editingChannel}
        channel={editingChannel}
        guild={currentGuild}
        onClose={() => setEditingChannel(null)}
        onChannelUpdated={handleChannelUpdated}
        onChannelDeleted={handleChannelDeletedFromModal}
      />

      {/* 10. 阶段四：屏幕分享与窗口选择弹窗 */}
      <ScreenShareModal
        isOpen={isScreenShareModalOpen}
        onClose={() => setIsScreenShareModalOpen(false)}
        defaultTransmissionMode={
          (activeVoiceChannelId
            ? screenShareModeByChannel[activeVoiceChannelId]
            : undefined) ||
          activeVoiceChannelObj?.streamMode ||
          "sfu"
        }
        onStartShare={handleStartScreenShare}
      />

      {/* 10.1 P2P 直连打洞失败切换确认弹窗 */}
      <P2PFallbackModal
        isOpen={isP2PFallbackModalOpen}
        onClose={() => setIsP2PFallbackModalOpen(false)}
        onFallbackToSFU={handleP2PFallbackToSFU}
        reason={p2pFallbackReason}
      />

      {/* 11. 阶段四：跨频道画中画 (Floating PiP) 悬浮迷你播放器 */}
      {activeScreenShare &&
        showFloatingPiP &&
        selectedChannel?.id !== activeVoiceChannelId && (
          <FloatingPiP
            share={activeScreenShare}
            streamerName={
              activeScreenShare.isLocal
                ? currentUser.username
                : voiceStates.find(
                    (v) => v.userId === activeScreenShare.participantIdentity,
                  )?.user?.username || activeScreenShare.participantIdentity
            }
            onReturnToChannel={() => {
              if (activeVoiceChannelId) {
                for (const g of guilds) {
                  const ch = g.channels.find(
                    (c) => c.id === activeVoiceChannelId,
                  );
                  if (ch) {
                    setSelectedGuildId(g.id);
                    setSelectedChannel(ch);
                    useChannelNavStore
                      .getState()
                      .recordChannelVisit(g.id, ch.id);
                    break;
                  }
                }
              }
            }}
            onClose={() => setShowFloatingPiP(false)}
          />
        )}

      {/* 12. 服务器管理员设置与配置面板 (全屏沉浸式) */}
      <ServerSettingsModal
        isOpen={isServerSettingsOpen}
        guild={serverSettingsTargetGuild || currentGuild}
        onClose={() => setIsServerSettingsOpen(false)}
        onGuildUpdated={(updatedGuild) => {
          setGuilds((prev) =>
            prev.map((g) => (g.id === updatedGuild.id ? updatedGuild : g)),
          );
        }}
        onGuildDeleted={(deletedGuildId) => {
          useChannelNavStore.getState().removeGuildMemory(deletedGuildId);
          setGuilds((prev) => prev.filter((g) => g.id !== deletedGuildId));
          if (selectedGuildId === deletedGuildId) {
            const remaining = guilds.filter((g) => g.id !== deletedGuildId);
            if (remaining.length > 0) {
              const nextGuild = remaining[0];
              setSelectedGuildId(nextGuild.id);
              const lastChId = useChannelNavStore
                .getState()
                .getLastVisitedChannel(nextGuild.id);
              const targetChannel = resolveGuildChannel(
                nextGuild,
                lastChId,
                true,
              );
              setSelectedChannel(targetChannel);
              if (targetChannel?.guildId) {
                useChannelNavStore
                  .getState()
                  .recordChannelVisit(targetChannel.guildId, targetChannel.id);
              }
            } else {
              setSelectedGuildId(null);
              setSelectedChannel(null);
            }
          }
        }}
      />

      {/* 13. WebRTC 媒体引擎与网络健康看板模态框 */}
      <NetworkQualityModal
        isOpen={isNetworkQualityModalOpen}
        onClose={() => setIsNetworkQualityModalOpen(false)}
        channel={activeVoiceChannelObj || selectedChannel}
        isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
      />

      {/* 15. 超级管理员系统控制台 */}
      <AdminDashboardModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
      />

      {/* 16. 1v1 私信来电全局浮窗振铃 */}
      {incomingCall && (
        <IncomingCallModal
          caller={incomingCall.caller}
          channelId={incomingCall.channelId}
          hasVideo={incomingCall.hasVideo}
          encryption={callEncryption}
          onAccept={handleAcceptCall}
          onReject={handleRejectCall}
        />
      )}

      {/* 16.1 离开私信频道时的悬浮画中画 (DM Picture-in-Picture) */}
      {dmCallStoreState.callState === "connected" &&
        selectedChannel?.id !== dmCallStoreState.channelId &&
        dmCallStoreState.targetUser && (
          <DMPictureInPicture
            targetUser={dmCallStoreState.targetUser}
            onReturnToCall={() => {
              const ch = dmChannels.find(
                (c) => c.id === dmCallStoreState.channelId,
              );
              if (ch) {
                setSelectedGuildId(null);
                setIsFriendsTabActive(false);
                setSelectedChannel(ch);
              }
            }}
            onHangup={handleLeaveVoiceChannel}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
            isSpeakingRemote={activeSpeakers.includes(
              dmCallStoreState.targetUser.id,
            )}
            remoteVideoTrack={
              livekitService.cameraTracksMap.get(
                dmCallStoreState.targetUser.id,
              ) || p2pStreamManager.getRemoteStream()
            }
            callDuration={
              dmCallStoreState.callStartTime
                ? (() => {
                    const elapsed = Math.floor(
                      (Date.now() - dmCallStoreState.callStartTime) / 1000,
                    );
                    const mins = Math.floor(elapsed / 60)
                      .toString()
                      .padStart(2, "0");
                    const secs = (elapsed % 60).toString().padStart(2, "0");
                    return `${mins}:${secs}`;
                  })()
                : "00:00"
            }
          />
        )}

      {/* 14. 全局浮动 Toast 提示（伴音降级提示、异常反馈等） */}
      {globalToast && (
        <div
          data-testid="global-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`fixed top-[max(3rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[110] max-w-[90vw] sm:max-w-md px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2.5 text-sm font-medium animate-in fade-in slide-in-from-top-4 duration-200 border backdrop-blur-md ${
            globalToast.type === "warning"
              ? "bg-[#2b2d31]/95 text-amber-300 border-amber-500/40"
              : globalToast.type === "error"
                ? "bg-[#2b2d31]/95 text-red-400 border-red-500/40"
                : "bg-[#2b2d31]/95 text-white border-[#383a40]"
          }`}
        >
          {globalToast.type === "warning" && (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          {globalToast.type === "error" && (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          {globalToast.type === "info" && (
            <Info className="w-4 h-4 text-discord-brand shrink-0" />
          )}
          <span className="flex-1 text-xs leading-relaxed">
            {globalToast.message}
          </span>
          <button
            type="button"
            onClick={() => setGlobalToast(null)}
            className="text-gray-400 hover:text-white p-0.5 rounded cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <ForcedPasswordChangeModal />
      <ReauthModal />
      {inviteFriendsGuild && (
        <InviteFriendsModal
          isOpen={!!inviteFriendsGuild}
          guild={inviteFriendsGuild}
          onClose={() => setInviteFriendsGuild(null)}
        />
      )}

      {/* 15. 全局单例用户信息卡片浮层 (User Profile Popout) */}
      {isProfilePopoutOpen && profilePopoutPayload && currentUser && (
        <UserProfilePopout
          isOpen={true}
          onClose={closeProfilePopout}
          targetRect={profilePopoutPayload.targetRect}
          user={profilePopoutPayload.user}
          member={profilePopoutPayload.member}
          guild={profilePopoutPayload.guild ?? currentGuild}
          allGuilds={guilds}
          currentUser={currentUser}
          roles={profilePopoutPayload.roles ?? currentGuild?.roles ?? []}
          isOwner={
            profilePopoutPayload.isOwner ??
            currentGuild?.ownerId === profilePopoutPayload.user.id
          }
          onOpenSettings={() => handleOpenUserSettings("profile")}
          onMention={(username) => {
            window.dispatchEvent(
              new CustomEvent("tescord:mention", { detail: { username } }),
            );
          }}
          onSendMessage={handleSendMessage}
          onStartDM={handleStartDM}
          onSendQuickDM={handleSendQuickDM}
          onKickMember={handleKickMember}
          onBanMember={handleBanMember}
        />
      )}

      {/* 16. 全局单例右键菜单浮层 (Global Singleton ContextMenu) */}
      <GlobalContextMenu />

      {/* 17. 普通用户维护模式全屏遮罩 */}
      {isMaintenance && currentUser?.role !== "SUPER_ADMIN" && (
        <MaintenanceScreen />
      )}

      {/* 18. 桌面端后台更新就绪悬浮通知 */}
      <UpdateNotificationBanner />

      {/* 18.1 版本更新公告模态框 (What's New) */}
      <WhatsNewModal />

      {/* 19. 全局通用决策与安全验证模态框 */}
      <GlobalDialogContainer />

      {/* 20. 全局 Toast 消息容器 */}
      <GlobalToastContainer />

      {/* 21. 全局单例音频小窗播放状态栏 */}
      <GlobalMiniPlayer />
    </div>
  );
};
