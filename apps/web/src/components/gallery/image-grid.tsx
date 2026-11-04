"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { AttachmentView } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { imageAlt } from "./image-alt";
import { Lightbox } from "./lightbox";

/** Tallest a single image may be in a post; portrait images narrow instead of growing. */
const SINGLE_MAX_HEIGHT = 520;
/** Aspect limits for a single image (width / height): 4:5 portrait up to 2:1 panorama. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 2;

function singleFrame(image: AttachmentView): CSSProperties {
  const natural = image.width && image.height ? image.width / image.height : 16 / 9;
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural));
  return ratio < 1
    ? { aspectRatio: String(ratio), width: `min(100%, ${Math.round(SINGLE_MAX_HEIGHT * ratio)}px)` }
    : { aspectRatio: String(ratio), maxHeight: SINGLE_MAX_HEIGHT };
}

/** Grid placement per count: 2 side by side, 3 = one large + two stacked, 4 = 2×2. */
function tileClass(count: number, index: number) {
  if (count === 3 && index === 0) return "row-span-2";
  return undefined;
}

/**
 * Post photos (1–4) in a fixed-ratio frame so nothing shifts while they load. Each tile is a
 * button that opens the full-screen lightbox at that image; focus comes back to the tile.
 */
export function ImageGrid({ images }: { images: AttachmentView[] }) {
  const shown = images.slice(0, 4);
  const count = shown.length;
  const [open, setOpen] = useState<number | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  if (count === 0) return null;

  return (
    <>
      <div
        className={cn(
          "w-full overflow-hidden rounded-[10px]",
          count === 1 ? "flex" : "grid aspect-video grid-cols-2 gap-1",
          count >= 3 && "grid-rows-2",
        )}
      >
        {shown.map((image, index) => (
          <button
            key={image.id}
            ref={(node) => {
              tiles.current[index] = node;
            }}
            type="button"
            onClick={() => setOpen(index)}
            style={count === 1 ? singleFrame(image) : undefined}
            className={cn(
              "group relative block min-h-0 cursor-zoom-in overflow-hidden bg-muted outline-none",
              "focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-primary-light",
              count === 1 ? "w-full rounded-[10px]" : "size-full",
              tileClass(count, index),
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
            <img
              src={image.url}
              alt={imageAlt(image, index, count)}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-[filter] duration-150 group-hover:brightness-95"
            />
            <span className="sr-only">{count > 1 ? `, open image ${index + 1} of ${count} in the viewer` : ", open in the viewer"}</span>
          </button>
        ))}
      </div>
      {open !== null && (
        <Lightbox
          images={shown}
          index={open}
          onIndexChange={setOpen}
          onClose={(last) => {
            setOpen(null);
            // The dialog has unmounted by the next frame; hand focus back to the matching thumbnail.
            requestAnimationFrame(() => tiles.current[last]?.focus());
          }}
        />
      )}
    </>
  );
}
