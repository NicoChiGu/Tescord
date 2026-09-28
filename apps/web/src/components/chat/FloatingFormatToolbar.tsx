import React from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  FileCode,
  EyeOff,
  Quote,
  Link2,
} from "lucide-react";

export type FormatType =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "codeBlock"
  | "spoiler"
  | "quote"
  | "link";

interface FloatingFormatToolbarProps {
  isMobile: boolean;
  position: { top: number; left: number } | null;
  onApply: (type: FormatType) => void;
}

export const FloatingFormatToolbar: React.FC<FloatingFormatToolbarProps> = ({
  isMobile,
  position,
  onApply,
}) => {
  const { t } = useTranslation("chat");

  const buttons: Array<{
    type: FormatType;
    icon: React.ReactNode;
    title: string;
  }> = [
    {
      type: "bold",
      icon: <Bold className="w-4 h-4" />,
      title: t("toolbar.bold", "粗体 (**)"),
    },
    {
      type: "italic",
      icon: <Italic className="w-4 h-4" />,
      title: t("toolbar.italic", "斜体 (*)"),
    },
    {
      type: "strikethrough",
      icon: <Strikethrough className="w-4 h-4" />,
      title: t("toolbar.strikethrough", "删除线 (~~)"),
    },
    {
      type: "inlineCode",
      icon: <Code className="w-4 h-4" />,
      title: t("toolbar.inlineCode", "行内代码 (`)"),
    },
    {
      type: "codeBlock",
      icon: <FileCode className="w-4 h-4" />,
      title: t("toolbar.codeBlock", "代码块 (```)"),
    },
    {
      type: "spoiler",
      icon: <EyeOff className="w-4 h-4" />,
      title: t("toolbar.spoiler", "剧透标签 (||)"),
    },
    {
      type: "quote",
      icon: <Quote className="w-4 h-4" />,
      title: t("toolbar.quote", "引用 (>)"),
    },
    {
      type: "link",
      icon: <Link2 className="w-4 h-4" />,
      title: t("toolbar.link", "超链接 ([文字](链接))"),
    },
  ];

  if (isMobile) {
    return (
      <div
        data-testid="floating-format-toolbar-mobile"
        className="absolute -top-11 left-0 right-0 z-40 flex items-center justify-start gap-1 overflow-x-auto px-2 py-1.5 rounded-t-xl bg-[#2b2d31]/95 border border-white/10 shadow-xl backdrop-blur-md no-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        {buttons.map((btn) => (
          <button
            key={btn.type}
            type="button"
            data-testid={`format-btn-${btn.type}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onApply(btn.type);
            }}
            title={btn.title}
            aria-label={btn.title}
            className="p-1.5 rounded-md hover:bg-white/10 active:bg-white/20 text-discord-textMuted hover:text-white transition-colors shrink-0"
          >
            {btn.icon}
          </button>
        ))}
      </div>
    );
  }

  if (!position) return null;

  return (
    <div
      data-testid="floating-format-toolbar-desktop"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      className="fixed z-50 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-[#1e1f22]/95 border border-white/10 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
    >
      {buttons.map((btn) => (
        <button
          key={btn.type}
          type="button"
          data-testid={`format-btn-${btn.type}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onApply(btn.type);
          }}
          title={btn.title}
          aria-label={btn.title}
          className="p-1.5 rounded hover:bg-white/10 active:bg-white/20 text-discord-textMuted hover:text-white transition-colors"
        >
          {btn.icon}
        </button>
      ))}
    </div>
  );
};
