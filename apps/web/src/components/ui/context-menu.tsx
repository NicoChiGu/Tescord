import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle, ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionDrawer, useActionDrawer } from "./action-drawer.js";

/**
 * 响应式上下文环境：用于将 PC 端的 Radix 右键浮动菜单在移动/触屏端
 * 自动适配为 Discord 风格的底部抽屉（Bottom Sheet Drawer）
 */
interface ResponsiveContextMenuContextValue {
  isMobileMode: boolean;
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const ResponsiveContextMenuContext =
  React.createContext<ResponsiveContextMenuContextValue | null>(null);

const useResponsiveContextMenu = () => {
  return React.useContext(ResponsiveContextMenuContext);
};

// 探测是否处于移动端或小屏触控设备 (屏幕宽度 < 1024px 或小屏纯触屏设备)
export const checkIsMobileDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  const isNarrow = window.innerWidth < 1024;
  const isTouch =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  return isNarrow || (isTouch && window.innerWidth < 1024);
};

export const ContextMenu: React.FC<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>
> = ({ onOpenChange, children, ...props }) => {
  const [isMobileMode, setIsMobileMode] = React.useState(checkIsMobileDevice);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobileMode(checkIsMobileDevice());
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      scheduleClearContextMenuPoint(200);
    }
    onOpenChange?.(open);
  };

  const openDrawer = React.useCallback(() => {
    setIsDrawerOpen(true);
    onOpenChange?.(true);
  }, [onOpenChange]);

  const closeDrawer = React.useCallback(() => {
    setIsDrawerOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const contextValue = React.useMemo(
    () => ({
      isMobileMode,
      isOpen: isDrawerOpen,
      openDrawer,
      closeDrawer,
    }),
    [isMobileMode, isDrawerOpen, openDrawer, closeDrawer],
  );

  return (
    <ResponsiveContextMenuContext.Provider value={contextValue}>
      {isMobileMode ? (
        <div className="contents">{children}</div>
      ) : (
        <ContextMenuPrimitive.Root onOpenChange={handleOpenChange} {...props}>
          {children}
        </ContextMenuPrimitive.Root>
      )}
    </ResponsiveContextMenuContext.Provider>
  );
};

export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
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
      if (transform.includes("-200%")) {
        return false;
      }
      if (!transform.includes("translate")) {
        return false;
      }

      if (!isSubMenu) {
        const lastPoint = getLastContextMenuPoint();
        if (lastPoint && Date.now() - lastPoint.time < 4000) {
          const rect = wrapper.getBoundingClientRect();
          const isClickFarFromOrigin =
            Math.hypot(lastPoint.x, lastPoint.y) > 35;
          if (isClickFarFromOrigin && rect.left < 20 && rect.top < 20) {
            return false;
          }

          const width = rect.width || node.offsetWidth || 200;
          const height = rect.height || node.offsetHeight || 200;

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
 * 在桌面端派发 contextmenu 事件由 Radix 接管；
 * 在移动/触屏端检测 450ms 长按并直接打开 Discord 风格的底部抽屉。
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
    const responsiveContext = useResponsiveContextMenu();
    const isMobileMode = responsiveContext?.isMobileMode ?? false;

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

    const installClickSuppressor = React.useCallback(() => {
      const suppressClick = (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.closest("[data-radix-menu-content]") ||
            target.closest("[data-testid='action-drawer']") ||
            target.closest("[data-testid='mobile-action-sheet']"))
        ) {
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

      if (e.pointerType === "mouse") return;

      clearTimer();
      isLongPressTriggeredRef.current = false;

      const coords = { x: e.clientX, y: e.clientY };
      startPosRef.current = coords;
      currentPosRef.current = coords;
      const target = e.target as HTMLElement | null;

      timerRef.current = setTimeout(() => {
        isLongPressTriggeredRef.current = true;

        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(40);
          } catch {}
        }
        if (typeof document !== "undefined" && document.activeElement) {
          (document.activeElement as HTMLElement)?.blur?.();
        }

        if (isMobileMode && responsiveContext) {
          responsiveContext.openDrawer();
        } else if (target) {
          const point = currentPosRef.current || coords;
          setLastContextMenuPoint(point);
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
      if (isMobileMode && responsiveContext) {
        e.preventDefault();
        e.stopPropagation();
        responsiveContext.openDrawer();
        return;
      }
      e.stopPropagation();
      onContextMenu?.(e);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
      onPointerMove?.(e);

      if (e.pointerType === "mouse" || !startPosRef.current) return;

      currentPosRef.current = { x: e.clientX, y: e.clientY };
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);

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

    const commonStyle = {
      WebkitTouchCallout: "none" as const,
      WebkitUserSelect: "none" as const,
      userSelect: "none" as const,
      ...style,
    };

    if (isMobileMode) {
      return (
        <span
          ref={ref as any}
          style={commonStyle}
          onContextMenu={handleContextMenu}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          className="contents"
          {...(props as any)}
        >
          {children}
        </span>
      );
    }

    return (
      <ContextMenuPrimitive.Trigger
        ref={ref}
        style={commonStyle}
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

/**
 * 抽屉内二级子页面共享上下文
 */
interface SubMenuBridgeContextValue {
  subContent: React.ReactNode;
  setSubContent: (content: React.ReactNode) => void;
}

const SubMenuBridgeContext =
  React.createContext<SubMenuBridgeContextValue | null>(null);

export const ContextMenuSub: React.FC<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Sub>
> = ({ children, ...props }) => {
  const responsiveContext = useResponsiveContextMenu();
  const [subContent, setSubContent] = React.useState<React.ReactNode>(null);

  if (responsiveContext?.isMobileMode) {
    return (
      <SubMenuBridgeContext.Provider value={{ subContent, setSubContent }}>
        <div className="flex flex-col w-full">{children}</div>
      </SubMenuBridgeContext.Provider>
    );
  }

  return (
    <ContextMenuPrimitive.Sub {...props}>{children}</ContextMenuPrimitive.Sub>
  );
};

const extractTextFromReactNode = (node: React.ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).filter(Boolean).join(" ").trim();
  }
  if (React.isValidElement(node) && (node.props as any)?.children) {
    return extractTextFromReactNode((node.props as any).children);
  }
  return "";
};

export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className = "", inset, children, onClick, ...props }, ref) => {
  const responsiveContext = useResponsiveContextMenu();
  const subBridge = React.useContext(SubMenuBridgeContext);
  let actionDrawerContext: ReturnType<typeof useActionDrawer> | null = null;
  try {
    actionDrawerContext = useActionDrawer();
  } catch {
    actionDrawerContext = null;
  }
  const { t } = useTranslation(["contextMenu", "common"]);

  if (responsiveContext?.isMobileMode) {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e as any);
      if (actionDrawerContext && subBridge?.subContent) {
        const extracted = extractTextFromReactNode(children);
        actionDrawerContext.pushView({
          title: extracted || t("contextMenu:subOptions", "子选项"),
          content: subBridge.subContent,
        });
      }
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-discord-textNormal active:bg-[#35373c] text-sm font-medium transition ${className}`}
      >
        <span className="flex items-center space-x-2.5 truncate">
          {children}
        </span>
        <ChevronRight className="w-4 h-4 text-discord-textMuted flex-shrink-0 ml-2" />
      </button>
    );
  }

  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={`flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[state=open]:bg-[#5865f2] data-[state=open]:text-white ${
        inset ? "pl-8" : ""
      } ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-3.5 w-3.5" />
    </ContextMenuPrimitive.SubTrigger>
  );
});
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(
  (
    { className = "", collisionPadding = 8, style, children, ...props },
    forwardedRef,
  ) => {
    const responsiveContext = useResponsiveContextMenu();
    const subBridge = React.useContext(SubMenuBridgeContext);

    React.useEffect(() => {
      if (responsiveContext?.isMobileMode && subBridge) {
        subBridge.setSubContent(children);
      }
    }, [responsiveContext?.isMobileMode, subBridge, children]);

    if (responsiveContext?.isMobileMode) {
      return null;
    }

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
          className={`z-[80] min-w-[180px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1 text-[#dbdee1] shadow-2xl outline-none ${
            isReady
              ? "data-[state=open]:animate-context-menu-in pointer-events-auto"
              : "!animate-none pointer-events-none"
          } data-[state=closed]:animate-context-menu-out ${className}`}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.SubContent>
      </ContextMenuPrimitive.Portal>
    );
  },
);
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(
  (
    { className = "", collisionPadding = 8, style, children, ...props },
    forwardedRef,
  ) => {
    const responsiveContext = useResponsiveContextMenu();
    const { t } = useTranslation(["contextMenu", "common"]);

    if (responsiveContext?.isMobileMode) {
      return (
        <ActionDrawer
          isOpen={responsiveContext.isOpen}
          onClose={responsiveContext.closeDrawer}
          title={t("contextMenu:messageActions", "操作菜单")}
          data-testid="responsive-action-drawer"
        >
          <div className="bg-[#1e1f22] rounded-xl overflow-hidden divide-y divide-[#35373c]/50 border border-[#35373c]/50">
            {children}
          </div>
        </ActionDrawer>
      );
    }

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
          className={`z-[80] min-w-[190px] overflow-hidden rounded-md border border-[#2b2d31]/80 bg-[#111214] p-1.5 text-[#dbdee1] shadow-2xl select-none outline-none ${
            isReady
              ? "data-[state=open]:animate-context-menu-in pointer-events-auto"
              : "!animate-none pointer-events-none"
          } data-[state=closed]:animate-context-menu-out ${className}`}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    );
  },
);
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "danger";
  }
>(
  (
    { className = "", inset, variant = "default", onClick, children, ...props },
    ref,
  ) => {
    const responsiveContext = useResponsiveContextMenu();
    const { t } = useTranslation(["contextMenu", "common"]);
    const [isConfirming, setIsConfirming] = React.useState(false);

    const isDanger =
      variant === "danger" ||
      className.includes("text-[#f23f43]") ||
      className.includes("text-discord-danger") ||
      className.includes("text-red-");

    React.useEffect(() => {
      if (isConfirming) {
        const timer = setTimeout(() => setIsConfirming(false), 3500);
        return () => clearTimeout(timer);
      }
    }, [isConfirming]);

    if (responsiveContext?.isMobileMode) {
      const handleMobileClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (isDanger && !isConfirming) {
          setIsConfirming(true);
          return;
        }

        setIsConfirming(false);
        responsiveContext.closeDrawer();
        onClick?.(e as any);
      };

      return (
        <button
          type="button"
          ref={ref as any}
          onClick={handleMobileClick}
          className={`w-full flex items-center justify-between px-3.5 py-3 text-sm font-medium transition text-left select-none ${
            isConfirming
              ? "bg-discord-danger text-white font-semibold"
              : isDanger
                ? "text-discord-danger hover:bg-discord-danger/10 active:bg-discord-danger active:text-white"
                : "text-[#dbdee1] active:bg-[#35373c] active:text-white"
          } ${className}`}
        >
          <span className="flex items-center space-x-2.5 truncate">
            {isConfirming
              ? t("contextMenu:confirmAction", "确认执行？")
              : children}
          </span>
        </button>
      );
    }

    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        onClick={onClick}
        className={`relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs font-medium outline-none transition-colors pointer-events-auto data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
          isDanger
            ? "text-[#f23f43] hover:bg-[#f23f43] hover:text-white focus:bg-[#f23f43] focus:text-white"
            : "text-[#dbdee1] hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white"
        } ${inset ? "pl-8" : ""} ${className}`}
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Item>
    );
  },
);
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

export const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className = "", children, checked, onClick, ...props }, ref) => {
  const responsiveContext = useResponsiveContextMenu();

  if (responsiveContext?.isMobileMode) {
    const handleMobileClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      responsiveContext.closeDrawer();
      onClick?.(e as any);
    };

    return (
      <button
        type="button"
        onClick={handleMobileClick}
        className={`w-full flex items-center justify-between px-3.5 py-3 text-sm font-medium text-[#dbdee1] active:bg-[#35373c] transition ${className}`}
      >
        <span className="flex items-center space-x-2.5">{children}</span>
        {checked && (
          <Check className="w-4 h-4 text-discord-brand flex-shrink-0" />
        )}
      </button>
    );
  }

  return (
    <ContextMenuPrimitive.CheckboxItem
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center rounded py-1.5 pl-8 pr-2 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${className}`}
      checked={checked}
      onClick={onClick}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 stroke-[3]" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
});
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;

export const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className = "", children, onClick, ...props }, ref) => {
  const responsiveContext = useResponsiveContextMenu();

  if (responsiveContext?.isMobileMode) {
    const handleMobileClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      responsiveContext.closeDrawer();
      onClick?.(e as any);
    };

    return (
      <button
        type="button"
        onClick={handleMobileClick}
        className={`w-full flex items-center space-x-2.5 px-3.5 py-3 text-sm font-medium text-[#dbdee1] active:bg-[#35373c] transition ${className}`}
      >
        {children}
      </button>
    );
  }

  return (
    <ContextMenuPrimitive.RadioItem
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center rounded py-1.5 pl-7 pr-2 text-xs font-medium text-[#dbdee1] outline-none transition-colors hover:bg-[#5865f2] hover:text-white focus:bg-[#5865f2] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${className}`}
      onClick={onClick}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
});
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

export const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className = "", inset, children, ...props }, ref) => {
  const responsiveContext = useResponsiveContextMenu();

  if (responsiveContext?.isMobileMode) {
    return (
      <div
        className={`px-3.5 py-2 text-xs font-semibold text-discord-textMuted uppercase tracking-wider ${className}`}
      >
        {children}
      </div>
    );
  }

  return (
    <ContextMenuPrimitive.Label
      ref={ref}
      className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4] ${
        inset ? "pl-8" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Label>
  );
});
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className = "", ...props }, ref) => {
  const responsiveContext = useResponsiveContextMenu();

  if (responsiveContext?.isMobileMode) {
    return <div className={`-mx-1 my-1.5 h-px bg-[#35373c]/60 ${className}`} />;
  }

  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={`-mx-1 my-1 h-px bg-[#35373c]/60 ${className}`}
      {...props}
    />
  );
});
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
