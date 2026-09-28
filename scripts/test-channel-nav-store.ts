import assert from "node:assert/strict";
import { Guild, Channel } from "@tescord/types";
import {
  computeInitialNavigation,
  useChannelNavStore,
} from "../apps/web/src/stores/useChannelNavStore.js";

console.log(
  "=== 开始测试 useChannelNavStore 与 computeInitialNavigation 核心逻辑 ===",
);

// 模拟测试数据
const mockTextChannel: Channel = {
  id: "ch-text-1",
  name: "常规",
  type: "TEXT",
  guildId: "guild-1",
  position: 0,
};

const mockTextChannel2: Channel = {
  id: "ch-text-2",
  name: "技术讨论",
  type: "TEXT",
  guildId: "guild-1",
  position: 1,
};

const mockVoiceChannel: Channel = {
  id: "ch-voice-1",
  name: "语音大厅",
  type: "VOICE",
  guildId: "guild-1",
  position: 2,
};

const mockGuild1: Guild = {
  id: "guild-1",
  name: "测试公会1",
  ownerId: "user-1",
  channels: [mockTextChannel, mockTextChannel2, mockVoiceChannel],
  categories: [],
};

const mockGuild2: Guild = {
  id: "guild-2",
  name: "测试公会2",
  ownerId: "user-1",
  channels: [
    {
      id: "ch-g2-1",
      name: "公会2频道",
      type: "TEXT",
      guildId: "guild-2",
      position: 0,
    },
  ],
  categories: [],
};

// 1. 测试 computeInitialNavigation: 用户最后停留在私信/好友主页 (lastSelectedGuildId === null)
{
  const result = computeInitialNavigation(
    "user-1",
    [mockGuild1, mockGuild2],
    null,
    () => undefined,
  );
  assert.equal(
    result.selectedGuildId,
    null,
    "当 lastSelectedGuildId 为 null 时，selectedGuildId 应为 null",
  );
  assert.equal(
    result.selectedChannel,
    null,
    "当处于好友视图时，selectedChannel 应为 null",
  );
  assert.equal(
    result.isFriendsTabActive,
    true,
    "当处于好友视图时，isFriendsTabActive 应为 true",
  );
  console.log("✔ 测试 1: 私信/好友视图记忆恢复校验通过");
}

// 2. 测试 computeInitialNavigation: 用户最后停留在公会 1，且访问过频道 2
{
  const result = computeInitialNavigation(
    "user-1",
    [mockGuild1, mockGuild2],
    "guild-1",
    (guildId) => (guildId === "guild-1" ? "ch-text-2" : undefined),
  );
  assert.equal(result.selectedGuildId, "guild-1", "应正确选中公会 1");
  assert.equal(
    result.selectedChannel?.id,
    "ch-text-2",
    "应精准恢复公会 1 内部最后访问的频道 2",
  );
  assert.equal(
    result.isFriendsTabActive,
    false,
    "公会模式下 isFriendsTabActive 应为 false",
  );
  console.log("✔ 测试 2: 公会与具体频道精确记忆恢复校验通过");
}

// 3. 测试 computeInitialNavigation: 记忆的公会已被删除/退出，安全降级至首个可用公会
{
  const result = computeInitialNavigation(
    "user-1",
    [mockGuild1, mockGuild2],
    "guild-deleted",
    () => undefined,
  );
  assert.equal(
    result.selectedGuildId,
    "guild-1",
    "失效公会应降级至第一个有效公会",
  );
  assert.equal(
    result.selectedChannel?.id,
    "ch-text-1",
    "应默认聚焦该公会的首选文字频道",
  );
  assert.equal(result.isFriendsTabActive, false);
  console.log("✔ 测试 3: 失效公会降级恢复校验通过");
}

// 4. 测试 computeInitialNavigation: 没有任何公会且无记忆，进入好友主页
{
  const result = computeInitialNavigation(
    "user-1",
    [],
    undefined,
    () => undefined,
  );
  assert.equal(result.selectedGuildId, null);
  assert.equal(result.selectedChannel, null);
  assert.equal(result.isFriendsTabActive, true);
  console.log("✔ 测试 4: 空公会列表安全进入好友主页校验通过");
}

// 5. 模拟 localStorage 验证 Store 的存储隔离与完整生命周期
{
  const storageMap: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storageMap[key] ?? null,
    setItem: (key: string, val: string) => {
      storageMap[key] = val;
    },
    removeItem: (key: string) => {
      delete storageMap[key];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
    length: 0,
    key: () => null,
  };

  // 设置用户 A
  useChannelNavStore.getState().setUserId("user-A");
  useChannelNavStore.getState().saveCachedGuilds([mockGuild1]);
  useChannelNavStore.getState().recordLastSelectedGuild("guild-1");
  useChannelNavStore.getState().recordChannelVisit("guild-1", "ch-text-2");

  assert.equal(
    useChannelNavStore.getState().getLastSelectedGuild("user-A"),
    "guild-1",
  );
  assert.equal(
    useChannelNavStore.getState().loadCachedGuilds("user-A").length,
    1,
  );
  assert.equal(
    useChannelNavStore.getState().getLastVisitedChannel("guild-1"),
    "ch-text-2",
  );

  // 切换到好友主页 (null)
  useChannelNavStore.getState().recordLastSelectedGuild(null);
  assert.equal(
    useChannelNavStore.getState().getLastSelectedGuild("user-A"),
    null,
    "记录 null 代表好友主页记忆",
  );

  // 切换到用户 B（隔离验证）
  useChannelNavStore.getState().setUserId("user-B");
  assert.equal(
    useChannelNavStore.getState().getLastSelectedGuild("user-B"),
    undefined,
    "用户 B 初始无记忆",
  );
  assert.equal(
    useChannelNavStore.getState().loadCachedGuilds("user-B").length,
    0,
    "用户 B 初始无公会缓存",
  );

  // 切回用户 A，验证持久化保留
  useChannelNavStore.getState().setUserId("user-A");
  assert.equal(
    useChannelNavStore.getState().getLastSelectedGuild("user-A"),
    null,
  );
  assert.equal(
    useChannelNavStore.getState().loadCachedGuilds("user-A").length,
    1,
  );

  // 测试 removeGuildMemory 级联清除缓存与记忆
  useChannelNavStore.getState().recordLastSelectedGuild("guild-1");
  useChannelNavStore.getState().removeGuildMemory("guild-1");
  assert.equal(
    useChannelNavStore.getState().getLastSelectedGuild("user-A"),
    null,
    "被删除的公会若为当前选中公会，应自动重置 lastSelectedGuildId 为 null",
  );
  assert.equal(
    useChannelNavStore.getState().loadCachedGuilds("user-A").length,
    0,
    "被删除的公会应从缓存公会列表中清除",
  );

  console.log(
    "✔ 测试 5: localStorage 存储隔离、用户切换与级联清理校验 100% 通过！",
  );
}

console.log("🎉 所有 useChannelNavStore 单元测试全部通过！");
