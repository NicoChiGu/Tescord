import React, { useEffect, useState } from "react";
import { resolveServerUrl } from "../../config.js";

/** Published GIFs have a server-decoded static variant for reduced motion. */
export function GuildIcon({
  src,
  alt = "",
  onError,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const resolved = src ? resolveServerUrl(src) : undefined;
  let imageSrc = resolved;
  if (reduced && resolved && /\.gif(?:[?#]|$)/i.test(resolved)) {
    const url = new URL(resolved, window.location.href);
    url.searchParams.set("static", "1");
    imageSrc = url.href;
  }
  useEffect(() => setFailed(false), [imageSrc]);
  // A failed static variant must not quietly resume animation.
  if (failed)
    return (
      <span
        role="img"
        aria-label={alt}
        className={`${props.className || ""} flex items-center justify-center bg-discord-channelList text-discord-textHeader`}
      >
        {alt.slice(0, 2).toUpperCase()}
      </span>
    );
  return (
    <img
      draggable={props.draggable ?? false}
      {...props}
      onDragStart={(event) => {
        if (props.draggable !== true) {
          event.preventDefault();
        }
        props.onDragStart?.(event);
      }}
      src={imageSrc}
      alt={alt}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
