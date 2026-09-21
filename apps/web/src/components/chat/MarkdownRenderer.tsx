import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  onMentionClick?: (username: string, rect: DOMRect) => void;
  currentUsername?: string;
}

// 递归解析节点内部文本中的 @提及
function parseMentionsInNode(
  node: React.ReactNode,
  onMentionClick?: (username: string, rect: DOMRect) => void,
  currentUsername?: string,
): React.ReactNode {
  if (typeof node === "string") {
    const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    if (!mentionRegex.test(node)) {
      return node;
    }
    mentionRegex.lastIndex = 0;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(node)) !== null) {
      if (match.index > lastIndex) {
        elements.push(node.substring(lastIndex, match.index));
      }
      const targetName = match[1];
      const isSpecial = targetName === "everyone" || targetName === "here";
      const isMe =
        currentUsername &&
        targetName.toLowerCase() === currentUsername.toLowerCase();

      elements.push(
        <span
          key={`${match.index}-${targetName}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isSpecial) {
              onMentionClick?.(
                targetName,
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
              ? `全员广播: @${targetName}`
              : `点击查看 @${targetName} 的个人资料`
          }
        >
          @{targetName}
        </span>,
      );
      lastIndex = mentionRegex.lastIndex;
    }

    if (lastIndex < node.length) {
      elements.push(node.substring(lastIndex));
    }
    return elements;
  }

  if (React.isValidElement(node) && (node.props as any)?.children) {
    const children = (node.props as any).children;
    return React.cloneElement(node, {
      ...(node.props as any),
      children: React.Children.map(children, (child) =>
        parseMentionsInNode(child, onMentionClick, currentUsername),
      ),
    });
  }

  return node;
}

// Discord 风格剧透 (Spoiler) 胶囊组件
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

// 预处理函数：将 Discord 风格的 ||spoiler|| 转换为 HTML 标签并保留 Markdown 其余语法
function parseDiscordSpoilers(raw: string): (string | { spoiler: string })[] {
  const parts: (string | { spoiler: string })[] = [];
  const regex = /\|\|(.*?)\|\|/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push(raw.substring(lastIndex, match.index));
    }
    parts.push({ spoiler: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    parts.push(raw.substring(lastIndex));
  }

  return parts;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onMentionClick,
  currentUsername,
}) => {
  const segments = parseDiscordSpoilers(content);

  const wrapMentions = (children: React.ReactNode) =>
    parseMentionsInNode(children, onMentionClick, currentUsername);

  return (
    <div className="text-[14px] leading-[1.375rem] text-discord-textNormal break-words font-normal">
      {segments.map((seg, idx) => {
        if (typeof seg !== "string") {
          return <Spoiler key={idx}>{wrapMentions(seg.spoiler)}</Spoiler>;
        }

        return (
          <ReactMarkdown
            key={idx}
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <span className="inline">{wrapMentions(children)}</span>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-discord-brand hover:underline font-medium"
                >
                  {children}
                </a>
              ),
              code: ({ className, children, ...props }) => {
                const isInline =
                  !className &&
                  typeof children === "string" &&
                  !children.includes("\n");
                if (isInline) {
                  return (
                    <code
                      className="bg-[#2b2d31] text-[#ebdbb2] font-mono text-[12px] px-1.5 py-0.5 rounded border border-[#383a40]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="bg-[#1e1f22] p-3 my-2 rounded-lg border border-[#2b2d31] font-mono text-xs overflow-x-auto text-discord-textHeader">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              blockquote: ({ children }) => (
                <div className="border-l-4 border-[#4e5058] pl-3 my-1.5 text-discord-textMuted italic bg-[#2b2d31]/40 py-0.5 rounded-r">
                  {wrapMentions(children)}
                </div>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 my-1 space-y-0.5">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li>{wrapMentions(children)}</li>,
              strong: ({ children }) => (
                <strong className="font-bold text-discord-textHeader">
                  {wrapMentions(children)}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic">{wrapMentions(children)}</em>
              ),
              del: ({ children }) => (
                <del className="line-through text-discord-textMuted">
                  {wrapMentions(children)}
                </del>
              ),
            }}
          >
            {seg}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};
