// ==========================================
// Tescord 统一协议与核心数据类型定义 (Contracts)
// ==========================================

// 1. 用户模型与鉴权体系
export type UserStatus = "ONLINE" | "IDLE" | "DND" | "OFFLINE" | "INVISIBLE";

export type SystemRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export type ActivityType =
  "PLAYING" | "STREAMING" | "LISTENING" | "WATCHING" | "CUSTOM";

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
  displayName?: string | null;
  discriminator?: string;
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

export type AuthFailureCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_REFRESH_INVALID"
  | "AUTH_REFRESH_EXPIRED"
  | "AUTH_ACCOUNT_BANNED"
  | "AUTH_SESSION_REVOKED";

export interface AuthErrorResponse {
  error: string;
  code: AuthFailureCode | "AUTH_SERVICE_UNAVAILABLE";
}

export interface RevokeSessionDTO {
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  token: string; // 兼容旧接口 token === accessToken
  accessToken: string;
  refreshToken: string;
}

export interface CheckEmailDTO {
  email: string;
}

export interface CheckEmailResponse {
  exists: boolean;
}

export interface RegisterDTO {
  username?: string;
  nickname?: string;
  email: string;
  password: string;
  inviteCode?: string;
}

export interface LoginDTO {
  emailOrUsername: string;
  password: string;
  rememberMe?: boolean;
}

export interface SavedAccount {
  id: string;
  email: string;
  username: string;
  displayName?: string | null;
  discriminator?: string;
  avatarUrl?: string | null;
  lastActiveAt: number;
  rememberPassword?: boolean;
  refreshToken?: string;
}

export interface RefreshTokenDTO {
  refreshToken: string;
}

// WebAuthn / Passkey 通行密钥认证契约
export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  aaguid?: string | null;
  transports?: string[] | null;
}

export interface WebAuthnRegisterOptionsResponse {
  options: any; // PublicKeyCredentialCreationOptionsJSON
  challengeId: string;
}

export interface WebAuthnVerifyRegisterDTO {
  challengeId: string;
  response: any; // RegistrationResponseJSON
  name?: string;
}

export interface WebAuthnLoginOptionsResponse {
  options: any; // PublicKeyCredentialRequestOptionsJSON
  challengeId: string;
}

export interface WebAuthnVerifyLoginDTO {
  challengeId: string;
  response: any; // AuthenticationResponseJSON
}

export interface UpdatePasskeyDTO {
  name: string;
}

export interface DeletePasskeyDTO {
  password?: string;
}

export interface DesktopPasskeyAuthPayload {
  action: "login" | "register";
  apiBase: string;
  emailOrUsername?: string;
  deviceName?: string;
  token?: string;
}

export interface DesktopPasskeyAuthResult {
  success: boolean;
  tokens?: AuthTokens;
  error?: string;
  code?: ErrorCode;
}

export interface UpdateProfileDTO {
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  customStatus?: string | null;
  bio?: string | null;
  status?: UserStatus;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  themeColor?: string | null;
  showActivity?: boolean;
}

export type RelationshipType =
  "FRIEND" | "PENDING_INCOMING" | "PENDING_OUTGOING" | "BLOCKED";

export interface Relationship {
  id: string;
  userId: string;
  targetUserId: string;
  type: RelationshipType;
  createdAt: string;
  updatedAt: string;
  targetUser?: User;
}

export interface SendFriendRequestDTO {
  identifier: string;
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

// 权限覆写与通道专属权限定义
export type OverwriteTargetType = "ROLE" | "MEMBER";

export interface PermissionOverwrite {
  id: string;
  guildId: string;
  channelId?: string | null;
  categoryId?: string | null;
  targetType: OverwriteTargetType;
  targetId: string;
  allow: number;
  deny: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SetPermissionOverwriteDTO {
  targetType: OverwriteTargetType;
  allow: number;
  deny: number;
}

export const CHANNEL_TEXT_PERMISSIONS: PermissionFlags[] = [
  PermissionFlags.VIEW_CHANNEL,
  PermissionFlags.MANAGE_CHANNELS,
  PermissionFlags.MANAGE_ROLES,
  PermissionFlags.SEND_MESSAGES,
  PermissionFlags.ATTACH_FILES,
  PermissionFlags.READ_MESSAGE_HISTORY,
  PermissionFlags.ADD_REACTIONS,
  PermissionFlags.MANAGE_MESSAGES,
  PermissionFlags.CREATE_INVITE,
];

export const CHANNEL_VOICE_PERMISSIONS: PermissionFlags[] = [
  PermissionFlags.VIEW_CHANNEL,
  PermissionFlags.MANAGE_CHANNELS,
  PermissionFlags.MANAGE_ROLES,
  PermissionFlags.CONNECT,
  PermissionFlags.SPEAK,
  PermissionFlags.STREAM,
  PermissionFlags.MUTE_MEMBERS,
  PermissionFlags.DEAFEN_MEMBERS,
  PermissionFlags.MOVE_MEMBERS,
];

export const CHANNEL_CATEGORY_PERMISSIONS: PermissionFlags[] = [
  ...Array.from(
    new Set([...CHANNEL_TEXT_PERMISSIONS, ...CHANNEL_VOICE_PERMISSIONS]),
  ),
];

export interface ComputePermissionsContext {
  userId: string;
  isOwner?: boolean;
  isSuperAdmin?: boolean;
  userRoleIds: string[];
  guildRoles: Role[];
  channelOverwrites?: PermissionOverwrite[];
  categoryOverwrites?: PermissionOverwrite[];
}

export function computeEffectivePermissions(
  context: ComputePermissionsContext,
): number {
  if (context.isOwner || context.isSuperAdmin) {
    return ~0;
  }

  const everyoneRole = context.guildRoles.find((r) => r.isDefault);
  let perms = everyoneRole ? everyoneRole.permissions : 0;

  for (const roleId of context.userRoleIds) {
    const role = context.guildRoles.find((r) => r.id === roleId);
    if (role) {
      perms |= role.permissions;
    }
  }

  if (
    (perms & PermissionFlags.ADMINISTRATOR) ===
    PermissionFlags.ADMINISTRATOR
  ) {
    return ~0;
  }

  if (context.categoryOverwrites && context.categoryOverwrites.length > 0) {
    if (everyoneRole) {
      const catEveryone = context.categoryOverwrites.find(
        (o) => o.targetType === "ROLE" && o.targetId === everyoneRole.id,
      );
      if (catEveryone) {
        perms = (perms & ~catEveryone.deny) | catEveryone.allow;
      }
    }

    let catRoleAllow = 0;
    let catRoleDeny = 0;
    for (const roleId of context.userRoleIds) {
      const catRoleOw = context.categoryOverwrites.find(
        (o) => o.targetType === "ROLE" && o.targetId === roleId,
      );
      if (catRoleOw) {
        catRoleAllow |= catRoleOw.allow;
        catRoleDeny |= catRoleOw.deny;
      }
    }
    perms = (perms & ~catRoleDeny) | catRoleAllow;

    const catMemberOw = context.categoryOverwrites.find(
      (o) => o.targetType === "MEMBER" && o.targetId === context.userId,
    );
    if (catMemberOw) {
      perms = (perms & ~catMemberOw.deny) | catMemberOw.allow;
    }
  }

  if (context.channelOverwrites && context.channelOverwrites.length > 0) {
    if (everyoneRole) {
      const chEveryone = context.channelOverwrites.find(
        (o) => o.targetType === "ROLE" && o.targetId === everyoneRole.id,
      );
      if (chEveryone) {
        perms = (perms & ~chEveryone.deny) | chEveryone.allow;
      }
    }

    let chRoleAllow = 0;
    let chRoleDeny = 0;
    for (const roleId of context.userRoleIds) {
      const chRoleOw = context.channelOverwrites.find(
        (o) => o.targetType === "ROLE" && o.targetId === roleId,
      );
      if (chRoleOw) {
        chRoleAllow |= chRoleOw.allow;
        chRoleDeny |= chRoleOw.deny;
      }
    }
    perms = (perms & ~chRoleDeny) | chRoleAllow;

    const chMemberOw = context.channelOverwrites.find(
      (o) => o.targetType === "MEMBER" && o.targetId === context.userId,
    );
    if (chMemberOw) {
      perms = (perms & ~chMemberOw.deny) | chMemberOw.allow;
    }
  }

  return perms;
}

// 3. 频道与公会 (Guild / Server)
export type ChannelType = "TEXT" | "VOICE" | "DM" | "GROUP_DM";

export interface ChannelCategory {
  id: string;
  guildId: string;
  name: string;
  position: number;
  overwrites?: PermissionOverwrite[];
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
  voiceMode?: "sfu" | "p2p_mesh";
  streamMode?: StreamTransmissionMode;
  recipients?: User[];
  lastMessage?: Message;
  unreadCount?: number;
  lastReadSequence?: number;
  overwrites?: PermissionOverwrite[];
  createdAt: string;
}

export interface ChannelUnreadInfo {
  channelId: string;
  guildId?: string | null;
  hasUnread: boolean;
  unreadCount: number;
  mentionCount: number;
  lastReadSequence: number;
}

export type ChannelUnreadMap = Record<string, ChannelUnreadInfo>;

export interface ChannelReadState {
  id: string;
  userId: string;
  channelId: string;
  guildId?: string | null;
  lastReadSequence: number;
  lastReadAt: string;
}

export interface MarkChannelReadDTO {
  sequence?: number;
  lastReadSequence?: number;
}

export interface MarkGuildReadDTO {
  guildId: string;
}

export interface MarkChannelReadResponse {
  success: boolean;
  channelId: string;
  lastReadSequence: number;
}

export interface MarkGuildReadResponse {
  success: boolean;
  guildId: string;
  updatedChannels: { channelId: string; lastReadSequence: number }[];
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

export interface ActiveGuildInviteResponse {
  invite: Invite | null;
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
  bitrate?: number;
  voiceMode?: "sfu" | "p2p_mesh";
  streamMode?: StreamTransmissionMode;
  isPrivate?: boolean;
  allowedRoleIds?: string[];
  allowedUserIds?: string[];
}

export interface UpdateChannelDTO {
  name?: string;
  topic?: string | null;
  parentId?: string | null;
  position?: number;
  isE2EE?: boolean;
  bitrate?: number;
  voiceMode?: "sfu" | "p2p_mesh";
  streamMode?: StreamTransmissionMode;
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
  maxAge?: number;
  maxUses?: number;
  expiresInHours?: number;
  isTemporary?: boolean;
  forceNew?: boolean;
}

export interface InvitePreviewDTO {
  code: string;
  guild: {
    id: string;
    name: string;
    iconUrl?: string | null;
    description?: string | null;
    createdAt?: string;
    approximateMemberCount?: number;
    approximatePresenceCount?: number;
  };
  inviter?: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  channel?: {
    id: string;
    name: string;
  } | null;
  expiresAt?: string | null;
  isTemporary?: boolean;
  approximateMemberCount?: number;
  approximatePresenceCount?: number;
  isMember?: boolean;
}

export interface JoinInviteDTO {
  code: string;
}

// 4. 消息系统与互动反应
export type AttachmentVariant = "original" | "preview";

export interface Attachment {
  id: string;
  url: string;
  previewUrl?: string;
  downloadUrl?: string;
  expiresAt?: number; // Unix milliseconds for signed URLs
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface DesktopServerConfig {
  serverUrl: string;
  gatewayUrl: string;
  livekitUrl: string;
  voiceEngine: "livekit" | "cloudflare_realtime";
  webUrl?: string;
}

export interface FileUrlAccess {
  fileUrl: string;
  url: string;
  previewUrl?: string;
  downloadUrl?: string;
  expiresAt: number;
}

export interface AttachmentAccessRequest {
  attachmentIds?: string[];
  fileUrls?: string[];
}

export interface AttachmentAccessResponse {
  attachments: Array<
    Pick<Attachment, "id" | "url" | "previewUrl" | "downloadUrl" | "expiresAt">
  >;
  fileUrls?: FileUrlAccess[];
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
    displayName?: string | null;
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

// 4.1 消息搜索引擎相关协议 (Discord Search Engine Protocol)
export interface SearchMessagesQuery {
  guildId?: string;
  channelId?: string;
  query?: string;
  from?: string; // 发送者 username 或 displayName
  mentions?: string; // 被提及的用户
  has?: "link" | "file" | "image" | "video" | "sound"; // 附件或特殊类型
  pinned?: boolean;
  before?: string; // ISO 格式时间
  after?: string; // ISO 格式时间
  limit?: number;
  offset?: number;
}

export interface SearchMessageItem extends Message {
  channelName?: string;
}

export interface SearchMessagesResponse {
  total: number;
  messages: SearchMessageItem[];
  hasMore: boolean;
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
  "disconnected" | "connecting" | "connected" | "reconnecting" | "p2p_active";

export interface AudioPlaybackStatus {
  canPlay: boolean;
  isInterrupted: boolean;
  error?: string;
}

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
  mediaEncryptionVersion?: number;
  guildId: string;
  channelId: string | null; // null 代表退出语音频道
  previousChannelId?: string | null;
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
  previousChannelId?: string | null;
  sessionId?: string;
  revision?: number;
  platform?: string;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
  streaming: boolean;
  streamMode?: StreamTransmissionMode;
  user?: Omit<User, "email">;
}

export interface VoiceServerDisconnectPayload {
  reason:
    | "VOICE_TRANSFER"
    | "KICKED"
    | "CHANNEL_DELETED"
    | "MEDIA_NEGOTIATION_TIMEOUT";
  newChannelId?: string | null;
  targetPlatform?: string;
}

export interface ReadyPayload {
  sessionId?: string;
  /** Advertises correlated media snapshot requests over this Gateway. */
  mediaEncryptionSync?: true;
  user: Partial<User>;
  guilds: Guild[];
  voiceStates: VoiceState[];
}

export interface StatusUpdatePayload {
  status: UserStatus;
  customStatus?: string | null;
  activities?: Activity[];
  /** 是否为用户显式手动在设置/菜单中切换状态 (true: 持久化偏好; false 或未传: 客户端会话活跃度变更) */
  isManual?: boolean;
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
export type LiveKitPublishSource =
  "microphone" | "camera" | "screen_share" | "screen_share_audio";

export interface LiveKitTokenRequest {
  roomName: string;
  identity: string;
  gatewaySessionId?: string;
  name?: string;
  isPublisher?: boolean;
  publishSources?: LiveKitPublishSource[];
  bitrate?: number; // 麦克风推流比特率 (bps, e.g. 16000 - 128000)
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

// 7. 音频设置与降噪配置
export type AudioInputMode = "VAD" | "PTT";
export type NoiseSuppressionMode = "off" | "rnnoise" | "dtln" | "dfn3";

export type NoiseEngineBackend = "web-wasm" | "desktop-native" | "bypass";
export type NoiseEnginePhase = "idle" | "loading" | "ready" | "failed";

/** Requested mode is persisted; effective mode describes the PCM actually sent. */
export interface NoiseEngineStatus {
  requestedMode: NoiseSuppressionMode;
  effectiveMode: NoiseSuppressionMode;
  backend: NoiseEngineBackend;
  phase: NoiseEnginePhase;
  reason?: string;
  sampleRate: number;
  processedFrames?: number;
  queueMs?: number;
  processingMs?: number;
  processingP50Ms?: number;
  processingP95Ms?: number;
  processingP99Ms?: number;
  capture?: {
    requestedEchoCancellation: boolean;
    actualEchoCancellation?: boolean;
    actualNoiseSuppression?: boolean;
    actualAutoGainControl?: boolean;
    actualSampleRate?: number;
    actualChannelCount?: number;
    contextSampleRate: number;
    warnings: string[];
  };
}

export interface DesktopNoiseFrame {
  sessionId: string;
  sequence: number;
  sampleCount: number;
  mode: Exclude<NoiseSuppressionMode, "off">;
  sampleRate: 48000;
  pcm: Float32Array;
}

export interface DesktopNoiseFrameResult {
  sessionId: string;
  sequence: number;
  sampleCount: number;
  pcm: Float32Array;
  processingMs: number;
  error?: string;
}

export interface DesktopAudioInferenceStart {
  mode: Exclude<NoiseSuppressionMode, "off">;
  requestId: string;
}

/** Stops only the inference process owned by the calling main window. */
export interface DesktopAudioInferenceStop {
  requestId: string;
}

export interface DesktopAudioInferenceFailure {
  requestId: string;
  reason: string;
}

export type SoundEffectType =
  | "MUTE"
  | "UNMUTE"
  | "DEAFEN"
  | "UNDEAFEN"
  | "VOICE_JOIN"
  | "VOICE_LEAVE"
  | "USER_JOIN"
  | "USER_LEAVE"
  | "CALL_RINGING"
  | "CALL_CALLING"
  | "CALL_CONNECT"
  | "CALL_DISCONNECT";

export type ClientCallState =
  | "idle"
  | "outgoing_calling"
  | "incoming_ringing"
  | "connecting"
  | "connected"
  | "ended";

export interface DMCallEventMetadata {
  callId: string;
  callType: "voice" | "video";
  status: "completed" | "missed" | "declined" | "canceled";
  durationSeconds?: number;
  startedAt: string;
  endedAt: string;
}

export interface AudioProcessingConfig {
  noiseSuppression: boolean; // RNNoise AI 神经网络降噪 (兼容旧布尔配置)
  noiseSuppressionMode?: NoiseSuppressionMode; // 全新多引擎降噪模式：'off' | 'rnnoise' | 'dtln' | 'dfn3' (默认 'rnnoise', dfn3 为 DFNv3 旗舰全频高保真)
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
  audioReceiveQuality?: import("./media-encryption.js").AudioReceiveQuality[];
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
  encodedFrames?: string;
  droppedFrames?: string;
  scalabilityMode?: string;
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

// 纯语音传输模式：SFU (LiveKit) 服务端转发、P2P 全网状 Mesh 直连 或 Cloudflare Realtime Serverless SFU
export type VoiceTransmissionMode = "sfu" | "p2p_mesh" | "cloudflare_realtime";

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
  packetLoss?: number; // 丢包率百分比 (0 - 100)，与 NetworkStats 一致
  connectionType: "LAN" | "P2P" | "RELAY" | "SFU";
  status: "connecting" | "connected" | "failed";
  localAddress?: string;
  remoteAddress?: string;
  candidateType?: string;
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
  i18nKey: string;
}

export const CHANNEL_MUTE_DURATION_OPTIONS: MuteDurationOption[] = [
  {
    label: "15 分钟",
    durationMs: 15 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute15m",
  },
  {
    label: "1 小时",
    durationMs: 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute1h",
  },
  {
    label: "3 小时",
    durationMs: 3 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute3h",
  },
  {
    label: "8 小时",
    durationMs: 8 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute8h",
  },
  {
    label: "24 小时",
    durationMs: 24 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute24h",
  },
  {
    label: "直到重新开启",
    durationMs: null,
    i18nKey: "contextMenu:channel.muteUntilTurnedOn",
  },
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

// 服务器通知设定模式
export type GuildNotificationMode = "ALL" | "MENTIONS" | "NOTHING";

// 服务器通知设定项
export interface GuildNotificationSettings {
  mode: GuildNotificationMode;
  suppressEveryone?: boolean;
  suppressRoles?: boolean;
}

// 服务器静音预设时长选项与常量
export const GUILD_MUTE_DURATION_OPTIONS: MuteDurationOption[] = [
  {
    label: "15 分钟",
    durationMs: 15 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute15m",
  },
  {
    label: "1 小时",
    durationMs: 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute1h",
  },
  {
    label: "3 小时",
    durationMs: 3 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute3h",
  },
  {
    label: "8 小时",
    durationMs: 8 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute8h",
  },
  {
    label: "24 小时",
    durationMs: 24 * 60 * 60 * 1000,
    i18nKey: "contextMenu:channel.mute24h",
  },
  {
    label: "直到重新开启",
    durationMs: null,
    i18nKey: "contextMenu:channel.muteUntilTurnedOn",
  },
];

/**
 * 判定服务器配置当前是否处于有效静音状态（毫秒级判断）
 */
export function isGuildMuted(config?: ChannelMuteConfig | null): boolean {
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

export type MessageDisplayMode = "cozy" | "compact";

// 用户全量偏好设置 DTO (支持本地 Zustand Persist 持久化与后端云端漫游)
export interface UserSettingsDTO {
  audio: AudioProcessingConfig;
  video: VideoSettingsConfig;
  outputVolume: number; // 全局母带输出音量 (0 - 200, 默认 100)
  userVolumes: Record<string, number>; // 针对特定成员的独立音量配置 (0 - 200)
  language?: SupportedLocale; // 用户界面多语言首选项
  voiceTransmissionMode?: VoiceTransmissionMode; // 纯语音偏好模式 (默认 sfu)
  mutedChannels?: Record<string, ChannelMuteConfig>; // 频道静音配置项字典 (key 为 channelId)
  mutedGuilds?: Record<string, ChannelMuteConfig>; // 服务器静音配置字典 (key 为 guildId)
  guildNotificationSettings?: Record<string, GuildNotificationSettings>; // 服务器通知设定字典 (key 为 guildId)
  guildPositions?: string[]; // 用户个人服务器排序偏好列表 (guildId 顺序)
  userNotes?: Record<string, string>; // 针对特定目标用户的私有备注字典 (targetUserId -> note)
  pinnedDMs?: string[]; // 置顶的私信会话 ID 列表
  mutedUsers?: Record<string, number>; // 针对特定用户的私信静音截止时间戳字典 (targetUserId -> timestamp, -1 代表永久)
  chatFontSize?: number; // 聊天字体大小 (12 - 20, 默认 16)
  messageDisplayMode?: MessageDisplayMode; // 消息展示模式 ('cozy' 舒适 / 'compact' 紧凑, 默认 'cozy')
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
  packetLoss?: number; // 丢包率百分比 (0% - 100%)；本机为上行 RTCP 反馈，远端为下行接收统计
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

export interface AudioOutputState {
  deviceId: string;
  volume: number;
  deafened: boolean;
}

export type AudioDeviceSelectionResult =
  | { success: true; deviceId: string }
  | {
      success: false;
      deviceId: string;
      code: "AUDIO_DEVICE_UNSUPPORTED" | "AUDIO_DEVICE_SWITCH_FAILED";
    };

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

export interface QuadTrackSNRResult {
  rawRms: number;
  rnnoiseRms: number;
  dtlnRms: number;
  dfn3Rms: number;
  rnnoiseDbReduction: number;
  dtlnDbReduction: number;
  dfn3DbReduction: number;
}

export function calculateQuadSNRReduction(
  rawRms: number,
  rnnoiseRms: number,
  dtlnRms: number,
  dfn3Rms: number,
): QuadTrackSNRResult {
  return {
    rawRms,
    rnnoiseRms,
    dtlnRms,
    dfn3Rms,
    rnnoiseDbReduction: calculateSNRReduction(rawRms, rnnoiseRms),
    dtlnDbReduction: calculateSNRReduction(rawRms, dtlnRms),
    dfn3DbReduction: calculateSNRReduction(rawRms, dfn3Rms),
  };
}

// 8. 对象存储直传契约 (MinIO / S3)
export interface PresignedUploadRequest {
  fileName: string;
  fileSize: number;
  mimeType: string;
  purpose?:
    | "attachment"
    | "guild-icon"
    | "user-avatar"
    | "user-banner"
    | "custom-emoji";
  channelId?: string;
  guildId?: string;
  width?: number;
  height?: number;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  fileUrl: string;
  fileKey: string;
  requiresAuth?: boolean;
}

export interface DiscardGuildIconUploadDTO {
  fileUrl: string;
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
  VOICE_SERVER_DISCONNECT: "VOICE_SERVER_DISCONNECT",
  CF_MEDIA_TRACKS: "CF_MEDIA_TRACKS",
  CF_STREAM_VIEWERS: "CF_STREAM_VIEWERS",
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
  // 文本 E2EE 信令（Double Ratchet）
  E2EE_KEY_EXCHANGE: "E2EE_KEY_EXCHANGE",
  E2EE_CHANNEL_UPDATE: "E2EE_CHANNEL_UPDATE",
  TYPING_START: "TYPING_START",
  // 媒体端到端加密（SFrame）实时推送与确认信令
  MEDIA_KEY_ENVELOPE: "MEDIA_KEY_ENVELOPE",
  MEDIA_KEY_ACK: "MEDIA_KEY_ACK",
  MEDIA_EPOCH_UPDATE: "MEDIA_EPOCH_UPDATE",
  MEDIA_ENCRYPTION_SYNC: "MEDIA_ENCRYPTION_SYNC",
  MEDIA_ENCRYPTION_SYNC_RESULT: "MEDIA_ENCRYPTION_SYNC_RESULT",
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
  // 好友关系与申请信令
  RELATIONSHIP_ADD: "RELATIONSHIP_ADD",
  RELATIONSHIP_REMOVE: "RELATIONSHIP_REMOVE",
  RELATIONSHIP_UPDATE: "RELATIONSHIP_UPDATE",
  ACCOUNT_SESSION_REVOKED: "ACCOUNT_SESSION_REVOKED",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  MAINTENANCE_UPDATE: "MAINTENANCE_UPDATE",
  // 全网系统广播
  SYSTEM_BROADCAST: "SYSTEM_BROADCAST",
} as const;

export type GatewayEventType =
  (typeof GatewayEvents)[keyof typeof GatewayEvents];

export interface DMCallOfferPayload {
  mediaEncryptionVersion?: number;
  channelId: string;
  hasVideo: boolean;
}

export interface DMCallActionPayload {
  mediaEncryptionVersion?: number;
  callId: string;
  reason?: string;
}

export interface DMCallStatePayload {
  callId: string;
  channelId: string;
  callerId: string;
  hasVideo: boolean;
  state: "ringing" | "active";
}

export interface DMCallIncomingPayload {
  callId: string;
  channelId: string;
  caller: Pick<User, "id" | "username" | "avatarUrl">;
  hasVideo: boolean;
}

export interface DMCallAnsweredPayload {
  callId: string;
  channelId: string;
}

export interface DMCallEndedPayload {
  callId: string;
  channelId: string;
  endedBy: string;
  reason: string;
}

export type NATType =
  | "FullCone"
  | "RestrictedCone"
  | "PortRestrictedCone"
  | "Symmetric"
  | "IPv6Direct"
  | "Unknown";

export interface P2PSignalPayload {
  /** Gateway-authenticated origin; clients cannot choose this session identity. */
  senderSessionId?: string;
  /** Voice offer/answer correlation; echoes the initiating offer through retries. */
  negotiationId?: string;
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
    | "VOICE_LEAVE"
    | "STREAM_WATCH_START"
    | "STREAM_WATCH_STOP"
    | "STREAM_KICK"
    | "REQUEST_STREAM_VIEWERS";
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

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  channelId?: string;
  guildId?: string;
  icon?: string;
  avatarUrl?: string;
  senderName?: string;
  timestamp?: number;
  silent?: boolean;
}

export interface DesktopUnreadStatePayload {
  hasUnread: boolean;
}

export interface AutoLaunchSettings {
  enabled: boolean;
  openAsHidden: boolean;
}

export type DesktopWindowMode = "auth" | "main";
export type DesktopWindowType = "auth" | "main";

export interface DesktopAuthSuccessPayload {
  userId?: string;
  username?: string;
}

export interface DesktopAuthSessionState {
  hasSession: boolean;
  lastUserId?: string;
  lastUsername?: string;
}

export interface DesktopWindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

export interface DesktopWindowModeOptions {
  mode: DesktopWindowMode;
  animate?: boolean;
  center?: boolean;
}

export interface DesktopWindowState {
  isMaximized: boolean;
  platform: string;
  mode?: DesktopWindowMode;
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

// 11.2 SFrame WebRTC 语音端到端加密规范 (RFC 9605)
export interface SFrameConfig {
  enabled: boolean;
  keyId: number;
  passphrase?: string;
}

export interface SFrameHeader {
  kid: number; // RFC 9605 KID, restricted to safe unsigned JavaScript integers
  counter: bigint; // Unsigned 64-bit monotonic frame counter
  headerLength: number; // 头部总字节数
}

/** RFC 9605 section 4.3 compact, unsigned, big-endian header. */
export function encodeSFrameHeader(
  kid: number,
  counter: bigint | number,
): Uint8Array {
  if (!Number.isSafeInteger(kid) || kid < 0)
    throw new Error("MEDIA_KEY_INVALID");
  const ctr = BigInt(counter);
  if (ctr < 0n || ctr > 0xffffffffffffffffn)
    throw new Error("MEDIA_KEY_INVALID");
  const encode = (value: bigint): number[] => {
    if (value <= 7n) return [];
    const bytes: number[] = [];
    do {
      bytes.unshift(Number(value & 255n));
      value >>= 8n;
    } while (value);
    return bytes;
  };
  const k = encode(BigInt(kid)),
    c = encode(ctr);
  const config =
    (k.length ? 0x80 | ((k.length - 1) << 4) : kid << 4) |
    (c.length ? 0x08 | (c.length - 1) : Number(ctr));
  return Uint8Array.from([config, ...k, ...c]);
}
export function decodeSFrameHeader(buffer: Uint8Array): SFrameHeader {
  if (!buffer.length) throw new Error("MEDIA_KEY_INVALID");
  const config = buffer[0];
  let offset = 1;
  const read = (length: number): bigint => {
    if (offset + length > buffer.length) throw new Error("MEDIA_KEY_INVALID");
    let value = 0n;
    for (let i = 0; i < length; i++)
      value = (value << 8n) | BigInt(buffer[offset++]);
    if (value <= 7n || (length > 1 && buffer[offset - length] === 0))
      throw new Error("MEDIA_KEY_INVALID");
    return value;
  };
  const kidBig =
    config & 0x80 ? read(((config >> 4) & 7) + 1) : BigInt((config >> 4) & 7);
  const counter = config & 8 ? read((config & 7) + 1) : BigInt(config & 7);
  if (kidBig > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("MEDIA_KEY_INVALID");
  return { kid: Number(kidBig), counter, headerLength: offset };
}
interface SFrameDerivedKey {
  key: CryptoKey;
  salt: Uint8Array;
}
const sframeDerivedKeys = new WeakMap<
  Uint8Array,
  Map<number, Promise<SFrameDerivedKey>>
>();
/** AES_256_GCM_SHA512_128 (0x0005), RFC 9605 section 4.4.2. */
export function deriveSFrameKey(
  keyBuffer: Uint8Array,
  kid: number,
): Promise<SFrameDerivedKey> {
  if (keyBuffer.length !== 16 && keyBuffer.length !== 32)
    return Promise.reject(new Error("MEDIA_KEY_INVALID"));
  let keys = sframeDerivedKeys.get(keyBuffer);
  if (!keys) {
    keys = new Map();
    sframeDerivedKeys.set(keyBuffer, keys);
  }
  const existing = keys.get(kid);
  if (existing) return existing;
  const promise = (async () => {
    const material = await globalThis.crypto.subtle.importKey(
      "raw",
      keyBuffer,
      "HKDF",
      false,
      ["deriveBits"],
    );
    const suffix = new Uint8Array(10);
    const view = new DataView(suffix.buffer);
    view.setBigUint64(0, BigInt(kid));
    view.setUint16(8, 5);
    const derive = async (label: string, size: number) => {
      const prefix = new TextEncoder().encode(label);
      const info = new Uint8Array(prefix.length + suffix.length);
      info.set(prefix);
      info.set(suffix, prefix.length);
      return globalThis.crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-512", salt: new Uint8Array(0), info },
        material,
        size * 8,
      );
    };
    const [rawKey, rawSalt] = await Promise.all([
      derive("SFrame 1.0 Secret key ", 32),
      derive("SFrame 1.0 Secret salt ", 12),
    ]);
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      rawKey,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    return { key, salt: new Uint8Array(rawSalt) };
  })();
  keys.set(kid, promise);
  return promise;
}
function sframeNonce(salt: Uint8Array, counter: bigint): Uint8Array {
  const nonce = salt.slice();
  for (let i = 0; i < 8; i++)
    nonce[11 - i] ^= Number((counter >> BigInt(i * 8)) & 255n);
  return nonce;
}
export async function encryptSFramePacket(
  rawPcmOrOpus: Uint8Array,
  keyBuffer: Uint8Array,
  kid: number,
  counter: bigint | number,
  metadata = new Uint8Array(0),
): Promise<Uint8Array> {
  const header = encodeSFrameHeader(kid, counter);
  const derived = await deriveSFrameKey(keyBuffer, kid);
  const aad = new Uint8Array(header.length + metadata.length);
  aad.set(header);
  aad.set(metadata, header.length);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: sframeNonce(derived.salt, BigInt(counter)),
        additionalData: aad,
        tagLength: 128,
      },
      derived.key,
      rawPcmOrOpus,
    ),
  );
  const result = new Uint8Array(header.length + ciphertext.length);
  result.set(header);
  result.set(ciphertext, header.length);
  return result;
}
export async function decryptSFramePacket(
  sframePacket: Uint8Array,
  keyBuffer: Uint8Array,
  metadata = new Uint8Array(0),
): Promise<{ decryptedPayload: Uint8Array; header: SFrameHeader }> {
  const header = decodeSFrameHeader(sframePacket);
  if (sframePacket.length < header.headerLength + 16)
    throw new Error("MEDIA_KEY_INVALID");
  const derived = await deriveSFrameKey(keyBuffer, header.kid);
  const aad = new Uint8Array(header.headerLength + metadata.length);
  aad.set(sframePacket.slice(0, header.headerLength));
  aad.set(metadata, header.headerLength);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: sframeNonce(derived.salt, header.counter),
      additionalData: aad,
      tagLength: 128,
    },
    derived.key,
    sframePacket.slice(header.headerLength),
  );
  return { decryptedPayload: new Uint8Array(decrypted), header };
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
export type SupportedLocale = "zh-CN" | "en-US" | "ja-JP" | "zh-TW" | "zh-HK";

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
    code: "zh-TW",
    label: "繁體中文（台灣）",
    englishName: "Traditional Chinese (Taiwan)",
    nativeName: "繁體中文（台灣）",
  },
  {
    code: "zh-HK",
    label: "繁體中文（香港）",
    englishName: "Traditional Chinese (Hong Kong)",
    nativeName: "繁體中文（香港）",
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

export enum ErrorCode {
  // 通用错误
  INTERNAL_ERROR = "INTERNAL_ERROR",
  AUDIO_INPUT_SWITCH_FAILED = "AUDIO_INPUT_SWITCH_FAILED",
  AUDIO_DEVICE_SWITCH_FAILED = "AUDIO_DEVICE_SWITCH_FAILED",
  AUDIO_DEVICE_UNSUPPORTED = "AUDIO_DEVICE_UNSUPPORTED",
  AUDIO_PROCESSING_UNSUPPORTED = "AUDIO_PROCESSING_UNSUPPORTED",
  INVALID_PARAMS = "INVALID_PARAMS",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  RATE_LIMITED = "RATE_LIMITED",

  // 认证与用户
  AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS",
  AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED",
  AUTH_USER_NOT_FOUND = "AUTH_USER_NOT_FOUND",
  AUTH_USER_EXISTS = "AUTH_USER_EXISTS",
  AUTH_PASSWORD_TOO_WEAK = "AUTH_PASSWORD_TOO_WEAK",
  AUTH_ACCOUNT_DISABLED = "AUTH_ACCOUNT_DISABLED",
  AUTH_REAUTH_REQUIRED = "AUTH_REAUTH_REQUIRED",

  // WebAuthn / 通行密钥 (Passkey)
  WEBAUTHN_NOT_SUPPORTED = "WEBAUTHN_NOT_SUPPORTED",
  WEBAUTHN_CHALLENGE_EXPIRED = "WEBAUTHN_CHALLENGE_EXPIRED",
  WEBAUTHN_VERIFICATION_FAILED = "WEBAUTHN_VERIFICATION_FAILED",
  WEBAUTHN_CREDENTIAL_EXISTS = "WEBAUTHN_CREDENTIAL_EXISTS",
  WEBAUTHN_CREDENTIAL_NOT_FOUND = "WEBAUTHN_CREDENTIAL_NOT_FOUND",

  // 服务器 (Guild)
  GUILD_NOT_FOUND = "GUILD_NOT_FOUND",
  GUILD_NAME_REQUIRED = "GUILD_NAME_REQUIRED",
  GUILD_PERMISSION_DENIED = "GUILD_PERMISSION_DENIED",
  GUILD_CREATION_RESTRICTED = "GUILD_CREATION_RESTRICTED",
  GUILD_INVITE_INVALID = "GUILD_INVITE_INVALID",
  GUILD_INVITE_EXPIRED = "GUILD_INVITE_EXPIRED",
  GUILD_ALREADY_MEMBER = "GUILD_ALREADY_MEMBER",
  GUILD_CANNOT_LEAVE_OWNER = "GUILD_CANNOT_LEAVE_OWNER",
  GUILD_ROLE_NOT_FOUND = "GUILD_ROLE_NOT_FOUND",
  GUILD_ROLE_CANNOT_DELETE_DEFAULT = "GUILD_ROLE_CANNOT_DELETE_DEFAULT",
  GUILD_ROLE_HIERARCHY_TOO_LOW = "GUILD_ROLE_HIERARCHY_TOO_LOW",

  // 频道与分类
  CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND",
  CHANNEL_NAME_REQUIRED = "CHANNEL_NAME_REQUIRED",
  CHANNEL_PERMISSION_DENIED = "CHANNEL_PERMISSION_DENIED",
  CHANNEL_OVERWRITE_NOT_FOUND = "CHANNEL_OVERWRITE_NOT_FOUND",
  CHANNEL_HIERARCHY_VIOLATION = "CHANNEL_HIERARCHY_VIOLATION",
  CATEGORY_NOT_FOUND = "CATEGORY_NOT_FOUND",
  CATEGORY_NAME_REQUIRED = "CATEGORY_NAME_REQUIRED",

  // 消息与文件
  MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND",
  MESSAGE_EMPTY = "MESSAGE_EMPTY",
  MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  FILE_TYPE_UNSUPPORTED = "FILE_TYPE_UNSUPPORTED",
  ICON_PROCESS_TIMEOUT = "ICON_PROCESS_TIMEOUT",
  UPLOAD_FAILED = "UPLOAD_FAILED",

  // 自定义表情 (Emoji)
  EMOJI_NOT_FOUND = "EMOJI_NOT_FOUND",
  EMOJI_LIMIT_REACHED = "EMOJI_LIMIT_REACHED",
  EMOJI_NAME_INVALID = "EMOJI_NAME_INVALID",
  EMOJI_FILE_TOO_LARGE = "EMOJI_FILE_TOO_LARGE",

  // 语音与媒体
  MEDIA_E2EE_UNSUPPORTED = "MEDIA_E2EE_UNSUPPORTED",
  MEDIA_KEY_UNAVAILABLE = "MEDIA_KEY_UNAVAILABLE",
  MEDIA_CONTEXT_STALE = "MEDIA_CONTEXT_STALE",
  MEDIA_KEY_INVALID = "MEDIA_KEY_INVALID",
  MEDIA_NEGOTIATION_TIMEOUT = "MEDIA_NEGOTIATION_TIMEOUT",
  VOICE_ROOM_FULL = "VOICE_ROOM_FULL",
  VOICE_JOIN_FAILED = "VOICE_JOIN_FAILED",
  VOICE_PERMISSION_DENIED = "VOICE_PERMISSION_DENIED",
  VOICE_USER_NOT_CONNECTED = "VOICE_USER_NOT_CONNECTED",
  CANNOT_MANAGE_MEMBER = "CANNOT_MANAGE_MEMBER",

  // 管理后台
  ADMIN_REQUIRED = "ADMIN_REQUIRED",
  ADMIN_CANNOT_BAN_SELF = "ADMIN_CANNOT_BAN_SELF",
  STORAGE_GC_FAILED = "STORAGE_GC_FAILED",
  OPERATION_CANCELLED = "OPERATION_CANCELLED",
}

export interface ApiErrorResponse {
  code?: ErrorCode | string;
  error: string;
  details?: Record<string, any>;
}

// 消息容量限制契约
export const MAX_MESSAGE_CONTENT_LENGTH = 4000;
export const MAX_ENCRYPTED_ENVELOPE_LENGTH = 256 * 1024; // 256KB

export interface CreateGuildRequest {
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  isPublic?: boolean;
  locale?: SupportedLocale;
}

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
  requireInviteCode?: boolean;
  maintenanceMode?: boolean;
  systemAnnouncement?: string;
  allowNonSuperAdminCreateGuild?: boolean;
}

export interface RegistrationStatusResponse {
  allowRegistration: boolean;
  requireInviteCode: boolean;
  allowNonSuperAdminCreateGuild?: boolean;
}

export interface CustomEmoji {
  id: string;
  name: string;
  imageUrl: string;
  animated: boolean;
  guildId?: string | null;
  userId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateCustomEmojiDTO {
  name: string;
  imageUrl: string;
  animated?: boolean;
  guildId?: string;
}

export interface RegistrationInviteDTO {
  code: string;
  note?: string | null;
  createdById: string;
  createdByName?: string;
  maxUses: number;
  uses: number;
  isRevoked: boolean;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  registeredUserCount?: number;
}

export interface CreateRegistrationInviteDTO {
  note?: string;
  maxUses?: number;
  expiresInDays?: number | null;
  customCode?: string;
}

export interface RegistrationInviteListResponse {
  invites: RegistrationInviteDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MaintenanceUpdatePayload {
  enabled: boolean;
  announcement?: string;
  estimatedEndTime?: string | null;
  triggeredAt?: string;
}

export interface AdminStorageStats {
  totalUsedBytes: number;
  activeAttachmentBytes: number;
  activeAttachmentCount: number;
  orphanedAttachmentBytes: number;
  orphanedAttachmentCount: number;
  orphanedDraftBytes: number;
  orphanedDraftCount: number;
  lastGcTimestamp?: number | null;
}

export interface AdminGcResult {
  success: boolean;
  deletedAttachmentRecords: number;
  deletedPhysicalFiles: number;
  freedBytes: number;
  durationMs: number;
  executedAt: number;
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
  | "disabled" // 未配置 Git 仓库或更新服务被禁用
  | "idle" // 空闲待命
  | "checking" // 正在检查更新
  | "downloading" // 正在下载增量包
  | "verifying" // 正在校验 SHA256 哈希
  | "extracting" // 正在解压至本地用户目录
  | "ready" // 增量包已就绪，等待重启生效
  | "error"; // 发生异常

export interface UpdateManifest {
  version: string; // 目标版本号 (如 "0.2.0")
  releaseTag?: string; // 签名发布标签，必须等于 version 或 v${version}；旧清单省略时采用 v 前缀
  releaseDate: string; // 发布时间 (ISO 8601)
  minHostVersion: string; // 最低需要的 Electron 原生 Host 壳版本
  webPackageUrl: string; // 已签名清单中的包文件名 (如 tescord-web-v0.2.0.zip)
  webPackageSha256: string; // 增量包 SHA256 校验和
  changelog?: string; // 更新日志段落
  mandatory?: boolean; // 是否为强制更新
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
  percent: number; // 0 - 100
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSec?: number;
  error?: string;
}

export interface UpdaterConfig {
  enabled: boolean;
  currentHostVersion: string;
  currentWebVersion: string;
  gitRepo: string | null; // e.g. "owner/repo" 或 null
  preferredProxy: string; // 默认 "https://v6.gh-proxy.org/"
  customProxy?: string; // 用户自定义代理地址
  lastCheckedAt?: string;
}

export interface SetCustomProxyDTO {
  proxyUrl: string; // 自定义代理前缀，传空字符串代表清除自定义代理
}

// ==========================================
// Cloudflare Realtime (Serverless SFU & Calls TURN) 媒体引擎契约
// ==========================================

export type VoiceMediaEngine = "livekit" | "cloudflare_realtime" | "p2p_mesh";

export interface CfCallsSessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface CfCallsTrackInfo {
  location: "local" | "remote";
  trackName: string;
  mid?: string;
  sessionId?: string;
  errorCode?: string;
  errorDescription?: string;
}

export interface CfCallsCreateSessionResponse {
  sessionId: string;
  tracks?: CfMediaPublication[];
  tracksRevision?: number;
  requiresE2EE?: boolean;
}

export interface CfCallsHeartbeatResponse {
  active: boolean;
}

export interface CfCallsCreateSessionRequest {
  channelId: string;
  /** Required for a DM call, omitted for a guild voice channel. */
  callId?: string;
  /** The identified Gateway connection that owns this DM call. */
  gatewaySessionId?: string;
}

export interface CfMediaPublication {
  sessionId: string;
  userId: string;
  channelId: string;
  trackName: string;
  mid?: string;
  kind: "audio" | "video";
  source: "microphone" | "camera" | "screen" | "screen-audio";
}

export interface CfMediaTracksEvent {
  revision?: number;
  channelId: string;
  tracks: CfMediaPublication[];
}

/** A stream is identified by the host's Cloudflare media session. */
export interface CfStreamWatchRequest {
  channelId: string;
  sessionId: string;
  publisherSessionId: string;
}

export interface CfStreamViewersEvent {
  channelId: string;
  publisherSessionId: string;
  hostUserId: string;
  viewerCount: number;
}

export interface CfStreamWatchState extends CfStreamViewersEvent {
  watching: boolean;
}

export interface CfCallsPublishTrackRequest {
  channelId: string;
  sessionId: string;
  sessionDescription: CfCallsSessionDescription;
  tracks: Array<{
    mid: string;
    trackName: string;
    kind: "audio" | "video";
    source: "microphone" | "camera" | "screen" | "screen-audio";
  }>;
}

export interface CfCallsPublishTrackResponse {
  sessionDescription: CfCallsSessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks: CfCallsTrackInfo[];
}

export interface CfCallsSubscribeTrackRequest {
  channelId: string;
  sessionId: string;
  tracks: Array<{
    publisherSessionId: string;
    trackName: string;
  }>;
}

export interface CfCallsSubscribeTrackResponse {
  sessionDescription?: CfCallsSessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks: CfCallsTrackInfo[];
}

export interface CfCallsRenegotiateRequest {
  sessionId: string;
  sessionDescription: CfCallsSessionDescription;
}

export interface CfCallsCloseTracksRequest {
  sessionId: string;
  tracks: Array<{ mid?: string; trackName?: string }>;
  sessionDescription?: CfCallsSessionDescription;
}

export interface CfCallsUnsubscribeRequest {
  channelId: string;
  sessionId: string;
  tracks: Array<{ mid: string }>;
}

export interface CfRealtimeConfigResponse {
  enabled: boolean;
  sfuEnabled: boolean;
  turnEnabled: boolean;
}

export interface CfTurnIceServersResponse {
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  expiresAt: number;
}

// ==========================================
// 25. 本地持久化与离线存储契约 (Local Storage & SQLite Contracts)
// ==========================================

export interface StoredActiveTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
  remember: boolean;
  updatedAt: number;
}

export interface StorageSearchMessagesQuery {
  keyword: string;
  channelId?: string;
  limit?: number;
}

export interface StorageChannelSnapshot {
  messages: Message[];
  meta: ChannelMetaRecord;
}

export interface StorageStats {
  adapterType: "sqlite" | "indexeddb";
  appDbSize?: number;
  userDbSize?: number;
  messageCount?: number;
  isEncryptionAvailable?: boolean;
}

export interface IStorageAdapter {
  // 1. 全局与用户偏好 (KV)
  getPreference<T = any>(key: string): Promise<T | null>;
  setPreference<T = any>(key: string, value: T): Promise<void>;
  removePreference(key: string): Promise<void>;

  // 2. 账号鉴权与凭据（桌面端走 safeStorage 加密）
  getSavedAccounts(): Promise<SavedAccount[]>;
  saveSavedAccounts(accounts: SavedAccount[]): Promise<void>;
  getActiveTokens(): Promise<StoredActiveTokens | null>;
  setActiveTokens(
    tokens: { accessToken: string; refreshToken: string; user: User },
    remember: boolean,
  ): Promise<void>;
  clearActiveTokens(): Promise<void>;

  // 3. 用户切换与多账号隔离
  switchUser(userId: string | null): Promise<void>;

  // 4. 频道消息与元数据缓存
  saveMessages(channelId: string, messages: Message[]): Promise<void>;
  saveMessage(msg: Message): Promise<void>;
  reconcileChannelMessages(
    channelId: string,
    authoritativeMessages: Message[],
    range: { minSequence: number; maxSequence: number },
  ): Promise<void>;
  getLatestMessages(channelId: string, limit?: number): Promise<Message[]>;
  getChannelSnapshot(
    channelId: string,
    limit?: number,
  ): Promise<StorageChannelSnapshot>;
  deleteMessage(messageId: string): Promise<void>;
  saveChannelMeta(
    channelId: string,
    meta: Partial<ChannelMetaRecord>,
  ): Promise<void>;
  getChannelMeta(channelId: string): Promise<ChannelMetaRecord | null>;
  clearChannel(channelId: string): Promise<void>;
  clearAllMessages(): Promise<void>;

  // 5. 本地全文搜索 (FTS5)
  searchMessages(query: StorageSearchMessagesQuery): Promise<Message[]>;

  // 6. 统计信息
  getStorageStats?(): Promise<StorageStats>;
}

export const STORAGE_IPC_CHANNELS = {
  PREF_GET: "storage:pref-get",
  PREF_SET: "storage:pref-set",
  PREF_REMOVE: "storage:pref-remove",
  ACCOUNTS_GET: "storage:accounts-get",
  ACCOUNTS_SAVE: "storage:accounts-save",
  TOKENS_GET: "storage:tokens-get",
  TOKENS_SET: "storage:tokens-set",
  TOKENS_CLEAR: "storage:tokens-clear",
  USER_SWITCH: "storage:user-switch",
  MESSAGES_SAVE_BATCH: "storage:messages-save-batch",
  MESSAGES_RECONCILE: "storage:messages-reconcile",
  MESSAGE_SAVE_SINGLE: "storage:message-save-single",
  MESSAGES_GET_LATEST: "storage:messages-get-latest",
  CHANNEL_SNAPSHOT_GET: "storage:channel-snapshot-get",
  MESSAGE_DELETE: "storage:message-delete",
  CHANNEL_META_SAVE: "storage:channel-meta-save",
  CHANNEL_META_GET: "storage:channel-meta-get",
  CHANNEL_CLEAR: "storage:channel-clear",
  MESSAGES_CLEAR_ALL: "storage:messages-clear-all",
  MESSAGES_SEARCH_FTS: "storage:messages-search-fts",
  STATS_GET: "storage:stats-get",
} as const;

export type StorageIpcChannel =
  (typeof STORAGE_IPC_CHANNELS)[keyof typeof STORAGE_IPC_CHANNELS];

// ==========================================
// 更新公告与发布日志 (What's New / Changelogs)
// ==========================================

export type ChangelogCategory = "features" | "improvements" | "fixes";

export interface ChangelogItem {
  id: string;
  category: ChangelogCategory;
  titleKey?: string; // i18n 翻译键名
  rawTitle?: string; // 兜底或直接渲染标题
  descriptionKey?: string; // i18n 翻译键名
  rawDescription?: string; // 兜底或直接渲染描述
}

export interface VersionChangelog {
  version: string; // 如 "0.2.0"
  releaseDate: string; // ISO 日期或格式化日期如 "2026-09-29"
  items: ChangelogItem[];
  bannerGradient?: string;
  releaseUrl?: string;
}

export type WhatsNewModalMode = "view" | "ready_to_restart";

export interface WhatsNewModalOptions {
  version?: string;
  mode?: WhatsNewModalMode;
  changelogOverride?: string;
  onRestartApply?: () => void | Promise<void>;
}
export * from "./communication.js";
export * from "./desktop-capture.js";

export * from "./media-encryption.js";
export * from "./media-frame.js";

// ==========================================
// 快捷键系统与动作映射 (Keybinds System)
// ==========================================

export type KeybindAction = "TOGGLE_MUTE" | "TOGGLE_DEAFEN" | "SCREEN_CAPTURE";

export interface KeybindConfig {
  id: KeybindAction;
  shortcut: string;
  enabled: boolean;
}

export type KeybindConflictType = "INTERNAL_CONFLICT" | "SYSTEM_OCCUPIED";

export interface KeybindConflictResult {
  conflict: boolean;
  type?: KeybindConflictType;
  conflictingAction?: KeybindAction;
  shortcut?: string;
}

export interface KeybindRegisterResponse {
  success: boolean;
  conflicts: Array<{
    id: KeybindAction;
    shortcut: string;
    reason: KeybindConflictType;
  }>;
}
