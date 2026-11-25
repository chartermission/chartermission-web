"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type React from "react";
import type { AttachmentView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { imageAlt } from "./image-alt";
import { Lightbox } from "./lightbox";
import { useT } from "@/i18n/client";

/** The frame follows the first photo's shape, from 4:5 portrait to 16:9 landscape. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 16 / 9;
/** A photo this far from the frame's shape is shown whole (letterboxed) instead of cropped. */
const CROP_TOLERANCE = 0.2;

const ratioOf = (image: AttachmentView | undefined) => (image?.width && image.height ? image.width / image.height : null);

const arrow =
  "absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-ink shadow-[0px_1px_4px_0px_rgba(0,0,0,0.25)] transition-opacity hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light max-sm:hidden";

/**
 * Post photos one at a time, in the author's order: swipe, use the side arrows or the arrow keys.
 * Every slide shares one frame (the first photo's shape) so the post never changes height while
 * moving through it. A slide opens the full-screen lightbox at that photo; on closing, the
 * carousel is left on the photo last viewed. With interactive off (the composer's preview) the
 * slides are plain pictures.
 */
export function ImageCarousel({
  images,
  bleedClassName,
  interactive = true,
  panel,
}: {
  images: AttachmentView[];
  /** Edge to edge inside a padded card: negative margins matching the card's padding (corners go square). */
  bleedClassName?: string;
  interactive?: boolean;
  /** The post the photos belong to, shown with them in the full-screen viewer. */
  panel?: React.ReactNode;
}) {
  const t = useT();
  const count = images.length;
  const scroller = useRef<HTMLDivElement>(null);
  const slides = useRef<(HTMLButtonElement | null)[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  if (count === 0) return null;

  const current = Math.min(index, count - 1);
  const frame = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratioOf(images[0]) ?? 4 / 3));

  function go(to: number, behavior: ScrollBehavior = "smooth") {
    const el = scroller.current;
    if (!el) return;
    const next = Math.min(count - 1, Math.max(0, to));
    el.scrollTo({ left: next * el.clientWidth, behavior });
  }

  function onScroll() {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") go(current + 1);
    else if (event.key === "ArrowLeft") go(current - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(count - 1);
    else return;
    event.preventDefault();
  }

  return (
    <>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={t("Photos, {total} in this post", { total: count })}
        onKeyDown={onKeyDown}
        className={cn("flex flex-col gap-2", bleedClassName ?? "w-full")}
      >
        <div className={cn("relative overflow-hidden bg-muted", !bleedClassName && "rounded-[10px]")} style={{ aspectRatio: String(frame) }}>
          {/* Always scrolls left to right, whatever the page's direction, so the arrows and the count agree. */}
          <div
            ref={scroller}
            dir="ltr"
            onScroll={onScroll}
            className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {images.map((image, i) => {
              const ratio = ratioOf(image);
              const whole = ratio !== null && Math.abs(ratio / frame - 1) > CROP_TOLERANCE;
              const picture = (
                // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets
                <img
                  src={image.url}
                  alt={imageAlt(image, i, count)}
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  className={cn("size-full select-none", whole ? "object-contain" : "object-cover")}
                />
              );
              const className = "relative block h-full w-full shrink-0 snap-center snap-always overflow-hidden outline-none";
              return interactive ? (
                <button
                  key={image.id}
                  ref={(node) => {
                    slides.current[i] = node;
                  }}
                  type="button"
                  onClick={() => setOpen(i)}
                  className={cn(
                    className,
                    "cursor-zoom-in focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-primary-light",
                  )}
                >
                  {picture}
                  <span className="sr-only">{`, open image ${i + 1} of ${count} in the viewer`}</span>
                </button>
              ) : (
                <div key={image.id} className={className}>
                  {picture}
                </div>
              );
            })}
          </div>

          {count > 1 && (
            <>
              <span aria-hidden="true" className="pointer-events-none absolute end-3 top-3 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-medium tabular-nums text-inverse">
                {current + 1} / {count}
              </span>
              <button
                type="button"
                onClick={() => go(current - 1)}
                aria-disabled={current === 0 || undefined}
                aria-label={t("Previous photo ({index} of {total})", { index: Math.max(1, current), total: count })}
                className={cn(arrow, "left-3", current === 0 && "cursor-default opacity-40")}
              >
                <Icon name="chevron-left" size={20} />
              </button>
              <button
                type="button"
                onClick={() => go(current + 1)}
                aria-disabled={current === count - 1 || undefined}
                aria-label={t("Next photo ({index} of {total})", { index: Math.min(count, current + 2), total: count })}
                className={cn(arrow, "right-3", current === count - 1 && "cursor-default opacity-40")}
              >
                <Icon name="chevron-right" size={20} />
              </button>
            </>
          )}
        </div>

        {count > 1 && (
          <>
            <div aria-hidden="true" dir="ltr" className="flex items-center justify-center gap-1.5">
              {images.map((image, i) => (
                <span key={image.id} className={cn("rounded-full transition-all", i === current ? "size-2 bg-primary" : "size-1.5 bg-line-strong")} />
              ))}
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {t("Photo {count} of {count2}.", { count: current + 1, count2: count })}
            </p>
          </>
        )}
      </div>
      {open !== null && (
        <Lightbox
          images={images}
          panel={panel}
          index={open}
          onIndexChange={setOpen}
          onClose={(last) => {
            setOpen(null);
            // Leave the carousel on the photo last viewed and hand focus back to its slide.
            go(last, "instant");
            requestAnimationFrame(() => slides.current[last]?.focus({ preventScroll: true }));
          }}
        />
      )}
    </>
  );
}
