import React, { useState, useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { resolveServerUrl } from "../../config.js";

export const SteamLogo: React.FC<{ className?: string }> = ({
  className = "w-3.5 h-3.5",
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.005.105.005.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 14.819C1.944 20.067 6.702 24 12.355 24c6.627 0 12-5.373 12-12S18.981 0 11.979 0zM7.558 17.702c-.93 0-1.688-.758-1.688-1.688 0-.93.758-1.688 1.688-1.688.93 0 1.688.758 1.688 1.688 0 .93-.758 1.688-1.688 1.688zm8.381-8.792c0-1.656 1.344-3 3-3s3 1.344 3 3-1.344 3-3 3-3-1.344-3-3z" />
  </svg>
);

export interface SteamGameImageProps {
  appId?: string;
  src?: string;
  gameName?: string;
  type?: "header" | "capsule";
  className?: string;
  imageClassName?: string;
  fallbackIconClassName?: string;
  alt?: string;
  showPlatformBadge?: boolean;
}

export const SteamGameImage: React.FC<SteamGameImageProps> = ({
  appId,
  src,
  gameName,
  type = "header",
  className = "w-12 h-12 rounded-lg",
  imageClassName = "w-full h-full object-cover",
  fallbackIconClassName = "w-6 h-6 text-emerald-400",
  alt,
  showPlatformBadge = false,
}) => {
  const [srcAttempt, setSrcAttempt] = useState<number>(0);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    setSrcAttempt(0);
    setIsLoaded(false);
  }, [appId, src, type]);

  const fileType = type === "capsule" ? "capsule_231x87.jpg" : "header.jpg";

  const getSourceUrl = (): string | null => {
    if (srcAttempt === 0) {
      if (src) return src;
      if (appId) {
        return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/${fileType}`;
      }
    }
    if (srcAttempt === 1 && appId) {
      const query = type === "capsule" ? "?type=capsule" : "";
      return resolveServerUrl(`/api/games/steam/${appId}/image${query}`);
    }
    return null;
  };

  const currentUrl = getSourceUrl();

  const handleImageError = () => {
    setSrcAttempt((prev) => prev + 1);
  };

  const isFailed = srcAttempt >= 2 || !currentUrl;

  return (
    <div
      className={`relative overflow-hidden bg-[#2b2d31] flex items-center justify-center flex-shrink-0 select-none ${className}`}
      data-testid="steam-game-image-container"
    >
      {!isFailed && currentUrl ? (
        <>
          <img
            src={currentUrl}
            alt={alt || gameName || "Game Cover"}
            onError={handleImageError}
            onLoad={() => setIsLoaded(true)}
            className={`${imageClassName} transition-opacity duration-300 ${
              isLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#2b2d31] animate-pulse">
              <Gamepad2 className={fallbackIconClassName} />
            </div>
          )}
        </>
      ) : (
        <Gamepad2 className={fallbackIconClassName} />
      )}

      {showPlatformBadge && appId && (
        <div
          title="Steam"
          className="absolute bottom-1 right-1 p-0.5 rounded bg-black/70 text-white/90 backdrop-blur-sm shadow"
        >
          <SteamLogo className="w-2.5 h-2.5" />
        </div>
      )}
    </div>
  );
};
