import React, { useState, useEffect, useRef } from "react";
import {
  Channel,
  Guild,
  Message,
  VoiceState,
  Attachment,
} from "@tescord/types";
import { Sidebar } from "./components/Sidebar.js";
import { ChannelSidebar } from "./components/ChannelSidebar.js";
import { ChatArea } from "./components/ChatArea.js";
import { VoiceRoomArea } from "./components/VoiceRoomArea.js";
import { MemberList } from "./components/MemberList.js";
import { AudioSettingsModal } from "./components/AudioSettingsModal.js";
import { AuthModal } from "./components/auth/AuthModal.js";
import { UserSettingsModal } from "./components/settings/UserSettingsModal.js";
import { CreateGuildModal } from "./components/modals/CreateGuildModal.js";
import { JoinGuildModal } from "./components/modals/JoinGuildModal.js";
import { CreateChannelModal } from "./components/modals/CreateChannelModal.js";
import { ScreenShareModal } from "./components/modals/ScreenShareModal.js";
import { FloatingPiP } from "./components/FloatingPiP.js";
import { useAuthStore } from "./stores/useAuthStore.js";
import { gatewayClient } from "./services/gateway.js";
import { audioEngine } from "./services/audioEngine.js";
import { livekitService, ActiveScreenShare } from "./services/livekit.js";
import { audioMixer } from "./services/audioMixer.js";
import { doubleRatchetManager } from "./services/doubleRatchet.js";
import { sframeManager } from "./services/sframe.js";
import { soundManager } from "./services/soundManager.js";
import { SCREEN_SHARE_PRESETS } from "@tescord/types";
import { API_BASE } from "./config.js";
import { useViewport } from "./hooks/useViewport.js";
import { useSwipeGesture } from "./hooks/useSwipeGesture.js";

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

  // 移动端左右滑动呼出与收起抽屉手势
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
        if (isMobile && selectedChannel?.type === "TEXT") {
          setIsMobileMemberOpen(true);
          setIsMobileDrawerOpen(false);
        }
      },
      onCloseRightDrawer: () => {
        if (isMobile) setIsMobileMemberOpen(false);
      },
      isLeftDrawerOpen: isMobileDrawerOpen,
      isRightDrawerOpen: isMobileMemberOpen,
    },
    isMobile,
  );
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceStates, setVoiceStates] = useState<VoiceState[]>([]);

  // 音频与多媒体状态
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeScreenShare, setActiveScreenShare] =
    useState<ActiveScreenShare | null>(null);
  const [showFloatingPiP, setShowFloatingPiP] = useState(true);
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] =
    useState(true);
  const [showMemberList, setShowMemberList] = useState(true);

  // 内部引用，保证长存事件与异步回调中始终读取最新状态
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  activeVoiceChannelIdRef.current = activeVoiceChannelId;
  const selectedGuildIdRef = useRef<string | null>(null);
  selectedGuildIdRef.current = selectedGuildId;
  const selectedChannelRef = useRef<Channel | null>(null);
  selectedChannelRef.current = selectedChannel;
  const isMutedRef = useRef<boolean>(false);
  isMutedRef.current = isMuted;
  const handleToggleMuteRef = useRef<() => void>(() => {});

  // 模态框显隐状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const [isCreateGuildOpen, setIsCreateGuildOpen] = useState(false);
  const [isJoinGuildOpen, setIsJoinGuildOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);

  // 初始化鉴权状态
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // 全局屏蔽浏览器原生右键菜单，按住 Shift+右键 可呼出原生菜单作为逃生通道
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      if (e.shiftKey) {
        return; // Shift+右键 开发者逃生通道
      }
      e.preventDefault();
    };

    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  // 拉取公会列表
  const refreshGuilds = () => {
    fetch(`${API_BASE}/api/guilds`)
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

  // 当用户鉴权登入后建立连接
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    refreshGuilds();
    window.electronAPI?.syncUserStatus(currentUser.status);

    // 初始化端到端双棘轮身份密钥对并同步 PreKeyBundle
    const token = localStorage.getItem("tescord_access_token") || undefined;
    doubleRatchetManager.init(currentUser.id, token);

    // 连接 WebSocket 网关
    gatewayClient.connect(currentUser.id);

    // 监听网关信令事件
    const unbindReady = gatewayClient.on("READY", (data) => {
      if (data.guilds) setGuilds(data.guilds);
      if (data.voiceStates) setVoiceStates(data.voiceStates);
    });

    const unbindMsgCreate = gatewayClient.on(
      "MESSAGE_CREATE",
      (msg: Message) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

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
        setGuilds((prev) => [...prev, newGuild]);
      },
    );

    const unbindChannelCreate = gatewayClient.on(
      "CHANNEL_CREATE",
      (newChannel: Channel) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === newChannel.guildId
              ? { ...g, channels: [...g.channels, newChannel] }
              : g,
          ),
        );
        if (newChannel.guildId === selectedGuildIdRef.current) {
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

    const unbindMemberRemove = gatewayClient.on(
      "GUILD_MEMBER_REMOVE",
      (data: { guildId: string; userId: string }) => {
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === data.guildId
              ? {
                  ...g,
                  members: g.members?.filter((m) => m.userId !== data.userId) || [],
                }
              : g,
          ),
        );
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
          if (existingIndex !== -1 && prev[existingIndex].channelId === vs.channelId) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...vs };
            return next;
          }

          // 3. 新加入成员或切换频道：先过滤旧状态，再追加到新频道列表中
          return [...prev.filter((p) => p.userId !== vs.userId), vs];
        });
      },
    );

    return () => {
      unbindReady();
      unbindMsgCreate();
      unbindMsgDelete();
      unbindReactionAdd();
      unbindReactionRemove();
      unbindPinUpdate();
      unbindGuildCreate();
      unbindChannelCreate();
      unbindChannelDelete();
      unbindChannelUpdate();
      unbindMemberRemove();
      unbindVoice();
      gatewayClient.disconnect();
    };
  }, [isAuthenticated, currentUser?.id]);

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

    const unbindTray = window.electronAPI?.onStatusChangeFromTray((newStatus) => {
      useAuthStore.getState().updateProfile({ status: newStatus });
    });

    const unbindShare = livekitService.onScreenShareChange((share) => {
      setActiveScreenShare(share);
      if (share) {
        setShowFloatingPiP(true);
      }
      if (share?.isLocal) {
        setIsScreenSharing(true);
      } else if (!share && isScreenSharing) {
        setIsScreenSharing(false);
      }
    });

    return () => {
      unbindNotif?.();
      unbindGlobalMute?.();
      unbindTray?.();
      unbindShare?.();
    };
  }, [guilds, isScreenSharing]);

  // 切换文字频道拉取历史消息
  useEffect(() => {
    if (selectedChannel && selectedChannel.type === "TEXT") {
      const token = localStorage.getItem("tescord_access_token");
      fetch(`${API_BASE}/api/channels/${selectedChannel.id}/messages`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
        .then((res) => res.json())
        .then((data: Message[]) => setMessages(data))
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
    if (!window.confirm(`确定要删除频道 #${channel.name} 吗？此操作无法撤销。`)) {
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

  // 业务：编辑频道名称与信息 (右键菜单调用)
  const handleEditChannel = async (channel: Channel) => {
    const newName = window.prompt("请输入新的频道名称：", channel.name);
    if (!newName || !newName.trim() || newName.trim() === channel.name) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setGuilds((prev) =>
          prev.map((g) =>
            g.id === channel.guildId
              ? {
                  ...g,
                  channels: g.channels.map((c) =>
                    c.id === channel.id ? updated : c,
                  ),
                }
              : g,
          ),
        );
        if (selectedChannel?.id === channel.id) {
          setSelectedChannel(updated);
        }
      }
    } catch (err) {
      console.error("Failed to update channel:", err);
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
    setActiveVoiceChannelId(channel.id);
    setSelectedChannel(channel);

    // 阶段五：语音端到端加密 (SFrame WebRTC E2EE)
    if (channel.isE2EE) {
      await sframeManager.deriveRoomKey(channel.id);
    } else {
      sframeManager.disable();
    }

    await audioEngine.initMicrophone();

    const bitrate = channel.bitrate || audioEngine.config.audioBitrate || 64000;
    const processedStream = audioEngine.getStream();

    try {
      const res = await fetch(`${API_BASE}/api/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: channel.id,
          identity: currentUser.id,
          name: currentUser.username,
          bitrate,
        }),
      });
      const data = await res.json();
      await livekitService.joinRoom(
        data.url,
        data.token,
        channel.id,
        processedStream,
        bitrate,
      );
    } catch (e) {
      console.error("Failed to join livekit room:", e);
    }

    // 播放加入语音频道提示音
    soundManager.play("VOICE_JOIN");

    gatewayClient.updateVoiceState(channel.guildId, channel.id, {
      selfMute: isMuted,
      selfDeaf: isDeafened,
      selfVideo: false,
      streaming: isScreenSharing,
    });
  };

  // 离开语音频道
  const handleLeaveVoiceChannel = async () => {
    if (!activeVoiceChannelId || !selectedGuildId) return;

    const leavingChannelId = activeVoiceChannelId;

    // 清理 SFrame 语音加密管线状态
    sframeManager.disable();
    audioEngine.stop();
    await livekitService.leaveRoom();

    // 播放退出语音频道提示音
    soundManager.play("VOICE_LEAVE");

    gatewayClient.updateVoiceState(selectedGuildId, null, {
      selfMute: isMuted,
      selfDeaf: isDeafened,
      selfVideo: false,
      streaming: false,
    });

    setActiveVoiceChannelId(null);
    setIsSpeaking(false);
    setIsScreenSharing(false);

    // 退出语音频道视角：自动平滑切换回当前公会的第一个/默认文字频道
    if (selectedChannel?.id === leavingChannelId || selectedChannel?.type === "VOICE") {
      const defaultTextChannel = currentChannels.find((c) => c.type === "TEXT") || null;
      setSelectedChannel(defaultTextChannel);
    }
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
        selfVideo: false,
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
        selfVideo: false,
        streaming: isScreenSharing,
      });
    }
  };

  // 切换 AI 降噪
  const handleToggleNoiseSuppression = () => {
    const nextVal = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionEnabled(nextVal);
    audioEngine.updateConfig({ noiseSuppression: nextVal });
  };

  // 切换屏幕分享 (打开选择弹窗或停止分享)
  const handleToggleScreenShare = async () => {
    if (!activeVoiceChannelId || !selectedGuildId) return;
    if (isScreenSharing || activeScreenShare?.isLocal) {
      await livekitService.stopScreenShare();
      setIsScreenSharing(false);
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: false,
        streaming: false,
      });
    } else {
      setIsScreenShareModalOpen(true);
    }
  };

  // 4.1 & 4.2 从弹窗启动屏幕推流、Simulcast 与伴音混音
  const handleStartScreenShare = async (
    sourceId: string | null,
    presetId: string,
    captureAudio: boolean,
  ) => {
    if (!activeVoiceChannelId || !selectedGuildId) return;

    const preset =
      SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS["1080p60"];

    try {
      let stream: MediaStream;
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
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate, max: preset.frameRate },
          },
          audio: captureAudio,
        });
      }

      // 4.2 若捕获了系统游戏伴音，在客户端与麦克风进行立体声混音
      let hasMixedAudio = false;
      if (captureAudio && stream.getAudioTracks().length > 0) {
        const micStream = audioEngine.getStream();
        const mixedStream = audioMixer.mixStreams(micStream, stream);
        if (mixedStream && mixedStream.getAudioTracks().length > 0) {
          const rawAudioTrack = stream.getAudioTracks()[0];
          stream.removeTrack(rawAudioTrack);
          stream.addTrack(mixedStream.getAudioTracks()[0]);
          hasMixedAudio = true;
        }
      }

      await livekitService.startScreenShareWithStream(stream, {
        sourceId: sourceId || undefined,
        preset: presetId,
        captureAudio,
        simulcast: true,
        mixedAudio: hasMixedAudio,
      });

      setIsScreenSharing(true);
      gatewayClient.updateVoiceState(selectedGuildId, activeVoiceChannelId, {
        selfMute: isMuted,
        selfDeaf: isDeafened,
        selfVideo: false,
        streaming: true,
      });
    } catch (err) {
      console.error("Failed to start screen share:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#1e1f22] flex-col">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-discord-brand/30 border-t-discord-brand rounded-full animate-spin" />
        </div>
        <p className="mt-4 text-sm font-medium text-gray-400 animate-pulse">
          正在载入 Tescord 个人资料与离线数据...
        </p>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return <AuthModal />;
  }

  const renderSidebarElements = (isDrawer: boolean = false) => (
    <>
      {/* 1. 最左侧公会导航侧栏 */}
      <Sidebar
        guilds={guilds}
        selectedGuildId={selectedGuildId}
        onSelectGuild={(id) => {
          setSelectedGuildId(id);
          const g = guilds.find((item) => item.id === id);
          if (g && g.channels.length > 0) {
            setSelectedChannel(g.channels[0]);
          }
          if (isDrawer) {
            setIsMobileDrawerOpen(false);
          }
        }}
        onOpenCreateGuild={() => setIsCreateGuildOpen(true)}
        onOpenJoinGuild={() => setIsJoinGuildOpen(true)}
        onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
        onOpenServerSettings={() => setIsSettingsOpen(true)}
        onLeaveGuild={handleLeaveGuild}
        onMarkGuildAsRead={handleMarkGuildAsRead}
      />

      {/* 2. 次级频道列表与底部控制栏 */}
      <ChannelSidebar
        guild={currentGuild}
        channels={currentChannels}
        selectedChannelId={selectedChannel?.id || ""}
        activeVoiceChannelId={activeVoiceChannelId}
        voiceStates={voiceStates}
        currentUser={currentUser}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isSpeaking={isSpeaking}
        isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
        onSelectChannel={(ch) => {
          setSelectedChannel(ch);
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenUserSettings={() => setIsUserSettingsOpen(true)}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
        onDeleteChannel={handleDeleteChannel}
        onEditChannel={handleEditChannel}
        onOpenServerSettings={() => setIsSettingsOpen(true)}
        onLeaveGuild={handleLeaveGuild}
        onMarkGuildAsRead={handleMarkGuildAsRead}
        onMarkChannelAsRead={handleMarkChannelAsRead}
      />
    </>
  );

  return (
    <div className="flex h-dvh h-[var(--visual-viewport-height,100dvh)] w-screen overflow-hidden bg-discord-chat relative">
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
          isConnected={activeVoiceChannelId === selectedChannel.id}
          isMuted={isMuted}
          isSpeaking={isSpeaking}
          isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
          isScreenSharing={isScreenSharing}
          onToggleMute={handleToggleMute}
          onToggleScreenShare={handleToggleScreenShare}
          onToggleNoiseSuppression={handleToggleNoiseSuppression}
          onLeave={handleLeaveVoiceChannel}
          onJoin={() => handleJoinVoiceChannel(selectedChannel)}
          onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
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
          showMemberList={showMemberList}
          onToggleMemberList={() => setShowMemberList(!showMemberList)}
          onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
          onToggleMobileMemberList={() =>
            setIsMobileMemberOpen((prev) => !prev)
          }
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

      {/* 桌面端右侧成员列表 */}
      {!isMobile && showMemberList && selectedChannel?.type === "TEXT" && (
        <MemberList
          guild={currentGuild}
          currentUser={currentUser}
          onKickMember={handleKickMember}
          onBanMember={handleBanMember}
        />
      )}

      {/* 移动端右侧成员抽屉 */}
      {isMobile && isMobileMemberOpen && selectedChannel?.type === "TEXT" && (
        <div className="fixed inset-0 z-40 flex justify-end md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setIsMobileMemberOpen(false)}
          />
          <div className="relative z-10 h-full w-72 max-w-[80vw] shadow-2xl animate-slide-left bg-discord-channelList border-l border-[#3f4147]">
            <MemberList
              guild={currentGuild}
              currentUser={currentUser}
              onKickMember={handleKickMember}
              onBanMember={handleBanMember}
            />
          </div>
        </div>
      )}

      {/* 5. 语音与智能降噪设置弹窗 */}
      <AudioSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isInCall={!!activeVoiceChannelId}
      />

      {/* 6. 用户个人中心弹窗 */}
      <UserSettingsModal
        isOpen={isUserSettingsOpen}
        onClose={() => setIsUserSettingsOpen(false)}
      />

      {/* 7. 创建服务器弹窗 */}
      <CreateGuildModal
        isOpen={isCreateGuildOpen}
        onClose={() => setIsCreateGuildOpen(false)}
        onGuildCreated={(newGuild) => {
          setGuilds((prev) => [...prev, newGuild]);
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
          onClose={() => setIsCreateChannelOpen(false)}
          onChannelCreated={(newChannel) => {
            setGuilds((prev) =>
              prev.map((g) =>
                g.id === newChannel.guildId
                  ? { ...g, channels: [...g.channels, newChannel] }
                  : g,
              ),
            );
            setSelectedChannel(newChannel);
          }}
        />
      )}

      {/* 10. 阶段四：屏幕分享与窗口选择弹窗 */}
      <ScreenShareModal
        isOpen={isScreenShareModalOpen}
        onClose={() => setIsScreenShareModalOpen(false)}
        onStartShare={handleStartScreenShare}
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
    </div>
  );
};
