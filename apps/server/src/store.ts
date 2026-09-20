import { Guild, Channel, Message, User, VoiceState } from "@tescord/types";

// 内存数据库与默认初始数据
export class DataStore {
  private users: Map<string, User & { password: string }> = new Map();
  private guilds: Map<string, Guild> = new Map();
  private channels: Map<string, Channel> = new Map();
  private messages: Map<string, Message[]> = new Map(); // channelId -> Message[]
  private voiceStates: Map<string, VoiceState> = new Map(); // userId -> VoiceState

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData() {
    // 预置默认测试用户
    const defaultUser: User & { password: string } = {
      id: "usr_default_admin",
      username: "Tescord_Admin",
      email: "admin@tescord.local",
      password: "adminpassword123",
      avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=tescord_admin",
      status: "ONLINE",
      customStatus: "正在维护 Tescord 本地私有节点 🚀",
      createdAt: new Date().toISOString(),
    };
    this.users.set(defaultUser.id, defaultUser);

    // 预置默认公会 (Server)
    const defaultGuildId = "guild_tescord_hq";
    const channels: Channel[] = [
      {
        id: "chan_general",
        guildId: defaultGuildId,
        name: "综合闲聊",
        type: "TEXT",
        topic: "欢迎来到 Tescord 本地私有化通讯平台！",
        position: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: "chan_crypto_vault",
        guildId: defaultGuildId,
        name: "绝密加密室",
        type: "TEXT",
        topic: "端到端加密频道 (E2EE 演示)",
        isE2EE: true,
        position: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: "chan_voice_lounge",
        guildId: defaultGuildId,
        name: "🎮 开黑语音房",
        type: "VOICE",
        bitrate: 64000,
        position: 2,
        createdAt: new Date().toISOString(),
      },
      {
        id: "chan_live_stage",
        guildId: defaultGuildId,
        name: "📺 屏幕直播与舞台",
        type: "VOICE",
        bitrate: 128000,
        position: 3,
        createdAt: new Date().toISOString(),
      },
    ];

    channels.forEach((ch) => this.channels.set(ch.id, ch));

    const defaultGuild: Guild = {
      id: defaultGuildId,
      name: "Tescord Headquarters",
      iconUrl: "https://api.dicebear.com/7.x/identicon/svg?seed=TescordHQ",
      ownerId: defaultUser.id,
      channels: channels,
      members: [
        {
          userId: defaultUser.id,
          guildId: defaultGuildId,
          roleIds: ["admin"],
          joinedAt: new Date().toISOString(),
          user: defaultUser,
        },
      ],
      createdAt: new Date().toISOString(),
    };
    this.guilds.set(defaultGuild.id, defaultGuild);

    // 预置初始欢迎消息
    this.messages.set("chan_general", [
      {
        id: "msg_welcome_1",
        channelId: "chan_general",
        authorId: defaultUser.id,
        author: {
          id: defaultUser.id,
          username: defaultUser.username,
          avatarUrl: defaultUser.avatarUrl,
        },
        content:
          "👋 欢迎体验 Tescord！这是为你私有化部署的类似 Discord 的语音聊天与直播系统。\n\n你可以：\n1. 加入左侧语音频道体验 **RNNoise 智能降噪** 与实时语音。\n2. 点击下方开启 **屏幕分享直播**。\n3. 在 **#绝密加密室** 体验加密通讯！",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  // 用户操作
  getUserById(id: string) {
    return this.users.get(id);
  }

  getUserByEmail(email: string) {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  createUser(user: User & { password: string }) {
    this.users.set(user.id, user);
    return user;
  }

  // 公会操作
  getGuilds() {
    return Array.from(this.guilds.values());
  }

  getGuildById(id: string) {
    return this.guilds.get(id);
  }

  createGuild(guild: Guild) {
    this.guilds.set(guild.id, guild);
    return guild;
  }

  // 频道操作
  getChannelById(id: string) {
    return this.channels.get(id);
  }

  createChannel(channel: Channel) {
    this.channels.set(channel.id, channel);
    const guild = this.guilds.get(channel.guildId);
    if (guild) {
      guild.channels.push(channel);
    }
    return channel;
  }

  // 消息操作
  getMessages(channelId: string) {
    return this.messages.get(channelId) || [];
  }

  addMessage(message: Message) {
    const list = this.messages.get(message.channelId) || [];
    list.push(message);
    this.messages.set(message.channelId, list);
    return message;
  }

  // 语音状态操作
  setVoiceState(voiceState: VoiceState) {
    if (!voiceState.channelId) {
      this.voiceStates.delete(voiceState.userId);
    } else {
      this.voiceStates.set(voiceState.userId, voiceState);
    }
    return voiceState;
  }

  getVoiceStates(guildId?: string) {
    const list = Array.from(this.voiceStates.values());
    return guildId ? list.filter((s) => s.guildId === guildId) : list;
  }
}

export const store = new DataStore();
