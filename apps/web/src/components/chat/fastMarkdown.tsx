import { isServerAttachmentImage } from "../../config.js";
import React, { useState } from "react";
import {
  AUTOLINK_CANDIDATE_REGEX,
  extractBalancedAutolink,
  MARKDOWN_LINK_REGEX,
} from "../../utils/url.js";

export { extractBalancedAutolink };

export interface MarkdownContext {
  onMentionClick?: (username: string, rect: DOMRect) => void;
  onAttachmentClick?: (url: string) => void;
  currentUsername?: string;
}

// Discord 风格剧透胶囊组件
export const Spoiler: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setRevealed(!revealed);
      }}
      className={`inline-block px-1.5 py-0.5 rounded text-[13px] transition cursor-pointer select-none ${
        revealed
          ? "bg-[#35373c] text-discord-textHeader border border-[#4e5058]"
          : "bg-[#1e1f22] hover:bg-[#2b2d31] text-transparent hover:text-transparent"
      }`}
      title={revealed ? "点击隐藏剧透" : "剧透警告：点击显隐"}
    >
      {children}
    </span>
  );
};

// 渲染 @提及 胶囊
const renderMention = (
  username: string,
  key: string | number,
  ctx?: MarkdownContext,
) => {
  const isSpecial = username === "everyone" || username === "here";
  const isMe =
    ctx?.currentUsername &&
    username.toLowerCase() === ctx.currentUsername.toLowerCase();

  return (
    <span
      key={key}
      onClick={(e) => {
        e.stopPropagation();
        if (!isSpecial) {
          ctx?.onMentionClick?.(
            username,
            e.currentTarget.getBoundingClientRect(),
          );
        }
      }}
      className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[13px] font-medium transition select-none align-baseline ${
        isSpecial
          ? "bg-[#5865f2]/20 hover:bg-[#5865f2]/35 text-[#c9cdfb] cursor-default"
          : isMe
            ? "bg-[#f0b232]/20 hover:bg-[#f0b232]/35 text-[#f0b232] font-semibold cursor-pointer"
            : "bg-[#5865f2]/15 hover:bg-[#5865f2] text-[#c9cdfb] hover:text-white cursor-pointer"
      }`}
      title={
        isSpecial
          ? `全员广播: @${username}`
          : `点击查看 @${username} 的个人资料`
      }
    >
      @{username}
    </span>
  );
};

// 正则表达式集合
const MENTION_REGEX = /^@([a-zA-Z0-9_\u4e00-\u9fa5]+)/;
const CODE_INLINE_REGEX = /^`([^`\n]+)`/;
const SPOILER_REGEX = /^\|\|([\s\S]+?)\|\|/;
const BOLD_UNDERLINE_REGEX =
  /^__(?:\*\*([\s\S]+?)\*\*|([\s\S]+?))__(?![a-zA-Z0-9_\u4e00-\u9fa5])/;
const BOLD_REGEX = /^\*\*([\s\S]+?)\*\*/;
const ITALIC_STAR_REGEX = /^\*([^\*\n]+)\*/;
const ITALIC_UNDER_REGEX = /^_([^\_\n\s]+?)_(?![a-zA-Z0-9_\u4e00-\u9fa5])/;
const STRIKE_REGEX = /^~~([\s\S]+?)~~/;
const LINK_REGEX = MARKDOWN_LINK_REGEX;

// 行内解析器：将文本解析为 React 节点流
function parseInline(
  text: string,
  ctx?: MarkdownContext,
  keyPrefix = "in",
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let prevChar = "";
  let counter = 0;

  while (remaining.length > 0) {
    const key = `${keyPrefix}-${counter++}`;

    // 1. 行内代码 `code`
    let match = remaining.match(CODE_INLINE_REGEX);
    if (match) {
      nodes.push(
        <code
          key={key}
          className="bg-[#2b2d31] text-[#ebdbb2] font-mono text-[12px] px-1.5 py-0.5 rounded border border-[#383a40]"
        >
          {match[1]}
        </code>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 2. 剧透 ||spoiler||
    match = remaining.match(SPOILER_REGEX);
    if (match) {
      nodes.push(
        <Spoiler key={key}>{parseInline(match[1], ctx, `${key}-sp`)}</Spoiler>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 3. @提及
    match = remaining.match(MENTION_REGEX);
    if (match) {
      nodes.push(renderMention(match[1], key, ctx));
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 4. Markdown 链接 [text](url)
    match = remaining.match(LINK_REGEX);
    if (match) {
      const linkUrl = match[2];
      const isAtt = isServerAttachmentImage(linkUrl);
      nodes.push(
        <a
          key={key}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (isAtt && ctx?.onAttachmentClick) {
              e.preventDefault();
              ctx.onAttachmentClick(linkUrl);
            }
          }}
          className="text-discord-brand hover:underline font-medium break-all"
        >
          {parseInline(match[1], ctx, `${key}-lnk`)}
        </a>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 5. 纯文本自动链接 (AutoLink，支持成对括号平衡与全角标点安全剥离)
    match =
      remaining.match(AUTOLINK_CANDIDATE_REGEX) ||
      remaining.match(/^(\/attachments\/[^\s<]+)/);
    if (match) {
      const validUrl = extractBalancedAutolink(match[1]);
      if (validUrl) {
        const isAtt = isServerAttachmentImage(validUrl);
        nodes.push(
          <a
            key={key}
            href={validUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (isAtt && ctx?.onAttachmentClick) {
                e.preventDefault();
                ctx.onAttachmentClick(validUrl);
              }
            }}
            className="text-discord-brand hover:underline font-medium break-all"
          >
            {validUrl}
          </a>,
        );
        prevChar = validUrl[validUrl.length - 1];
        remaining = remaining.slice(validUrl.length);
        continue;
      }
    }

    const isPrecededByWord = /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(prevChar);

    // 6. 加粗加下划线 __**text**__ 或 __text__
    if (!isPrecededByWord) {
      match = remaining.match(BOLD_UNDERLINE_REGEX);
      if (match) {
        const inner = match[1] || match[2];
        const isBold = !!match[1];
        nodes.push(
          <u
            key={key}
            className={isBold ? "font-bold text-discord-textHeader" : ""}
          >
            {parseInline(inner, ctx, `${key}-u`)}
          </u>,
        );
        prevChar = remaining[match[0].length - 1];
        remaining = remaining.slice(match[0].length);
        continue;
      }
    }

    // 7. 加粗 **text**
    match = remaining.match(BOLD_REGEX);
    if (match) {
      nodes.push(
        <strong key={key} className="font-bold text-discord-textHeader">
          {parseInline(match[1], ctx, `${key}-b`)}
        </strong>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 8. 删除线 ~~text~~
    match = remaining.match(STRIKE_REGEX);
    if (match) {
      nodes.push(
        <del key={key} className="line-through text-discord-textMuted">
          {parseInline(match[1], ctx, `${key}-del`)}
        </del>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 9. 斜体 *text* 或 _text_
    match = remaining.match(ITALIC_STAR_REGEX);
    if (!match && !isPrecededByWord) {
      match = remaining.match(ITALIC_UNDER_REGEX);
    }
    if (match) {
      nodes.push(
        <em key={key} className="italic">
          {parseInline(match[1], ctx, `${key}-i`)}
        </em>,
      );
      prevChar = remaining[match[0].length - 1];
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // 10. 普通文本累积
    const nextSpecialIndex = remaining.search(
      /[`*_~|\[@]|https?:\/\/|\/attachments\//,
    );
    if (nextSpecialIndex === -1) {
      nodes.push(remaining);
      break;
    } else if (nextSpecialIndex > 0) {
      nodes.push(remaining.slice(0, nextSpecialIndex));
      prevChar = remaining[nextSpecialIndex - 1];
      remaining = remaining.slice(nextSpecialIndex);
    } else {
      nodes.push(remaining[0]);
      prevChar = remaining[0];
      remaining = remaining.slice(1);
    }
  }

  return nodes;
}

// LRU 语法树与 React 节点缓存池：上限 500 条，杜绝消息列表滚动复用时重复执行正则词法分析
const MARKDOWN_CACHE_LIMIT = 500;
const markdownCache = new Map<string, React.ReactNode>();

export function clearFastMarkdownCache(): void {
  markdownCache.clear();
}

// 块级分词与解析实现
function parseFastMarkdownInternal(
  content: string,
  ctx?: MarkdownContext,
): React.ReactNode {
  if (!content) return null;

  // 极速快径 1：极简纯文本（无任何格式与特殊符号，普通蛇形命名如 foo_bar 视为纯文本）
  const hasFormatting =
    /[`*~|\[\]>@\n]|https?:\/\/|\/attachments\//.test(content) ||
    /(?:^|\s)_[^\s_][^_]*[^\s_]_(?:\s|$)/.test(content);
  if (!hasFormatting) {
    return <span>{content}</span>;
  }

  // 极速快径 2：仅包含 @提及 而无多行或复杂 Markdown
  const isSimpleMentionOnly =
    !/[`*~|\[\]>\n]|https?:\/\/|\/attachments\//.test(content) &&
    !/(?:^|\s)_[^\s_][^_]*[^\s_]_(?:\s|$)/.test(content) &&
    content.includes("@");
  if (isSimpleMentionOnly) {
    const parts = content.split(/(@[a-zA-Z0-9_\u4e00-\u9fa5]+)/g);
    return (
      <span>
        {parts.map((part, idx) => {
          if (part.startsWith("@")) {
            const username = part.slice(1);
            return renderMention(username, idx, ctx);
          }
          return part;
        })}
      </span>
    );
  }

  // 块级解析（处理代码块 ```、引用块 >、换行 \n）
  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 多行代码块 ```
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      elements.push(
        <pre
          key={`codeblock-${i}`}
          className="bg-[#1e1f22] p-3 my-2 rounded-lg border border-[#2b2d31] font-mono text-xs overflow-x-auto text-discord-textHeader"
        >
          <code className={lang ? `language-${lang}` : ""}>
            {codeLines.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    // 引用块 >
    if (line.startsWith("> ") || line === ">") {
      const quoteLines: string[] = [line.startsWith("> ") ? line.slice(2) : ""];
      i++;
      while (
        i < lines.length &&
        (lines[i].startsWith("> ") || lines[i] === ">")
      ) {
        quoteLines.push(lines[i].startsWith("> ") ? line.slice(2) : "");
        i++;
      }
      elements.push(
        <div
          key={`quote-${i}`}
          className="border-l-4 border-[#4e5058] pl-3 my-1.5 text-discord-textMuted italic bg-[#2b2d31]/40 py-0.5 rounded-r"
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={qIdx}>{parseInline(ql, ctx, `q-${qIdx}`)}</div>
          ))}
        </div>,
      );
      continue;
    }

    // 普通行
    elements.push(
      <span key={`line-${i}`} className="inline">
        {parseInline(line, ctx, `l-${i}`)}
      </span>,
    );

    if (i < lines.length - 1) {
      elements.push(<br key={`br-${i}`} />);
    }
    i++;
  }

  return elements;
}

// 块级分词与解析入口（带 LRU 缓存）
export function parseFastMarkdown(
  content: string,
  ctx?: MarkdownContext,
): React.ReactNode {
  if (!content) return null;

  // Mention nodes close over the click handler. Reusing them across message
  // components or accounts would invoke the first renderer's stale handler.
  if (
    (ctx?.onMentionClick && content.includes("@")) ||
    (ctx?.onAttachmentClick && content.includes("/attachments/"))
  ) {
    return parseFastMarkdownInternal(content, ctx);
  }

  // 构造稳定的缓存 Key（结合当前用户名与内容）
  const cacheKey = `${ctx?.currentUsername || ""}:::${content}`;
  const cached = markdownCache.get(cacheKey);
  if (cached) {
    // 移至末尾更新 LRU
    markdownCache.delete(cacheKey);
    markdownCache.set(cacheKey, cached);
    return cached;
  }

  const result = parseFastMarkdownInternal(content, ctx);

  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldestKey = markdownCache.keys().next().value;
    if (oldestKey !== undefined) {
      markdownCache.delete(oldestKey);
    }
  }
  markdownCache.set(cacheKey, result);

  return result;
}
