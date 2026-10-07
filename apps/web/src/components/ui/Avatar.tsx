import React, { useState, useEffect } from "react";
import { UserStatus } from "@tescord/types";
import { resolveServerUrl } from "../../config";
import { StatusBadge } from "./StatusBadge.js";

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  fallbackSeed?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  className?: string;
  status?: UserStatus;
  statusClassName?: string;
  showStatus?: boolean;
}

const SIZE_MAP: Record<string, string> = {
  xs: "w-5 h-5",
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
  xl: "w-16 h-16",
  "2xl": "w-20 h-20",
  "3xl": "w-24 h-24",
};

const STATUS_SIZE_MAP: Record<string, string> = {
  xs: "w-2 h-2 ring-1",
  sm: "w-2.5 h-2.5 ring-[2px]",
  md: "w-3.5 h-3.5 ring-[3px]",
  lg: "w-4 h-4 ring-[3px]",
  xl: "w-5 h-5 ring-[3px]",
  "2xl": "w-6 h-6 ring-[4px]",
  "3xl": "w-7 h-7 ring-[4px]",
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt = "avatar",
  fallbackSeed = "tescord-user",
  size = "md",
  className = "",
  status,
  statusClassName = "",
  showStatus = Boolean(status),
}) => {
  const [hasError, setHasError] = useState(false);

  // 依赖的 src 发生改变时，重置错误状态
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
    fallbackSeed || "tescord-user",
  )}`;

  const resolvedSrc =
    !hasError && src?.trim() ? resolveServerUrl(src.trim()) : defaultAvatar;

  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const statusSizeClass = STATUS_SIZE_MAP[size] || STATUS_SIZE_MAP.md;

  const renderStatus = () => {
    if (!showStatus || !status) return null;
    const badgeSizes: Record<string, number> = {
      xs: 8,
      sm: 10,
      md: 14,
      lg: 16,
      xl: 20,
      "2xl": 24,
      "3xl": 28,
    };
    const badgePixelSize = badgeSizes[size] || 14;

    return (
      <div className={`absolute bottom-0 right-0 z-10 ${statusClassName}`}>
        <StatusBadge
          status={status}
          size={badgePixelSize}
          borderColor="#232428"
        />
      </div>
    );
  };

  return (
    <div
      className={`relative inline-block flex-shrink-0 ${sizeClass} ${className}`}
    >
      <img
        src={resolvedSrc}
        alt={alt}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onError={() => setHasError(true)}
        className="w-full h-full aspect-square object-cover rounded-full bg-[#1e1f22] select-none pointer-events-none"
      />
      {renderStatus()}
    </div>
  );
};
