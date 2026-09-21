// ==========================================
// Tescord 统一协议与核心数据类型定义 (Contracts)
// ==========================================

// 1. 用户模型与鉴权体系
export type UserStatus = "ONLINE" | "IDLE" | "DND" | "OFFLINE";

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  status: UserStatus;
  customStatus?: string | null;
  bio?: string | null;
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
  { flag: PermissionFlags.VIEW_AUDIT_LOG, name: "查看审计日志", description: "允许成员查看服务器管理操作的记录流水。", category: "GENERAL" },
  { flag: PermissionFlags.MANAGE_GUILD, name: "管理服务器", description: "允许成员修改服务器名称、更换图标和全局设置。", category: "GENERAL" },
  { flag: PermissionFlags.MANAGE_ROLES, name: "管理角色", description: "允许成员创建新角色并编辑低于此职级的角色与权限。", category: "GENERAL" },
  { flag: PermissionFlags.MANAGE_CHANNELS, name: "管理频道", description: "允许成员创建、编辑或删除频道与分类。", category: "GENERAL" },
  // 成员处置与邀请
  { flag: PermissionFlags.KICK_MEMBERS, name: "踢出成员", description: "允许成员将低于此职级的成员移出此服务器。", category: "MEMBERSHIP" },
  { flag: PermissionFlags.BAN_MEMBERS, name: "封禁成员", description: "允许成员将低于此职级的成员永久封禁并列入黑名单。", category: "MEMBERSHIP" },
  { flag: PermissionFlags.CREATE_INVITE, name: "创建邀请", description: "允许成员创建服务器邀请码邀请新用户加入。", category: "MEMBERSHIP" },
  { flag: PermissionFlags.CHANGE_NICKNAME, name: "修改昵称", description: "允许成员修改自己在服务器内的专属昵称。", category: "MEMBERSHIP" },
  { flag: PermissionFlags.MANAGE_NICKNAMES, name: "管理昵称", description: "允许成员修改其他成员的昵称。", category: "MEMBERSHIP" },
  // 文本频道权限
  { flag: PermissionFlags.VIEW_CHANNEL, name: "查看频道", description: "允许成员查看频道列表并阅读文本频道内容。", category: "TEXT" },
  { flag: PermissionFlags.SEND_MESSAGES, name: "发送消息", description: "允许成员在文字频道中发送消息。", category: "TEXT" },
  { flag: PermissionFlags.ATTACH_FILES, name: "发送附件", description: "允许成员在文字频道中上传图片、文件或媒体附件。", category: "TEXT" },
  { flag: PermissionFlags.ADD_REACTIONS, name: "添加反应", description: "允许成员在已有消息上添加表情反应。", category: "TEXT" },
  { flag: PermissionFlags.READ_MESSAGE_HISTORY, name: "阅读历史消息", description: "允许成员查看频道过去的聊天记录。", category: "TEXT" },
  { flag: PermissionFlags.MANAGE_MESSAGES, name: "管理消息", description: "允许成员删除或置顶其他成员发送的消息。", category: "TEXT" },
  // 语音频道权限
  { flag: PermissionFlags.CONNECT, name: "连接语音", description: "允许成员加入并收听语音频道。", category: "VOICE" },
  { flag: PermissionFlags.SPEAK, name: "说话开麦", description: "允许成员在语音频道中自由开麦发言。", category: "VOICE" },
  { flag: PermissionFlags.STREAM, name: "屏幕共享", description: "允许成员在语音频道中分享屏幕或摄像头视频流。", category: "VOICE" },
  { flag: PermissionFlags.MUTE_MEMBERS, name: "禁言闭麦成员", description: "允许成员在语音频道中静音闭麦其他成员。", category: "VOICE" },
  { flag: PermissionFlags.DEAFEN_MEMBERS, name: "禁听成员", description: "允许成员在语音频道中抑制其他成员的收听状态。", category: "VOICE" },
  { flag: PermissionFlags.MOVE_MEMBERS, name: "移动成员", description: "允许成员在不同语音频道之间拖拽转移成员。", category: "VOICE" },
  // 高级管理
  { flag: PermissionFlags.ADMINISTRATOR, name: "管理员 (最高特权)", description: "拥有服务器的全部最高特权，无视其他所有权限限制，请极其慎重授予！", category: "ADVANCED" },
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
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string");
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
export type ChannelType = "TEXT" | "VOICE";

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: ChannelType;
  topic?: string | null;
  parentId?: string | null; // 频道分类 ID
  position: number; // 排序位置
  isE2EE?: boolean;
  bitrate?: number; // 语音比特率 (默认 64000)
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

export interface Guild {
  id: string;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  ownerId: string;
  channels: Channel[];
  members: GuildMember[];
  roles?: Role[];
  createdAt: string;
  updatedAt?: string;
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

export interface GatewayPayload<T = any> {
  op: GatewayOpCode;
  d?: T;
  s?: number; // 序列号
  t?: string; // 事件名 (当 op === DISPATCH 时)
}

export interface HelloPayload {
  heartbeatInterval: number; // 毫秒
}

export interface IdentifyPayload {
  token: string;
  properties: {
    os: string;
    browser: string;
    device: string;
  };
}

export interface VoiceStateUpdatePayload {
  guildId: string;
  channelId: string | null; // null 代表退出语音频道
  selfMute?: boolean;
  selfDeaf?: boolean;
  selfVideo?: boolean;
  streaming?: boolean;
}

export interface VoiceState {
  userId: string;
  guildId: string;
  channelId: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
  streaming: boolean;
  user?: User;
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
  noiseSuppression: boolean; // RNNoise AI 神经网络降噪
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

export interface NetworkStats {
  identity: string; // 用户唯一标识 / userId
  rtt: number; // 往返延迟 Round-Trip Time (ms)
  packetLoss: number; // 丢包率百分比 (0% - 100%)
  jitter: number; // 网络抖动 Jitter (ms)
  bitrate: number; // 吞吐码率 (kbps)
  codec: string; // 音频编码 (如 'Opus')
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
  STREAM_START: "STREAM_START",
  STREAM_STOP: "STREAM_STOP",
  E2EE_KEY_EXCHANGE: "E2EE_KEY_EXCHANGE",
  E2EE_CHANNEL_UPDATE: "E2EE_CHANNEL_UPDATE",
} as const;

export type GatewayEventType =
  (typeof GatewayEvents)[keyof typeof GatewayEvents];

// 10. 阶段四：屏幕分享直播、Simulcast 与桌面原生协议 (Phase 4 Contracts)

export type ScreenShareResolution = "720p" | "1080p" | "1440p" | "4k";
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

export const SCREEN_SHARE_PRESETS: Record<string, ScreenSharePreset> = {
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
}

export interface ScreenShareOptions {
  sourceId?: string;
  sourceType?: "screen" | "window";
  preset: string; // e.g. "1080p60"
  captureAudio: boolean;
  simulcast: boolean;
  mixedAudio?: boolean;
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

  public async initAsAlice(
    peerDhPublicKey: CryptoKey | string,
  ): Promise<void> {
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
    const { nextRootKey, chainKey } = await kdfRootKey(
      this.rootKey,
      dhSecret,
    );
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
