export interface DisplayNameUser {
  username?: string | null;
  displayName?: string | null;
}

export interface DisplayNameMember {
  nickname?: string | null;
}

/**
 * 统一获取用户主显示名称：
 * 优先级：公会专属昵称 (member.nickname) > 用户个人显示名 (user.displayName) > 用户名前缀（去掉 #0000 鉴别码）> 完整用户名 > 兜底默认值
 *
 * @param user 目标用户信息对象（包含 username, displayName）
 * @param member 当前公会成员对象（包含 nickname）
 * @param fallback 兜底默认名称，默认为 "用户"
 */
export function getUserDisplayName(
  user?: DisplayNameUser | null,
  member?: DisplayNameMember | null,
  fallback = "用户",
): string {
  if (member?.nickname && member.nickname.trim()) {
    return member.nickname.trim();
  }
  if (user?.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }
  if (!user?.username || !user.username.trim()) {
    return fallback;
  }
  const trimmed = user.username.trim();
  return trimmed.includes("#") ? trimmed.split("#")[0] : trimmed;
}

/**
 * 统一格式化副标识标签 (@username)
 *
 * @param username 用户全名或账号识别名
 */
export function formatUserTag(username?: string | null): string {
  if (!username || !username.trim()) {
    return "";
  }
  const clean = username.trim().replace(/^@/, "");
  return `@${clean}`;
}
