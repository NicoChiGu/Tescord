/**
 * URL 与 Markdown 超链接提取及括号平衡工具
 * 遵循 GitHub Flavored Markdown (GFM 0.29+) 与 CommonMark 规范
 */

/** 纯文本 URL 初筛正则：匹配以 http:// 或 https:// 开头的连续非空白与非 HTML 标签字符 */
export const AUTOLINK_CANDIDATE_REGEX = /^(https?:\/\/[^\s<]+)/;

/**
 * 非法尾随标点符号集合：
 * 包含 ASCII 英文半角标点、Markdown 格式控制符以及 CJK (中日韩) 全角标点
 */
export const TRAILING_PUNCTUATIONS = new Set<string>([
  // ASCII 英文标点与 Markdown 控制符
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  '"',
  "'",
  "`",
  "*",
  "_",
  "~",
  "<",
  ">",
  "\\",
  // CJK 中日韩全角标点符号
  "\u3002", // 。 句号
  "\uff0c", // ， 逗号
  "\u3001", // 、 顿号
  "\uff01", // ！ 感叹号
  "\uff1f", // ？ 问号
  "\uff1b", // ； 分号
  "\uff1a", // ： 冒号
  "\u201d", // ” 双引号（右）
  "\u2019", // ’ 单引号（右）
  "\u201c", // “ 双引号（左）
  "\u2018", // ‘ 单引号（左）
  "\u3011", // 】 方头括号（右）
  "\uff09", // ） 全角圆括号（右）
  "\u300b", // 》 书名号（右）
  "\u3009", // 〉 单书名号（右）
  "\u300d", // 」 单引号角标（右）
  "\u300f", // 』 双引号角标（右）
]);

/**
 * 依据 GFM 规范从候选字符串中提取净 URL，执行后向尾随标点剥离与括号平衡（Balanced Parentheses）
 * @param candidate 以 http(s):// 开头的候选 URL 字符串
 * @returns 经过校验与清洗后的有效 URL，若无有效链接则返回空字符串
 */
export function extractBalancedAutolink(candidate: string): string {
  let url = candidate;

  while (url.length > 0) {
    const lastChar = url[url.length - 1];

    // 1. 若末尾是普通非法尾随标点（如句号、逗号、中文方头括号【】等），直接剥离
    if (TRAILING_PUNCTUATIONS.has(lastChar)) {
      url = url.slice(0, -1);
      continue;
    }

    // 2. 若末尾是未闭合的开括号（如 ( 或 [），视为孤立标点予以剥离
    if (lastChar === "(" || lastChar === "[") {
      url = url.slice(0, -1);
      continue;
    }

    // 3. 针对末尾是闭括号 ) 或 ] 的场景，执行括号成对平衡检查
    if (lastChar === ")" || lastChar === "]") {
      const openChar = lastChar === ")" ? "(" : "[";
      let openCount = 0;
      let closeCount = 0;

      for (let i = 0; i < url.length; i++) {
        const ch = url[i];
        if (ch === openChar) openCount++;
        else if (ch === lastChar) closeCount++;
      }

      // 如果闭括号数量多于开括号，说明该闭括号属于外层包裹（例如 (https://example.com)），应予以剥离
      // 如果数量相等（例如 https://wiki.com/Foo_(Bar)），说明是 URL 内部词条的合法闭合，应予以完整保留
      if (closeCount > openCount) {
        url = url.slice(0, -1);
        continue;
      }
    }

    // 尾部字符合法且括号平衡，终止剥离
    break;
  }

  // 必须是有效的完整 URL 协议头（至少多于 "http://" 或 "https://"）
  if (url === "http://" || url === "https://" || url.length < 8) {
    return "";
  }

  return url;
}

/**
 * 支持成对嵌套圆括号的 Markdown 超链接匹配正则：
 * 匹配格式如 [标题](URL)，其中 URL 允许包含至多 2 层的平衡圆括号（如 Wikipedia / Tarkov Wiki 词条）
 */
export const MARKDOWN_LINK_REGEX =
  /^\[([^\]]+)\]\(((?:https?:\/\/|\/)(?:[^\s()]|\((?:[^\s()]|\([^\s()]*\))*\))+)\)/;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);

/**
 * 从文本中提取所有属于本站附件且为图片的 URL
 */
export function extractInlineAttachmentUrls(content?: string): string[] {
  if (!content) return [];

  // Hidden spoilers and code must not reveal media through a second renderer.
  content = content.replace(/```[\s\S]*?```|`[^`]*`|\|\|[\s\S]*?\|\|/g, " ");

  const regex =
    /(?:https?:\/\/[^\s<>"'`]+)?\/attachments\/([^\s<>"'`?#]+)(?:\?[^\s<>"'`]*)?/gi;

  const urls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const rawUrl = extractBalancedAutolink(match[0]);
    if (isInlineAttachmentImageUrl(rawUrl)) {
      urls.push(rawUrl);
    }
  }

  return [...new Set(urls)];
}

export function isInlineAttachmentImageUrl(
  url: string,
  serverUrl?: string,
): boolean {
  try {
    if (!/^https?:\/\//i.test(url) && !/^\/attachments\//.test(url))
      return false;
    const parsed = new URL(url, serverUrl || "https://attachment.invalid");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return false;
    if (serverUrl && parsed.origin !== new URL(serverUrl).origin) return false;
    const match = /^\/attachments\/([^/]+)$/.exec(parsed.pathname);
    if (!match) return false;
    const fileName = decodeURIComponent(match[1]);
    if (/[\\/\x00]/.test(fileName)) return false;
    const ext = fileName.split(".").pop()?.toLowerCase();
    return Boolean(ext && IMAGE_EXTENSIONS.has(ext));
  } catch {
    return false;
  }
}
