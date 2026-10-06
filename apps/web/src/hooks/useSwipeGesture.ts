import { useEffect, useRef } from "react";

export interface SwipeGestureHandlers {
  onOpenLeftDrawer?: () => void; // 向右滑动：打开左侧抽屉（频道/服务器）
  onCloseLeftDrawer?: () => void; // 向左滑动：关闭左侧抽屉
  onOpenRightDrawer?: () => void; // 向左滑动：打开右侧抽屉（服务器人员）
  onCloseRightDrawer?: () => void; // 向右滑动：关闭右侧抽屉
  isLeftDrawerOpen?: boolean;
  isRightDrawerOpen?: boolean;
}

export function useSwipeGesture(
  handlers: SwipeGestureHandlers,
  enabled: boolean = true,
) {
  const startRef = useRef<{
    x: number;
    y: number;
    time: number;
    shouldIgnore: boolean;
  } | null>(null);

  // 用 ref 保持最新 handlers，防止重新绑定监听
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleTouchStart = (e: TouchEvent) => {
      // 仅处理单指滑动
      if (e.touches.length !== 1) {
        startRef.current = null;
        return;
      }

      const touch = e.touches[0];
      const target = e.target as HTMLElement | null;

      // 检查是否发生在应忽略横向手势的区域（输入框、横向滚动条、滑块等）
      const isHorizontalScrollable = target?.closest(
        'input, textarea, select, [contenteditable="true"], .overflow-x-auto, [data-swipe-ignore="true"], [data-drag-handle]',
      );

      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
        shouldIgnore: !!isHorizontalScrollable,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!startRef.current || e.touches.length !== 1) return;
      if (startRef.current.shouldIgnore) return;

      const touch = e.touches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;

      // 当主要位移为横向滑动时，调用 preventDefault 彻底限制移动端浏览器把左右拖拽当作“返回上一页/前进下一页”
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!startRef.current || e.changedTouches.length === 0) return;
      if (startRef.current.shouldIgnore) {
        startRef.current = null;
        return;
      }

      const touch = e.changedTouches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      const duration = Date.now() - startRef.current.time;

      startRef.current = null;

      // 手势阈值判定：快速轻扫（650ms 内）且水平位移大于 45px，且水平位移明显大于垂直位移
      if (
        duration > 650 ||
        Math.abs(dx) < 45 ||
        Math.abs(dx) < Math.abs(dy) * 1.2
      ) {
        return;
      }

      const {
        isLeftDrawerOpen,
        isRightDrawerOpen,
        onOpenLeftDrawer,
        onCloseLeftDrawer,
        onOpenRightDrawer,
        onCloseRightDrawer,
      } = handlersRef.current;

      // 1. 如果左侧频道抽屉已打开
      if (isLeftDrawerOpen) {
        // 向左滑 -> 关闭左侧抽屉
        if (dx < -40) {
          onCloseLeftDrawer?.();
          return;
        }
      }

      // 2. 如果右侧成员抽屉已打开
      if (isRightDrawerOpen) {
        // 向右滑 -> 关闭右侧抽屉
        if (dx > 40) {
          onCloseRightDrawer?.();
          return;
        }
      }

      // 3. 当前处于主聊天/语音页面（两侧抽屉均未打开）
      if (!isLeftDrawerOpen && !isRightDrawerOpen) {
        // 向右滑 (dx > 0) -> 打开左侧抽屉（频道与服务器）
        if (dx > 45) {
          onOpenLeftDrawer?.();
          return;
        }

        // 向左滑 (dx < 0) -> 打开右侧抽屉（服务器人员）
        if (dx < -45) {
          onOpenRightDrawer?.();
          return;
        }
      }
    };

    // passive: false 是为了允许 handleTouchMove 调用 e.preventDefault() 拦截浏览器的横向返回手势
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled]);
}
