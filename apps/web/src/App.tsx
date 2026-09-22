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
  DevicePublicKey,
  MediaKeyEnvelopePayload,
} from "@tescord/types";
import { TitleBar } from "./components/TitleBar.js";
import { GatewayConnectionBanner } from "./components/GatewayConnectionBanner.js";
import { Sidebar } from "./components/Sidebar.js";
import {
  ChannelSidebar,
  VoiceTransferNotice,
} from "./components/ChannelSidebar.js";
import { ChatArea } from "./components/ChatArea.js";
import { VoiceRoomArea } from "./components/VoiceRoomArea.js";
import { MemberList } from "./components/MemberList.js";
import { AuthModal } from "./components/auth/AuthModal.js";
import { ForcedPasswordChangeModal } from "./components/auth/ForcedPasswordChangeModal.js";
import { UserSettingsModal } from "./components/settings/UserSettingsModal.js";
import { ServerSettingsModal } from "./components/server-settings/ServerSettingsModal.js";
import { CreateGuildModal } from "./components/modals/CreateGuildModal.js";
import { JoinGuildModal } from "./components/modals/JoinGuildModal.js";
import { CreateChannelModal } from "./components/modals/CreateChannelModal.js";
import { EditChannelModal } from "./components/modals/EditChannelModal.js";
import { CreateCategoryModal } from "./components/modals/CreateCategoryModal.js";
import { EditCategoryModal } from "./components/modals/EditCategoryModal.js";
import { ScreenShareModal } from "./components/modals/ScreenShareModal.js";
import { NetworkQualityModal } from "./components/modals/NetworkQualityModal.js";
import { P2PFallbackModal } from "./components/modals/P2PFallbackModal.js";
import { AdminDashboardModal } from "./components/admin/AdminDashboardModal.js";
import { IncomingCallModal } from "./components/dm/IncomingCallModal.js";
import { FloatingPiP } from "./components/FloatingPiP.js";
import { useAuthStore } from "./stores/useAuthStore.js";
import { gatewayClient } from "./services/gateway.js";
import { audioEngine } from "./services/audioEngine.js";
import { livekitService, ActiveScreenShare } from "./services/livekit.js";
import { audioMixer } from "./services/audioMixer.js";
import { doubleRatchetManager } from "./services/doubleRatchet.js";
import { sframeManager } from "./services/sframe.js";
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
import { API_BASE } from "./config.js";
import { useViewport } from "./hooks/useViewport.js";
import { useSwipeGesture } from "./hooks/useSwipeGesture.js";
import { X, AlertTriangle, Info } from "lucide-react";
import { deviceKeyService } from "./services/deviceKeys.js";

export const App: React.FC = () => {
  const {
    user: currentUser,
    isAuthenticated,
    isLoading,
    initAuth,
  } = useAuthStore();

  const { isMobile, isTablet, isDesktop } = useViewport();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isMobileMemberOpen, setIsMobileMemberOpen] = useState(false);

  // 核心数据状态
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // 切换频道或切换至宽屏桌面端时，自动收起移动端/平板端右侧抽屉
  useEffect(() => {
    setIsMobileMemberOpen(false);
  }, [selectedChannel?.id, isDesktop]);

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
    !isDesktop,
  );
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<
    string | null
  >(null);
  const [voiceConnectionStatus, setVoiceConnectionStatus] =
    useState<VoiceConnectionStatus>(() => livekitService.getConnectionStatus());
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceStates, setVoiceStates] = useState<VoiceState[]>([]);
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
  activeVoiceChannelIdRef.current = activeVoiceChannelId;
  if (typeof window !== "undefined") {
    (window as any).__activeVoiceChannelId = activeVoiceChannelId;
    (window as any).__selectedChannelId = selectedChannel?.id;
  }
  const guildsRef = useRef<Guild[]>([]);
  guildsRef.current = guilds;
  const selectedGuildIdRef = useRef<string | null>(null);
  selectedGuildIdRef.current = selectedGuildId;
  const selectedChannelRef = useRef<Channel | null>(null);
  selectedChannelRef.current = selectedChannel;
  const isMutedRef = useRef<boolean>(false);
  isMutedRef.current = isMuted;
  const handleToggleMuteRef = useRef<() => void>(() => {});

  // 模态框显隐状态
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
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
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [selectedCategoryForChannel, setSelectedCategoryForChannel] =
    useState<ChannelCategory | null>(null);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<ChannelCategory | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);
  const [isNetworkQualityModalOpen, setIsNetworkQualityModalOpen] =
    useState(false);
  const [isP2PFallbackModalOpen, setIsP2PFallbackModalOpen] = useState(false);
  const [p2pFallbackReason, setP2PFallbackReason] = useState<string>("");

  // 私信、呼叫与超级管理员状态
  const [dmChannels, setDmChannels] = useState<Channel[]>([]);
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

  // 拉取公会列表
  const refreshGuilds = () => {
    const token = useAuthStore.getState().token;
    fetch(`${API_BASE}/api/guilds`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((res) => res.json())
      .then((data: Guild[]) => {
        setGuilds(data);
        if (data.length > 0 && !selectedGuildId) {
          const firstGuild = data[0];
          setSelectedGuildId(firstGuild.id);
          if (firstGuild.channels.length > 0) {
            setSelectedChannel(firstGuild.channels[0]);
          }
        }
      })
      .catch((err) => console.error("Failed to load guilds:", err));
  };

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!isAuthenticated || !currentUser?.id || !token || !window.indexedDB) return;
    deviceKeyService.ensureAndRegister(currentUser.id, token).catch((error) => {
      console.error("Failed to initialize account-scoped device keys:", error);
      showGlobalToast("设备身份密钥初始化失败，E2EE 媒体将保持禁用", "error");
    });
  }, [isAuthenticated, currentUser?.id]);

  // 本机资料更新先同步至已加载的成员缓存；网关事件随后仍按用户 ID 幂等合并。
  // 这样短暂重连期间切换 Presence 也不会让自己的状态指示滞后。
  useEffect(() => {
    if (!currentUser) return;
    setGuilds((previous) => previous.map((guild) => ({
      ...guild,
      members: guild.members?.map((member) =>
        member.userId === currentUser.id && member.user
          ? { ...member, user: { ...member.user, status: currentUser.status, customStatus: currentUser.customStatus } }
          : member,
      ),
    })));
  }, [currentUser?.id, currentUser?.status, currentUser?.customStatus]);

  // 拉取私信列表
  const refreshDMChannels = useCallback(async () => {
    try {
      const token = localStorage.getItem("tescord_access_token");
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: Channel[] | { items: Channel[] } = await res.json();
        setDmChannels(Array.isArray(data) ? data : data.items);
      }
    } catch (err) {
      console.error("Failed to load DM channels:", err);
    }
  }, []);

  // 当用户鉴权登入后建立连接
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    refreshGuilds();
    refreshDMChannels();
    window.electronAPI?.syncUserStatus(currentUser.status);
    p2pStreamManager.setContext(currentUser.id);

    // 初始化端到端双棘轮身份密钥对并同步 PreKeyBundle
    const token = localStorage.getItem("tescord_access_token") || undefined;
    doubleRatchetManager.init(currentUser.id, token);

    // 连接 WebSocket 网关
    gatewayClient.connect(currentUser.id);
    voiceMeshManager.setContext(currentUser.id);
    useSettingsStore.getState().fetchCloudSettings();
    if (typeof window !== "undefined") {
      (window as any).voiceMeshManager = voiceMeshManager;
      (window as any).p2pStreamManager = p2pStreamManager;
      (window as any).useSettingsStore = useSettingsStore;
    }

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

    // 监听网关信令事件
    const unbindReady = gatewayClient.on("READY", (data) => {
      if (data.guilds) setGuilds(data.guilds);
      if (data.voiceStates) setVoiceStates(data.voiceStates);
    });

    // 监听实时在线状态广播
    const unbindPresenceUpdate = gatewayClient.on(
      GatewayEvents.PRESENCE_UPDATE,
      (data: PresenceUpdateEvent) => {
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
                      },
                    }
                  : m,
              ),
            };
          }),
        );

        // 若为自身端的状态更新（包括跨端同步或自身隐身），同步当前用户信息
        if (currentUser && data.userId === currentUser.id) {
          useAuthStore.getState().setUser({
            ...currentUser,
            status: data.status,
            customStatus:
              data.customStatus !== undefined
                ? data.customStatus
                : currentUser.customStatus,
          });
        }
      },
    );

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
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // 若属于私信会话，同步最新消息与未读计数
        setDmChannels((prev) =>
          prev.map((dm) => {
            if (dm.id === msg.channelId) {
              const isCurrentActive =
                selectedChannelRef.current?.id === msg.channelId;
              return {
                ...dm,
                lastMessage: msg,
                unreadCount: isCurrentActive
                  ? 0
                  : (dm.unreadCount || 0) + 1,
              };
            }
            return dm;
          }),
        );

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

        // 4.3 原生桌面通知推送 (当窗口未聚焦或有 @ 提及)
        if (msg.authorId !== currentUser.id) {
          const isMentioned = msg.content.includes(`@${currentUser.username}`);
          const isHidden =
            document.hidden || selectedChannelRef.current?.id !== msg.channelId;
          if (isMentioned || isHidden) {
            window.electronAPI?.showNotification({
              title: `${msg.author?.username || "Tescord"}`,
              body:
                msg.content.length > 80
                  ? msg.content.slice(0, 80) + "..."
                  : msg.content,
              channelId: msg.channelId,
              guildId: selectedGuildIdRef.current || undefined,
            });
          }
        }
      },
    );

    const unbindMsgDelete = gatewayClient.on(
      "MESSAGE_DELETE",
      (data: { channelId: string; messageId: string }) => {
        setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
      },
    );

    const unbindReactionAdd = gatewayClient.on(
      "MESSAGE_REACTION_ADD",
      (data: any) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId ? { ...m, reactions: data.reactions } : m,
          ),
        );
      },
    );

    const unbindReactionRemove = gatewayClient.on(
      "MESSAGE_REACTION_REMOVE",
      (data: any) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId ? { ...m, reactions: data.reactions } : m,
          ),
        );
      },
    );

    const unbindPinUpdate = gatewayClient.on(
      "MESSAGE_PIN_UPDATE",
      (data: any) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m,
          ),
        );
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
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  channels: g.channels.filter((c) => c.id !== data.channelId),
                }
              : g,
          ),
        );
        if (selectedChannelRef.current?.id === data.channelId) {
          setSelectedChannel(null);
        }
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
        if (
          data.userId === currentUser.id &&
          selectedGuildIdRef.current === data.guildId
        ) {
          setSelectedGuildId(null);
          setSelectedChannel(null);
        }
      },
    );

    const unbindVoice = gatewayClient.on(
      "VOICE_STATE_UPDATE",
      (vs: VoiceState) => {
        setVoiceStates((prev) => {
          // 若变动成员不是自身，且自身当前处于语音频道中，播放进出提示音
          const currentVoiceId = activeVoiceChannelIdRef.current;
          if (currentUser && vs.userId !== currentUser.id && currentVoiceId) {
            const oldState = prev.find((p) => p.userId === vs.userId);
            const wasInMyChannel = oldState?.channelId === currentVoiceId;
            const isNowInMyChannel = vs.channelId === currentVoiceId;

            if (!wasInMyChannel && isNowInMyChannel) {
              soundManager.play("USER_JOIN");
            } else if (wasInMyChannel && !isNowInMyChannel) {
              soundManager.play("USER_LEAVE");
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
        if (data.reason === "VOICE_TRANSFER") {
          const prevChannel =
            currentChannels.find(
              (c) => c.id === activeVoiceChannelIdRef.current,
            ) || selectedChannelRef.current;

          // 1. 彻底释放麦克风硬件与媒体流
          sframeManager.disable();
          audioEngine.stop();
          await livekitService.leaveRoom();

          // 2. 播放挂断提示音
          soundManager.play("VOICE_LEAVE");

          // 3. 重置本地活跃状态
          setActiveVoiceChannelId(null);
          setIsSpeaking(false);
          setIsScreenSharing(false);

          // 4. 展示转移提示卡片
          setVoiceTransferNotice({
            targetPlatform: data.targetPlatform || "其他设备",
            previousChannel: prevChannel || null,
          });
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
        const activeCall = { callId: data.callId, channelId: data.channelId, hasVideo: !!data.hasVideo };
        activeDMCallRef.current = activeCall;
        setActiveDMCall(activeCall);
        setCallEncryption({ status: "negotiating" });
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
        showGlobalToast("对方已接听通话", "info");
        if (activeDMCallRef.current?.callId === data.callId) {
          handleJoinDMCall(data.channelId, activeDMCallRef.current.hasVideo, data.callId);
        }
      },
    );

    const unbindCallReject = gatewayClient.on(
      GatewayEvents.CALL_REJECT,
      () => {
        showGlobalToast("对方已挂断或拒绝了通话", "warning");
        soundManager.play("VOICE_LEAVE");
        activeDMCallRef.current = null;
        setActiveDMCall(null);
        setCallEncryption({ status: "idle" });
        handleLeaveVoiceChannel();
      },
    );

    const unbindCallState = gatewayClient.on(
      GatewayEvents.CALL_STATE_UPDATE,
      async (data: { callId: string; channelId: string; callerId: string; hasVideo: boolean; state: string }) => {
        if (data.state === "ringing" || data.state === "active") {
          const call = { callId: data.callId, channelId: data.channelId, hasVideo: data.hasVideo };
          activeDMCallRef.current = call;
          setActiveDMCall(call);
          if (data.callerId === currentUser?.id && data.state === "ringing") {
            try {
              const token = useAuthStore.getState().token;
              if (!token) throw new Error("登录已失效");
              const response = await fetch(`${API_BASE}/api/channels/${data.channelId}/e2ee/devices`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!response.ok) throw new Error("无法读取对端设备密钥");
              const devices = await response.json() as DevicePublicKey[];
              const negotiated = await deviceKeyService.distributeMediaKey(data.channelId, data.callId, devices, token);
              sframeManager.setNegotiatedKey(negotiated.key);
              livekitService.setNegotiatedE2EEKey(negotiated.key);
              setCallEncryption({ status: negotiated.trust, fingerprint: negotiated.fingerprint });
            } catch (error) {
              setCallEncryption({ status: "failed" });
              showGlobalToast(error instanceof Error ? error.message : "E2EE 密钥协商失败", "error");
              gatewayClient.send({ op: GatewayOpCode.DISPATCH, t: GatewayEvents.CALL_END, d: { callId: data.callId, reason: "e2ee_key_exchange_failed" } });
            }
          }
        }
      },
    );

    const unbindMediaKey = gatewayClient.on(
      GatewayEvents.E2EE_KEY_EXCHANGE,
      async (data: MediaKeyEnvelopePayload) => {
        if (!data?.callId || data.callId !== activeDMCallRef.current?.callId) return;
        try {
          const negotiated = await deviceKeyService.openMediaKey(data);
          if (!negotiated) return;
          sframeManager.setNegotiatedKey(negotiated.key);
          livekitService.setNegotiatedE2EEKey(negotiated.key);
          setCallEncryption({ status: negotiated.trust, fingerprint: negotiated.fingerprint });
        } catch (error) {
          setCallEncryption({ status: "failed" });
          showGlobalToast(error instanceof Error ? error.message : "E2EE 媒体密钥验证失败", "error");
        }
      },
    );

    const unbindCallEnd = gatewayClient.on(
      GatewayEvents.CALL_END,
      (data: { channelId: string }) => {
        setIncomingCall(null);
        activeDMCallRef.current = null;
        setActiveDMCall(null);
        setCallEncryption({ status: "idle" });
        if (activeVoiceChannelIdRef.current === data.channelId) {
          soundManager.play("VOICE_LEAVE");
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
      (update: Channel & {
        channelId?: string;
        unreadIncrement?: number;
        lastReadSequence?: number;
      }) => {
        const channelId = update.channelId || update.id;
        setDmChannels((prev) =>
          prev.map((channel) =>
            channel.id === channelId
              ? {
                  ...channel,
                  ...update,
                  id: channel.id,
                  unreadCount:
                    update.unreadCount ??
                    Math.max(
                      0,
                      (channel.unreadCount || 0) + (update.unreadIncrement || 0),
                    ),
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

    return () => {
      unbindReady();
      unbindPresenceUpdate();
      unbindUserUpdate();
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
      gatewayClient.disconnect();
    };
  }, [isAuthenticated, currentUser?.id]);

  // 10 分钟无操作自动离开 (AFK Auto-Idle) 检测
  useEffect(() => {
    if (!currentUser || !isAuthenticated) return;

    let afkTimer: any = null;
    let isAutoIdled = false;
    let previousStatus: UserStatus = currentUser.status || "ONLINE";

    const resetAfkTimer = () => {
      if (isAutoIdled) {
        isAutoIdled = false;
        // 恢复前置在线状态
        gatewayClient.updateStatus(previousStatus, currentUser.customStatus);
      }

      if (afkTimer) clearTimeout(afkTimer);

      const latestUser = useAuthStore.getState().user;
      if (latestUser && latestUser.status === "ONLINE") {
        afkTimer = setTimeout(() => {
          const u = useAuthStore.getState().user;
          if (u && u.status === "ONLINE") {
            isAutoIdled = true;
            previousStatus = "ONLINE";
            gatewayClient.updateStatus("IDLE", u.customStatus);
          }
        }, 10 * 60 * 1000); // 10分钟
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
  }, [currentUser?.id, isAuthenticated]);

  // 监听 LiveKit SFU 底层断开回调（服务器断线、异常掉线、多端冲突被踢时权威收敛状态并向网关上报）
  useEffect(() => {
    const unbindLiveKitDisconnect = livekitService.onDisconnected((reason) => {
      const channelId = activeVoiceChannelIdRef.current;
      if (!channelId) return;

      // 1 代表 DisconnectReason.CLIENT_INITIATED（用户主动挂断），由 handleLeaveVoiceChannel 正常清理
      const isClientInitiated =
        reason === 1 || String(reason).toLowerCase().includes("client_initiated");
      if (isClientInitiated) return;

      console.warn(
        `[LiveKit] Abnormal disconnection detected (reason: ${reason}), reconciling voice state with gateway...`,
      );

      // 1. 查找当前语音频道所属的真实 guildId
      const currentChannel = guildsRef.current
        .flatMap((g) => g.channels)
        .find((c) => c.id === channelId);
      const targetGuildId = currentChannel?.guildId || selectedGuildIdRef.current;

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
      sframeManager.disable();
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
          if (selectedGuildIdRef.current && activeVoiceChannelIdRef.current) {
            gatewayClient.updateVoiceState(
              selectedGuildIdRef.current,
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

    const unbindSpeakers = livekitService.onActiveSpeakersChange((speakers) => {
      setActiveSpeakers([...speakers]);
    });

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
      unbindConnStatus?.();
    };
  }, [guilds, isScreenSharing]);

  // 切换文字或私信频道拉取历史消息
  useEffect(() => {
    if (selectedChannel && selectedChannel.type !== "VOICE") {
      const token = localStorage.getItem("tescord_access_token");
      fetch(`${API_BASE}/api/channels/${selectedChannel.id}/messages`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`读取消息失败 (${res.status})`);
          const data = (await res.json()) as Message[];
          setMessages(data);
          if (selectedChannel.type === "DM") {
            const lastReadSequence = data.reduce(
              (max, message) => Math.max(max, message.sequence || 0),
              0,
            );
            await fetch(`${API_BASE}/api/channels/${selectedChannel.id}/read`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ lastReadSequence }),
            });
            setDmChannels((current) =>
              current.map((channel) =>
                channel.id === selectedChannel.id
                  ? { ...channel, unreadCount: 0 }
                  : channel,
              ),
            );
          }
        })
        .catch((err) => console.error("Failed to fetch messages:", err));
    }
  }, [selectedChannel?.id]);

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
      await fetch(`${API_BASE}/api/channels/${selectedChannel.id}/messages`, {
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
      });
    } catch (err) {
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
    if (
      !window.confirm(`确定要删除频道 #${channel.name} 吗？此操作无法撤销。`)
    ) {
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
        if (selectedChannel?.id === channel.id) {
          const guild = guilds.find((g) => g.id === channel.guildId);
          const remaining =
            guild?.channels.filter((c) => c.id !== channel.id) || [];
          setSelectedChannel(remaining.length > 0 ? remaining[0] : null);
        }
      }
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  };

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
    setGuilds((prev) =>
      prev.map((g) => ({
        ...g,
        channels: g.channels.filter((c) => c.id !== channelId),
      })),
    );
    if (selectedChannel?.id === channelId) {
      const remaining = currentChannels.filter((c) => c.id !== channelId);
      setSelectedChannel(remaining.length > 0 ? remaining[0] : null);
    }
  };

  // 业务：退出公会 (右键菜单调用)
  const handleLeaveGuild = async (guild: Guild) => {
    if (!window.confirm(`确定要退出服务器 "${guild.name}" 吗？`)) {
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
        setGuilds((prev) => prev.filter((g) => g.id !== guild.id));
        if (selectedGuildId === guild.id) {
          const remaining = guilds.filter((g) => g.id !== guild.id);
          if (remaining.length > 0) {
            setSelectedGuildId(remaining[0].id);
            setSelectedChannel(remaining[0].channels[0] || null);
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
    if (!window.confirm(`确定要将成员 "${username}" 踢出服务器吗？`)) {
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
    if (!window.confirm(`确定要封禁成员 "${username}" 吗？`)) {
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

  // 业务：标记服务器为已读
  const handleMarkGuildAsRead = (guild: Guild) => {
    console.log(`服务器 ${guild.name} 标记为已读`);
  };

  // 业务：标记频道为已读
  const handleMarkChannelAsRead = (channel: Channel) => {
    console.log(`频道 #${channel.name} 标记为已读`);
  };

  // 加入语音频道
  const handleJoinVoiceChannel = async (channel: Channel) => {
    if (!currentUser) return;
    setVoiceTransferNotice(null);
    setActiveVoiceChannelId(channel.id);
    setSelectedChannel(channel);
    livekitService.setConnectionStatus("connecting");

    // 阶段五：语音端到端加密 (SFrame WebRTC E2EE)
    if (channel.isE2EE) {
      if (!sframeManager.getStats().enabled) {
        showGlobalToast("设备密钥尚未协商完成，已阻止未加密加入 E2EE 频道", "error");
        setActiveVoiceChannelId(null);
        livekitService.setConnectionStatus("disconnected");
        return;
      }
    } else {
      sframeManager.disable();
    }

    await audioEngine.initMicrophone();

    const bitrate = channel.bitrate || audioEngine.config.audioBitrate || 64000;
    const processedStream = audioEngine.getStream();

    let joinSuccess = false;
    const voiceMode = useSettingsStore.getState().voiceTransmissionMode;
    if (voiceMode === "p2p_mesh" && processedStream && channel.guildId) {
      gatewayClient.updateVoiceState(channel.guildId, channel.id, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: isVideoEnabled,
        streaming: isScreenSharing,
      });
      const otherMembers = voiceStates
        .filter((state) => state.channelId === channel.id && state.userId !== currentUser.id)
        .map((state) => state.userId);
      try {
        await voiceMeshManager.startVoiceMesh(channel.id, channel.guildId, processedStream, otherMembers);
        joinSuccess = otherMembers.length === 0 || await voiceMeshManager.waitForConnectedPeer(8_000);
        if (joinSuccess) livekitService.setConnectionStatus("connected");
      } catch (error) {
        console.warn("公会 Mesh P2P 协商失败，准备回退 SFU:", error);
      }
      if (!joinSuccess) voiceMeshManager.stopAll();
    }
    try {
      if (!joinSuccess) {
        const token = useAuthStore.getState().token;
        const res = await fetch(`${API_BASE}/api/livekit/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            roomName: channel.id,
            identity: currentUser.id,
            name: currentUser.username,
            bitrate,
          }),
        });
        if (!res.ok) throw new Error("Failed to get guild media token");
        const data = await res.json();
        joinSuccess = await livekitService.joinRoom(
          data.url,
          data.token,
          channel.id,
          processedStream,
          bitrate,
        );
      }
    } catch (e) {
      console.error("Failed to join livekit room:", e);
      joinSuccess = false;
    }

    if (!joinSuccess) {
      console.warn("LiveKit 连接未成功，自动复位语音频道状态");
      audioEngine.stop();
      setActiveVoiceChannelId(null);
      return;
    }

    // 播放加入语音频道提示音
    soundManager.play("VOICE_JOIN");

    if (channel.guildId) {
      gatewayClient.updateVoiceState(channel.guildId, channel.id, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: isVideoEnabled,
        streaming: isScreenSharing,
      });
    }

  };

  // 取消正在进行的语音连接
  const handleCancelVoiceJoin = async () => {
    const cancellingChannelId = activeVoiceChannelId;
    setActiveVoiceChannelId(null);
    audioEngine.stop();
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
    if (!activeVoiceChannelId) return;

    const leavingChannelId = activeVoiceChannelId;

    if (isVideoEnabled) {
      await livekitService.setCameraEnabled(false);
      setIsVideoEnabled(false);
    }

    // 清理 SFrame 语音加密管线状态与纯语音 Mesh P2P
    sframeManager.disable();
    livekitService.setNegotiatedE2EEKey(null);
    voiceMeshManager.stopAll();
    audioEngine.stop();
    await livekitService.leaveRoom();

    // 播放退出语音频道提示音
    soundManager.play("VOICE_LEAVE");

    const currentChannel = guildsRef.current
      .flatMap((g) => g.channels)
      .find((c) => c.id === leavingChannelId);
    const targetGuildId = currentChannel?.guildId || selectedGuildId;

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
          d: { callId: activeDMCallRef.current.callId, reason: "hangup" },
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

    // 退出语音频道视角：自动平滑切换回当前公会的第一个/默认文字频道
    if (
      selectedGuildId &&
      (selectedChannel?.id === leavingChannelId ||
        selectedChannel?.type === "VOICE")
    ) {
      const defaultTextChannel =
        currentChannels.find((c) => c.type === "TEXT") || null;
      setSelectedChannel(defaultTextChannel);
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
      setSelectedChannel(dmChannel);
    } catch (err) {
      console.error("Failed to start DM:", err);
      showGlobalToast("发起私信会话失败", "error");
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
    if (!sframeManager.getStats().enabled) {
      showGlobalToast("E2EE 设备密钥尚未就绪，已阻止未加密媒体连接", "error");
      return;
    }
    setActiveVoiceChannelId(channelId);
    livekitService.setConnectionStatus("connecting");
    await audioEngine.initMicrophone();
    const bitrate = 64000;
    const processedStream = audioEngine.getStream();

    let joinSuccess = false;
    const dmChannel = dmChannels.find((candidate) => candidate.id === channelId) ||
      (selectedChannel?.id === channelId ? selectedChannel : null);
    const peerId = dmChannel?.recipients?.find((recipient) => recipient.id !== currentUser.id)?.id;

    // 1v1 默认先建立端到端加密的 WebRTC 直连；ICE 配置中包含自建 TURN，
    // 因此 host/srflx/relay 都属于 P2P 阶段。只有该阶段确认失败才进入 SFU。
    if (processedStream && peerId) {
      try {
        await voiceMeshManager.startVoiceMesh(channelId, "", processedStream, [peerId], callId);
        joinSuccess = await voiceMeshManager.waitForConnectedPeer(8_000);
        if (joinSuccess) livekitService.setConnectionStatus("connected");
      } catch (error) {
        console.warn("DM P2P/TURN 协商失败，准备回退 SFU:", error);
      }
    }

    if (!joinSuccess) voiceMeshManager.stopAll();
    try {
      if (!joinSuccess) {
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
        );
      }
    } catch (e) {
      console.error("Failed to join DM call:", e);
      joinSuccess = false;
    }

    if (!joinSuccess) {
      console.warn("LiveKit 连接未成功，自动复位呼叫状态");
      audioEngine.stop();
      setActiveVoiceChannelId(null);
      return;
    }

    soundManager.play("VOICE_JOIN");
    if (hasVideo) {
      handleToggleCamera();
    }
  };

  // 主动发起 1v1 私信呼叫
  const handleStartCall = (channelId: string, hasVideo: boolean) => {
    if (!currentUser) return;
    sframeManager.disable();
    livekitService.setNegotiatedE2EEKey(null);
    setCallEncryption({ status: "negotiating" });
    const ch = dmChannels.find((c) => c.id === channelId) || selectedChannel;
    if (!ch) return;
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_OFFER,
      d: {
        channelId,
        hasVideo,
      },
    });
  };

  // 接听呼叫
  const handleAcceptCall = async () => {
    if (!incomingCall) return;
    if (!sframeManager.getStats().enabled) {
      try {
        const token = useAuthStore.getState().token;
        if (!token) throw new Error("登录已失效");
        const envelope = await deviceKeyService.fetchMediaKey(incomingCall.channelId, incomingCall.callId, token);
        const negotiated = await deviceKeyService.openMediaKey(envelope);
        if (!negotiated) throw new Error("媒体密钥未发给当前设备");
        sframeManager.setNegotiatedKey(negotiated.key);
        livekitService.setNegotiatedE2EEKey(negotiated.key);
        setCallEncryption({ status: negotiated.trust, fingerprint: negotiated.fingerprint });
      } catch (error) {
        setCallEncryption({ status: "failed" });
        showGlobalToast(error instanceof Error ? error.message : "E2EE 密钥尚未就绪", "warning");
        return;
      }
    }
    const call = incomingCall;
    setIncomingCall(null);
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_ANSWER,
      d: {
        callId: call.callId,
      },
    });
    const ch = dmChannels.find((c) => c.id === call.channelId);
    if (ch) {
      setSelectedGuildId(null);
      setSelectedChannel(ch);
    }
    const activeCall = { callId: call.callId, channelId: call.channelId, hasVideo: call.hasVideo };
    activeDMCallRef.current = activeCall;
    setActiveDMCall(activeCall);
  };

  // 拒绝呼叫
  const handleRejectCall = () => {
    if (!incomingCall) return;
    const call = incomingCall;
    setIncomingCall(null);
    gatewayClient.send({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CALL_REJECT,
      d: {
        callId: call.callId,
      },
    });
  };

  // 切换静音
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioEngine.setMute(nextMuted);
    // 播放麦克风开/关提示音
    soundManager.play(nextMuted ? "MUTE" : "UNMUTE");
    if (selectedGuildId) {
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: nextMuted,
        selfDeaf: isDeafened,
        selfVideo: isVideoEnabled,
        streaming: isScreenSharing,
      });
    }
  };
  handleToggleMuteRef.current = handleToggleMute;

  // 切换拒听
  const handleToggleDeafen = () => {
    const nextDeafened = !isDeafened;
    setIsDeafened(nextDeafened);
    // 播放关闭/开启声音提示音
    soundManager.play(nextDeafened ? "DEAFEN" : "UNDEAFEN");
    if (!isMuted && nextDeafened) {
      setIsMuted(true);
      audioEngine.setMute(true);
    }
    if (selectedGuildId) {
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: nextDeafened ? true : isMuted,
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
    setIsVideoEnabled(nextVideo);
    if (selectedGuildId) {
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: nextVideo,
        streaming: isScreenSharing,
      });
    }
    try {
      await livekitService.setCameraEnabled(nextVideo);
    } catch (e) {
      console.warn("LiveKit camera toggle error:", e);
    }
  };

  // 切换 AI 降噪 (支持三档轮转：RNNoise 标准轻量 -> DTLN 深度消键盘音 -> 关闭)
  const handleToggleNoiseSuppression = () => {
    const currentMode = noiseSuppressionMode;

    let nextMode: NoiseSuppressionMode = "rnnoise";
    if (currentMode === "rnnoise") {
      nextMode = "dtln";
    } else if (currentMode === "dtln") {
      nextMode = "off";
    } else {
      nextMode = "rnnoise";
    }

    const nextEnabled = nextMode !== "off";
    setIsNoiseSuppressionEnabled(nextEnabled);
    setNoiseSuppressionMode(nextMode);
    audioEngine.setNoiseSuppressionMode(nextMode);
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
    setIsScreenSharing(false);
    setActiveScreenShare((prev) => (prev?.isLocal ? null : prev));

    try {
      await livekitService.stopScreenShare();
    } catch (err) {
      console.warn("livekit stopScreenShare error:", err);
    }

    try {
      p2pStreamManager.stopAll();
    } catch (err) {
      console.warn("p2p stopAll error:", err);
    }

    const targetGuildId = selectedGuildIdRef.current || selectedGuildId;
    const targetChannelId =
      activeVoiceChannelIdRef.current || activeVoiceChannelId;

    if (targetGuildId && targetChannelId) {
      gatewayClient.updateVoiceState(targetGuildId, targetChannelId, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: isVideoEnabled,
        streaming: false,
        streamMode: "sfu",
      });
    }

    showGlobalToast("已停止屏幕直播", "info");
  }, [
    selectedGuildId,
    activeVoiceChannelId,
    isMuted,
    isDeafened,
    isVideoEnabled,
    showGlobalToast,
  ]);

  // 切换屏幕分享 (打开选择弹窗或停止分享)
  const handleToggleScreenShare = async () => {
    if (!activeVoiceChannelId || !selectedGuildId) return;
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
    if (!activeVoiceChannelId || !selectedGuildId) return;

    const preset =
      SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS["1080p60"];

    try {
      let stream: MediaStream;
      let fellBackToVideoOnly = false;

      if (sourceId && window.electronAPI) {
        const constraints: any = {
          audio: captureAudio
            ? {
                mandatory: {
                  chromeMediaSource: "desktop",
                },
              }
            : false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              minWidth: preset.width,
              maxWidth: preset.width,
              minHeight: preset.height,
              maxHeight: preset.height,
              minFrameRate: preset.frameRate,
              maxFrameRate: preset.frameRate,
            },
          },
        };
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (desktopErr: any) {
          if (captureAudio) {
            console.warn(
              "桌面端伴音捕获失败，自动降级为纯画面推流:",
              desktopErr,
            );
            constraints.audio = false;
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            fellBackToVideoOnly = true;
          } else {
            throw desktopErr;
          }
        }
      } else {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };

        const displayMediaOptions: any = {
          video: {
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate, max: preset.frameRate },
          },
          audio: captureAudio ? audioConstraints : false,
          // W3C Screen Capture Extensions
          systemAudio: captureAudio ? "include" : "exclude",
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
        };

        try {
          stream =
            await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } catch (mediaErr: any) {
          // 用户主动取消授权或关闭原生选择弹窗
          if (
            mediaErr?.name === "NotAllowedError" ||
            mediaErr?.name === "AbortError"
          ) {
            throw mediaErr;
          }

          // 捕获伴音启动失败（NotReadableError: Could not start audio source 等）
          const isAudioSourceError =
            captureAudio &&
            (mediaErr?.name === "NotReadableError" ||
              mediaErr?.name === "TrackStartError" ||
              mediaErr?.name === "OverconstrainedError" ||
              (typeof mediaErr?.message === "string" &&
                mediaErr.message.toLowerCase().includes("audio")));

          if (isAudioSourceError) {
            console.warn(
              "⚠️ 浏览器伴音源启动失败(声卡独占/驱动限制/窗口不支持伴音)，自动无缝降级为纯画面推流:",
              mediaErr,
            );
            const fallbackOptions = {
              video: displayMediaOptions.video,
              audio: false,
              systemAudio: "exclude",
              selfBrowserSurface: "exclude",
              surfaceSwitching: "include",
            };
            stream =
              await navigator.mediaDevices.getDisplayMedia(fallbackOptions);
            fellBackToVideoOnly = true;
          } else {
            throw mediaErr;
          }
        }
      }

      // 如果发生了伴音降级，给用户醒目 Toast 提示
      if (fellBackToVideoOnly) {
        showGlobalToast(
          "⚠️ 系统伴音未能启动（声卡可能被独占或窗口不支持伴音），已自动降级为纯画面直播",
          "warning",
          6000,
        );
      }

      const actualHasAudioTrack = stream.getAudioTracks().length > 0;

      if (
        transmissionMode === "p2p_direct" ||
        transmissionMode === "p2p_relay"
      ) {
        await p2pStreamManager.startBroadcasting(
          activeVoiceChannelId,
          selectedGuildId,
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
        await livekitService.startScreenShareWithStream(stream, {
          sourceId: sourceId || undefined,
          preset: presetId,
          captureAudio: actualHasAudioTrack,
          simulcast: true,
          videoCodec,
          customBitrate,
        });
      }

      setIsScreenSharing(true);
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: isVideoEnabled,
        streaming: true,
        streamMode: transmissionMode,
      });
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
        console.info("用户取消了屏幕共享授权");
        return;
      }
      console.error("Failed to start screen share:", err);
      showGlobalToast(`屏幕分享失败: ${err?.message || "未知错误"}`, "error");
    }
  };

  // 观众端 P2P 穿透受阻时一键切换回服务器中继模式
  const handleP2PFallbackToSFU = () => {
    p2pStreamManager.stopAll();
    if (activeVoiceChannelId) {
      gatewayClient.sendRaw({
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.P2P_FALLBACK_REQUEST,
        d: { channelId: activeVoiceChannelId },
      });
      showGlobalToast("已切换为服务器中继 (LiveKit SFU) 模式观看", "info");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen w-screen bg-[#1e1f22]">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center flex-col">
          <div className="relative flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-discord-brand/30 border-t-discord-brand rounded-full animate-spin" />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-400 animate-pulse">
            正在载入 Tescord 个人资料与离线数据...
          </p>
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
        .find((c) => c.id === activeVoiceChannelId) || null
    : null;

  const renderSidebarElements = (isDrawer: boolean = false) => (
    <>
      {/* 1. 最左侧公会导航侧栏 */}
      <Sidebar
        guilds={guilds}
        selectedGuildId={selectedGuildId}
        isSuperAdmin={currentUser?.role === "SUPER_ADMIN"}
        onOpenAdminDashboard={() => setIsAdminModalOpen(true)}
        onSelectGuild={(id) => {
          setSelectedGuildId(id);
          if (id === null) {
            if (dmChannels.length > 0) {
              setSelectedChannel(dmChannels[0]);
            } else {
              setSelectedChannel(null);
            }
          } else {
            const g = guilds.find((item) => item.id === id);
            if (g && g.channels.length > 0) {
              setSelectedChannel(g.channels[0]);
            }
          }
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
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
        channels={currentChannels}
        dmChannels={dmChannels}
        onCloseDMChannel={handleCloseDMChannel}
        onDMChannelCreated={(ch) => {
          setDmChannels((prev) => [ch, ...prev.filter((c) => c.id !== ch.id)]);
          setSelectedGuildId(null);
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
        onSelectChannel={(ch) => {
          setSelectedChannel(ch);
          if (ch.type === "DM" || !ch.guildId) {
            setDmChannels((prev) =>
              prev.map((dm) =>
                dm.id === ch.id ? { ...dm, unreadCount: 0 } : dm,
              ),
            );
          }
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
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
      />
    </>
  );

  return (
    <div className="flex flex-col h-dvh h-[var(--visual-viewport-height,100dvh)] w-screen overflow-hidden bg-discord-chat relative">
      {/* 顶部自定义标题栏 (仅在 Electron 桌面环境下展示，Web 端自动隐藏) */}
      <TitleBar />

      {/* Discord 风格网关长连接状态指示条 */}
      <GatewayConnectionBanner />

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
            <span>[{systemBroadcast.title || "系统公告"}] {systemBroadcast.content}</span>
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
              voiceConnectionStatus === "connected"
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
            onLeave={handleLeaveVoiceChannel}
            onJoin={() => handleJoinVoiceChannel(selectedChannel)}
            onCancelJoin={handleCancelVoiceJoin}
            onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
            onOpenVideoSettings={() => handleOpenUserSettings("audio", "video")}
          />
        ) : selectedChannel ? (
          <ChatArea
            channel={selectedChannel}
            guild={currentGuild}
            messages={messages}
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
            callEncryption={activeDMCall?.channelId === selectedChannel.id ? callEncryption : undefined}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-discord-textMuted p-4 text-center">
            {isMobile && (
              <button
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
              onClick={() => setIsMobileMemberOpen(false)}
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
                  onClick={() => setIsMobileMemberOpen(false)}
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
          if (newGuild.channels && newGuild.channels.length > 0) {
            setSelectedChannel(newGuild.channels[0]);
          }
        }}
        onOpenJoinModal={() => setIsJoinGuildOpen(true)}
      />

      {/* 8. 加入服务器弹窗 */}
      <JoinGuildModal
        isOpen={isJoinGuildOpen}
        onClose={() => setIsJoinGuildOpen(false)}
        onGuildJoined={(guildId) => {
          refreshGuilds();
          setSelectedGuildId(guildId);
        }}
        onOpenCreateModal={() => setIsCreateGuildOpen(true)}
      />

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
            setGuilds((prev) => prev.map((guild) => {
              if (guild.id !== newChannel.guildId) return guild;
              const exists = guild.channels.some((channel) => channel.id === newChannel.id);
              return {
                ...guild,
                channels: exists
                  ? guild.channels.map((channel) => channel.id === newChannel.id ? newChannel : channel)
                  : [...guild.channels, newChannel],
              };
            }));
            setSelectedChannel(newChannel);
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
                      categories: [...(g.categories || []), newCat],
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
          setGuilds((prev) => prev.filter((g) => g.id !== deletedGuildId));
          if (selectedGuildId === deletedGuildId) {
            const remaining = guilds.filter((g) => g.id !== deletedGuildId);
            if (remaining.length > 0) {
              setSelectedGuildId(remaining[0].id);
              setSelectedChannel(remaining[0].channels[0] || null);
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

      {/* 14. 全局浮动 Toast 提示（伴音降级提示、异常反馈等） */}
      {globalToast && (
        <div
          data-testid="global-toast"
          className={`fixed top-12 left-1/2 -translate-x-1/2 z-[9999] max-w-[90vw] sm:max-w-md px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2.5 text-sm font-medium animate-in fade-in slide-in-from-top-4 duration-200 border backdrop-blur-md ${
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
    </div>
  );
};
