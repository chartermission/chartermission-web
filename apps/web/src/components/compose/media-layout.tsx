"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { AttachmentView, MediaLayout } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { ImageCarousel } from "@/components/gallery/image-carousel";
import { ImageGrid } from "@/components/gallery/image-grid";

/** A small picture of each layout, drawn in the current text colour. */
const glyphs: Record<MediaLayout, ReactNode> = {
  collage: (
    <>
      <rect x="1" y="1" width="11" height="14" rx="1.5" />
      <rect x="13.5" y="1" width="7.5" height="6.25" rx="1.5" />
      <rect x="13.5" y="8.75" width="7.5" height="6.25" rx="1.5" />
    </>
  ),
  carousel: (
    <>
      <rect x="5" y="1" width="12" height="11" rx="1.5" />
      <rect x="0" y="2.5" width="3.5" height="8" rx="1" opacity="0.45" />
      <rect x="18.5" y="2.5" width="3.5" height="8" rx="1" opacity="0.45" />
      <circle cx="8" cy="14.5" r="1" />
      <circle cx="11" cy="14.5" r="1" opacity="0.45" />
      <circle cx="14" cy="14.5" r="1" opacity="0.45" />
    </>
  ),
  grid: (
    <>
      <rect x="1" y="1" width="6" height="6.25" rx="1.25" />
      <rect x="8" y="1" width="6" height="6.25" rx="1.25" />
      <rect x="15" y="1" width="6" height="6.25" rx="1.25" />
      <rect x="1" y="8.75" width="6" height="6.25" rx="1.25" />
      <rect x="8" y="8.75" width="6" height="6.25" rx="1.25" />
      <rect x="15" y="8.75" width="6" height="6.25" rx="1.25" />
    </>
  ),
};

export const mediaLayouts: { value: MediaLayout; label: string; hint: string }[] = [
  { value: "collage", label: "Collage", hint: "One large photo with smaller ones around it. Any extra photos open in the viewer." },
  { value: "carousel", label: "Carousel", hint: "One photo at a time. People swipe through them in your order." },
  { value: "grid", label: "Grid", hint: "Even square tiles. Any extra photos open in the viewer." },
];

/** How a post's photos are laid out: a radio group of the layouts (arrow keys move between them) with a line on the chosen one. */
export function MediaLayoutPicker({ id, value, onChange }: { id: string; value: MediaLayout; onChange: (layout: MediaLayout) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = mediaLayouts.find((layout) => layout.value === value) ?? mediaLayouts[0]!;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = mediaLayouts.findIndex((layout) => layout.value === value);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (at + step + mediaLayouts.length) % mediaLayouts.length;
    onChange(mediaLayouts[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="text-xs font-medium text-body">
        Photo layout
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="grid grid-cols-3 gap-1 rounded-[10px] bg-muted p-1">
        {mediaLayouts.map((layout, index) => {
          const checked = layout.value === chosen.value;
          return (
            <button
              key={layout.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(layout.value)}
              onKeyDown={onKeyDown}
              className={cn(
                "flex min-w-0 items-center justify-center gap-2 rounded-[7px] px-2 py-1.5 text-sm transition-colors",
                checked ? "bg-card font-medium text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
              )}
            >
              <svg viewBox="0 0 22 16" width="22" height="16" fill="currentColor" aria-hidden="true" className={cn("shrink-0", checked && "text-accent")}>
                {glyphs[layout.value]}
              </svg>
              <span className="truncate">{layout.label}</span>
            </button>
          );
        })}
      </div>
      <p id={`${id}-hint`} className="text-xs text-secondary">
        {chosen.hint}
      </p>
    </div>
  );
}

/** The photos as the post will show them, in the chosen layout (nothing opens from here). */
export function MediaLayoutPreview({ images, layout }: { images: AttachmentView[]; layout: MediaLayout }) {
  if (images.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-body">Preview</p>
      {layout === "carousel" ? <ImageCarousel images={images} interactive={false} /> : <ImageGrid images={images} layout={layout} interactive={false} />}
    </div>
  );
}
