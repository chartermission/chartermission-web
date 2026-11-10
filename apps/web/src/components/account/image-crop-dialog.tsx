"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { UPLOAD_LIMITS, type UploadPurpose } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { ApiError } from "@/lib/api/errors";
import { Dialog } from "./dialog";

export type CropShape = "circle" | "rect";

/** Originals can be larger than the upload limit: the crop is re-encoded at a fixed size before upload. */
export const CROP_SOURCE_MAX_BYTES = 25 * 1024 * 1024;

/** Checks a picked image before it opens in the crop editor; throws an ApiError with a member-facing message. */
export function assertCroppable(file: File, purpose: UploadPurpose): void {
  if (!(UPLOAD_LIMITS[purpose].mimes as readonly string[]).includes(file.type)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "Choose a JPEG, PNG or WebP image.");
  }
  if (file.size > CROP_SOURCE_MAX_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Choose an image under 25 MB.");
  }
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const KEY_STEP = 12;

type Offset = { x: number; y: number };

/**
 * Crop editor for profile photos and cover banners: drag to reposition, zoom (slider, wheel, +/-),
 * rotate in 90° steps, reset. The crop happens in the browser; the result is a JPEG of
 * outputWidth × outputHeight that goes through the normal upload (the server re-encodes it).
 */
export function ImageCropDialog({
  file,
  title,
  aspect,
  shape,
  outputWidth,
  onCancel,
  onConfirm,
}: {
  /** The picked image; the dialog is open while this is set. */
  file: File | null;
  title: string;
  /** Width / height of the crop, e.g. 1 for a photo, 4 for a 4:1 banner. */
  aspect: number;
  shape: CropShape;
  outputWidth: number;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const [loaded, setLoaded] = useState<{ file: File; image: HTMLImageElement | null } | null>(null);
  const current = loaded && loaded.file === file ? loaded : null;
  const image = current?.image ?? null;
  const loadError = current !== null && current.image === null;

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    let cancelled = false;
    img.src = url;
    img
      .decode()
      .then(() => !cancelled && setLoaded({ file, image: img }))
      .catch(() => !cancelled && setLoaded({ file, image: null }));
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <Dialog
      open={file !== null}
      onClose={onCancel}
      title={title}
      description="Drag to reposition. Use the slider or scroll to zoom."
      className={aspect > 1.5 ? "max-w-[680px]" : "max-w-[480px]"}
    >
      {loadError ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-error">This image couldn’t be opened. Try a different JPEG, PNG or WebP file.</p>
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      ) : image && file ? (
        <CropEditor
          key={image.src}
          image={image}
          fileName={file.name}
          aspect={aspect}
          shape={shape}
          outputWidth={outputWidth}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-secondary">Opening your image…</div>
      )}
    </Dialog>
  );
}

function CropEditor({
  image,
  fileName,
  aspect,
  shape,
  outputWidth,
  onCancel,
  onConfirm,
}: {
  image: HTMLImageElement;
  fileName: string;
  aspect: number;
  shape: CropShape;
  outputWidth: number;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const sliderId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; from: Offset } | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const frameHeight = frameWidth / aspect;
  const quarterTurn = rotation % 180 !== 0;
  const naturalW = image.naturalWidth;
  const naturalH = image.naturalHeight;
  const rotatedW = quarterTurn ? naturalH : naturalW;
  const rotatedH = quarterTurn ? naturalW : naturalH;
  const baseScale = frameWidth > 0 ? Math.max(frameWidth / rotatedW, frameHeight / rotatedH) : 0;
  const scale = baseScale * zoom;

  const clamp = useCallback(
    (next: Offset, z = zoom, rot = rotation): Offset => {
      const turned = rot % 180 !== 0;
      const rw = turned ? naturalH : naturalW;
      const rh = turned ? naturalW : naturalH;
      const s = Math.max(frameWidth / rw, frameHeight / rh) * z;
      const maxX = Math.max(0, (rw * s - frameWidth) / 2);
      const maxY = Math.max(0, (rh * s - frameHeight) / 2);
      return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
    },
    [frameWidth, frameHeight, naturalW, naturalH, zoom, rotation],
  );

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** The stored offset may be stale after a resize; what's shown (and saved) is always within bounds. */
  const shown = clamp(offset);

  function setZoomClamped(z: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    setZoom(next);
    setOffset((o) => clamp(o, next));
  }

  function rotate() {
    const next = (rotation + 90) % 360;
    setRotation(next);
    setOffset((o) => clamp({ x: o.y * -1, y: o.x }, zoom, next));
  }

  function reset() {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, from: shown };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    setOffset(clamp({ x: d.from.x + event.clientX - d.startX, y: d.from.y + event.clientY - d.startY }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, Offset> = {
      ArrowLeft: { x: KEY_STEP, y: 0 },
      ArrowRight: { x: -KEY_STEP, y: 0 },
      ArrowUp: { x: 0, y: KEY_STEP },
      ArrowDown: { x: 0, y: -KEY_STEP },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setOffset(clamp({ x: shown.x + move.x, y: shown.y + move.y }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoomClamped(zoom + 0.1);
    } else if (event.key === "-") {
      event.preventDefault();
      setZoomClamped(zoom - 0.1);
    }
  }

  // Wheel zoom needs a non-passive listener to stop the dialog from scrolling.
  useEffect(() => {
    const el = frame.current?.parentElement;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-event.deltaY * 0.0015)));
        setOffset((o) => clamp(o, next));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp]);

  async function save() {
    if (!frameWidth) return;
    setSaving(true);
    setSaveError(null);
    try {
      const outW = outputWidth;
      const outH = Math.round(outputWidth / aspect);
      const k = outW / frameWidth;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = "high";
      ctx.translate(outW / 2 + shown.x * k, outH / 2 + shown.y * k);
      ctx.rotate((rotation * Math.PI) / 180);
      const w = naturalW * scale * k;
      const h = naturalH * scale * k;
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("no blob");
      const base = fileName.replace(/\.[^.]+$/, "") || "photo";
      onConfirm(new File([blob], `${base}.jpg`, { type: "image/jpeg" }));
    } catch {
      setSaveError("The photo couldn’t be prepared. Try again or choose a different image.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="touch-none overflow-hidden rounded-lg bg-ink p-6 select-none max-sm:p-4">
        <div
          ref={frame}
          role="application"
          aria-label="Crop area. Use the arrow keys to move the image, and plus or minus to zoom."
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={cn(
            "relative mx-auto w-full cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-light",
            shape === "circle" && "max-w-[320px]",
          )}
          style={{ aspectRatio: String(aspect) }}
        >
          {frameWidth > 0 && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL being cropped
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: naturalW * scale,
                height: naturalH * scale,
                transform: `translate(-50%, -50%) translate(${shown.x}px, ${shown.y}px) rotate(${rotation}deg)`,
              }}
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]",
              shape === "circle" ? "rounded-full" : "rounded-sm",
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={sliderId} className="text-sm font-medium text-ink">
          Zoom
        </label>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoomClamped(zoom - 0.25)}
          disabled={zoom <= MIN_ZOOM}
          className="size-8 rounded-md text-lg leading-none text-secondary hover:bg-muted hover:text-ink disabled:opacity-40"
        >
          −
        </button>
        <input
          id={sliderId}
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoomClamped(Number(e.target.value))}
          className="min-w-[120px] flex-1 accent-primary"
        />
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoomClamped(zoom + 0.25)}
          disabled={zoom >= MAX_ZOOM}
          className="size-8 rounded-md text-lg leading-none text-secondary hover:bg-muted hover:text-ink disabled:opacity-40"
        >
          +
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={rotate} disabled={saving}>
            Rotate
          </Button>
          <Button variant="ghost" size="small" onClick={reset} disabled={saving || (zoom === 1 && rotation === 0 && shown.x === 0 && shown.y === 0)}>
            Reset
          </Button>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !frameWidth}>
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </div>
      </div>
      {saveError && <p className="text-xs text-error">{saveError}</p>}
    </div>
  );
}
