import { useState, useEffect } from "react";

export interface ViewportInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  viewportWidth: number;
  viewportHeight: number;
  isKeyboardOpen: boolean;
  keyboardHeight: number;
}

export function useViewport(): ViewportInfo {
  const [viewport, setViewport] = useState<ViewportInfo>(() => {
    const width = typeof window !== "undefined" ? window.innerWidth : 1200;
    const height = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      isMobile: width < 768,
      isTablet: width >= 768 && width < 1024,
      isDesktop: width >= 1024,
      viewportWidth: width,
      viewportHeight: height,
      isKeyboardOpen: false,
      keyboardHeight: 0,
    };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      const vv = window.visualViewport;
      const width = window.innerWidth;
      const currentHeight = vv ? vv.height : window.innerHeight;
      const fullHeight = window.innerHeight;
      const kbHeight = Math.max(0, fullHeight - currentHeight);
      const isKbOpen = kbHeight > 120; // 软键盘一般高于 120px

      // 动态更新 CSS 变量，确保固定全屏布局避开软键盘
      if (vv) {
        document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${vv.height}px`,
        );
      }

      setViewport({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
        viewportWidth: width,
        viewportHeight: currentHeight,
        isKeyboardOpen: isKbOpen,
        keyboardHeight: kbHeight,
      });
    };

    updateViewport();

    window.addEventListener("resize", updateViewport, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewport);
      window.visualViewport.addEventListener("scroll", updateViewport);
    }

    return () => {
      window.removeEventListener("resize", updateViewport);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateViewport);
        window.visualViewport.removeEventListener("scroll", updateViewport);
      }
    };
  }, []);

  return viewport;
}
