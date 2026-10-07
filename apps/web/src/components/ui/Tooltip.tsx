import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "center" | "start" | "end";
  delayDuration?: number;
  className?: string;
  disabled?: boolean;
}

export const Tooltip = React.forwardRef<
  HTMLElement,
  TooltipProps & React.HTMLAttributes<HTMLElement>
>(
  (
    {
      content,
      children,
      side = "top",
      align = "center",
      delayDuration = 150,
      className = "",
      disabled = false,
      onContextMenu,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      ...restProps
    },
    forwardedRef,
  ) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState<{ x: number; y: number }>({
      x: 0,
      y: 0,
    });
    const triggerRef = useRef<HTMLElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const calculatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const offset = 8; // 间距

      let x = 0;
      let y = 0;

      if (side === "top") {
        y = rect.top - offset;
        if (align === "start") x = rect.left;
        else if (align === "end") x = rect.right;
        else x = rect.left + rect.width / 2;
      } else if (side === "bottom") {
        y = rect.bottom + offset;
        if (align === "start") x = rect.left;
        else if (align === "end") x = rect.right;
        else x = rect.left + rect.width / 2;
      } else if (side === "left") {
        x = rect.left - offset;
        if (align === "start") y = rect.top;
        else if (align === "end") y = rect.bottom;
        else y = rect.top + rect.height / 2;
      } else if (side === "right") {
        x = rect.right + offset;
        if (align === "start") y = rect.top;
        else if (align === "end") y = rect.bottom;
        else y = rect.top + rect.height / 2;
      }

      setCoords({ x, y });
    };

    const handleMouseEnter = () => {
      if (disabled || !content) return;
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        calculatePosition();
        setIsVisible(true);
      }, delayDuration);
    };

    const handleMouseLeave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsVisible(false);
    };

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    if (!content || disabled) {
      return children;
    }

    // 计算 transform 对齐方式
    let transformClass = "-translate-x-1/2 -translate-y-full"; // 默认 side="top", align="center"
    let arrowClass =
      "top-full left-1/2 -translate-x-1/2 border-t-[#111214] border-x-transparent border-b-transparent";

    if (side === "top") {
      transformClass =
        align === "start"
          ? "translate-y-[-100%]"
          : align === "end"
            ? "-translate-x-full translate-y-[-100%]"
            : "-translate-x-1/2 translate-y-[-100%]";
      arrowClass =
        "top-full left-1/2 -translate-x-1/2 border-t-[#111214] border-x-transparent border-b-transparent";
    } else if (side === "bottom") {
      transformClass =
        align === "start"
          ? ""
          : align === "end"
            ? "-translate-x-full"
            : "-translate-x-1/2";
      arrowClass =
        "bottom-full left-1/2 -translate-x-1/2 border-b-[#111214] border-x-transparent border-t-transparent";
    } else if (side === "left") {
      transformClass =
        align === "start"
          ? "-translate-x-full"
          : align === "end"
            ? "-translate-x-full -translate-y-full"
            : "-translate-x-full -translate-y-1/2";
      arrowClass =
        "left-full top-1/2 -translate-y-1/2 border-l-[#111214] border-y-transparent border-r-transparent";
    } else if (side === "right") {
      transformClass =
        align === "start"
          ? ""
          : align === "end"
            ? "-translate-y-full"
            : "-translate-y-1/2";
      arrowClass =
        "right-full top-1/2 -translate-y-1/2 border-r-[#111214] border-y-transparent border-l-transparent";
    }

    const clonedChild = React.cloneElement(children, {
      ...restProps,
      ref: (node: HTMLElement | null) => {
        triggerRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
        const { ref } = children as any;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref && typeof ref === "object") {
          ref.current = node;
        }
      },
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
        onContextMenu?.(e);
        children.props.onContextMenu?.(e);
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        onPointerDown?.(e);
        children.props.onPointerDown?.(e);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        onPointerMove?.(e);
        children.props.onPointerMove?.(e);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        onPointerUp?.(e);
        children.props.onPointerUp?.(e);
      },
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
        onPointerCancel?.(e);
        children.props.onPointerCancel?.(e);
      },
      onMouseEnter: (e: React.MouseEvent) => {
        handleMouseEnter();
        children.props.onMouseEnter?.(e);
      },
      onMouseLeave: (e: React.MouseEvent) => {
        handleMouseLeave();
        children.props.onMouseLeave?.(e);
      },
      onFocus: (e: React.FocusEvent) => {
        handleMouseEnter();
        children.props.onFocus?.(e);
      },
      onBlur: (e: React.FocusEvent) => {
        handleMouseLeave();
        children.props.onBlur?.(e);
      },
    });

    return (
      <>
        {clonedChild}
        {isVisible &&
          createPortal(
            <div
              data-testid="tooltip-bubble"
              style={{
                position: "fixed",
                left: `${coords.x}px`,
                top: `${coords.y}px`,
              }}
              className={`pointer-events-none z-[99999] transform ${transformClass} select-none animate-in fade-in zoom-in-95 duration-150`}
            >
              <div
                className={`relative bg-[#111214] text-white text-xs font-medium px-2.5 py-1.5 rounded-md shadow-2xl border border-[#2b2d31]/60 whitespace-nowrap ${className}`}
              >
                {content}
                <div
                  className={`absolute w-0 h-0 border-4 border-solid ${arrowClass}`}
                />
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  },
);
Tooltip.displayName = "Tooltip";
