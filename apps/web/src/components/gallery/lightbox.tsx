"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import type { AttachmentView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { hasAuthorAlt, imageAlt } from "./image-alt";
import { T, useT } from "@/i18n/client";

/** Space kept clear around the image: the top bar, the caption strip and the side buttons. */
const BAR = 64;
const SIDE_DESKTOP = 80;
const SIDE_MOBILE = 12;
const SWIPE_MIN = 48;
/** The thumbnail strip under the photo when there are several. */
const STRIP = 72;
/** Width of the side panel (the post's author, text and reactions) on wide screens. */
const PANEL = 380;
/** From this width the post sits beside the photo; below it, in a sheet over the bottom. */
const WIDE = 1024;

function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** The image's size when fitted into the free area (never upscaled), or null when its size is unknown. */
function fitSize(image: AttachmentView, viewport: { width: number; height: number }, multiple: boolean, panelBeside: boolean) {
  if (!image.width || !image.height) return null;
  const side = viewport.width < 640 || !multiple ? SIDE_MOBILE : SIDE_DESKTOP;
  const boxW = Math.max(120, viewport.width - (panelBeside ? PANEL : 0) - side * 2);
  const boxH = Math.max(120, viewport.height - BAR * 2 - (multiple ? STRIP : 0));
  const scale = Math.min(boxW / image.width, boxH / image.height, 1);
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

const roundButton =
  "flex size-11 items-center justify-center rounded-full bg-inverse/10 text-inverse transition-colors hover:bg-inverse/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse";

/**
 * Full-screen photo viewer on a native modal <dialog>: the page behind is inert (focus stays
 * inside), Escape closes it. Arrow keys, the side buttons, the thumbnail strip and horizontal
 * swipes move between images (wrapping round); the image is sized from its known dimensions so
 * nothing jumps while it loads. onClose receives the index last shown so the caller can return
 * focus to its tile.
 *
 * With `panel` (the post the photos belong to: author, text, reactions and comments link) the
 * viewer works like Facebook's: the post sits beside the photo on wide screens, and in a sheet over
 * the bottom of the photo on phones (collapsed to a few lines; tap to read it all, or hide it).
 * Each photo's own description (alt text), when the author wrote one, shows under the post.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
  panel,
}: {
  images: AttachmentView[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: (lastIndex: number) => void;
  /** The post these photos belong to, shown as the caption (see above). */
  panel?: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef(index);
  const onCloseRef = useRef(onClose);
  const [showCaption, setShowCaption] = useState(true);
  /** Phones: the post sheet shows a few lines until opened. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const viewport = useViewport();
  const wide = viewport.width >= WIDE;

  useEffect(() => {
    indexRef.current = index;
    onCloseRef.current = onClose;
  });

  const count = images.length;
  const multiple = count > 1;
  const image = images[index]!;
  const alt = imageAlt(image, index, count);
  const authored = hasAuthorAlt(image);
  const size = fitSize(image, viewport, multiple, !!panel && wide);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeButton.current?.focus();
    // Lock page scroll; pad the body by the scrollbar's width so the page behind doesn't shift.
    const root = document.documentElement;
    const body = document.body;
    const scrollbar = window.innerWidth - root.clientWidth;
    const previous = { overflow: root.style.overflow, padding: body.style.paddingRight };
    root.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previous.overflow;
      body.style.paddingRight = previous.padding;
    };
  }, []);

  // Keep the current thumbnail in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  // Warm the neighbours so stepping through is instant.
  useEffect(() => {
    if (!multiple) return;
    for (const offset of [1, -1]) {
      const neighbour = images[(index + offset + count) % count];
      if (neighbour) new window.Image().src = neighbour.url;
    }
  }, [images, index, count, multiple]);

  function step(delta: number) {
    if (!multiple) return;
    onIndexChange((index + delta + count) % count);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "Home" && multiple) onIndexChange(0);
    else if (event.key === "End" && multiple) onIndexChange(count - 1);
    else return;
    event.preventDefault();
  }

  function onTouchStart(event: TouchEvent) {
    const t = event.touches[0];
    touch.current = t && event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touch.current;
    const t = event.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }

  const close = () => ref.current?.close();

  const description = authored ? (
    <p id={`${id}-caption`} dir="auto" className="text-sm text-body">
      <span className="font-medium text-ink">{t("Photo description")}: </span>
      {alt}
    </p>
  ) : null;

  const thumbnails = multiple && (
    <div ref={strip} className="flex h-[72px] shrink-0 items-center justify-center overflow-x-auto px-3" role="group" aria-label={t("All photos in this post")}>
      <div className="flex gap-2 py-2">
        {images.map((thumb, i) => (
          <button
            key={thumb.id}
            type="button"
            data-index={i}
            onClick={() => onIndexChange(i)}
            aria-label={t("Show photo {index} of {total}", { index: i + 1, total: count })}
            aria-current={i === index ? "true" : undefined}
            className={cn(
              "size-12 shrink-0 overflow-hidden rounded-md ring-offset-2 ring-offset-ink transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse",
              i === index ? "opacity-100 ring-2 ring-inverse" : "opacity-50 hover:opacity-90",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
            <img src={thumb.url} alt="" className="size-full object-cover" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <dialog
      ref={ref}
      aria-label={multiple ? t("Photo viewer, {count} photos", { count }) : "Photo viewer"}
      onClose={() => onCloseRef.current(indexRef.current)}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-inverse backdrop:bg-ink/95"
    >
      <div className="flex size-full bg-ink">
        <div className="relative flex min-w-0 flex-1 flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* Top bar */}
          <div className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-3 px-4 max-sm:px-3">
            <p className="min-w-16 text-sm font-medium tabular-nums text-inverse/90">
              {multiple && (
                <>
                  <span aria-hidden="true">
                    {index + 1} / {count}
                  </span>
                  <span className="sr-only">
                    <T vars={{ count: index + 1, count2: count }}>{"Photo {count} of {count2}"}</T>
                  </span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {!panel && authored && (
                <button
                  type="button"
                  aria-pressed={showCaption}
                  aria-controls={`${id}-caption`}
                  onClick={() => setShowCaption((v) => !v)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse",
                    showCaption ? "border border-inverse bg-inverse text-ink" : "border border-inverse/40 text-inverse hover:border-inverse",
                  )}
                >
                  ALT
                  <span className="sr-only">{showCaption ? ": hide image description" : ": show image description"}</span>
                </button>
              )}
              <a
                href={image.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center gap-1.5 rounded-full bg-inverse/10 px-3 text-sm font-medium text-inverse transition-colors hover:bg-inverse/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse"
              >
                <Icon name="external" size={16} />
                <span className="max-sm:sr-only">Open original</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button ref={closeButton} type="button" onClick={close} aria-label="Close photo viewer" className={roundButton}>
                <Icon name="x" size={22} />
              </button>
            </div>
          </div>

          {/* Stage: clicking the empty area around the image closes the viewer. */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center"
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
            <img
              key={image.id}
              src={image.url}
              alt={alt}
              width={size?.width ?? image.width ?? undefined}
              height={size?.height ?? image.height ?? undefined}
              style={size ? { width: size.width, height: size.height } : undefined}
              className={cn(
                "select-none rounded-md bg-inverse/5 object-contain",
                !size && "h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-[calc(100vw-1.5rem)]",
              )}
              draggable={false}
            />

            {multiple && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={t("Previous photo ({index} of {total})", { index: ((index - 1 + count) % count) + 1, total: count })}
                  className={cn(roundButton, "absolute start-4 top-1/2 -translate-y-1/2 max-sm:start-2")}
                >
                  <Icon name="chevron-left" size={24} />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t("Next photo ({index} of {total})", { index: ((index + 1) % count) + 1, total: count })}
                  className={cn(roundButton, "absolute end-4 top-1/2 -translate-y-1/2 max-sm:end-2")}
                >
                  <Icon name="chevron-right" size={24} />
                </button>
              </>
            )}
          </div>

          {thumbnails}

          {panel ? (
            // Phones and tablets: the post in a sheet over the bottom of the photo.
            !wide && (
              <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col rounded-t-2xl bg-card text-ink shadow-[0_-8px_28px_rgba(0,0,0,0.35)]">
                <button
                  type="button"
                  aria-expanded={sheetOpen}
                  onClick={() => setSheetOpen((v) => !v)}
                  className="flex shrink-0 flex-col items-center gap-1 pt-2 pb-1 text-xs font-medium text-secondary"
                >
                  <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-strong" />
                  {sheetOpen ? t("Show less") : t("Show the post")}
                </button>
                <div className={cn("flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4", !sheetOpen && "max-h-[7.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}>
                  {panel}
                  {description}
                </div>
              </div>
            )
          ) : (
            // No post (e.g. a photo in a message): the photo's description in a strip under it.
            <div className="relative z-10 flex h-16 shrink-0 items-center justify-center px-4">
              {authored && (
                <p id={`${id}-caption`} hidden={!showCaption} dir="auto" className="line-clamp-3 max-h-full max-w-2xl overflow-y-auto text-center text-sm text-inverse">
                  {alt}
                </p>
              )}
            </div>
          )}
        </div>

        {panel && wide && (
          // Wide screens: the post beside the photo, like Facebook's photo viewer.
          <aside aria-label={t("The post")} className="flex h-full shrink-0 flex-col gap-4 overflow-y-auto border-s border-line bg-card p-5 text-ink" style={{ width: PANEL }}>
            {panel}
            {description}
          </aside>
        )}

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {multiple ? t("Photo {count} of {count2}.", { count: index + 1, count2: count }) : ""}
          {alt}
        </p>
      </div>
    </dialog>
  );
}
