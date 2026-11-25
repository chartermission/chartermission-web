"use client";

import { useRef, useState, type CSSProperties } from "react";
import type React from "react";
import type { AttachmentView } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { imageAlt } from "./image-alt";
import { Lightbox } from "./lightbox";
import { useT } from "@/i18n/client";

/** Aspect limits for a single image (width / height): 4:5 portrait up to 2:1 panorama; beyond that it's cropped. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 2;

/** A single image always fills the post's width; its height follows the photo's shape within the limits. */
function singleFrame(image: AttachmentView): CSSProperties {
  const natural = image.width && image.height ? image.width / image.height : 16 / 9;
  return { aspectRatio: String(Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural))) };
}

/** How a set of photos is arranged: how many tiles show, the frame's grid, and any tile that spans. */
type Arrangement = { shown: number; frame: string; tile: (index: number) => string | undefined };

/** Collage: 2 side by side, 3 = one large + two stacked, 4 = 2×2, 5 or more = two large over three smaller. */
function collage(count: number): Arrangement {
  if (count === 2) return { shown: 2, frame: "aspect-video grid-cols-2 grid-rows-1", tile: () => undefined };
  if (count === 3) return { shown: 3, frame: "aspect-video grid-cols-2 grid-rows-2", tile: (index) => (index === 0 ? "row-span-2" : undefined) };
  if (count === 4) return { shown: 4, frame: "aspect-video grid-cols-2 grid-rows-2", tile: () => undefined };
  return { shown: 5, frame: "aspect-[4/3] grid-cols-6 grid-rows-[3fr_2fr]", tile: (index) => (index < 2 ? "col-span-3" : "col-span-2") };
}

/** Grid: even square tiles in a full block of 2, 3, 4, 6 or 9. */
function evenGrid(count: number): Arrangement {
  const tile = () => undefined;
  if (count === 2) return { shown: 2, frame: "aspect-[2/1] grid-cols-2 grid-rows-1", tile };
  if (count === 3) return { shown: 3, frame: "aspect-[3/1] grid-cols-3 grid-rows-1", tile };
  if (count < 6) return { shown: 4, frame: "aspect-square grid-cols-2 grid-rows-2", tile };
  if (count < 9) return { shown: 6, frame: "aspect-[3/2] grid-cols-3 grid-rows-2", tile };
  return { shown: 9, frame: "aspect-square grid-cols-3 grid-rows-3", tile };
}

/**
 * Post photos as a collage or an even grid, in a fixed-ratio frame so nothing shifts while they
 * load. Photos that don't fit sit behind a "+N" on the last tile. Each tile is a button that opens
 * the full-screen lightbox (which steps through every photo) at that image; focus comes back to
 * the tile. With interactive off (the composer's preview) the tiles are plain pictures.
 */
export function ImageGrid({
  images,
  layout = "collage",
  bleedClassName,
  interactive = true,
  panel,
}: {
  images: AttachmentView[];
  layout?: "collage" | "grid";
  /** Edge to edge inside a padded card: negative margins matching the card's padding (corners go square). */
  bleedClassName?: string;
  interactive?: boolean;
  /** The post the photos belong to, shown with them in the full-screen viewer. */
  panel?: React.ReactNode;
}) {
  const t = useT();
  const count = images.length;
  const [open, setOpen] = useState<number | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  if (count === 0) return null;

  const single = count === 1;
  const arrangement = single ? null : layout === "grid" ? evenGrid(count) : collage(count);
  const shown = images.slice(0, arrangement?.shown ?? 1);
  const hidden = count - shown.length;

  return (
    <>
      <div className={cn("overflow-hidden", bleedClassName ?? "w-full rounded-[10px]", single ? "flex" : cn("grid gap-1", arrangement!.frame))}>
        {shown.map((image, index) => {
          const more = hidden > 0 && index === shown.length - 1;
          const className = cn(
            "group relative block min-h-0 min-w-0 overflow-hidden bg-muted outline-none",
            interactive && "cursor-zoom-in",
            "focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-primary-light",
            single ? cn("w-full", !bleedClassName && "rounded-[10px]") : "size-full",
            arrangement?.tile(index),
          );
          const picture = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
              <img
                src={image.url}
                alt={imageAlt(image, index, count)}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
                decoding="async"
                className={cn("size-full object-cover", interactive && "transition-[filter] duration-150 group-hover:brightness-95")}
              />
              {more && (
                <span className="absolute inset-0 flex items-center justify-center bg-ink/55 text-[28px] font-semibold text-inverse max-sm:text-2xl">
                  <span aria-hidden="true">+{hidden}</span>
                  <span className="sr-only">{t("and {hidden} more photos", { hidden })}</span>
                </span>
              )}
            </>
          );
          return interactive ? (
            <button
              key={image.id}
              ref={(node) => {
                tiles.current[index] = node;
              }}
              type="button"
              onClick={() => setOpen(index)}
              style={single ? singleFrame(image) : undefined}
              className={className}
            >
              {picture}
              <span className="sr-only">{count > 1 ? `, open image ${index + 1} of ${count} in the viewer` : ", open in the viewer"}</span>
            </button>
          ) : (
            <div key={image.id} style={single ? singleFrame(image) : undefined} className={className}>
              {picture}
            </div>
          );
        })}
      </div>
      {open !== null && (
        <Lightbox
          images={images}
          panel={panel}
          index={open}
          onIndexChange={setOpen}
          onClose={(last) => {
            setOpen(null);
            // The dialog has unmounted by the next frame; hand focus back to the matching thumbnail
            // (the "+N" tile for photos that have no tile of their own).
            requestAnimationFrame(() => tiles.current[Math.min(last, shown.length - 1)]?.focus());
          }}
        />
      )}
    </>
  );
}
