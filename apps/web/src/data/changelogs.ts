import { VersionChangelog } from "@tescord/types";

export const CURRENT_APP_VERSION = "0.3.0";

export const BUILTIN_CHANGELOGS: VersionChangelog[] = [
  {
    version: "0.3.0",
    releaseDate: "2026-09-30",
    releaseUrl: "https://github.com/labsphaela/Tescord/releases/tag/0.3.0",
    items: [
      {
        id: "channel-unread",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_3_0_unread_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_unread_desc",
      },
      {
        id: "appearance",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_3_0_appearance_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_appearance_desc",
      },
      {
        id: "server-settings",
        category: "improvements",
        titleKey: "modals:whatsNew.items.v0_3_0_roles_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_roles_desc",
      },
      {
        id: "branding",
        category: "improvements",
        titleKey: "modals:whatsNew.items.v0_3_0_brand_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_brand_desc",
      },
      {
        id: "inline-media",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_3_0_media_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_media_desc",
      },
      {
        id: "desktop-audio",
        category: "improvements",
        titleKey: "modals:whatsNew.items.v0_3_0_desktop_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_desktop_desc",
      },
      {
        id: "desktop-security",
        category: "fixes",
        titleKey: "modals:whatsNew.items.v0_3_0_security_title",
        descriptionKey: "modals:whatsNew.items.v0_3_0_security_desc",
      },
    ],
  },
  {
    version: "0.2.0",
    releaseDate: "2026-09-29",
    releaseUrl: "https://github.com/labsphaela/Tescord/releases/tag/v0.2.0",
    items: [
      {
        id: "livekit-engine",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_2_0_livekit_title",
        rawTitle: "多引擎低延迟音视频网关",
        descriptionKey: "modals:whatsNew.items.v0_2_0_livekit_desc",
        rawDescription:
          "无缝集成 LiveKit 与 Cloudflare Realtime，支持高质量低延迟多人连麦与高清屏幕共享。",
      },
      {
        id: "rnnoise-worklet",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_2_0_rnnoise_title",
        rawTitle: "RNNoise 神经网络实时降噪",
        descriptionKey: "modals:whatsNew.items.v0_2_0_rnnoise_desc",
        rawDescription:
          "基于 AudioWorklet 隔离线程驱动深度神经网络，在毫秒级无损消除键盘敲击声与风扇噪声。",
      },
      {
        id: "i18n-hot-switch",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_2_0_i18n_title",
        rawTitle: "全域 5 种语言无感热切换",
        descriptionKey: "modals:whatsNew.items.v0_2_0_i18n_desc",
        rawDescription:
          "全站严格对齐简体中文、繁體中文（台灣/香港）、英语及日本語，零硬编码文案。",
      },
      {
        id: "dual-track-updater",
        category: "features",
        titleKey: "modals:whatsNew.items.v0_2_0_updater_title",
        rawTitle: "双轨增量热更新与 gh-proxy 加速",
        descriptionKey: "modals:whatsNew.items.v0_2_0_updater_desc",
        rawDescription:
          "支持前端与宿主壳解耦更新，配合三级代理阶梯加速直连 GitHub Releases。",
      },
      {
        id: "virtual-list-perf",
        category: "improvements",
        titleKey: "modals:whatsNew.items.v0_2_0_perf_title",
        rawTitle: "虚拟长列表与本地 SQLite 性能调优",
        descriptionKey: "modals:whatsNew.items.v0_2_0_perf_desc",
        rawDescription:
          "海量聊天消息毫秒级加载与极速全文检索，显著降低内存与 CPU 负载。",
      },
      {
        id: "audio-reset-fix",
        category: "fixes",
        titleKey: "modals:whatsNew.items.v0_2_0_fix_audio_title",
        rawTitle: "修复设备切换与声道重置异常",
        descriptionKey: "modals:whatsNew.items.v0_2_0_fix_audio_desc",
        rawDescription:
          "优化多声卡环境下的设备拔插响应，杜绝声卡混音与资源泄露问题。",
      },
    ],
  },
  {
    version: "0.1.0",
    releaseDate: "2026-08-15",
    releaseUrl: "https://github.com/labsphaela/Tescord/releases/tag/v0.1.0",
    items: [
      {
        id: "initial-release",
        category: "features",
        rawTitle: "Tescord 初版架构交付",
        rawDescription:
          "类 Discord 私有化即时通讯、公会、频道与高保真暗色质感界面。",
      },
    ],
  },
];

/**
 * 获取指定版本的更新日志，若未精确匹配则返回最新版本更新日志作为保底
 */
export function getChangelogForVersion(version?: string): VersionChangelog {
  if (!version) {
    return BUILTIN_CHANGELOGS[0];
  }
  const cleanVer = version.replace(/^v/i, "");
  const found = BUILTIN_CHANGELOGS.find(
    (c) => c.version === cleanVer || `v${c.version}` === version,
  );
  return found || BUILTIN_CHANGELOGS[0];
}
