import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

export interface SpoilerProps {
  children: React.ReactNode;
  className?: string;
  defaultRevealed?: boolean;
}

/**
 * 类 Telegram / Discord 剧透马赛克迷彩组件
 * - 遮蔽态：呈现细密闪烁的像素微粒与噪点马赛克遮罩，内部文本高斯模糊不可见，禁止选中文本偷窥；
 * - 展开态：点击后平滑溶解马赛克，呈现 Discord 风格半透明卡片，允许划选与复制文本；
 * - 再次点击：在无选中文本时点击可重新遮蔽剧透。
 */
export const Spoiler: React.FC<SpoilerProps> = ({
  children,
  className = "",
  defaultRevealed = false,
}) => {
  const [revealed, setRevealed] = useState(defaultRevealed);
  const { t } = useTranslation("chat");

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // 如果已揭开且当前正在划选复制文字，避免收起遮蔽
      if (revealed) {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
      }
      setRevealed((prev) => !prev);
    },
    [revealed],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      setRevealed((prev) => !prev);
    }
  }, []);

  const title = revealed
    ? t("spoilerHintRevealed", "点击重新隐藏剧透")
    : t("spoilerHintHidden", "剧透警告：点击显现");

  return (
    <span
      data-testid="chat-spoiler"
      data-spoiler={revealed ? "revealed" : "hidden"}
      role="button"
      tabIndex={0}
      aria-expanded={revealed}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title}
      className={`relative inline align-baseline rounded-[4px] px-1.5 py-0.5 mx-0.5 text-[13px] transition-all duration-300 ease-out cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-discord-blurple/80 ${
        revealed
          ? "bg-white/[0.08] text-discord-textHeader border border-white/10 hover:bg-white/[0.12] select-text"
          : "spoiler-mosaic-mask text-transparent border border-black/20 hover:brightness-110 active:scale-[0.98]"
      } ${className}`}
    >
      <span
        className={`transition-all duration-300 ease-out ${
          revealed
            ? "filter-none opacity-100 select-text pointer-events-auto"
            : "blur-[7px] opacity-0 pointer-events-none select-none inline-block"
        }`}
      >
        {children}
      </span>
    </span>
  );
};
