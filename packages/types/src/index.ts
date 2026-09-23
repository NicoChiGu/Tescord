// ==========================================
// Tescord 统一协议与核心数据类型定义 (Contracts)
// ==========================================

// 1. 用户模型与鉴权体系
export type UserStatus = "ONLINE" | "IDLE" | "DND" | "OFFLINE" | "INVISIBLE";

export type SystemRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export type ActivityType = "PLAYING" | "STREAMING" | "LISTENING" | "WATCHING" | "CUSTOM";

export interface Activity {
  name: string;
  type: ActivityType;
  details?: string;
  state?: string;
  applicationId?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    largeImage?: string;
    largeText?: string;
    smallImage?: string;
    smallText?: string;
  };
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  status: UserStatus;
  customStatus?: string | null;
  bio?: string | null;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  themeColor?: string | null;
  showActivity?: boolean;
  activities?: Activity[];
  role?: SystemRole;
  isBanned?: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  token: string; // 兼容旧接口 token === accessToken
  accessToken: string;
  refreshToken: string;
}

export interface RegisterDTO {
  username: string;
  email: string;
  password: string;
}

export interface LoginDTO {
  emailOrUsername: string;
  password: string;
}

export interface RefreshTokenDTO {
  refreshToken: string;
}

export interface UpdateProfileDTO {
  username?: string;
  avatarUrl?: string | null;
  customStatus?: string | null;
  bio?: string | null;
  status?: UserStatus;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  themeColor?: string | null;
  showActivity?: boolean;
}

// 2. 位掩码权限体系与角色 (Bitwise Permissions & Roles)
export enum PermissionFlags {
  CREATE_INVITE = 1 << 0, // 0x00000001
  KICK_MEMBERS = 1 << 1, // 0x00000002
  BAN_MEMBERS = 1 << 2, // 0x00000004
  ADMINISTRATOR = 1 << 3, // 0x00000008 (拥有全部权限)
  MANAGE_CHANNELS = 1 << 4, // 0x00000010
  MANAGE_GUILD = 1 << 5, // 0x00000020
  ADD_REACTIONS = 1 << 6, // 0x00000040
  VIEW_AUDIT_LOG = 1 << 7, // 0x00000080
  VIEW_CHANNEL = 1 << 10, // 0x00000400
  SEND_MESSAGES = 1 << 11, // 0x00000800
  MANAGE_MESSAGES = 1 << 13, // 0x00002000
  ATTACH_FILES = 1 << 15, // 0x00008000
  READ_MESSAGE_HISTORY = 1 << 16, // 0x00010000
  CONNECT = 1 << 20, // 0x00100000
  SPEAK = 1 << 21, // 0x00200000
  MUTE_MEMBERS = 1 << 22, // 0x00400000
  DEAFEN_MEMBERS = 1 << 23, // 0x00800000
  MOVE_MEMBERS = 1 << 24, // 0x01000000
  STREAM = 1 << 25, // 0x02000000
  MANAGE_ROLES = 1 << 26, // 0x04000000
  CHANGE_NICKNAME = 1 << 27, // 0x08000000
  MANAGE_NICKNAMES = 1 << 28, // 0x10000000
}

export interface PermissionDefinition {
  flag: PermissionFlags;
  name: string;
  description: string;
  category: "GENERAL" | "MEMBERSHIP" | "TEXT" | "VOICE" | "ADVANCED";
}

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  // 通用管理
  {
    flag: PermissionFlags.VIEW_AUDIT_LOG,
    name: "查看审计日志",
    description: "允许成员查看服务器管理操作的记录流水。",
    category: "GENERAL",
  },
  {
    flag: PermissionFlags.MANAGE_GUILD,
    name: "管理服务器",
    description: "允许成员修改服务器名称、更换图标和全局设置。",
    category: "GENERAL",
  },
  {
    flag: PermissionFlags.MANAGE_ROLES,
    name: "管理角色",
    description: "允许成员创建新角色并编辑低于此职级的角色与权限。",
    category: "GENERAL",
  },
  {
    flag: PermissionFlags.MANAGE_CHANNELS,
    name: "管理频道",
    description: "允许成员创建、编辑或删除频道与分类。",
    category: "GENERAL",
  },
  // 成员处置与邀请
  {
    flag: PermissionFlags.KICK_MEMBERS,
    name: "踢出成员",
    description: "允许成员将低于此职级的成员移出此服务器。",
    category: "MEMBERSHIP",
  },
  {
    flag: PermissionFlags.BAN_MEMBERS,
    name: "封禁成员",
    description: "允许成员将低于此职级的成员永久封禁并列入黑名单。",
    category: "MEMBERSHIP",
  },
  {
    flag: PermissionFlags.CREATE_INVITE,
    name: "创建邀请",
    description: "允许成员创建服务器邀请码邀请新用户加入。",
    category: "MEMBERSHIP",
  },
  {
    flag: PermissionFlags.CHANGE_NICKNAME,
    name: "修改昵称",
    description: "允许成员修改自己在服务器内的专属昵称。",
    category: "MEMBERSHIP",
  },
  {
    flag: PermissionFlags.MANAGE_NICKNAMES,
    name: "管理昵称",
    description: "允许成员修改其他成员的昵称。",
    category: "MEMBERSHIP",
  },
  // 文本频道权限
  {
    flag: PermissionFlags.VIEW_CHANNEL,
    name: "查看频道",
    description: "允许成员查看频道列表并阅读文本频道内容。",
    category: "TEXT",
  },
  {
    flag: PermissionFlags.SEND_MESSAGES,
    name: "发送消息",
    description: "允许成员在文字频道中发送消息。",
    category: "TEXT",
  },
  {
    flag: PermissionFlags.ATTACH_FILES,
    name: "发送附件",
    description: "允许成员在文字频道中上传图片、文件或媒体附件。",
    category: "TEXT",
  },
  {
    flag: PermissionFlags.ADD_REACTIONS,
    name: "添加反应",
    description: "允许成员在已有消息上添加表情反应。",
    category: "TEXT",
  },
  {
    flag: PermissionFlags.READ_MESSAGE_HISTORY,
    name: "阅读历史消息",
    description: "允许成员查看频道过去的聊天记录。",
    category: "TEXT",
  },
  {
    flag: PermissionFlags.MANAGE_MESSAGES,
    name: "管理消息",
    description: "允许成员删除或置顶其他成员发送的消息。",
    category: "TEXT",
  },
  // 语音频道权限
  {
    flag: PermissionFlags.CONNECT,
    name: "连接语音",
    description: "允许成员加入并收听语音频道。",
    category: "VOICE",
  },
  {
    flag: PermissionFlags.SPEAK,
    name: "说话开麦",
    description: "允许成员在语音频道中自由开麦发言。",
    category: "VOICE",
  },
  {
    flag: PermissionFlags.STREAM,
    name: "屏幕共享",
    description: "允许成员在语音频道中分享屏幕或摄像头视频流。",
    category: "VOICE",
  },
  {
    flag: PermissionFlags.MUTE_MEMBERS,
    name: "禁言闭麦成员",
    description: "允许成员在语音频道中静音闭麦其他成员。",
    category: "VOICE",
  },
  {
    flag: PermissionFlags.DEAFEN_MEMBERS,
    name: "禁听成员",
    description: "允许成员在语音频道中抑制其他成员的收听状态。",
    category: "VOICE",
  },
  {
    flag: PermissionFlags.MOVE_MEMBERS,
    name: "移动成员",
    description: "允许成员在不同语音频道之间拖拽转移成员。",
    category: "VOICE",
  },
  // 高级管理
  {
    flag: PermissionFlags.ADMINISTRATOR,
    name: "管理员 (最高特权)",
    description:
      "拥有服务器的全部最高特权，无视其他所有权限限制，请极其慎重授予！",
    category: "ADVANCED",
  },
];

export interface Role {
  id: string;
  guildId: string;
  name: string;
  color?: string | null;
  hoist: boolean;
  position: number;
  permissions: number; // 位掩码组合
  isDefault?: boolean; // 是否是 @everyone 默认兜底角色
  createdAt: string;
}

export function hasPermission(
  userPermissions: number,
  flag: PermissionFlags,
): boolean {
  if (
    (userPermissions & PermissionFlags.ADMINISTRATOR) ===
    PermissionFlags.ADMINISTRATOR
  ) {
    return true;
  }
  return (userPermissions & flag) === flag;
}

export function computePermissions(roles: Role[]): number {
  return roles.reduce((acc, r) => acc | r.permissions, 0);
}

export function parseRoleIds(raw: any): string[] {
  if (Array.isArray(raw))
    return raw.filter((id): id is string => typeof id === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

// 3. 频道与公会 (Guild / Server)
export type ChannelType = "TEXT" | "VOICE" | "DM" | "GROUP_DM";

export interface ChannelCategory {
  id: string;
  guildId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  guildId?: string | null;
  name: string;
  type: ChannelType;
  topic?: string | null;
  parentId?: string | null; // 频道分类 ID
  position: number; // 排序位置
  isE2EE?: boolean;
  bitrate?: number; // 语音比特率 (默认 64000)
  recipients?: User[];
  lastMessage?: Message;
  unreadCount?: number;
  createdAt: string;
}

export interface GuildMember {
  userId: string;
  guildId: string;
  nickname?: string | null;
  roleIds: string[];
  roles?: Role[];
  joinedAt: string;
  user?: User;
}

export interface GuildMemberAddPayload {
  guildId: string;
  member: GuildMember;
}

export interface GuildMemberRemovePayload {
  guildId: string;
  userId: string;
}

export interface GuildMemberUpdatePayload {
  guildId: string;
  member: GuildMember;
}

export interface Guild {
  id: string;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  isPublic?: boolean;
  ownerId: string;
  channels: Channel[];
  categories?: ChannelCategory[];
  members: GuildMember[];
  roles?: Role[];
  createdAt: string;
  updatedAt?: string;
}

export interface PublicGuild {
  id: string;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  ownerId: string;
  memberCount: number;
  isJoined?: boolean;
  createdAt: string;
}

export interface Invite {
  code: string;
  guildId: string;
  inviterId: string;
  inviter?: User;
  maxUses?: number;
  uses: number;
  expiresAt?: string | null;
  createdAt: string;
}

export interface GuildBan {
  id: string;
  guildId: string;
  userId: string;
  user?: User;
  reason?: string | null;
  createdAt: string;
}

export interface BanMemberDTO {
  reason?: string;
}

export enum AuditLogAction {
  GUILD_UPDATE = "GUILD_UPDATE",
  ROLE_CREATE = "ROLE_CREATE",
  ROLE_UPDATE = "ROLE_UPDATE",
  ROLE_DELETE = "ROLE_DELETE",
  MEMBER_KICK = "MEMBER_KICK",
  MEMBER_BAN_ADD = "MEMBER_BAN_ADD",
  MEMBER_BAN_REMOVE = "MEMBER_BAN_REMOVE",
  MEMBER_ROLE_UPDATE = "MEMBER_ROLE_UPDATE",
  INVITE_CREATE = "INVITE_CREATE",
  INVITE_DELETE = "INVITE_DELETE",
  CHANNEL_CREATE = "CHANNEL_CREATE",
  CHANNEL_UPDATE = "CHANNEL_UPDATE",
  CHANNEL_DELETE = "CHANNEL_DELETE",
}

export interface AuditLogEntry {
  id: string;
  guildId: string;
  userId: string;
  user?: User;
  action: AuditLogAction | string;
  targetId?: string | null;
  targetName?: string | null;
  changesJson?: string | null;
  changes?: Record<string, { old?: any; new?: any }>;
  reason?: string | null;
  createdAt: string;
}

export interface CreateGuildDTO {
  name: string;
  iconUrl?: string | null;
  description?: string | null;
}

export interface UpdateGuildDTO {
  name?: string;
  iconUrl?: string | null;
  description?: string | null;
}

export interface TransferOwnershipDTO {
  newOwnerId: string;
}

export interface CreateRoleDTO {
  name: string;
  color?: string | null;
  hoist?: boolean;
  permissions?: number;
}

export interface UpdateRoleDTO {
  name?: string;
  color?: string | null;
  hoist?: boolean;
  position?: number;
  permissions?: number;
}

export interface UpdateRolePositionsDTO {
  roles: Array<{ id: string; position: number }>;
}

export interface UpdateMemberRolesDTO {
  roleIds: string[];
  nickname?: string | null;
}

export interface CreateChannelDTO {
  name: string;
  type?: ChannelType;
  topic?: string | null;
  parentId?: string | null;
  position?: number;
  isE2EE?: boolean;
}

export interface UpdateChannelDTO {
  name?: string;
  topic?: string | null;
  parentId?: string | null;
  position?: number;
  isE2EE?: boolean;
}

export interface CreateCategoryDTO {
  name: string;
  position?: number;
}

export interface UpdateCategoryDTO {
  name?: string;
  position?: number;
}

export interface ReorderCategoriesDTO {
  categories: { id: string; position: number }[];
}

export interface ReorderChannelsDTO {
  channels: { id: string; position: number; parentId?: string | null }[];
}

export interface CreateInviteDTO {
  maxUses?: number;
  expiresInHours?: number;
}

export interface JoinInviteDTO {
  code: string;
}

// 4. 消息系统与互动反应
export interface Attachment {
  id: string;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
  me?: boolean; // 当前用户是否点赞
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  };
  content: string;
  isEncrypted?: boolean;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    authorName: string;
    content: string;
  } | null;
  isPinned?: boolean;
  reactions?: MessageReaction[];
  attachments?: Attachment[];
  createdAt: string;
  updatedAt?: string;
  sequence?: number;
}

// 5. 网关信令协议 (WebSocket Gateway)
export enum GatewayOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  STATUS_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

export enum GatewayCloseCode {
  NORMAL = 1000,
  TOKEN_EXPIRED = 4001,
  UNAUTHORIZED = 4002,
  ACCOUNT_BANNED = 4003,
  SESSION_INVALID = 4004,
  MAINTENANCE_MODE = 4013,
}

export interface GatewayPayload<T = any> {
  op: GatewayOpCode;
  d?: T;
  s?: number; // 序列号
  t?: string; // 事件名 (当 op === DISPATCH 时)
}

export interface HelloPayload {
  heartbeatInterval: number; // 毫秒
}

export interface HeartbeatData {
  clientTimestamp: number;
  serverTimestamp?: number;
}

export type GatewayConnectionState =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export type VoiceConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export interface GatewayPingStats {
  ping: number; // 毫秒往返延迟 (RTT)
  lastAckTimestamp: number;
}

export interface IdentifyPayload {
  token: string;
  sessionId?: string;
  properties: {
    os: string;
    browser: string;
    device: string;
  };
}

export type StreamTransmissionMode = "sfu" | "p2p_direct" | "p2p_relay";

export interface VoiceStateUpdatePayload {
  guildId: string;
  channelId: string | null; // null 代表退出语音频道
  sessionId?: string;
  selfMute?: boolean;
  selfDeaf?: boolean;
  selfVideo?: boolean;
  streaming?: boolean;
  streamMode?: StreamTransmissionMode;
}

export interface VoiceState {
  userId: string;
  guildId: string;
  channelId: string | null;
  sessionId?: string;
  platform?: string;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
  streaming: boolean;
  streamMode?: StreamTransmissionMode;
  user?: User;
}

export interface VoiceServerDisconnectPayload {
  reason: "VOICE_TRANSFER" | "KICKED" | "CHANNEL_DELETED";
  newChannelId?: string | null;
  targetPlatform?: string;
}

export interface ReadyPayload {
  sessionId?: string;
  user: Partial<User>;
  guilds: Guild[];
  voiceStates: VoiceState[];
}

export interface StatusUpdatePayload {
  status: UserStatus;
  customStatus?: string | null;
  activities?: Activity[];
}

export interface UserPresence {
  userId: string;
  status: UserStatus;
  customStatus?: string | null;
  activities?: Activity[];
  clientStatus?: {
    web?: UserStatus;
    desktop?: UserStatus;
  };
  lastActiveAt?: string;
}

export interface PresenceUpdateEvent {
  userId: string;
  status: UserStatus;
  customStatus?: string | null;
  activities?: Activity[];
  clientStatus?: {
    web?: UserStatus;
    desktop?: UserStatus;
  };
  lastActiveAt?: string;
}

// 6. LiveKit 媒体 Token 协议
export interface LiveKitTokenRequest {
  roomName: string;
  identity: string;
  name?: string;
  isPublisher?: boolean;
  bitrate?: number; // 麦克风推流比特率 (bps, e.g. 16000 - 128000)
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

// 7. 音频设置与降噪配置
export type AudioInputMode = "VAD" | "PTT";
export type NoiseSuppressionMode = "off" | "rnnoise" | "dtln";

export type SoundEffectType =
  | "MUTE"
  | "UNMUTE"
  | "DEAFEN"
  | "UNDEAFEN"
  | "VOICE_JOIN"
  | "VOICE_LEAVE"
  | "USER_JOIN"
  | "USER_LEAVE";

export interface AudioProcessingConfig {
  noiseSuppression: boolean; // RNNoise AI 神经网络降噪 (兼容旧布尔配置)
  noiseSuppressionMode?: NoiseSuppressionMode; // 全新多引擎降噪模式：'off' | 'rnnoise' | 'dtln' (默认 'rnnoise')
  echoCancellation: boolean; // 回声消除 (AEC)
  autoGainControl: boolean; // 自动增益 (AGC)
  highFidelityMusic: boolean; // 48kHz 高保真立体声直通
  inputMode: AudioInputMode; // 输入模式：语音感应 (VAD) 或 按键说话 (PTT)
  pushToTalk: boolean; // 按键说话开关 (兼容旧属性)
  pushToTalkKey?: string; // 按键配置 (如 'Space', 'ControlLeft', 'KeyV')
  pushToTalkReleaseDelay?: number; // 按键释放延迟 (毫秒, 默认 200)
  vadSensitivity: number; // 语音感应门限 (0 - 100)
  audioBitrate: number; // Opus 推流码率 (bps, 默认 64000)
  manualGain?: number; // 手动输入增益百分比 (0 - 200，默认 100，对应 0.0x ~ 2.0x)
  agcGainRange?: number; // 自动增益范围/上限 (dB, 6 - 30，默认 18 dB)
  inputDeviceId?: string; // 输入设备 ID
  outputDeviceId?: string; // 输出设备 ID
}

export type VideoCodecType = "h264" | "av1" | "vp9" | "vp8" | "h265";

export interface CodecCapabilityInfo {
  codec: VideoCodecType;
  label: string;
  description: string;
  supported: boolean;
  isHardwareAccelerated?: boolean;
  reason?: string;
}

export const DEFAULT_VIDEO_CODEC: VideoCodecType = "h264";
export const MIN_CUSTOM_BITRATE = 500_000; // 500 kbps
export const MAX_CUSTOM_BITRATE = 25_000_000; // 25 Mbps (支持 4K 60fps)

export interface VideoSettingsConfig {
  cameraDeviceId?: string; // 选中的摄像头硬件 Device ID
  mirrorLocalPreview?: boolean; // 是否开启本地自拍镜像翻转 (默认 true)
  preferredVideoCodec?: VideoCodecType; // 全局首选视频编码器 (默认 'h264')
  customBitrate?: number; // 自定义推流目标码率 (bps, 500000 - 25000000)
  enableBackupCodec?: boolean; // 是否启用 VP8 双编码兜底降级 (默认 true)
}

// 物理媒体连接架构与拓扑类型
export type ConnectionTopology =
  | "SFU_SERVER" // LiveKit 媒体服务器集中转发
  | "P2P_MESH" // 纯语音全网状点对点打洞
  | "P2P_DIRECT" // 屏幕共享点对点单向打洞
  | "P2P_TREE_RELAY"; // 屏幕共享树状接力转发

// 动态 ICE / TURN 服务器配置契约
export interface ICEServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ICEServerConfigResponse {
  iceServers: ICEServerEntry[];
  turnActive: boolean;
}

// 详细媒体属性与实时统计报告契约 (Stats for nerds)
export interface StreamDetailedStats {
  participantIdentity: string;
  isLocal: boolean;
  mimeType: string;
  playerCore: string;
  videoInfo?: string;
  audioInfo: string;
  encoder: string;
  streamHost: string;
  connectionMode: string;
  topology: ConnectionTopology;
  protocol: string;
  bufferLength: string;
  decodedFrames?: string;
  downloadBitrate: string; // 格式化瞬时下行速率与累计量 (如 "1.45 Mbps (12.4 MB)")
  uploadBitrate?: string; // 格式化瞬时上行速率与累计量 (如 "850 Kbps (4.2 MB)")
  rawDownloadBitrateBps?: number; // 瞬时下行真实速率 (bps)
  rawUploadBitrateBps?: number; // 瞬时上行真实速率 (bps)
  totalBytesReceived?: number; // 累计接收字节数
  totalBytesSent?: number; // 累计发送字节数
  rtt: string;
  packetLoss: string;
  jitter: string;
  holePunchStatus?: string; // 打洞状态：如 "已打洞连通"、"打洞重试中 (1/3)"、"SFU 中继回退"
  ipVersion?: "IPv4" | "IPv6"; // 实际协商候选的 IP 版本
  candidateType?: "host" | "srflx" | "prflx" | "relay";
  preferredVideoCodec?: VideoCodecType;
  actualSendCodec?: string;
  actualReceiveCodec?: string;
  codecFallbackReason?: string;
  transportVerified?: boolean;
}

// 纯语音传输模式：SFU 服务端转发 或 P2P 全网状 Mesh 直连
export type VoiceTransmissionMode = "sfu" | "p2p_mesh";

// 语音通道状态信息
export interface VoiceChannelStatusInfo {
  mode: VoiceTransmissionMode;
  isMeshActive: boolean;
  isFallbackToSFU: boolean;
  fallbackReason?: string;
  peerCount: number;
  rtt: number;
  jitter: number;
  packetLoss: number;
  bitrate: number;
  codec: string;
}

// 视频与直播通道状态信息
export interface VideoChannelStatusInfo {
  state: "idle" | "broadcasting" | "watching";
  transmissionMode: StreamTransmissionMode;
  codec?: string;
  hardwareAcceleration?: string; // 如 'Intel QSV', 'NVIDIA NVENC', 'AMD AMF', 'WebCodecs', 'CPU'
  resolution?: string;
  framerate?: number;
  bitrate?: number;
  packetLoss?: number;
}

// 点对点网络质量与延迟评估报告
export interface PeerLatencyReport {
  targetUserId: string;
  rtt: number; // 毫秒往返物理延迟
  jitter?: number; // 抖动毫秒
  packetLoss?: number; // 丢包率 (0.0 - 1.0)
  connectionType: "LAN" | "P2P" | "RELAY" | "SFU";
  updatedAt: number;
}

// 频道静音配置项
export interface ChannelMuteConfig {
  muted: boolean;
  mutedUntil: number | null; // 毫秒绝对时间戳；null 表示永久静音（直到重新开启）
}

// 频道静音预设时长选项
export interface MuteDurationOption {
  label: string;
  durationMs: number | null;
}

export const CHANNEL_MUTE_DURATION_OPTIONS: MuteDurationOption[] = [
  { label: "15 分钟", durationMs: 15 * 60 * 1000 },
  { label: "1 小时", durationMs: 60 * 60 * 1000 },
  { label: "3 小时", durationMs: 3 * 60 * 60 * 1000 },
  { label: "8 小时", durationMs: 8 * 60 * 60 * 1000 },
  { label: "24 小时", durationMs: 24 * 60 * 60 * 1000 },
  { label: "直到重新开启", durationMs: null },
];

/**
 * 判定频道配置当前是否处于有效静音状态（毫秒级判断）
 */
export function isChannelMuted(config?: ChannelMuteConfig | null): boolean {
  if (!config || !config.muted) return false;
  if (
    config.mutedUntil === null ||
    config.mutedUntil === undefined ||
    config.mutedUntil === -1
  ) {
    return true;
  }
  return Date.now() < config.mutedUntil;
}

// 用户全量偏好设置 DTO (支持本地 Zustand Persist 持久化与后端云端漫游)
export interface UserSettingsDTO {
  audio: AudioProcessingConfig;
  video: VideoSettingsConfig;
  outputVolume: number; // 全局母带输出音量 (0 - 200, 默认 100)
  userVolumes: Record<string, number>; // 针对特定成员的独立音量配置 (0 - 200)
  language?: SupportedLocale; // 用户界面多语言首选项
  voiceTransmissionMode?: VoiceTransmissionMode; // 纯语音偏好模式 (默认 sfu)
  mutedChannels?: Record<string, ChannelMuteConfig>; // 频道静音配置项字典 (key 为 channelId)
  guildPositions?: string[]; // 用户个人服务器排序偏好列表 (guildId 顺序)
  userNotes?: Record<string, string>; // 针对特定目标用户的私有备注字典 (targetUserId -> note)
}

export interface UpdateUserNoteDTO {
  note: string;
}

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface NetworkStats {
  identity: string; // 用户唯一标识 / userId
  rtt?: number; // 往返延迟 Round-Trip Time (ms)，未采集时省略
  packetLoss?: number; // 丢包率百分比 (0% - 100%)，未采集时省略
  jitter?: number; // 网络抖动 Jitter (ms)，未采集时省略
  bitrate?: number; // 实际吞吐码率 (kbps)，未采集时省略
  codec?: string; // 实际音频编码 (如 'Opus')，未采集时省略
  videoCodec?: string; // 视频编码 (如 'H264', 'AV1', 'VP8')
  videoResolution?: string; // 视频实时分辨率 (如 '1920x1080')
  videoFramerate?: number; // 视频实时帧率 (fps)
  videoBitrate?: number; // 视频实时码率 (kbps)
  quality: "excellent" | "good" | "poor" | "unknown"; // 综合网络健康等级
  timestamp: number;
}

export interface ParticipantAudioSettings {
  participantId: string;
  volume: number; // 音量百分比 (0% - 200%, 默认 100%)
  muted: boolean; // 是否对该用户单独静音
}

// 7.1 音频算法与工具函数 (Audio Utilities & Helpers)
export function clampVolume(vol: number): number {
  if (isNaN(vol)) return 100;
  return Math.max(0, Math.min(200, Math.round(vol)));
}

export function computeGain(volumePercent: number, isMuted: boolean): number {
  if (isMuted) return 0;
  return clampVolume(volumePercent) / 100;
}

export function evaluateNetworkQuality(
  rtt: number,
  packetLoss: number,
): "excellent" | "good" | "poor" {
  if (rtt < 60 && packetLoss < 2) return "excellent";
  if (rtt < 150 && packetLoss < 6) return "good";
  return "poor";
}

export function calculateSNRReduction(
  rawRms: number,
  cleanRms: number,
): number {
  const safeRaw = Math.max(1e-6, rawRms);
  const safeClean = Math.max(1e-6, cleanRms);
  if (safeRaw <= safeClean) return 0;
  const db = 20 * Math.log10(safeRaw / safeClean);
  return Math.max(0, +db.toFixed(1));
}

export interface TripleTrackSNRResult {
  rawRms: number;
  rnnoiseRms: number;
  dtlnRms: number;
  rnnoiseDbReduction: number;
  dtlnDbReduction: number;
}

export function calculateTripleSNRReduction(
  rawRms: number,
  rnnoiseRms: number,
  dtlnRms: number,
): TripleTrackSNRResult {
  return {
    rawRms,
    rnnoiseRms,
    dtlnRms,
    rnnoiseDbReduction: calculateSNRReduction(rawRms, rnnoiseRms),
    dtlnDbReduction: calculateSNRReduction(rawRms, dtlnRms),
  };
}

// 8. 对象存储直传契约 (MinIO / S3)
export interface PresignedUploadRequest {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  fileUrl: string;
  fileKey: string;
  requiresAuth?: boolean;
}

export interface AddReactionDTO {
  emoji: string;
}

// 9. 网关事件常量 (Gateway Event Constants)
export const GatewayEvents = {
  READY: "READY",
  MESSAGE_CREATE: "MESSAGE_CREATE",
  MESSAGE_UPDATE: "MESSAGE_UPDATE",
  MESSAGE_DELETE: "MESSAGE_DELETE",
  MESSAGE_REACTION_ADD: "MESSAGE_REACTION_ADD",
  MESSAGE_REACTION_REMOVE: "MESSAGE_REACTION_REMOVE",
  MESSAGE_PIN_UPDATE: "MESSAGE_PIN_UPDATE",
  VOICE_STATE_UPDATE: "VOICE_STATE_UPDATE",
  USER_UPDATE: "USER_UPDATE",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
  GUILD_CREATE: "GUILD_CREATE",
  GUILD_UPDATE: "GUILD_UPDATE",
  GUILD_DELETE: "GUILD_DELETE",
  GUILD_MEMBER_ADD: "GUILD_MEMBER_ADD",
  GUILD_MEMBER_REMOVE: "GUILD_MEMBER_REMOVE",
  GUILD_MEMBER_UPDATE: "GUILD_MEMBER_UPDATE",
  GUILD_ROLE_CREATE: "GUILD_ROLE_CREATE",
  GUILD_ROLE_UPDATE: "GUILD_ROLE_UPDATE",
  GUILD_ROLE_DELETE: "GUILD_ROLE_DELETE",
  GUILD_BAN_ADD: "GUILD_BAN_ADD",
  GUILD_BAN_REMOVE: "GUILD_BAN_REMOVE",
  CHANNEL_CREATE: "CHANNEL_CREATE",
  CHANNEL_UPDATE: "CHANNEL_UPDATE",
  CHANNEL_DELETE: "CHANNEL_DELETE",
  CATEGORY_CREATE: "CATEGORY_CREATE",
  CATEGORY_UPDATE: "CATEGORY_UPDATE",
  CATEGORY_DELETE: "CATEGORY_DELETE",
  CATEGORY_POSITIONS_UPDATE: "CATEGORY_POSITIONS_UPDATE",
  CHANNEL_POSITIONS_UPDATE: "CHANNEL_POSITIONS_UPDATE",
  STREAM_START: "STREAM_START",
  STREAM_STOP: "STREAM_STOP",
  E2EE_KEY_EXCHANGE: "E2EE_KEY_EXCHANGE",
  E2EE_CHANNEL_UPDATE: "E2EE_CHANNEL_UPDATE",
  TYPING_START: "TYPING_START",
  // P2P 直连与智能接力信令
  P2P_SIGNAL: "P2P_SIGNAL",
  P2P_TOPOLOGY_UPDATE: "P2P_TOPOLOGY_UPDATE",
  P2P_QUALITY_REPORT: "P2P_QUALITY_REPORT",
  P2P_FALLBACK_REQUEST: "P2P_FALLBACK_REQUEST",
  // 私信与 1v1 音视频呼叫信令
  DM_CHANNEL_CREATE: "DM_CHANNEL_CREATE",
  DM_CHANNEL_UPDATE: "DM_CHANNEL_UPDATE",
  DM_CHANNEL_DELETE: "DM_CHANNEL_DELETE",
  CALL_OFFER: "CALL_OFFER",
  CALL_ANSWER: "CALL_ANSWER",
  CALL_REJECT: "CALL_REJECT",
  CALL_END: "CALL_END",
  CALL_STATE_UPDATE: "CALL_STATE_UPDATE",
  ACCOUNT_SESSION_REVOKED: "ACCOUNT_SESSION_REVOKED",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  MAINTENANCE_UPDATE: "MAINTENANCE_UPDATE",
  // 全网系统广播
  SYSTEM_BROADCAST: "SYSTEM_BROADCAST",
} as const;

export type GatewayEventType =
  (typeof GatewayEvents)[keyof typeof GatewayEvents];

export type NATType =
  | "FullCone"
  | "RestrictedCone"
  | "PortRestrictedCone"
  | "Symmetric"
  | "IPv6Direct"
  | "Unknown";

export interface P2PSignalPayload {
  guildId: string;
  channelId: string;
  callId?: string;
  senderId: string;
  targetId?: string; // 目标接收用户ID（点对点直传时必填）
  streamOwnerId: string; // 主播ID
  type:
    | "OFFER"
    | "ANSWER"
    | "ICE_CANDIDATE"
    | "REQUEST_STREAM"
    | "TOPOLOGY_SYNC"
    | "FALLBACK_TO_SFU"
    | "VOICE_OFFER"
    | "VOICE_ANSWER"
    | "VOICE_ICE_CANDIDATE"
    | "VOICE_LEAVE";
  sdp?: any;
  candidate?: any;
  transmissionMode?: StreamTransmissionMode;
  timestamp?: number;
}

export interface P2PNodeMetrics {
  userId: string;
  natType: NATType;
  hasIPv6: boolean;
  rtt: number;
  packetLoss: number;
  downstreamCount: number;
  maxDownstream: number;
}

export interface P2PTopologyNode {
  peerId: string;
  parentId: string | null;
  childrenIds: string[];
  transmissionMode: StreamTransmissionMode;
  metrics?: P2PNodeMetrics;
}

export interface P2PTopologyUpdatePayload {
  streamOwnerId: string;
  channelId: string;
  transmissionMode: StreamTransmissionMode;
  nodes: Record<string, P2PTopologyNode>;
  myParentId?: string | null;
  myChildrenIds?: string[];
}

export interface P2PNetworkDiagnostics {
  transmissionMode: StreamTransmissionMode;
  natType: NATType;
  hasIPv6: boolean;
  activeCandidatePair?: {
    localCandidateType: string;
    remoteCandidateType: string;
    protocol: string;
    localAddress?: string;
    remoteAddress?: string;
  };
  rtt?: number;
  packetLoss?: number;
  relayParentName?: string;
  downstreamPeersCount: number;
}

export interface TypingIndicatorPayload {
  channelId: string;
  userId: string;
  user: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  };
  timestamp: number;
}

// 10. 阶段四：屏幕分享直播、Simulcast 与桌面原生协议 (Phase 4 Contracts)

export type ScreenShareResolution = "480p" | "720p" | "1080p" | "1440p" | "4k";
export type ScreenShareFps = 15 | 30 | 60;

export interface ScreenSharePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: ScreenShareFps;
  bitrate: number; // bps
  description: string;
}

export interface ResolutionInfo {
  id: ScreenShareResolution;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const RESOLUTION_OPTIONS: ResolutionInfo[] = [
  {
    id: "480p",
    label: "480P (标清)",
    width: 854,
    height: 480,
    description: "极低带宽开销，适合弱网及文档阅读",
  },
  {
    id: "720p",
    label: "720P (高清)",
    width: 1280,
    height: 720,
    description: "省流低带宽，适合日常文档与演示",
  },
  {
    id: "1080p",
    label: "1080P (超清)",
    width: 1920,
    height: 1080,
    description: "细腻清晰，代码与文本展示首选",
  },
  {
    id: "1440p",
    label: "2K 1440P (极清)",
    width: 2560,
    height: 1440,
    description: "2K 细腻画质，高清大屏演示",
  },
  {
    id: "4k",
    label: "4K 2160P (原画)",
    width: 3840,
    height: 2160,
    description: "4K 视网膜级原生画质呈现",
  },
];

export const FPS_OPTIONS: ScreenShareFps[] = [15, 30, 60];

export function getRecommendedBitrate(
  resolution: ScreenShareResolution,
  fps: ScreenShareFps,
): number {
  const table: Record<ScreenShareResolution, Record<ScreenShareFps, number>> = {
    "480p": { 15: 500_000, 30: 800_000, 60: 1_200_000 },
    "720p": { 15: 1_000_000, 30: 1_500_000, 60: 2_500_000 },
    "1080p": { 15: 2_000_000, 30: 3_000_000, 60: 5_000_000 },
    "1440p": { 15: 3_500_000, 30: 5_000_000, 60: 8_000_000 },
    "4k": { 15: 6_000_000, 30: 10_000_000, 60: 16_000_000 },
  };
  return table[resolution]?.[fps] ?? 3_000_000;
}

/**
 * 根据屏幕物理像素尺寸 (宽, 高)，按 16:9 比例计算该屏幕所支持的最大标准 16:9 分辨率档位。
 * 支持 16:10、21:9、3:2 等非标比例屏幕安全等比内接映射。
 */
export function getMaxAllowed16x9Resolution(
  screenWidth?: number,
  screenHeight?: number,
): ScreenShareResolution {
  if (!screenWidth || !screenHeight || screenWidth <= 0 || screenHeight <= 0) {
    return "1080p"; // 默认安全回退
  }

  // 横屏归一化（防止竖屏取反）
  const w = Math.max(screenWidth, screenHeight);
  const h = Math.min(screenWidth, screenHeight);

  // 计算最大内接 16:9 尺寸的高（纵向像素）
  // H_avail = min(H, floor(W * 9 / 16))
  const hAvail = Math.min(h, Math.floor((w * 9) / 16));

  // 按照阶梯划分 (带 32px 容差缓冲)
  if (hAvail < 688) {
    return "480p";
  } else if (hAvail < 1048) {
    return "720p";
  } else if (hAvail < 1408) {
    return "1080p";
  } else if (hAvail < 2128) {
    return "1440p";
  } else {
    return "4k";
  }
}

/**
 * 判定目标分辨率是否被最大允许分辨率支持 (基于 480p < 720p < 1080p < 1440p < 4k 顺序)
 */
export function isResolutionAllowed(
  target: ScreenShareResolution,
  maxAllowed: ScreenShareResolution,
): boolean {
  const order: ScreenShareResolution[] = [
    "480p",
    "720p",
    "1080p",
    "1440p",
    "4k",
  ];
  const targetIdx = order.indexOf(target);
  const maxIdx = order.indexOf(maxAllowed);
  if (targetIdx === -1) return true;
  if (maxIdx === -1) return true;
  return targetIdx <= maxIdx;
}

export const SCREEN_SHARE_PRESETS: Record<string, ScreenSharePreset> = {
  "480p15": {
    id: "480p15",
    name: "省流极低 (480p 15fps)",
    width: 854,
    height: 480,
    frameRate: 15,
    bitrate: 500_000,
    description: "极限省流模式，超低带宽开销",
  },
  "480p30": {
    id: "480p30",
    name: "流畅标清 (480p 30fps)",
    width: 854,
    height: 480,
    frameRate: 30,
    bitrate: 800_000,
    description: "极低带宽开销，适合弱网及文档阅读",
  },
  "480p60": {
    id: "480p60",
    name: "流畅高帧 (480p 60fps)",
    width: 854,
    height: 480,
    frameRate: 60,
    bitrate: 1_200_000,
    description: "低带宽下的高帧率分享",
  },
  "720p15": {
    id: "720p15",
    name: "文档标清 (720p 15fps)",
    width: 1280,
    height: 720,
    frameRate: 15,
    bitrate: 1_000_000,
    description: "清晰文字展示，低帧率省流",
  },
  "720p30": {
    id: "720p30",
    name: "流畅标清 (720p 30fps)",
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrate: 1_500_000,
    description: "省流低带宽，适合日常文档与演示",
  },
  "720p60": {
    id: "720p60",
    name: "流畅电竞 (720p 60fps)",
    width: 1280,
    height: 720,
    frameRate: 60,
    bitrate: 2_500_000,
    description: "兼顾高帧率与画质，竞技游戏优先",
  },
  "1080p15": {
    id: "1080p15",
    name: "静态高清 (1080p 15fps)",
    width: 1920,
    height: 1080,
    frameRate: 15,
    bitrate: 2_000_000,
    description: "高分辨率代码与文档阅读首选",
  },
  "1080p30": {
    id: "1080p30",
    name: "高清演示 (1080p 30fps)",
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 3_000_000,
    description: "细腻清晰，代码与文本展示首选",
  },
  "1080p60": {
    id: "1080p60",
    name: "极清高帧 (1080p 60fps)",
    width: 1920,
    height: 1080,
    frameRate: 60,
    bitrate: 5_000_000,
    description: "极致画质与丝滑流畅，高画质游戏直播",
  },
  "1440p15": {
    id: "1440p15",
    name: "2K静态 (1440p 15fps)",
    width: 2560,
    height: 1440,
    frameRate: 15,
    bitrate: 3_500_000,
    description: "2K 超高解析度静态画面",
  },
  "1440p30": {
    id: "1440p30",
    name: "2K极清 (1440p 30fps)",
    width: 2560,
    height: 1440,
    frameRate: 30,
    bitrate: 5_000_000,
    description: "2K 细腻画质，高清大屏演示",
  },
  "1440p60": {
    id: "1440p60",
    name: "2K高刷 (1440p 60fps)",
    width: 2560,
    height: 1440,
    frameRate: 60,
    bitrate: 8_000_000,
    description: "2K 电竞高刷直播，超高解析度",
  },
  "4k15": {
    id: "4k15",
    name: "4K静态 (4K 15fps)",
    width: 3840,
    height: 2160,
    frameRate: 15,
    bitrate: 6_000_000,
    description: "4K 视网膜级超精细文本与绘图",
  },
  "4k30": {
    id: "4k30",
    name: "4K原画 (4K 30fps)",
    width: 3840,
    height: 2160,
    frameRate: 30,
    bitrate: 10_000_000,
    description: "4K 视网膜级原生画质呈现",
  },
  "4k60": {
    id: "4k60",
    name: "4K极限 (4K 60fps)",
    width: 3840,
    height: 2160,
    frameRate: 60,
    bitrate: 16_000_000,
    description: "4K 60fps 旗舰级画质分享",
  },
};

export interface SimulcastLayer {
  rid: "f" | "h" | "q"; // full, half, quarter
  width: number;
  height: number;
  maxBitrate: number;
  maxFramerate: number;
}

export function computeSimulcastLayers(
  baseWidth: number,
  baseHeight: number,
  baseFps: number,
  baseBitrate: number,
): SimulcastLayer[] {
  // 强制将分辨率对齐到偶数 (2 的倍数)，以防 H.264 / VP8 硬件编码器因奇数宽度或高度崩溃
  const safeBaseW = Math.max(2, (Math.round(baseWidth) >> 1) << 1);
  const safeBaseH = Math.max(2, (Math.round(baseHeight) >> 1) << 1);
  const halfW = Math.max(2, (Math.round(safeBaseW / 2) >> 1) << 1);
  const halfH = Math.max(2, (Math.round(safeBaseH / 2) >> 1) << 1);
  const quarterW = Math.max(2, (Math.round(safeBaseW / 4) >> 1) << 1);
  const quarterH = Math.max(2, (Math.round(safeBaseH / 4) >> 1) << 1);

  return [
    {
      rid: "f",
      width: safeBaseW,
      height: safeBaseH,
      maxFramerate: Math.max(1, baseFps),
      maxBitrate: Math.max(100_000, baseBitrate),
    },
    {
      rid: "h",
      width: halfW,
      height: halfH,
      maxFramerate: Math.min(30, Math.max(1, baseFps)),
      maxBitrate: Math.round(baseBitrate * 0.35),
    },
    {
      rid: "q",
      width: quarterW,
      height: quarterH,
      maxFramerate: 15,
      maxBitrate: Math.round(baseBitrate * 0.12),
    },
  ];
}

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  type: "screen" | "window";
  appIcon?: string;
  displayDimensions?: { width: number; height: number }; // 物理尺寸 (宽 x 高)
}

export interface ScreenShareOptions {
  sourceId?: string;
  sourceType?: "screen" | "window";
  preset: string; // e.g. "1080p60"
  captureAudio: boolean;
  simulcast: boolean;
  mixedAudio?: boolean;
  videoCodec?: VideoCodecType; // 本次屏幕分享指定编码器
  customBitrate?: number; // 本次屏幕分享自定义目标码率 (bps)
}

export interface AudioMixerConfig {
  micVolume: number; // 0 - 100
  systemAudioVolume: number; // 0 - 100
  enabled: boolean;
  stereoDirect: boolean; // 立体声直通
}

export function computeMixGains(
  micVolume: number,
  systemAudioVolume: number,
  isMuted: boolean = false,
): { micGain: number; systemGain: number } {
  const safeMicVol =
    typeof micVolume !== "number" || isNaN(micVolume) ? 100 : micVolume;
  const safeSysVol =
    typeof systemAudioVolume !== "number" || isNaN(systemAudioVolume)
      ? 100
      : systemAudioVolume;

  const safeMic = isMuted ? 0 : Math.max(0, Math.min(100, safeMicVol)) / 100;
  const safeSystem = Math.max(0, Math.min(100, safeSysVol)) / 100;
  return {
    micGain: +safeMic.toFixed(2),
    systemGain: +safeSystem.toFixed(2),
  };
}

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  channelId?: string;
  guildId?: string;
  icon?: string;
  silent?: boolean;
}

export interface AutoLaunchSettings {
  enabled: boolean;
  openAsHidden: boolean;
}

export interface DesktopWindowState {
  isMaximized: boolean;
  platform: string;
}

export type WindowControlAction = "minimize" | "maximize" | "close";

export type VideoViewMode = "grid" | "theater" | "pip" | "fullscreen";

// ==========================================
// 11. 阶段五：混合分级安全加密体系协议与核心算法 (Phase 5 Contracts & Crypto)
// ==========================================

// 11.0 跨平台基础编解码与密钥转换工具
export function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as any;
  if (typeof g.Buffer !== "undefined") {
    return g.Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const g = globalThis as any;
  if (typeof g.Buffer !== "undefined") {
    return new Uint8Array(g.Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  const g = globalThis as any;
  if (typeof g.Buffer !== "undefined") {
    return g.Buffer.from(bytes).toString("hex");
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

// 11.1 基础链路安全与网络加固 (5.1 Link Security & Hardening)
export interface SecurityHeadersConfig {
  strictTransportSecurity: string;
  contentSecurityPolicy: string;
  xContentTypeOptions: string;
  xFrameOptions: string;
  referrerPolicy: string;
  permissionsPolicy: string;
}

export function buildSecurityHeaders(
  custom?: Partial<SecurityHeadersConfig>,
): Record<string, string> {
  return {
    "Strict-Transport-Security":
      custom?.strictTransportSecurity ||
      "max-age=31536000; includeSubDomains; preload",
    "Content-Security-Policy":
      custom?.contentSecurityPolicy ||
      "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src 'self' blob: mediastream:; connect-src 'self' ws: wss: http: https:;",
    "X-Content-Type-Options": custom?.xContentTypeOptions || "nosniff",
    "X-Frame-Options": custom?.xFrameOptions || "DENY",
    "Referrer-Policy":
      custom?.referrerPolicy || "strict-origin-when-cross-origin",
    "Permissions-Policy":
      custom?.permissionsPolicy ||
      "camera=(), microphone=(self), display-capture=(self)",
  };
}

export interface DtlsSrtpConfig {
  cipherSuites: string[];
  dtlsRole: "auto" | "client" | "server";
  requireDtlsSrtp: boolean;
}

export function validateDtlsSrtpParameters(config: DtlsSrtpConfig): {
  valid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!config.requireDtlsSrtp) {
    reasons.push("WebRTC 媒体链路必须强制开启 requireDtlsSrtp");
  }
  const supportedCiphers = [
    "SRTP_AES128_CM_HMAC_SHA1_80",
    "SRTP_AEAD_AES_128_GCM",
    "SRTP_AEAD_AES_256_GCM",
  ];
  const hasValidCipher = config.cipherSuites?.some((c) =>
    supportedCiphers.includes(c),
  );
  if (!hasValidCipher) {
    reasons.push(
      "cipherSuites 未包含标准 SRTP 加密套件 (如 SRTP_AEAD_AES_128_GCM / SRTP_AEAD_AES_256_GCM)",
    );
  }
  return {
    valid: reasons.length === 0,
    reasons,
  };
}

// 11.2 SFrame WebRTC 语音端到端加密规范 (IETF draft-ietf-sframe-enc)
export interface SFrameConfig {
  enabled: boolean;
  keyId: number;
  passphrase?: string;
}

export interface SFrameHeader {
  kid: number; // Key ID (0 - 15)
  counter: bigint; // 48-bit 单调递增帧序列号
  headerLength: number; // 头部总字节数
}

export function encodeSFrameHeader(
  kid: number,
  counter: bigint | number,
): Uint8Array {
  const ctrBig = BigInt(counter);
  let ctrBytes: number[] = [];
  let temp = ctrBig;
  while (temp > 0n) {
    ctrBytes.unshift(Number(temp & 0xffn));
    temp >>= 8n;
  }
  if (ctrBytes.length === 0) ctrBytes = [0];
  const ctrLen = Math.min(15, ctrBytes.length);
  const safeKid = kid & 0x0f;
  const header = new Uint8Array(1 + ctrLen);
  header[0] = (safeKid << 4) | (ctrLen & 0x0f);
  for (let i = 0; i < ctrLen; i++) {
    header[1 + i] = ctrBytes[i];
  }
  return header;
}

export function decodeSFrameHeader(buffer: Uint8Array): SFrameHeader {
  if (buffer.length < 2) {
    throw new Error("SFrame 数据包长度过短，无法解析头部");
  }
  const firstByte = buffer[0];
  const kid = (firstByte >> 4) & 0x0f;
  const ctrLen = firstByte & 0x0f;
  if (buffer.length < 1 + ctrLen) {
    throw new Error("SFrame 数据包截断异常");
  }
  let counter = 0n;
  for (let i = 0; i < ctrLen; i++) {
    counter = (counter << 8n) | BigInt(buffer[1 + i]);
  }
  return {
    kid,
    counter,
    headerLength: 1 + ctrLen,
  };
}

export async function encryptSFramePacket(
  rawPcmOrOpus: Uint8Array,
  keyBuffer: Uint8Array,
  kid: number,
  counter: bigint | number,
): Promise<Uint8Array> {
  const header = encodeSFrameHeader(kid, counter);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error("当前环境不支持 Web Crypto API");
  }
  let safeKeyBuf = keyBuffer;
  if (keyBuffer.length !== 32) {
    const padded = new Uint8Array(32);
    padded.set(keyBuffer.slice(0, 32));
    safeKeyBuf = padded;
  }
  const key = await cryptoObj.subtle.importKey(
    "raw",
    safeKeyBuf,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = new Uint8Array(12);
  const ctrBig = BigInt(counter);
  for (let i = 0; i < 8; i++) {
    iv[11 - i] = Number((ctrBig >> BigInt(i * 8)) & 0xffn);
  }
  iv[0] = (kid ^ 0xa5) & 0xff;

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: header,
    },
    key,
    rawPcmOrOpus,
  );

  const ciphertextWithTag = new Uint8Array(encryptedBuffer);
  const result = new Uint8Array(header.length + ciphertextWithTag.length);
  result.set(header, 0);
  result.set(ciphertextWithTag, header.length);
  return result;
}

export async function decryptSFramePacket(
  sframePacket: Uint8Array,
  keyBuffer: Uint8Array,
): Promise<{ decryptedPayload: Uint8Array; header: SFrameHeader }> {
  const header = decodeSFrameHeader(sframePacket);
  const headerBytes = sframePacket.slice(0, header.headerLength);
  const ciphertextWithTag = sframePacket.slice(header.headerLength);

  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error("当前环境不支持 Web Crypto API");
  }

  let safeKeyBuf = keyBuffer;
  if (keyBuffer.length !== 32) {
    const padded = new Uint8Array(32);
    padded.set(keyBuffer.slice(0, 32));
    safeKeyBuf = padded;
  }
  const key = await cryptoObj.subtle.importKey(
    "raw",
    safeKeyBuf,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const iv = new Uint8Array(12);
  const ctrBig = header.counter;
  for (let i = 0; i < 8; i++) {
    iv[11 - i] = Number((ctrBig >> BigInt(i * 8)) & 0xffn);
  }
  iv[0] = (header.kid ^ 0xa5) & 0xff;

  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: headerBytes,
    },
    key,
    ciphertextWithTag,
  );

  return {
    decryptedPayload: new Uint8Array(decryptedBuffer),
    header,
  };
}

export class SFrameReplayFilter {
  private windowSize: bigint;
  private maxCounter: bigint = -1n;
  private windowBitmask: bigint = 0n;

  constructor(windowSize: number = 64) {
    this.windowSize = BigInt(windowSize);
  }

  public checkAndAdd(counter: bigint | number): boolean {
    const ctr = BigInt(counter);
    if (this.maxCounter < 0n) {
      this.maxCounter = ctr;
      this.windowBitmask = 1n;
      return true;
    }

    if (ctr > this.maxCounter) {
      const diff = ctr - this.maxCounter;
      if (diff >= this.windowSize) {
        this.windowBitmask = 1n;
      } else {
        this.windowBitmask = (this.windowBitmask << diff) | 1n;
      }
      this.maxCounter = ctr;
      return true;
    }

    const diff = this.maxCounter - ctr;
    if (diff >= this.windowSize) {
      return false;
    }

    const mask = 1n << diff;
    if ((this.windowBitmask & mask) !== 0n) {
      return false;
    }

    this.windowBitmask |= mask;
    return true;
  }
}

// 11.3 绝密频道端到端文本双棘轮加密体系 (5.3 Double Ratchet)
export interface EncryptedMessageEnvelope {
  version: number;
  senderId: string;
  channelId: string;
  ephemeralPublicKey: string; // Base64 of ECDH P-256 Public Key (65 bytes raw)
  sequenceNumber: number; // 当前发送链中的消息计数 (Ns)
  previousChainLength: number; // 上一发送链的总消息数 (PN)
  ciphertext: string; // Base64 密文
  iv: string; // Base64 12-byte IV
  tag: string; // Base64 16-byte GCM Authentication Tag
  fingerprint: string; // 密钥安全码 / 指纹 (Safety Number)
}

export interface DevicePreKeyBundle {
  userId: string;
  identityKey: string; // Base64 ECDH Identity Public Key
  signedPreKey: string; // Base64 ECDH Signed PreKey
  signature: string; // Base64 签名
  oneTimePreKeys: string[]; // 一次性预共享公钥池
  createdAt: string;
}

export interface RegisterPreKeyDTO {
  identityKey: string;
  signedPreKey: string;
  signature: string;
  oneTimePreKeys?: string[];
}

export interface E2eeKeyExchangePayload {
  channelId: string;
  senderId: string;
  recipientId?: string;
  ephemeralKey: string;
  encryptedKeyData: string;
  timestamp: number;
}

export async function generateDhKeyPair(): Promise<CryptoKeyPair> {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) throw new Error("缺少 Web Crypto API");
  return await cryptoObj.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits", "deriveKey"],
  );
}

export async function exportDhPublicKey(key: CryptoKey): Promise<string> {
  const cryptoObj = globalThis.crypto;
  const raw = await cryptoObj.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}

export async function importDhPublicKey(base64: string): Promise<CryptoKey> {
  const cryptoObj = globalThis.crypto;
  return await cryptoObj.subtle.importKey(
    "raw",
    base64ToBytes(base64),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

export async function computeDhSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const cryptoObj = globalThis.crypto;
  const bits = await cryptoObj.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function kdfRootKey(
  rootKey: Uint8Array,
  dhSecret: Uint8Array,
): Promise<{ nextRootKey: Uint8Array; chainKey: Uint8Array }> {
  const cryptoObj = globalThis.crypto;
  const enc = new TextEncoder();
  const hkdfKey = await cryptoObj.subtle.importKey(
    "raw",
    dhSecret,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const derived = await cryptoObj.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: rootKey,
      info: enc.encode("TescordDoubleRatchetRootKDF"),
    },
    hkdfKey,
    512,
  );
  const buf = new Uint8Array(derived);
  return {
    nextRootKey: buf.slice(0, 32),
    chainKey: buf.slice(32, 64),
  };
}

export async function kdfChainKey(
  chainKey: Uint8Array,
): Promise<{ nextChainKey: Uint8Array; messageKey: Uint8Array }> {
  const cryptoObj = globalThis.crypto;
  const enc = new TextEncoder();
  const hkdfKey = await cryptoObj.subtle.importKey(
    "raw",
    chainKey,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const derived = await cryptoObj.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("TescordDoubleRatchetChainKDF"),
    },
    hkdfKey,
    512,
  );
  const buf = new Uint8Array(derived);
  return {
    nextChainKey: buf.slice(0, 32),
    messageKey: buf.slice(32, 64),
  };
}

export async function computeFingerprint(pubBase64: string): Promise<string> {
  const cryptoObj = globalThis.crypto;
  const digest = await cryptoObj.subtle.digest(
    "SHA-256",
    base64ToBytes(pubBase64),
  );
  return bytesToHex(new Uint8Array(digest)).slice(0, 16).toUpperCase();
}

export async function encryptMessageWithKey(
  plaintext: string,
  messageKey: Uint8Array,
  associatedData: Uint8Array,
): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const cryptoObj = globalThis.crypto;
  const key = await cryptoObj.subtle.importKey(
    "raw",
    messageKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ctBuf = await cryptoObj.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData },
    key,
    enc.encode(plaintext),
  );
  const rawCt = new Uint8Array(ctBuf);
  const tag = rawCt.slice(rawCt.length - 16);
  const ciphertext = rawCt.slice(0, rawCt.length - 16);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
  };
}

export async function decryptMessageWithKey(
  ciphertextBase64: string,
  ivBase64: string,
  tagBase64: string,
  messageKey: Uint8Array,
  associatedData: Uint8Array,
): Promise<string> {
  const cryptoObj = globalThis.crypto;
  const key = await cryptoObj.subtle.importKey(
    "raw",
    messageKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const ct = base64ToBytes(ciphertextBase64);
  const tag = base64ToBytes(tagBase64);
  const full = new Uint8Array(ct.length + tag.length);
  full.set(ct, 0);
  full.set(tag, ct.length);
  const iv = base64ToBytes(ivBase64);
  const dec = new TextDecoder();
  const ptBuf = await cryptoObj.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: associatedData },
    key,
    full,
  );
  return dec.decode(ptBuf);
}

export class DoubleRatchetSession {
  public localUserId: string;
  public peerUserId: string;
  private rootKey: Uint8Array;
  private sendingChainKey: Uint8Array | null = null;
  private receivingChainKey: Uint8Array | null = null;
  private localDhKeyPair: CryptoKeyPair | null = null;
  private localDhPublicKeyB64: string | null = null;
  private remoteDhPublicKey: CryptoKey | null = null;
  private remoteDhPublicKeyB64: string | null = null;
  private sendingSeq: number = 0;
  private receivingSeq: number = 0;
  private previousChainLength: number = 0;
  private skippedMessageKeys: Map<string, Uint8Array> = new Map();

  // 频道群组模式支持 (Channel / Group Sender-Key Ratchet Mode)
  private isChannelMode: boolean = false;
  private channelId: string | null = null;
  private channelReceivingChains: Map<
    string,
    { chainKey: Uint8Array; seq: number }
  > = new Map();
  private cachedFingerprint: string | null = null;

  constructor(localUserId: string, peerUserId: string, rootKey: Uint8Array) {
    this.localUserId = localUserId;
    this.peerUserId = peerUserId;
    this.rootKey = new Uint8Array(rootKey);
  }

  public async initAsAlice(peerDhPublicKey: CryptoKey | string): Promise<void> {
    this.isChannelMode = false;
    if (typeof peerDhPublicKey === "string") {
      this.remoteDhPublicKey = await importDhPublicKey(peerDhPublicKey);
      this.remoteDhPublicKeyB64 = peerDhPublicKey;
    } else {
      this.remoteDhPublicKey = peerDhPublicKey;
      this.remoteDhPublicKeyB64 = await exportDhPublicKey(peerDhPublicKey);
    }
    this.localDhKeyPair = await generateDhKeyPair();
    this.localDhPublicKeyB64 = await exportDhPublicKey(
      this.localDhKeyPair.publicKey,
    );
    this.cachedFingerprint = await computeFingerprint(this.localDhPublicKeyB64);
    const dhSecret = await computeDhSecret(
      this.localDhKeyPair.privateKey,
      this.remoteDhPublicKey,
    );
    const { nextRootKey, chainKey } = await kdfRootKey(this.rootKey, dhSecret);
    this.rootKey = nextRootKey;
    this.sendingChainKey = chainKey;
    this.sendingSeq = 0;
  }

  public async initAsBob(bobDhKeyPair: CryptoKeyPair): Promise<void> {
    this.isChannelMode = false;
    this.localDhKeyPair = bobDhKeyPair;
    this.localDhPublicKeyB64 = await exportDhPublicKey(
      this.localDhKeyPair.publicKey,
    );
    this.cachedFingerprint = await computeFingerprint(this.localDhPublicKeyB64);
    this.sendingChainKey = null;
    this.receivingChainKey = null;
    this.sendingSeq = 0;
    this.receivingSeq = 0;
  }

  // 绝密频道模式：基于频道根密钥派生发送者棘轮链
  public async initAsChannel(
    channelId: string,
    currentUserId: string,
  ): Promise<void> {
    this.isChannelMode = true;
    this.channelId = channelId;
    this.localUserId = currentUserId;
    this.localDhKeyPair = await generateDhKeyPair();
    this.localDhPublicKeyB64 = await exportDhPublicKey(
      this.localDhKeyPair.publicKey,
    );
    this.cachedFingerprint = await computeFingerprint(this.localDhPublicKeyB64);

    const enc = new TextEncoder();
    const senderSeed = enc.encode(
      `TescordChannelSenderChain:${channelId}:${currentUserId}:${this.localDhPublicKeyB64}`,
    );
    const { chainKey } = await kdfRootKey(this.rootKey, senderSeed);
    this.sendingChainKey = chainKey;
    this.sendingSeq = 0;
  }

  public async ratchetEncrypt(
    plaintext: string,
    channelId: string = "e2ee-channel",
  ): Promise<EncryptedMessageEnvelope> {
    if (!this.localDhKeyPair) {
      this.localDhKeyPair = await generateDhKeyPair();
      this.localDhPublicKeyB64 = await exportDhPublicKey(
        this.localDhKeyPair.publicKey,
      );
      this.cachedFingerprint = await computeFingerprint(
        this.localDhPublicKeyB64,
      );
    }
    if (!this.sendingChainKey) {
      if (this.isChannelMode) {
        const localPub =
          this.localDhPublicKeyB64 ||
          (await exportDhPublicKey(this.localDhKeyPair.publicKey));
        const enc = new TextEncoder();
        const senderSeed = enc.encode(
          `TescordChannelSenderChain:${channelId}:${this.localUserId}:${localPub}`,
        );
        const { chainKey } = await kdfRootKey(this.rootKey, senderSeed);
        this.sendingChainKey = chainKey;
        this.sendingSeq = 0;
      } else {
        if (!this.remoteDhPublicKey) {
          throw new Error("缺少远端 DH 公钥，无法建立发送链");
        }
        const dhSecret = await computeDhSecret(
          this.localDhKeyPair.privateKey,
          this.remoteDhPublicKey,
        );
        const { nextRootKey, chainKey } = await kdfRootKey(
          this.rootKey,
          dhSecret,
        );
        this.rootKey = nextRootKey;
        this.sendingChainKey = chainKey;
        this.sendingSeq = 0;
      }
    }

    const { nextChainKey, messageKey } = await kdfChainKey(
      this.sendingChainKey,
    );
    this.sendingChainKey = nextChainKey;
    const currentSeq = this.sendingSeq;
    this.sendingSeq += 1;

    const localPubB64 =
      this.localDhPublicKeyB64 ||
      (await exportDhPublicKey(this.localDhKeyPair.publicKey));
    const enc = new TextEncoder();
    const associatedData = enc.encode(
      `${channelId}:${localPubB64}:${currentSeq}`,
    );

    const { ciphertext, iv, tag } = await encryptMessageWithKey(
      plaintext,
      messageKey,
      associatedData,
    );

    const fingerprint =
      this.cachedFingerprint || (await computeFingerprint(localPubB64));

    return {
      version: 1,
      senderId: this.localUserId,
      channelId,
      ephemeralPublicKey: localPubB64,
      sequenceNumber: currentSeq,
      previousChainLength: this.previousChainLength,
      ciphertext,
      iv,
      tag,
      fingerprint,
    };
  }

  public async ratchetDecrypt(
    envelope: EncryptedMessageEnvelope,
  ): Promise<string> {
    const peerPubB64 = envelope.ephemeralPublicKey;
    const enc = new TextEncoder();
    const associatedData = enc.encode(
      `${envelope.channelId}:${peerPubB64}:${envelope.sequenceNumber}`,
    );

    if (this.isChannelMode) {
      // 频道模式：按 [senderId + ephemeralPublicKey] 隔离接收链并执行前向棘轮
      const cacheKey = `${envelope.senderId}:${peerPubB64}:${envelope.sequenceNumber}`;
      if (this.skippedMessageKeys.has(cacheKey)) {
        const messageKey = this.skippedMessageKeys.get(cacheKey)!;
        this.skippedMessageKeys.delete(cacheKey);
        return await decryptMessageWithKey(
          envelope.ciphertext,
          envelope.iv,
          envelope.tag,
          messageKey,
          associatedData,
        );
      }

      const chainId = `${envelope.senderId}:${peerPubB64}`;
      if (!this.channelReceivingChains.has(chainId)) {
        const senderSeed = enc.encode(
          `TescordChannelSenderChain:${envelope.channelId}:${envelope.senderId}:${peerPubB64}`,
        );
        const { chainKey } = await kdfRootKey(this.rootKey, senderSeed);
        this.channelReceivingChains.set(chainId, { chainKey, seq: 0 });
      }

      const chainState = this.channelReceivingChains.get(chainId)!;
      if (envelope.sequenceNumber < chainState.seq) {
        throw new Error(
          `消息 sequenceNumber (${envelope.sequenceNumber}) 已落后于当前接收链游标 (${chainState.seq})，该消息已解密过或已被单向棘轮消费`,
        );
      }
      const MAX_SKIP = 2000;
      if (chainState.seq + MAX_SKIP < envelope.sequenceNumber) {
        throw new Error("跳过的消息数量过多，疑似拒绝服务攻击 (DoS)");
      }

      // 处理乱序消息：将中途跳过的消息密钥暂存
      while (chainState.seq < envelope.sequenceNumber) {
        const { nextChainKey, messageKey } = await kdfChainKey(
          chainState.chainKey,
        );
        chainState.chainKey = nextChainKey;
        this.saveSkippedMessageKey(
          `${envelope.senderId}:${peerPubB64}:${chainState.seq}`,
          messageKey,
        );
        chainState.seq += 1;
      }

      const { nextChainKey, messageKey } = await kdfChainKey(
        chainState.chainKey,
      );
      chainState.chainKey = nextChainKey;
      chainState.seq += 1;

      return await decryptMessageWithKey(
        envelope.ciphertext,
        envelope.iv,
        envelope.tag,
        messageKey,
        associatedData,
      );
    }

    // 1-to-1 点对点双棘轮模式
    const cacheKey = `${peerPubB64}:${envelope.sequenceNumber}`;
    if (this.skippedMessageKeys.has(cacheKey)) {
      const messageKey = this.skippedMessageKeys.get(cacheKey)!;
      this.skippedMessageKeys.delete(cacheKey);
      return await decryptMessageWithKey(
        envelope.ciphertext,
        envelope.iv,
        envelope.tag,
        messageKey,
        associatedData,
      );
    }

    if (peerPubB64 !== this.remoteDhPublicKeyB64) {
      if (this.receivingChainKey && this.remoteDhPublicKeyB64) {
        await this.skipMessageKeys(
          this.remoteDhPublicKeyB64,
          envelope.previousChainLength,
        );
      }

      this.remoteDhPublicKeyB64 = peerPubB64;
      this.remoteDhPublicKey = await importDhPublicKey(peerPubB64);

      if (!this.localDhKeyPair) {
        throw new Error("本地 DH 密钥对尚未初始化");
      }
      const dhSecretRecv = await computeDhSecret(
        this.localDhKeyPair.privateKey,
        this.remoteDhPublicKey,
      );
      const { nextRootKey: rk1, chainKey: recvChainKey } = await kdfRootKey(
        this.rootKey,
        dhSecretRecv,
      );
      this.rootKey = rk1;
      this.receivingChainKey = recvChainKey;
      this.previousChainLength = this.sendingSeq;
      this.receivingSeq = 0;

      this.localDhKeyPair = await generateDhKeyPair();
      this.localDhPublicKeyB64 = await exportDhPublicKey(
        this.localDhKeyPair.publicKey,
      );
      this.cachedFingerprint = await computeFingerprint(
        this.localDhPublicKeyB64,
      );
      const dhSecretSend = await computeDhSecret(
        this.localDhKeyPair.privateKey,
        this.remoteDhPublicKey,
      );
      const { nextRootKey: rk2, chainKey: sendChainKey } = await kdfRootKey(
        this.rootKey,
        dhSecretSend,
      );
      this.rootKey = rk2;
      this.sendingChainKey = sendChainKey;
      this.sendingSeq = 0;
    }

    if (this.remoteDhPublicKeyB64) {
      await this.skipMessageKeys(
        this.remoteDhPublicKeyB64,
        envelope.sequenceNumber,
      );
    }

    if (!this.receivingChainKey) {
      throw new Error("接收链尚未就绪");
    }
    const { nextChainKey, messageKey } = await kdfChainKey(
      this.receivingChainKey,
    );
    this.receivingChainKey = nextChainKey;
    this.receivingSeq += 1;

    return await decryptMessageWithKey(
      envelope.ciphertext,
      envelope.iv,
      envelope.tag,
      messageKey,
      associatedData,
    );
  }

  private saveSkippedMessageKey(keyId: string, messageKey: Uint8Array): void {
    const MAX_KEYS = 2000;
    if (this.skippedMessageKeys.size >= MAX_KEYS) {
      const oldestKey = this.skippedMessageKeys.keys().next().value;
      if (oldestKey) this.skippedMessageKeys.delete(oldestKey);
    }
    this.skippedMessageKeys.set(keyId, messageKey);
  }

  private async skipMessageKeys(
    pubB64: string,
    untilSeq: number,
  ): Promise<void> {
    if (!this.receivingChainKey) return;
    const MAX_SKIP = 2000;
    if (this.receivingSeq + MAX_SKIP < untilSeq) {
      throw new Error("跳过的消息数量过多，疑似拒绝服务攻击 (DoS)");
    }
    while (this.receivingSeq < untilSeq) {
      const { nextChainKey, messageKey } = await kdfChainKey(
        this.receivingChainKey,
      );
      this.receivingChainKey = nextChainKey;
      const keyId = `${pubB64}:${this.receivingSeq}`;
      this.saveSkippedMessageKey(keyId, messageKey);
      this.receivingSeq += 1;
    }
  }

  public getFingerprint(): string {
    if (this.cachedFingerprint) return this.cachedFingerprint;
    if (this.remoteDhPublicKeyB64) {
      return this.remoteDhPublicKeyB64.slice(0, 16).toUpperCase();
    }
    return "UNVERIFIED";
  }

  public async getSafetyNumber(): Promise<string> {
    if (this.cachedFingerprint) return this.cachedFingerprint;
    const key =
      this.localDhPublicKeyB64 ||
      (this.localDhKeyPair
        ? await exportDhPublicKey(this.localDhKeyPair.publicKey)
        : null);
    if (!key) return "UNVERIFIED";
    this.cachedFingerprint = await computeFingerprint(key);
    return this.cachedFingerprint;
  }
}

// 11.4 客户端本地密文全文检索与倒排索引 (5.4 Client-Side FTS)
export interface FtsDocument {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface FtsSearchResult extends FtsDocument {
  score: number;
}

export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // 匹配英文字词与数字
  const words = lower.match(/[a-z0-9_]+/g) || [];
  tokens.push(...words);

  // 匹配中日韩字符 (CJK Unigrams - 滤除常见单字虚词停用词)
  const cjkChars = lower.match(/[\u4e00-\u9fa5]/g) || [];
  const CJK_STOP_WORDS = new Set([
    "的",
    "了",
    "和",
    "是",
    "就",
    "都",
    "而",
    "及",
    "与",
    "着",
    "在",
    "之",
  ]);
  for (const ch of cjkChars) {
    if (!CJK_STOP_WORDS.has(ch)) {
      tokens.push(ch);
    }
  }

  // 提取 CJK 二元分词 (Bigrams) 用于快速子词精确匹配
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.push(cjkChars[i] + cjkChars[i + 1]);
  }

  return Array.from(new Set(tokens.filter((t) => t.length > 0)));
}

export class ClientSideFtsEngine {
  private documents: Map<string, FtsDocument> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();

  public addDocument(doc: FtsDocument): void {
    this.removeDocument(doc.id);
    this.documents.set(doc.id, doc);
    const tokens = tokenizeText(doc.content);
    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }
  }

  public removeDocument(id: string): void {
    if (!this.documents.has(id)) return;
    const oldDoc = this.documents.get(id)!;
    const tokens = tokenizeText(oldDoc.content);
    for (const token of tokens) {
      const set = this.invertedIndex.get(token);
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          this.invertedIndex.delete(token);
        }
      }
    }
    this.documents.delete(id);
  }

  public search(query: string, filterChannelId?: string): FtsSearchResult[] {
    const queryTokens = tokenizeText(query);
    if (queryTokens.length === 0) return [];

    const scores = new Map<string, number>();
    for (const token of queryTokens) {
      const docIds = this.invertedIndex.get(token);
      if (docIds) {
        for (const id of docIds) {
          scores.set(id, (scores.get(id) || 0) + 1);
        }
      }
    }

    const results: FtsSearchResult[] = [];
    for (const [id, score] of scores.entries()) {
      const doc = this.documents.get(id);
      if (!doc) continue;
      if (filterChannelId && doc.channelId !== filterChannelId) continue;
      results.push({ ...doc, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  public clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
  }

  public get size(): number {
    return this.documents.size;
  }
}

// ==========================================
// 19. 多语言与国际化契约 (i18n Localization)
// ==========================================
export type SupportedLocale = "zh-CN" | "en-US" | "ja-JP";

export interface LocaleOption {
  code: SupportedLocale;
  label: string;
  englishName: string;
  nativeName: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
  {
    code: "zh-CN",
    label: "简体中文",
    englishName: "Simplified Chinese",
    nativeName: "简体中文",
  },
  {
    code: "en-US",
    label: "English (US)",
    englishName: "English (US)",
    nativeName: "English (US)",
  },
  {
    code: "ja-JP",
    label: "日本語",
    englishName: "Japanese",
    nativeName: "日本語",
  },
];

// ==========================================
// 20. 超级管理员与全平台治理契约 (Super Admin)
// ==========================================
export interface AdminOverviewStats {
  totalUsers: number;
  onlineUsers: number;
  totalGuilds: number;
  totalMessages: number;
  uptimeSeconds: number;
  memoryUsageMb: number;
}

export interface AdminUserItem extends User {
  guildCount: number;
  messageCount: number;
  isBanned: boolean;
  role: SystemRole;
}

export interface AdminUpdateUserDTO {
  role?: SystemRole;
  isBanned?: boolean;
  resetPassword?: boolean;
}

export interface AdminUpdateUserResult {
  user: AdminUserItem;
  temporaryPassword?: string;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface AdminGuildItem {
  id: string;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  channelCount: number;
  createdAt: string;
}

export interface SystemBroadcastDTO {
  id: string;
  title: string;
  content: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  senderName: string;
  createdAt: string;
}

export interface SystemSettingsDTO {
  allowRegistration: boolean;
  maintenanceMode?: boolean;
  systemAnnouncement?: string;
}

export interface MaintenanceUpdatePayload {
  enabled: boolean;
  announcement?: string;
  estimatedEndTime?: string | null;
  triggeredAt?: string;
}

// ==========================================
// 21. 私信与 1v1 实时音视频呼叫契约 (Direct Messages & 1v1 Calling)
// ==========================================
export interface CreateDMDTO {
  recipientId: string;
}

export interface ChannelRecipientInfo {
  userId: string;
  isClosed: boolean;
  lastReadAt: string;
  lastReadSequence: number;
  user: User;
}

export type DMCallState = "ringing" | "connecting" | "active" | "ended";

export interface DMCallSession {
  callId: string;
  channelId: string;
  callerId: string;
  calleeId: string;
  hasVideo: boolean;
  state: DMCallState;
  callerSessionId?: string;
  acceptedSessionId?: string;
  createdAt: string;
  expiresAt: string;
  endedReason?: string;
}

export interface CallOfferPayload {
  callId: string;
  channelId: string;
  caller: Pick<User, "id" | "username" | "avatarUrl">;
  hasVideo: boolean;
  expiresAt: string;
}

export interface CallAnswerPayload {
  callId: string;
  channelId: string;
  responderId: string;
  acceptedSessionId: string;
}

export interface CallRejectPayload {
  callId: string;
  channelId: string;
  rejecterId: string;
  reason?: string;
}

export interface CallEndPayload {
  callId: string;
  channelId: string;
  endedBy: string;
  reason?: string;
}

export interface DMCallTokenResponse {
  token: string;
  callId: string;
  roomName: string;
  serverUrl: string;
}

export interface RegisterDeviceKeyDTO {
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  fingerprint: string;
}

export interface DevicePublicKey extends RegisterDeviceKeyDTO {
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaKeyEnvelopePayload {
  channelId: string;
  callId: string;
  senderId: string;
  senderDeviceId: string;
  recipientId: string;
  recipientDeviceId: string;
  ephemeralPublicKey: string;
  senderSigningPublicKey: string;
  senderFingerprint: string;
  iv: string;
  ciphertext: string;
  signature: string;
  createdAt: string;
}

export interface MarkDMReadDTO {
  lastReadSequence: number;
}

export interface GetMessagesQueryDTO {
  limit?: number | string;
  before?: number | string;
  after?: number | string;
}

export interface ChannelMetaRecord {
  channelId: string;
  lastReadSequence: number;
  scrollTop: number;
  isNearBottom: boolean;
  lastVisitedAt: number;
}

// ==========================================
// 22. 桌面客户端自动更新与 gh-proxy 加速协议 (Client Updater & Acceleration)
// ==========================================
export type UpdaterState =
  | "disabled"     // 未配置 Git 仓库或更新服务被禁用
  | "idle"         // 空闲待命
  | "checking"     // 正在检查更新
  | "downloading"  // 正在下载增量包
  | "verifying"    // 正在校验 SHA256 哈希
  | "extracting"   // 正在解压至本地用户目录
  | "ready"        // 增量包已就绪，等待重启生效
  | "error";       // 发生异常

export interface UpdateManifest {
  version: string;                    // 目标版本号 (如 "0.2.0")
  releaseDate: string;                // 发布时间 (ISO 8601)
  minHostVersion: string;             // 最低需要的 Electron 原生 Host 壳版本
  webPackageUrl: string;              // 增量包相对路径或完整 URL (如 tescord-web-v0.2.0.zip)
  webPackageSha256: string;           // 增量包 SHA256 校验和
  changelog?: string;                 // 更新日志段落
  mandatory?: boolean;                // 是否为强制更新
  hostInstallers?: {
    windows?: { url: string; sha256?: string };
    macOS?: { url: string; sha256?: string };
    linux?: { url: string; sha256?: string };
  };
}

export interface UpdateCheckResult {
  enabled: boolean;
  hasUpdate: boolean;
  currentHostVersion: string;
  currentWebVersion: string;
  latestVersion?: string;
  isHostUpdateRequired?: boolean;
  manifest?: UpdateManifest;
  error?: string;
}

export interface UpdateProgress {
  state: UpdaterState;
  percent: number;                    // 0 - 100
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSec?: number;
  error?: string;
}

export interface UpdaterConfig {
  enabled: boolean;
  currentHostVersion: string;
  currentWebVersion: string;
  gitRepo: string | null;             // e.g. "owner/repo" 或 null
  preferredProxy: string;             // 默认 "https://v6.gh-proxy.org/"
  customProxy?: string;               // 用户自定义代理地址
  lastCheckedAt?: string;
}

export interface SetCustomProxyDTO {
  proxyUrl: string;                   // 自定义代理前缀，传空字符串代表清除自定义代理
}

