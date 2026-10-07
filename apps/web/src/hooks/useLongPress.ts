import { useCallback, useRef, useEffect } from "react";

export interface LongPressOptions {
  threshold?: number; // 毫秒，默认 450ms
  moveTolerance?: number; // 允许的移动像素，默认 10px
  vibrate?: boolean; // 是否触发轻微震动反馈
}

export function useLongPress(
  onLongPress: (
    e: React.TouchEvent | React.MouseEvent | React.PointerEvent,
  ) => void,
  options: LongPressOptions = {},
) {
  const { threshold = 450, moveTolerance = 10, vibrate = true } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressTriggeredRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const handleStart = useCallback(
    (clientX: number, clientY: number, e: any) => {
      clear();
      startPosRef.current = { x: clientX, y: clientY };
      isLongPressTriggeredRef.current = false;

      timerRef.current = setTimeout(() => {
        isLongPressTriggeredRef.current = true;
        if (vibrate && typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {}
        }
        onLongPress(e);
      }, threshold);
    },
    [clear, onLongPress, threshold, vibrate],
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!startPosRef.current) return;
      const dx = Math.abs(clientX - startPosRef.current.x);
      const dy = Math.abs(clientY - startPosRef.current.y);

      if (dx > moveTolerance || dy > moveTolerance) {
        clear();
      }
    },
    [clear, moveTolerance],
  );

  // Touch handlers
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length > 1) return;
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY, e);
    },
    [handleStart],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current || e.touches.length === 0) return;
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove],
  );

  // Pointer handlers (covers touch, pen, and synthetic pointer events)
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      handleStart(e.clientX, e.clientY, e);
    },
    [handleStart],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current) return;
      handleMove(e.clientX, e.clientY);
    },
    [handleMove],
  );

  useEffect(() => {
    return () => clear();
  }, [clear]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}
