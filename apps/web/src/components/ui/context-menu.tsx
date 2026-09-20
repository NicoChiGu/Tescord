import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle } from "lucide-react";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

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
>(({ children, style, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...props }, ref) => {
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

      // 触觉反馈震动
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch {}
      }

      // 同步更新门禁全局坐标
      lastContextMenuPoint = { x: point.x, y: point.y, time: Date.now() };

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

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLSpanElement>) => {
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  );
});
ContextMenuTrigger.displayName = ContextMenuPrimitive.Trigger.displayName;


// 记录最近一次右键点击的鼠标视口坐标
let lastContextMenuPoint: { x: number; y: number; time: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "contextmenu",
    (e) => {
      lastContextMenuPoint = { x: e.clientX, y: e.clientY, time: Date.now() };
    },
    true
  );
}

/**
 * 防左上角闪烁门禁 Hook：
 * 当 Radix Popper 首帧因异步 useEffect 尚未应用真实鼠标锚点而停留在 (0, 0) 时，
 * 在浏览器绘制 (Paint) 之前将其保持隐藏，待真实锚点计算完成后立即解除隐藏并触发顺滑进入动画。
 */
function useContextMenuPositionGate(elementRef: React.RefObject<HTMLElement | null>) {
  const [isReady, setIsReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const node = elementRef.current;
    if (!node) return;

    const point = lastContextMenuPoint;
    const now = Date.now();

    // 若最近 1.5 秒内无鼠标右击坐标，直接判定就绪（键盘呼出或无障碍模式）
    if (!point || now - point.time > 1500) {
      setIsReady(true);
      return;
    }

    const wrapper = node.closest(
      "[data-radix-popper-content-wrapper]"
    ) as HTMLElement | null;

    if (!wrapper) {
      setIsReady(true);
      return;
    }

    const checkIsPositioned = () => {
      const rect = wrapper.getBoundingClientRect();
      // 如果 wrapper 卡在左上角 (0, 0) 附近，而鼠标点击在它处，说明首帧尚未完成锚点纠偏
      const isStuckAtOrigin =
        rect.left <= 15 &&
        rect.top <= 15 &&
        (Math.abs(point.x - rect.left) > 40 || Math.abs(point.y - rect.top) > 40);

      return !isStuckAtOrigin;
    };

    if (checkIsPositioned()) {
      setIsReady(true);
      return;
    }

    // 首帧未正确定位：在 Paint 发生前强制不可见，彻底消除左上角闪烁
    node.style.visibility = "hidden";
    node.style.opacity = "0";
    node.style.pointerEvents = "none";

    let rafId: number;
    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanupGate = () => {
      if (observer) observer.disconnect();
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      node.style.visibility = "";
      node.style.opacity = "";
      node.style.pointerEvents = "";
      setIsReady(true);
    };

    // 监听 wrapper 样式变动（Popper 更新真实坐标时触发）
    observer = new MutationObserver(() => {
      if (checkIsPositioned()) {
        cleanupGate();
      }
    });

    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ["style", "transform"]
    });

    // 辅助 RAF 轮询以兼容极端环境
    const pollFrame = () => {
      if (checkIsPositioned()) {
        cleanupGate();
      } else {
        rafId = requestAnimationFrame(pollFrame);
      }
    };
    rafId = requestAnimationFrame(pollFrame);

    // 最大 40ms 超时兜底，确保任何异常场景绝不卡死隐藏
    timeoutId = setTimeout(cleanupGate, 40);

    return () => {
      if (observer) observer.disconnect();
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [elementRef]);

  return isReady;
}

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
>(({ className = "", collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      collisionPadding={collisionPadding}
      className={`z-50 min-w-[180px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1 text-[#dbdee1] shadow-2xl outline-none data-[state=open]:animate-context-menu-in data-[state=closed]:animate-context-menu-out ${className}`}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className = "", collisionPadding = 8, ...props }, forwardedRef) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const isReady = useContextMenuPositionGate(innerRef);

  // 合并内部用于门禁的 ref 和外部传递的 forwardedRef
  const handleRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [forwardedRef]
  );

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={handleRef}
        collisionPadding={collisionPadding}
        className={`z-50 min-w-[190px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1.5 text-[#dbdee1] shadow-2xl select-none outline-none ${
          isReady
            ? "data-[state=open]:animate-context-menu-in data-[state=closed]:animate-context-menu-out"
            : "invisible opacity-0"
        } ${className}`}
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
      className={`relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
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
