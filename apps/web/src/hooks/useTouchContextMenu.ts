import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, TouchEvent } from "react";

/** Keep touch menus separate from sorting and native scroll gestures. */
export function useTouchContextMenu() {
  const start = useRef<{ x: number; y: number; target: HTMLElement }>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const suppressClickUntil = useRef(0);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  };
  useEffect(() => {
    window.addEventListener("scroll", cancel, true);
    return () => {
      cancel();
      window.removeEventListener("scroll", cancel, true);
    };
  }, []);
  return {
    // Radix has its own touch timer. Stop it before it competes with this one.
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      if (
        event.pointerType === "touch" &&
        !(event.target as Element).closest("[data-drag-handle]")
      )
        event.stopPropagation();
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      cancel();
      suppressClickUntil.current = 0;
      if (
        event.touches.length !== 1 ||
        (event.target as Element).closest("[data-drag-handle]")
      )
        return;
      const touch = event.touches[0];
      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        target: event.currentTarget,
      };
      timer.current = setTimeout(() => {
        const point = start.current;
        if (!point) return;
        suppressClickUntil.current = Date.now() + 1500;
        point.target.dispatchEvent(
          new window.MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: point.x,
            clientY: point.y,
            button: 2,
          }),
        );
        cancel();
      }, 600);
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      if (
        start.current &&
        Math.hypot(
          event.touches[0].clientX - start.current.x,
          event.touches[0].clientY - start.current.y,
        ) > 8
      )
        cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (Date.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
