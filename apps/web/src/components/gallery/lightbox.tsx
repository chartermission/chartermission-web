"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import type { AttachmentView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { hasAuthorAlt, imageAlt } from "./image-alt";

/** Space kept clear around the image: the top bar, the caption strip and the side buttons. */
const BAR = 64;
const SIDE_DESKTOP = 80;
const SIDE_MOBILE = 12;
const SWIPE_MIN = 48;

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
function fitSize(image: AttachmentView, viewport: { width: number; height: number }, multiple: boolean) {
  if (!image.width || !image.height) return null;
  const side = viewport.width < 640 || !multiple ? SIDE_MOBILE : SIDE_DESKTOP;
  const boxW = Math.max(120, viewport.width - side * 2);
  const boxH = Math.max(120, viewport.height - BAR * 2);
  const scale = Math.min(boxW / image.width, boxH / image.height, 1);
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

const roundButton =
  "flex size-11 items-center justify-center rounded-full bg-inverse/10 text-inverse transition-colors hover:bg-inverse/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse";

/**
 * Full-screen photo viewer on a native modal <dialog>: the page behind is inert (focus stays
 * inside), Escape closes it. Arrow keys, the side buttons and horizontal swipes move between
 * images (wrapping round); the image is sized from its known dimensions so nothing jumps while
 * it loads. onClose receives the index last shown so the caller can return focus to its tile.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: AttachmentView[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: (lastIndex: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef(index);
  const onCloseRef = useRef(onClose);
  const [showCaption, setShowCaption] = useState(true);
  const viewport = useViewport();

  useEffect(() => {
    indexRef.current = index;
    onCloseRef.current = onClose;
  });

  const count = images.length;
  const multiple = count > 1;
  const image = images[index]!;
  const alt = imageAlt(image, index, count);
  const authored = hasAuthorAlt(image);
  const size = fitSize(image, viewport, multiple);

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

  return (
    <dialog
      ref={ref}
      aria-label={multiple ? `Photo viewer, ${count} photos` : "Photo viewer"}
      onClose={() => onCloseRef.current(indexRef.current)}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-inverse backdrop:bg-ink/95"
    >
      <div className="relative flex size-full flex-col bg-ink" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* Top bar */}
        <div className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-3 px-4 max-sm:px-3">
          <p className="min-w-16 text-sm font-medium tabular-nums text-inverse/90">
            {multiple && (
              <>
                <span aria-hidden="true">
                  {index + 1} / {count}
                </span>
                <span className="sr-only">
                  Photo {index + 1} of {count}
                </span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
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
                aria-label={`Previous photo (${((index - 1 + count) % count) + 1} of ${count})`}
                className={cn(roundButton, "absolute left-4 top-1/2 -translate-y-1/2 max-sm:left-2")}
              >
                <Icon name="chevron-left" size={24} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={`Next photo (${((index + 1) % count) + 1} of ${count})`}
                className={cn(roundButton, "absolute right-4 top-1/2 -translate-y-1/2 max-sm:right-2")}
              >
                <Icon name="chevron-right" size={24} />
              </button>
            </>
          )}
        </div>

        {/* Caption strip: fixed height so toggling it never moves the image. */}
        <div className="relative z-10 flex h-16 shrink-0 items-center justify-center px-4">
          <p
            id={`${id}-caption`}
            hidden={!showCaption}
            className={cn(
              "line-clamp-3 max-h-full max-w-2xl overflow-y-auto text-center text-sm",
              authored ? "text-inverse" : "text-inverse/60",
            )}
          >
            {authored ? alt : "The author didn’t add a description for this photo."}
          </p>
        </div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {multiple ? `Photo ${index + 1} of ${count}. ` : ""}
          {alt}
        </p>
      </div>
    </dialog>
  );
}
