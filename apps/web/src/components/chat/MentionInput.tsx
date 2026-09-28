import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { User, GuildMember, Role, parseRoleIds } from "@tescord/types";
import {
  MentionAutocomplete,
  MentionCandidate,
} from "./MentionAutocomplete.js";
import {
  FloatingFormatToolbar,
  FormatType,
} from "./FloatingFormatToolbar.js";
import { getUserDisplayName } from "../../utils/userDisplay.js";

export interface MentionInputHandle {
  focus: () => void;
  clear: () => void;
  insertMention: (userId: string, name: string) => void;
  insertText: (text: string) => void;
  getPlainText: () => string;
  getElement: () => HTMLDivElement | null;
}

interface MentionInputProps {
  initialValue?: string;
  placeholder?: string;
  members?: GuildMember[];
  roles?: Role[];
  disabled?: boolean;
  onSendMessage: (text: string) => void;
  onPasteFiles?: (files: File[]) => void;
  onChangeText?: (text: string) => void;
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  (
    {
      initialValue,
      placeholder = "发送消息...",
      members = [],
      roles = [],
      disabled = false,
      onSendMessage,
      onPasteFiles,
      onChangeText,
    },
    ref,
  ) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    // 补全菜单状态
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // 记录触发 @ 的位置与 Range
    const mentionRangeRef = useRef<Range | null>(null);

    // 富文本悬浮菜单状态
    const [selectedRange, setSelectedRange] = useState<Range | null>(null);
    const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
    const [showToolbar, setShowToolbar] = useState(false);
    const [isMobileDevice, setIsMobileDevice] = useState(false);
    const isCtrlAPressedRef = useRef(false);

    // 移动端视口检测
    useEffect(() => {
      const checkMobile = () => {
        setIsMobileDevice(
          typeof window !== "undefined" &&
            (window.innerWidth < 768 ||
              ("ontouchstart" in window && window.innerWidth < 1024)),
        );
      };
      checkMobile();
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }, []);

    // 序列化 contenteditable 内容为纯文本字符串
    const serializeToPlainText = useCallback((node: Node | null): string => {
      if (!node) return "";
      let result = "";

      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          result += child.textContent || "";
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement;
          if (el.classList.contains("mention-chip")) {
            const name = el.getAttribute("data-mention-name") || "";
            result += `@${name} `;
          } else if (el.tagName === "BR") {
            result += "\n";
          } else if (el.tagName === "DIV" || el.tagName === "P") {
            result += (result ? "\n" : "") + serializeToPlainText(el);
          } else {
            result += serializeToPlainText(el);
          }
        }
      });

      return result;
    }, []);

    // 提取当前纯文本并通知外部
    const handleContentChange = useCallback(() => {
      if (!editorRef.current) return;
      const text = serializeToPlainText(editorRef.current);
      const textTrimmed = text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
      setIsEmpty(!textTrimmed && editorRef.current.childNodes.length === 0);
      onChangeText?.(text);
    }, [serializeToPlainText, onChangeText]);

    // 当外部传入或切换 initialValue 时（例如频道草稿恢复/清空），同步更新 DOM
    useEffect(() => {
      if (editorRef.current) {
        const currentText = serializeToPlainText(editorRef.current);
        const nextText = initialValue ?? "";
        if (currentText !== nextText) {
          editorRef.current.innerText = nextText;
          const textTrimmed = nextText
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
          setIsEmpty(!textTrimmed);
        }
      }
    }, [initialValue, serializeToPlainText]);

    // 创建 Mention Tag DOM 节点
    const createMentionTagElement = useCallback(
      (userId: string, name: string) => {
        const span = document.createElement("span");
        span.className =
          "mention-chip inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-[#5865f2]/20 hover:bg-[#5865f2]/35 text-[#c9cdfb] font-medium text-xs select-none align-baseline cursor-default transition-colors";
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-mention-id", userId);
        span.setAttribute("data-mention-name", name);
        span.textContent = `@${name}`;
        return span;
      },
      [],
    );

    // 插入 Tag 到当前光标处
    const insertMentionAtCursor = useCallback(
      (userId: string, name: string) => {
        if (!editorRef.current) return;
        editorRef.current.focus();

        const sel = window.getSelection();
        let range: Range;

        if (mentionRangeRef.current) {
          range = mentionRangeRef.current;
        } else if (sel && sel.rangeCount > 0) {
          range = sel.getRangeAt(0);
        } else {
          range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
        }

        // 删除已输入的 @query
        range.deleteContents();

        const chip = createMentionTagElement(userId, name);
        const space = document.createTextNode("\u00A0"); // 不可拆分空格

        range.insertNode(space);
        range.insertNode(chip);

        // 将光标定位在空格之后
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.setEndAfter(space);

        if (sel) {
          sel.removeAllRanges();
          sel.addRange(newRange);
        }

        mentionRangeRef.current = null;
        setIsMenuOpen(false);
        setMentionQuery("");
        handleContentChange();
      },
      [createMentionTagElement, handleContentChange],
    );

    // 暴露 ImperativeHandle 给父组件
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
        },
        clear: () => {
          if (editorRef.current) {
            editorRef.current.innerHTML = "";
            handleContentChange();
          }
        },
        insertMention: (userId: string, name: string) => {
          insertMentionAtCursor(userId, name);
        },
        insertText: (text: string) => {
          if (!editorRef.current) return;
          editorRef.current.focus();
          const sel = window.getSelection();
          let range: Range;
          if (sel && sel.rangeCount > 0) {
            range = sel.getRangeAt(0);
          } else {
            range = document.createRange();
            range.selectNodeContents(editorRef.current);
            range.collapse(false);
          }
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          const newRange = document.createRange();
          newRange.setStartAfter(textNode);
          newRange.setEndAfter(textNode);
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
          handleContentChange();
        },
        getPlainText: () => {
          return editorRef.current
            ? serializeToPlainText(editorRef.current)
            : "";
        },
        getElement: () => editorRef.current,
      }),
      [insertMentionAtCursor, serializeToPlainText, handleContentChange],
    );

    // 监听全局 @提及 事件 (来自成员列表或右键菜单)
    useEffect(() => {
      const handleMentionEvent = (e: Event) => {
        const customEvent = e as CustomEvent<{
          username: string;
          userId?: string;
          displayName?: string;
        }>;
        if (customEvent.detail?.username) {
          const name =
            customEvent.detail.displayName || customEvent.detail.username;
          const id = customEvent.detail.userId || customEvent.detail.username;
          insertMentionAtCursor(id, name);
        }
      };

      window.addEventListener("tescord:mention", handleMentionEvent);
      return () => {
        window.removeEventListener("tescord:mention", handleMentionEvent);
      };
    }, [insertMentionAtCursor]);

    // 选区与悬浮富文本工具栏更新
    const updateSelectionToolbar = useCallback(() => {
      if (disabled) {
        setShowToolbar(false);
        return;
      }
      // 严格仅在用户按下 Ctrl+A / Command+A 快捷键时抑制悬浮菜单，若鼠标划选则依旧展示
      if (isCtrlAPressedRef.current) {
        setShowToolbar(false);
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setShowToolbar(false);
        return;
      }
      const range = sel.getRangeAt(0);
      if (
        !editorRef.current ||
        !editorRef.current.contains(range.commonAncestorContainer)
      ) {
        setShowToolbar(false);
        return;
      }
      const text = sel.toString();
      if (!text || !text.trim()) {
        setShowToolbar(false);
        return;
      }

      setSelectedRange(range.cloneRange());

      const isMobile =
        typeof window !== "undefined" &&
        (window.innerWidth < 768 ||
          ("ontouchstart" in window && window.innerWidth < 1024));

      if (!isMobile) {
        const rect = range.getBoundingClientRect();
        const toolbarWidth = 320;
        const toolbarHeight = 36;
        const gap = 8;

        let left = rect.left + rect.width / 2 - toolbarWidth / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - toolbarWidth - 12));

        let top = rect.top - toolbarHeight - gap;
        if (top < 10) {
          top = rect.bottom + gap;
        }
        setToolbarPos({ top, left });
      }
      setShowToolbar(true);
    }, [disabled]);

    useEffect(() => {
      const onSelectionChange = () => {
        requestAnimationFrame(updateSelectionToolbar);
      };
      document.addEventListener("selectionchange", onSelectionChange);
      return () => {
        document.removeEventListener("selectionchange", onSelectionChange);
      };
    }, [updateSelectionToolbar]);

    // 执行富文本 Markdown 智能包裹
    const applyFormat = useCallback(
      (formatType: FormatType) => {
        if (!editorRef.current) return;
        const sel = window.getSelection();
        let range = selectedRange;
        if (
          sel &&
          sel.rangeCount > 0 &&
          editorRef.current.contains(sel.getRangeAt(0).commonAncestorContainer)
        ) {
          range = sel.getRangeAt(0);
        }
        if (!range) return;

        const rawText = range.toString();
        if (!rawText) return;

        let newText = rawText;
        switch (formatType) {
          case "bold":
            newText =
              rawText.startsWith("**") &&
              rawText.endsWith("**") &&
              rawText.length >= 4
                ? rawText.slice(2, -2)
                : `**${rawText}**`;
            break;
          case "italic":
            newText =
              rawText.startsWith("*") &&
              rawText.endsWith("*") &&
              rawText.length >= 2
                ? rawText.slice(1, -1)
                : `*${rawText}*`;
            break;
          case "strikethrough":
            newText =
              rawText.startsWith("~~") &&
              rawText.endsWith("~~") &&
              rawText.length >= 4
                ? rawText.slice(2, -2)
                : `~~${rawText}~~`;
            break;
          case "inlineCode":
            newText =
              rawText.startsWith("`") &&
              rawText.endsWith("`") &&
              rawText.length >= 2
                ? rawText.slice(1, -1)
                : `\`${rawText}\``;
            break;
          case "codeBlock":
            newText = `\`\`\`\n${rawText}\n\`\`\``;
            break;
          case "spoiler":
            newText =
              rawText.startsWith("||") &&
              rawText.endsWith("||") &&
              rawText.length >= 4
                ? rawText.slice(2, -2)
                : `||${rawText}||`;
            break;
          case "quote":
            newText = rawText.startsWith("> ")
              ? rawText.replace(/^> /gm, "")
              : rawText
                  .split("\n")
                  .map((line) => `> ${line}`)
                  .join("\n");
            break;
          case "link":
            newText = `[${rawText}](https://)`;
            break;
        }

        range.deleteContents();
        const textNode = document.createTextNode(newText);
        range.insertNode(textNode);

        const newRange = document.createRange();
        newRange.selectNodeContents(textNode);
        sel?.removeAllRanges();
        sel?.addRange(newRange);

        handleContentChange();
        setShowToolbar(false);
        setSelectedRange(null);
        editorRef.current.focus();
      },
      [selectedRange, handleContentChange],
    );

    // 计算候选成员列表
    useEffect(() => {
      if (!isMenuOpen) {
        setCandidates([]);
        return;
      }

      const q = mentionQuery.toLowerCase().trim();
      const list: MentionCandidate[] = [];

      // 1. 特殊广播候选项 (@everyone, @here)
      if ("everyone".includes(q) || !q) {
        list.push({
          id: "everyone",
          name: "everyone",
          displayName: "everyone",
          isSpecial: true,
          description: "通知此频道的每位成员",
        });
      }
      if ("here".includes(q) || !q) {
        list.push({
          id: "here",
          name: "here",
          displayName: "here",
          isSpecial: true,
          description: "仅通知此时在线的成员",
        });
      }

      // 2. 真实成员候选
      const roleMap = new Map<string, Role>();
      roles.forEach((r) => roleMap.set(r.id, r));

      const memberCandidates: MentionCandidate[] = [];
      members.forEach((m) => {
        const user = m.user;
        if (!user) return;

        const displayName = getUserDisplayName(user, m);
        const username = user.username;

        // 匹配昵称或用户名
        if (
          !q ||
          displayName.toLowerCase().includes(q) ||
          username.toLowerCase().includes(q)
        ) {
          // 获取最高角色颜色与角色名
          let roleColor: string | undefined;
          let roleName: string | undefined;
          const roleIds = parseRoleIds(m.roleIds);
          if (roleIds.length > 0) {
            const memberRoles = roleIds
              .map((id) => roleMap.get(id))
              .filter(Boolean) as Role[];
            memberRoles.sort((a, b) => b.position - a.position);
            const coloredRole = memberRoles.find(
              (r) => r.color && r.color !== "#000000" && r.color !== "#99aab5",
            );
            if (coloredRole) {
              roleColor = coloredRole.color || undefined;
              roleName = coloredRole.name;
            } else if (memberRoles[0]) {
              roleName = memberRoles[0].name;
            }
          }

          memberCandidates.push({
            id: user.id,
            name: displayName,
            displayName,
            username,
            avatarUrl: user.avatarUrl,
            status: user.status,
            roleColor,
            roleName,
            user,
            member: m,
          });
        }
      });

      // 排序：在线状态优先 (ONLINE > IDLE > DND > OFFLINE)
      const statusWeight: Record<string, number> = {
        ONLINE: 4,
        IDLE: 3,
        DND: 2,
        OFFLINE: 1,
      };

      memberCandidates.sort((a, b) => {
        const wA = statusWeight[a.status || "OFFLINE"] || 0;
        const wB = statusWeight[b.status || "OFFLINE"] || 0;
        return wB - wA;
      });

      const finalList = [...list, ...memberCandidates];
      setCandidates(finalList);
      setSelectedIndex(0);
    }, [isMenuOpen, mentionQuery, members, roles]);

    // 检测光标前是否刚刚输入了 @
    const checkMentionTrigger = useCallback(() => {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) {
        setIsMenuOpen(false);
        return;
      }

      const range = sel.getRangeAt(0);
      const node = range.startContainer;

      if (node.nodeType !== Node.TEXT_NODE) {
        setIsMenuOpen(false);
        return;
      }

      const text = node.textContent || "";
      const textBefore = text.slice(0, range.startOffset);

      // 匹配光标前的 @query (行首或前置为空格)
      const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);

      if (match) {
        const query = match[1];
        const matchIndex = textBefore.lastIndexOf("@" + query);

        // 创建精确覆盖 @query 的 Range
        const mentionRange = document.createRange();
        mentionRange.setStart(node, matchIndex);
        mentionRange.setEnd(node, range.startOffset);
        mentionRangeRef.current = mentionRange;

        setMentionQuery(query);
        setIsMenuOpen(true);
      } else {
        setIsMenuOpen(false);
        setMentionQuery("");
        mentionRangeRef.current = null;
      }
    }, []);

    // 键盘事件处理：退格原子删除、Enter 发送、候选菜单导航
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // 0. Ctrl+A / Command+A 快捷键全选检测（严格抑制悬浮工具栏展示）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        isCtrlAPressedRef.current = true;
        setShowToolbar(false);
      } else {
        isCtrlAPressedRef.current = false;
      }

      // 1. 如果补全菜单已打开，接管快捷键导航
      if (isMenuOpen && candidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % candidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + candidates.length) % candidates.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selected = candidates[selectedIndex];
          if (selected) {
            insertMentionAtCursor(selected.id, selected.name);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setIsMenuOpen(false);
          setShowToolbar(false);
          mentionRangeRef.current = null;
          return;
        }
      }

      // 2. 回车发送消息 (Shift+Enter 为换行)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!editorRef.current) return;
        const text = serializeToPlainText(editorRef.current).trim();
        onSendMessage(text);
        editorRef.current.innerHTML = "";
        handleContentChange();
        setIsMenuOpen(false);
        setShowToolbar(false);
        isCtrlAPressedRef.current = false;
        return;
      }

      // 3. 退格键原子化删除 Tag 拦截
      if (e.key === "Backspace") {
        const sel = window.getSelection();
        if (sel && sel.isCollapsed && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const container = range.startContainer;
          const offset = range.startOffset;

          let targetToDelete: HTMLElement | null = null;

          if (container.nodeType === Node.TEXT_NODE) {
            const textBefore = container.textContent?.slice(0, offset) || "";
            // 如果光标在文本最开始，或者前置字符仅为不可见空格
            if (
              offset === 0 ||
              textBefore === "\u00A0" ||
              textBefore.trim() === ""
            ) {
              const prev = container.previousSibling;
              if (
                prev &&
                prev instanceof HTMLElement &&
                prev.classList.contains("mention-chip")
              ) {
                targetToDelete = prev;
              }
            }
          } else if (container.nodeType === Node.ELEMENT_NODE) {
            const prev = container.childNodes[offset - 1];
            if (
              prev &&
              prev instanceof HTMLElement &&
              prev.classList.contains("mention-chip")
            ) {
              targetToDelete = prev;
            }
          }

          if (targetToDelete) {
            e.preventDefault();
            targetToDelete.remove();
            handleContentChange();
            // 重新检查是否处于 @ 模式
            setTimeout(checkMentionTrigger, 10);
            return;
          }
        }
      }

      // 键盘输入后延迟触发提及检测
      setTimeout(checkMentionTrigger, 10);
    };

    // 粘贴拦截：过滤 HTML 样式，支持纯文本与文件直传
    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      // 检查是否有粘贴的文件/图片
      const files = Array.from(e.clipboardData.files || []);
      if (files.length > 0 && onPasteFiles) {
        e.preventDefault();
        onPasteFiles(files);
        return;
      }

      // 纯文本粘贴拦截，避免富文本样式污染
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        document.execCommand("insertText", false, text);
        handleContentChange();
        setTimeout(checkMentionTrigger, 10);
      }
    };

    return (
      <div className="relative flex-1 flex items-center min-w-0">
        {/* 选中文本富文本悬浮/固定功能菜单 */}
        {showToolbar && (
          <FloatingFormatToolbar
            isMobile={isMobileDevice}
            position={toolbarPos}
            onApply={applyFormat}
          />
        )}

        {/* 上拉候选菜单 */}
        {isMenuOpen && (
          <MentionAutocomplete
            candidates={candidates}
            selectedIndex={selectedIndex}
            onSelect={(c) => insertMentionAtCursor(c.id, c.name)}
            onHoverIndex={setSelectedIndex}
          />
        )}

        {/* 占位符 */}
        {isEmpty && (
          <span
            data-testid="chat-input-placeholder"
            className="absolute left-0 top-1/2 -translate-y-1/2 text-sm text-discord-textMuted pointer-events-none select-none truncate"
          >
            {placeholder}
          </span>
        )}

        {/* ContentEditable 主输入容器 */}
        <div
          ref={editorRef}
          data-testid="chat-mention-input"
          contentEditable={!disabled}
          onInput={() => {
            handleContentChange();
            checkMentionTrigger();
          }}
          onKeyDown={handleKeyDown}
          onMouseDown={() => {
            isCtrlAPressedRef.current = false;
          }}
          onPaste={handlePaste}
          onClick={checkMentionTrigger}
          onBlur={() => {
            // 延时关闭菜单，确保鼠标点击候选项能触发
            setTimeout(() => setIsMenuOpen(false), 200);
          }}
          className="w-full bg-transparent text-sm text-discord-textHeader focus:outline-none leading-normal min-h-[20px] max-h-32 overflow-y-auto break-words select-text custom-scrollbar py-0.5"
          style={{ wordBreak: "break-word" }}
        />
      </div>
    );
  },
);

MentionInput.displayName = "MentionInput";
