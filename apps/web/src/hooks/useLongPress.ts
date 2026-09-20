import { useCallback, useRef } from "react";

export interface LongPressOptions {
  threshold?: number; // 毫秒，默认 500ms
  moveTolerance?: number; // 允许的手指移动像素，默认 10px
  vibrate?: boolean; // 是否触发轻微震动反馈
}

export function useLongPress(
  onLongPress: (e: React.TouchEvent | React.MouseEvent) => void,
  options: LongPressOptions = {},
) {
  const { threshold = 500, moveTolerance = 10, vibrate = true } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressTriggeredRef = useRef(false);

  const start = useCallback(
    (e: React.TouchEvent) => {
      // 仅针对单指触摸
      if (e.touches.length > 1) return;
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      isLongPressTriggeredRef.current = false;

      timerRef.current = setTimeout(() => {
        isLongPressTriggeredRef.current = true;
        if (vibrate && typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {
            // 忽略某些浏览器安全策略限制
          }
        }
        onLongPress(e);
      }, threshold);
    },
    [onLongPress, threshold, vibrate],
  );

  const move = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current || e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startPosRef.current.x);
      const dy = Math.abs(touch.clientY - startPosRef.current.y);

      // 手指滑动超过容差，说明是滚动页面，取消长按
      if (dx > moveTolerance || dy > moveTolerance) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    },
    [moveTolerance],
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  return {
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}
