import React, { useId } from "react";

export type BrandLogoVariant = "badge" | "symbol";
export type BrandLogoSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export interface BrandLogoProps extends React.SVGAttributes<SVGSVGElement> {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  badgeBgColor?: string;
  badgeRadius?: number;
  symbolColor?: string;
  className?: string;
}

const SIZE_MAP: Record<BrandLogoSize, string> = {
  xs: "w-4 h-4", // 16px
  sm: "w-5 h-5", // 20px
  md: "w-6 h-6", // 24px
  lg: "w-8 h-8", // 32px
  xl: "w-12 h-12", // 48px
  "2xl": "w-16 h-16", // 64px
};

/**
 * Tescord 官方品牌吉祥物矢量徽标组件
 * 猫耳天线电竞机甲头盔 (Official Mascot: Lynx/Cat-Ear Tech Mech)
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = "symbol",
  size,
  badgeBgColor = "#5865F2",
  badgeRadius = 28,
  symbolColor = "currentColor",
  className = "",
  ...svgProps
}) => {
  const uniqueId = useId().replace(/:/g, "_");
  const maskId = `tescord-mascot-mask-${uniqueId}`;

  const sizeClass = size ? SIZE_MAP[size] : "";

  // 吉祥物头盔主体轮廓 (绝对居中数学校准)
  const helmetPath =
    "M 36 99 C 28 95, 21 87, 19 77 C 17 67, 20 57, 24 49 C 25.5 44, 27 36, 28 29 C 28.8 24.5, 33 22, 37.5 24.5 C 43 27.5, 48.5 36, 52 43.5 C 56 42, 72 42, 76 43.5 C 79.5 36, 85 27.5, 90.5 24.5 C 95 22, 99.2 24.5, 100 29 C 101 36, 102.5 44, 104 49 C 108 57, 111 67, 109 77 C 107 87, 100 95, 92 99 C 84 103, 76 105.5, 64 105.5 C 52 105.5, 44 103, 36 99 Z";

  // 猫耳内侧科技镂空透光槽
  const leftEarCutout =
    "M 36 33 C 38 38, 42 44, 45 47 C 42.5 47, 39 45, 36.5 41.5 C 34.5 38.5, 34.5 35, 36 33 Z";
  const rightEarCutout =
    "M 92 33 C 93.5 35, 93.5 38.5, 91.5 41.5 C 89 45, 85.5 47, 83 47 C 86 44, 90 38, 92 33 Z";

  if (variant === "badge") {
    return (
      <svg
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${sizeClass} ${className}`}
        {...svgProps}
      >
        {/* 圆角底框 */}
        <rect width="128" height="128" rx={badgeRadius} fill={badgeBgColor} />
        {/* 白色头盔主体 */}
        <path d={helmetPath} fill="#FFFFFF" />
        {/* 猫耳内侧透光 */}
        <path d={leftEarCutout} fill={badgeBgColor} opacity="0.9" />
        <path d={rightEarCutout} fill={badgeBgColor} opacity="0.9" />
        {/* 科技按键眼 */}
        <rect x="39" y="63" width="14" height="20" rx="7" fill={badgeBgColor} />
        <rect x="75" y="63" width="14" height="20" rx="7" fill={badgeBgColor} />
        {/* 萌感微笑呼吸线 */}
        <path
          d="M 58 88 Q 64 92 70 88"
          stroke={badgeBgColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }

  // 纯剪影模式 (无背景底色，眼睛与内槽天然透空，颜色受控于 currentColor 或 symbolColor)
  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${sizeClass} ${className}`}
      {...svgProps}
    >
      <mask id={maskId}>
        {/* 白色区域保留可见 */}
        <rect width="128" height="128" fill="#FFFFFF" />
        {/* 黑色区域穿透镂空 */}
        <path d={leftEarCutout} fill="#000000" />
        <path d={rightEarCutout} fill="#000000" />
        <rect x="39" y="63" width="14" height="20" rx="7" fill="#000000" />
        <rect x="75" y="63" width="14" height="20" rx="7" fill="#000000" />
        <path
          d="M 58 88 Q 64 92 70 88"
          stroke="#000000"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </mask>
      <path d={helmetPath} fill={symbolColor} mask={`url(#${maskId})`} />
    </svg>
  );
};

export default BrandLogo;
