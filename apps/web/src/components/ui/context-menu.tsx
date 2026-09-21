import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle } from "lucide-react";

export const ContextMenu: React.FC<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>
> = ({ onOpenChange, ...props }) => {
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      scheduleClearContextMenuPoint(200);
    }
    onOpenChange?.(open);
  };

  return (
    <ContextMenuPrimitive.Root onOpenChange={handleOpenChange} {...props} />
  );
};
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/**
 * 上下文菜单触发坐标物理缓存与门禁：
 * 捕获最近一次右键/长按唤起菜单时的精确物理视口坐标，用于防范
 * Radix ContextMenu 内部因 useEffect 异步时序导致的初始锚点 (0, 0) 或旧坐标闪烁。
 */
export interface ContextMenuCoord {
  x: number;
  y: number;
  time: number;
}

let lastContextMenuPoint: ContextMenuCoord | null = null;
let clearPointTimer: ReturnType<typeof setTimeout> | null = null;

export const setLastContextMenuPoint = (point: { x: number; y: number }) => {
  if (clearPointTimer) {
    clearTimeout(clearPointTimer);
    clearPointTimer = null;
  }
  lastContextMenuPoint = { ...point, time: Date.now() };
};

export const getLastContextMenuPoint = () => lastContextMenuPoint;

/**
 * 延迟清空物理坐标：
 * 默认延迟 200ms（等待 85ms 的离场动画 context-menu-out 播放完毕且元素从 DOM 卸载后），
 * 清空坐标缓存，防止下一次打开其他菜单时污染新菜单的锚点。
 */
export const scheduleClearContextMenuPoint = (delayMs: number = 200) => {
  if (clearPointTimer) {
    clearTimeout(clearPointTimer);
  }
  clearPointTimer = setTimeout(() => {
    lastContextMenuPoint = null;
    clearPointTimer = null;
  }, delayMs);
};

// 在全局捕获阶段注册物理 contextmenu 监听，确保无论从哪个组件或子树右键触发，都能在任何 React 批处理前捕获到坐标
if (typeof window !== "undefined") {
  window.addEventListener(
    "contextmenu",
    (e: MouseEvent) => {
      setLastContextMenuPoint({ x: e.clientX, y: e.clientY });
    },
    true,
  );
}

/**
 * 定位收敛门禁 Hook (useContextMenuPositionReady)
 * 解决 Radix ContextMenu 在打开首帧由于 PopperAnchor 的异步 useEffect 造成 PopperContent
 * 在 (0, 0) 初始锚点或上一次旧锚点处错误挂载并启动 CSS 进场动画的问题。
 *
 * 核心策略：
 * 1. 挂载阶段利用 visibility: hidden 与 opacity: 0 保留真实 offsetWidth/offsetHeight 供 Floating UI 测量；
 * 2. 抑制入场动画 (!animate-none)，防止错误位置渲染与 transform-origin 突变；
 * 3. 校验外层 wrapper 是否脱离 (0, 0) 错误锚点，并且物理位置是否已经收敛到当前点击目标区域 (isWithinTargetRegion)；
 * 4. 菜单关闭并卸载后，调度延迟清空坐标并重置 wrapper transform，防止历史坐标残留污染下一次唤起；
 * 5. 门禁解除后无缝激活标准的 animate-context-menu-in 入场动画。
 */
export function useContextMenuPositionReady(
  node: HTMLElement | null,
  isSubMenu: boolean = false,
) {
  const [isReady, setIsReady] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!node) return;

    const wrapper = node.closest<HTMLElement>(
      "[data-radix-popper-content-wrapper]",
    );
    if (!wrapper) {
      setIsReady(true);
      return;
    }

    let cancelled = false;

    const checkReady = () => {
      if (cancelled) return false;

      const transform = wrapper.style.transform || "";
      // 1. 若仍在隐藏测量阶段 (translate(0, -200%))，未就绪
      if (transform.includes("-200%")) {
        return false;
      }

      // 2. 若尚未计算任何 translate 变换，未就绪
      if (!transform.includes("translate")) {
        return false;
      }

      // 3. 对于主右键菜单（非级联子菜单），校验坐标是否落入 (0, 0) 错误锚点或上一次菜单的历史旧坐标
      if (!isSubMenu) {
        const lastPoint = getLastContextMenuPoint();
        if (lastPoint && Date.now() - lastPoint.time < 4000) {
          const rect = wrapper.getBoundingClientRect();

          // 校验 a：防屏幕左上角 (0, 0) 初始错误锚点
          const isClickFarFromOrigin =
            Math.hypot(lastPoint.x, lastPoint.y) > 35;
          if (isClickFarFromOrigin && rect.left < 20 && rect.top < 20) {
            return false;
          }

          // 校验 b：防前一个打开 Menu 的历史旧坐标残留闪烁
          const width = rect.width || node.offsetWidth || 200;
          const height = rect.height || node.offsetHeight || 200;

          // 菜单正常展开位置必定围绕当前点击物理点进行 placement 计算
          const minValidX = lastPoint.x - width - 60;
          const maxValidX = lastPoint.x + 60;
          const minValidY = lastPoint.y - height - 60;
          const maxValidY = lastPoint.y + 60;

          const isWithinTargetRegion =
            rect.left >= minValidX &&
            rect.left <= maxValidX &&
            rect.top >= minValidY &&
            rect.top <= maxValidY;

          if (!isWithinTargetRegion) {
            // 说明 wrapper 当前仍停留在上一次打开菜单的旧坐标处，尚未对齐到当前点击锚点
            return false;
          }
        }
      }

      return true;
    };

    if (checkReady()) {
      setIsReady(true);
    } else {
      let rafId1: number;
      let rafId2: number;

      rafId1 = requestAnimationFrame(() => {
        if (cancelled) return;
        if (checkReady()) {
          setIsReady(true);
        } else {
          // 双重 rAF 确保跨越 React 被动任务阶段
          rafId2 = requestAnimationFrame(() => {
            if (cancelled) return;
            setIsReady(true);
          });
        }
      });

      return () => {
        cancelled = true;
        cancelAnimationFrame(rafId1);
        if (rafId2) cancelAnimationFrame(rafId2);
      };
    }
  }, [node, isSubMenu]);

  // 组件卸载清理逻辑：菜单关闭后延迟清空坐标，并主动重置 wrapper transform，防止残留
  React.useEffect(() => {
    return () => {
      scheduleClearContextMenuPoint(200);
      if (node) {
        const wrapper = node.closest<HTMLElement>(
          "[data-radix-popper-content-wrapper]",
        );
        if (wrapper) {
          wrapper.style.transform = "translate(0, -200%)";
        }
      }
    };
  }, [node]);

  return isReady;
}

/**
 * 增强型 ContextMenuTrigger：
 * 1. 解决 Radix 原生在 touch 环境下 700ms 过长且 0 容差（微小手抖直接取消）的问题；
 * 2. 引入 450ms 黄金长按时长与 10px 抖动容差算法（超过 10px 判定为滚动页面并取消长按）；
 * 3. 长按触发轻微触觉震动反馈 (40ms)；
 * 4. 派发合成 contextmenu 事件，同步更新 Radix 锚点及 lastContextMenuPoint 门禁坐标；
 * 5. 在长按抬起阶段实施 400ms 捕获级穿透保护，防止误触子级 button onClick 或导致 DismissableLayer 误关菜单。
 */
export const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>
>(
  (
    {
      children,
      style,
      onContextMenu,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      ...props
    },
    ref,
  ) => {
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPosRef = React.useRef<{ x: number; y: number } | null>(null);
    const currentPosRef = React.useRef<{ x: number; y: number } | null>(null);
    const isLongPressTriggeredRef = React.useRef(false);

    const clearTimer = React.useCallback(() => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      startPosRef.current = null;
      currentPosRef.current = null;
    }, []);

    // 捕获并拦截长按抬起后的合成点击，防止穿透到内部 button 或被 Radix 误认为 outside click
    const installClickSuppressor = React.useCallback(() => {
      const suppressClick = (e: Event) => {
        const target = e.target as HTMLElement | null;
        // 若用户点击的是弹出的右键菜单内部（或子菜单），正常放行
        if (target && target.closest("[data-radix-menu-content]")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      window.addEventListener("click", suppressClick, true);
      window.addEventListener("touchend", suppressClick, true);
      window.addEventListener("pointerup", suppressClick, true);

      setTimeout(() => {
        window.removeEventListener("click", suppressClick, true);
        window.removeEventListener("touchend", suppressClick, true);
        window.removeEventListener("pointerup", suppressClick, true);
        isLongPressTriggeredRef.current = false;
      }, 400);
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
      onPointerDown?.(e);

      // PC 端纯鼠标右键交由原有原生逻辑处理
      if (e.pointerType === "mouse") return;

      clearTimer();
      isLongPressTriggeredRef.current = false;

      const coords = { x: e.clientX, y: e.clientY };
      startPosRef.current = coords;
      currentPosRef.current = coords;
      const target = e.target as HTMLElement | null;

      timerRef.current = setTimeout(() => {
        isLongPressTriggeredRef.current = true;
        const point = currentPosRef.current || coords;
        setLastContextMenuPoint(point);

        // 触觉反馈震动
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {}
        }

        // 派发原生 contextmenu 事件到触发目标，激活 Radix 原生 handleOpen
        if (target) {
          const contextMenuEvent = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: point.x,
            clientY: point.y,
            screenX: point.x,
            screenY: point.y,
            button: 2,
            buttons: 2,
          });
          target.dispatchEvent(contextMenuEvent);
        }

        installClickSuppressor();
      }, 450);
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLSpanElement>) => {
      setLastContextMenuPoint({ x: e.clientX, y: e.clientY });
      onContextMenu?.(e);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
      onPointerMove?.(e);

      if (e.pointerType === "mouse" || !startPosRef.current) return;

      currentPosRef.current = { x: e.clientX, y: e.clientY };
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);

      // 位移容差 10px：超过 10px 说明用户正在滚动列表，取消长按
      if (dx > 10 || dy > 10) {
        clearTimer();
      }
    };

    const handlePointerUpOrCancel = (
      e: React.PointerEvent<HTMLSpanElement>,
    ) => {
      if (e.type === "pointerup") onPointerUp?.(e);
      if (e.type === "pointercancel") onPointerCancel?.(e);

      if (e.pointerType === "mouse") return;
      clearTimer();
    };

    React.useEffect(() => {
      return () => clearTimer();
    }, [clearTimer]);

    return (
      <ContextMenuPrimitive.Trigger
        ref={ref}
        style={{
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          ...style,
        }}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Trigger>
    );
  },
);
ContextMenuTrigger.displayName = ContextMenuPrimitive.Trigger.displayName;

export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className = "", inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={`flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[state=open]:bg-[#5865f2] data-[state=open]:text-white ${
      inset ? "pl-8" : ""
    } ${className}`}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-3.5 w-3.5" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className = "", collisionPadding = 8, style, ...props }, forwardedRef) => {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const isReady = useContextMenuPositionReady(node, true);

  const handleRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNode(el);
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (
          forwardedRef as React.MutableRefObject<HTMLDivElement | null>
        ).current = el;
      }
    },
    [forwardedRef],
  );

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        ref={handleRef}
        collisionPadding={collisionPadding}
        style={{
          ...style,
          visibility: isReady ? undefined : "hidden",
          opacity: isReady ? undefined : 0,
          pointerEvents: isReady ? "auto" : "none",
        }}
        className={`z-50 min-w-[180px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1 text-[#dbdee1] shadow-2xl outline-none ${
          isReady
            ? "data-[state=open]:animate-context-menu-in pointer-events-auto"
            : "!animate-none pointer-events-none"
        } data-[state=closed]:animate-context-menu-out ${className}`}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className = "", collisionPadding = 8, style, ...props }, forwardedRef) => {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const isReady = useContextMenuPositionReady(node, false);

  const handleRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNode(el);
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (
          forwardedRef as React.MutableRefObject<HTMLDivElement | null>
        ).current = el;
      }
    },
    [forwardedRef],
  );

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={handleRef}
        collisionPadding={collisionPadding}
        style={{
          ...style,
          visibility: isReady ? undefined : "hidden",
          opacity: isReady ? undefined : 0,
          pointerEvents: isReady ? "auto" : "none",
        }}
        className={`z-50 min-w-[190px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1.5 text-[#dbdee1] shadow-2xl select-none outline-none ${
          isReady
            ? "data-[state=open]:animate-context-menu-in pointer-events-auto"
            : "!animate-none pointer-events-none"
        } data-[state=closed]:animate-context-menu-out ${className}`}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "danger";
  }
>(({ className = "", inset, variant = "default", ...props }, ref) => {
  const isDanger = variant === "danger";
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs font-medium outline-none transition-colors pointer-events-auto data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
        isDanger
          ? "text-[#f23f43] hover:bg-[#f23f43] hover:text-white focus:bg-[#f23f43] focus:text-white"
          : "text-[#dbdee1] hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white"
      } ${inset ? "pl-8" : ""} ${className}`}
      {...props}
    />
  );
});
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

export const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className = "", children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={`relative flex cursor-pointer select-none items-center rounded py-1.5 pl-8 pr-2 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${className}`}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 stroke-[3]" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;

export const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className = "", children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={`relative flex cursor-pointer select-none items-center rounded py-1.5 pl-7 pr-2 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${className}`}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

export const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className = "", inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4] ${
      inset ? "pl-8" : ""
    } ${className}`}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className = "", ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-[#35373c]/60 ${className}`}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export const ContextMenuShortcut: React.FC<
  React.HTMLAttributes<HTMLSpanElement>
> = ({ className = "", ...props }) => {
  return (
    <span
      className={`ml-auto text-[10px] tracking-widest text-[#949ba4] group-hover:text-white ${className}`}
      {...props}
    />
  );
};
