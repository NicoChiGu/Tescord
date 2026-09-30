import React, { useId } from "react";
import { UserStatus } from "@tescord/types";

export interface StatusBadgeProps {
  status?: UserStatus | string;
  size?: number | "sm" | "md" | "lg";
  className?: string;
  /** 边框底色，默认 #232428 匹配 Discord 深色卡片背景 */
  borderColor?: string;
  /** 是否需要边框/间距（通常覆盖在头像上时需要 ring 边框隔离） */
  withBorder?: boolean;
}

const PRESET_SIZES: Record<string, number> = {
  sm: 10,
  md: 14,
  lg: 20,
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status = "OFFLINE",
  size = "sm",
  className = "",
  borderColor = "#232428",
  withBorder = true,
}) => {
  const pixelSize = typeof size === "number" ? size : PRESET_SIZES[size] || 10;
  const rawId = useId();
  const maskId = `status-mask-${rawId.replace(/:/g, "")}`;

  // 标准化状态
  const normalizedStatus = String(status || "OFFLINE").toUpperCase();

  // 根据不同状态渲染具有物理镂空（SVG Mask）特性的图标
  const renderBadgeContent = () => {
    switch (normalizedStatus) {
      case "ONLINE":
        return (
          <circle cx="5" cy="5" r="5" fill="#23a55a" />
        );

      case "IDLE":
        return (
          <>
            <defs>
              <mask id={maskId}>
                {/* 白色保留，黑色挖空 */}
                <rect x="0" y="0" width="10" height="10" fill="#ffffff" />
                <circle cx="3" cy="3" r="3.75" fill="#000000" />
              </mask>
            </defs>
            <circle cx="5" cy="5" r="5" fill="#f0b232" mask={`url(#${maskId})`} />
          </>
        );

      case "DND":
        return (
          <>
            <defs>
              <mask id={maskId}>
                {/* 白色保留，黑色挖空中心横杠 */}
                <rect x="0" y="0" width="10" height="10" fill="#ffffff" />
                <rect x="2" y="4.25" width="6" height="1.5" rx="0.75" fill="#000000" />
              </mask>
            </defs>
            <circle cx="5" cy="5" r="5" fill="#f23f43" mask={`url(#${maskId})`} />
          </>
        );

      case "OFFLINE":
      case "INVISIBLE":
      default:
        return (
          <>
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width="10" height="10" fill="#ffffff" />
                <circle cx="5" cy="5" r="2.75" fill="#000000" />
              </mask>
            </defs>
            <circle cx="5" cy="5" r="5" fill="#80848e" mask={`url(#${maskId})`} />
          </>
        );
    }
  };

  const borderWidth = withBorder ? Math.max(1.5, Math.round(pixelSize * 0.15)) : 0;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{
        width: pixelSize,
        height: pixelSize,
        borderRadius: "50%",
        boxShadow: withBorder ? `0 0 0 ${borderWidth}px ${borderColor}` : undefined,
      }}
      aria-label={`Status: ${normalizedStatus}`}
    >
      <svg
        viewBox="0 0 10 10"
        width={pixelSize}
        height={pixelSize}
        className="w-full h-full block"
      >
        {renderBadgeContent()}
      </svg>
    </div>
  );
};
