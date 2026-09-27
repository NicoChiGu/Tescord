import { useEffect, useRef } from "react";

interface MomentumScrollOptions {
  damping?: number; // 阻尼系数 (0.1 ~ 0.3)，越小越平滑厚重
  multiplier?: number; // 滚轮速度倍率
  enabled?: boolean;
}

/**
 * useMomentumScroll:
 * Discord 官方同款滚轮平滑阻尼插值 Hook。
 * 接管鼠标滚轮的步进式阶跃跳动，采用 requestAnimationFrame 贝塞尔物理阻尼平滑插值，
 * 营造 Discord 标志性的细腻丝滑质感。
 */
export function useMomentumScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  options: MomentumScrollOptions = {},
) {
  const { damping = 0.18, multiplier = 1.0, enabled = true } = options;

  const targetScrollTopRef = useRef<number>(0);
  const currentScrollTopRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const isInteractingRef = useRef<boolean>(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    // 移动端/平板触控设备优先保留系统原生 GPU 硬件加速平滑滚动，避免 JS 阻尼劫持导致卡顿
    const isTouchOnly =
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
      window.innerWidth < 1024;
    if (isTouchOnly) return;

    targetScrollTopRef.current = el.scrollTop;
    currentScrollTopRef.current = el.scrollTop;

    const stopAnimation = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const animate = () => {
      if (!containerRef.current) return;
      const current = currentScrollTopRef.current;
      const target = targetScrollTopRef.current;

      const diff = target - current;

      if (Math.abs(diff) < 0.5) {
        containerRef.current.scrollTop = target;
        currentScrollTopRef.current = target;
        stopAnimation();
        return;
      }

      // 阻尼线性逼近 (Ease Out Damping)
      const next = current + diff * damping;
      containerRef.current.scrollTop = next;
      currentScrollTopRef.current = next;

      rafIdRef.current = requestAnimationFrame(animate);
    };

    const handleWheel = (e: WheelEvent) => {
      // 触控板双指微滑动或水平滚动交由原生处理
      if (Math.abs(e.deltaY) < 1) return;

      e.preventDefault();

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      // 同步当前位置以防外部（如跳转或拖拽滚动条）改动了 scrollTop
      if (Math.abs(el.scrollTop - currentScrollTopRef.current) > 4) {
        currentScrollTopRef.current = el.scrollTop;
        targetScrollTopRef.current = el.scrollTop;
      }

      const delta = e.deltaY * multiplier;
      targetScrollTopRef.current = Math.max(
        0,
        Math.min(maxScroll, targetScrollTopRef.current + delta),
      );

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(animate);
      }
    };

    // 用户直接按住滚动条拖动时，同步目标位置，避免插值冲突
    const handlePointerDown = () => {
      isInteractingRef.current = true;
      stopAnimation();
      if (containerRef.current) {
        currentScrollTopRef.current = containerRef.current.scrollTop;
        targetScrollTopRef.current = containerRef.current.scrollTop;
      }
    };

    const handlePointerUp = () => {
      isInteractingRef.current = false;
      if (containerRef.current) {
        currentScrollTopRef.current = containerRef.current.scrollTop;
        targetScrollTopRef.current = containerRef.current.scrollTop;
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      stopAnimation();
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [containerRef, damping, multiplier, enabled]);
}
