import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
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
}) => {
  const segments = parseDiscordSpoilers(content);

  return (
    <div className="text-[14px] leading-[1.375rem] text-discord-textNormal break-words font-normal">
      {segments.map((seg, idx) => {
        if (typeof seg !== "string") {
          return <Spoiler key={idx}>{seg.spoiler}</Spoiler>;
        }

        return (
          <ReactMarkdown
            key={idx}
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <span className="inline">{children}</span>,
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
                  {children}
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
              strong: ({ children }) => (
                <strong className="font-bold text-discord-textHeader">
                  {children}
                </strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              del: ({ children }) => (
                <del className="line-through text-discord-textMuted">
                  {children}
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
