import React, { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "../ui/context-menu.js";
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Undo2,
  Redo2,
  CheckCheck,
  Code,
  Bold,
  EyeOff,
} from "lucide-react";

interface InputContextMenuProps {
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (val: string) => void;
  children: React.ReactNode;
}

export const InputContextMenu: React.FC<InputContextMenuProps> = ({
  inputRef,
  value,
  onChange,
  children,
}) => {
  const [pasteTip, setPasteTip] = useState<string | null>(null);

  // 获取输入框当前选区
  const getSelectionInfo = () => {
    const el = inputRef?.current;
    if (!el) {
      return { start: value.length, end: value.length, selectedText: "" };
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    return {
      start,
      end,
      selectedText: value.substring(start, end),
    };
  };

  const handleCut = async () => {
    const { start, end, selectedText } = getSelectionInfo();
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      const nextVal = value.substring(0, start) + value.substring(end);
      onChange(nextVal);
      // 重新恢复光标
      setTimeout(() => {
        if (inputRef?.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(start, start);
        }
      }, 0);
    } catch (e) {
      console.error("Cut failed:", e);
    }
  };

  const handleCopy = async () => {
    const { selectedText } = getSelectionInfo();
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const { start, end } = getSelectionInfo();
      const nextVal = value.substring(0, start) + text + value.substring(end);
      onChange(nextVal);
      const nextCursor = start + text.length;
      setTimeout(() => {
        if (inputRef?.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
    } catch (err) {
      // 浏览器权限受阻时给出友好提示
      setPasteTip("请直接使用快捷键 Ctrl+V 粘贴");
      setTimeout(() => setPasteTip(null), 3000);
    }
  };

  const handleSelectAll = () => {
    if (inputRef?.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  };

  const handleFormat = (prefix: string, suffix: string) => {
    const { start, end, selectedText } = getSelectionInfo();
    const content = selectedText || "文字";
    const inserted = `${prefix}${content}${suffix}`;
    const nextVal = value.substring(0, start) + inserted + value.substring(end);
    onChange(nextVal);
    setTimeout(() => {
      if (inputRef?.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(
          start + prefix.length,
          start + prefix.length + content.length,
        );
      }
    }, 0);
  };

  const hasSelection = !!getSelectionInfo().selectedText;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          onClick={handleCut}
          disabled={!hasSelection}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <Scissors className="w-4 h-4 text-discord-textMuted" />
            <span>剪切</span>
          </div>
          <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleCopy}
          disabled={!hasSelection}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <Copy className="w-4 h-4 text-discord-textMuted" />
            <span>复制</span>
          </div>
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handlePaste}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <ClipboardPaste className="w-4 h-4 text-discord-textMuted" />
            <span>{pasteTip || "粘贴"}</span>
          </div>
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={handleSelectAll}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <CheckCheck className="w-4 h-4 text-discord-textMuted" />
            <span>全选</span>
          </div>
          <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* 快速 Markdown 格式化 */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <div className="flex items-center space-x-2">
              <Bold className="w-4 h-4 text-discord-textMuted" />
              <span>文字格式</span>
            </div>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onClick={() => handleFormat("**", "**")}>
              <div className="flex items-center space-x-2">
                <Bold className="w-4 h-4 text-discord-textMuted" />
                <span>加粗粗体</span>
              </div>
              <ContextMenuShortcut>**文本**</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={() => handleFormat("||", "||")}>
              <div className="flex items-center space-x-2">
                <EyeOff className="w-4 h-4 text-discord-textMuted" />
                <span>剧透遮罩</span>
              </div>
              <ContextMenuShortcut>||文本||</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={() => handleFormat("`", "`")}>
              <div className="flex items-center space-x-2">
                <Code className="w-4 h-4 text-discord-textMuted" />
                <span>行内代码</span>
              </div>
              <ContextMenuShortcut>`代码`</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
};
