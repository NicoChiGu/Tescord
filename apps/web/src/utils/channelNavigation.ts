import { Channel, Guild } from "@tescord/types";

/**
 * 按照侧边栏（ChannelSidebar）真实视觉渲染顺序计算公会频道的标准排序列表：
 * 1. 顶层未分类频道（按 position 升序）
 * 2. 各分类（按分类 position 升序）下的子频道（按 position 升序）
 */
export function getSortedGuildChannels(guild: Guild): Channel[] {
  const categories = [...(guild.categories || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const channels = guild.channels || [];

  // 1. 顶层未分类频道
  const uncategorizedChannels = channels
    .filter(
      (c) => !c.parentId || !categories.some((cat) => cat.id === c.parentId),
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // 2. 属于各个分类的子频道（按分类顺序依次排列）
  const categorizedChannels: Channel[] = [];
  for (const category of categories) {
    const subChannels = channels
      .filter((c) => c.parentId === category.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    categorizedChannels.push(...subChannels);
  }

  return [...uncategorizedChannels, ...categorizedChannels];
}

/**
 * 获取公会的默认聚焦频道（当首次进入服务器或历史记忆失效时）：
 * - 若 preferText 为 true，优先返回排序中第一个 TEXT 文字频道；
 * - 若公会无文字频道（纯语音服务器），则回退返回排序第一项（如 VOICE 频道）；
 * - 若公会无任何频道，则返回 null。
 */
export function getDefaultGuildChannel(
  guild: Guild,
  preferText: boolean = true,
): Channel | null {
  const sortedChannels = getSortedGuildChannels(guild);
  if (sortedChannels.length === 0) {
    return null;
  }

  if (preferText) {
    const firstTextChannel = sortedChannels.find((c) => c.type === "TEXT");
    if (firstTextChannel) {
      return firstTextChannel;
    }
  }

  return sortedChannels[0];
}

/**
 * 解析并决定切换至某个公会时应选中的频道：
 * 1. 若提供了 lastVisitedChannelId，且该频道在公会当前频道列表中仍然存在，优先恢复该频道；
 * 2. 否则，降级调用 getDefaultGuildChannel 计算默认频道。
 */
export function resolveGuildChannel(
  guild: Guild,
  lastVisitedChannelId?: string | null,
  preferText: boolean = true,
): Channel | null {
  if (lastVisitedChannelId && guild.channels?.length) {
    const rememberedChannel = guild.channels.find(
      (c) => c.id === lastVisitedChannelId,
    );
    if (rememberedChannel) {
      return rememberedChannel;
    }
  }

  return getDefaultGuildChannel(guild, preferText);
}
