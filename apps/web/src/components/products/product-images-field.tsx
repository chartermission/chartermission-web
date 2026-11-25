"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PRODUCT_MAX_IMAGES, UPLOAD_LIMITS } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { errorMessage } from "@/components/social/errors";
import { uploadFile } from "@/lib/upload";
import { useT } from "@/i18n/client";

export type ProductImage = {
  key: string;
  /** Set once the upload is clean (or, for saved pictures, read from the URL). */
  fileId: string | null;
  url: string | null;
  status: "uploading" | "ready" | "rejected";
  progress: number;
  error: string | null;
};

let seq = 0;
const nextKey = () => `img-${++seq}`;

export function imagesFromProduct(product: { imageUrls: string[]; imageFileIds: string[] } | undefined): ProductImage[] {
  if (!product) return [];
  return product.imageUrls.map((url, i) => ({ key: nextKey(), fileId: product.imageFileIds[i] ?? null, url, status: "ready", progress: 1, error: null }));
}

/**
 * Up to PRODUCT_MAX_IMAGES product pictures (product_image uploads), in order: the first is shown on
 * the product's card. Each file is uploaded and scanned as soon as it is picked.
 */
export function ProductImagesField({ id, value, onChange }: { id?: string; value: ProductImage[]; onChange: (update: (current: ProductImage[]) => ProductImage[]) => void }) {
  const t = useT();
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const input = useRef<HTMLInputElement>(null);
  const blobs = useRef(new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  const live = value.filter((image) => image.status !== "rejected");
  const room = PRODUCT_MAX_IMAGES - live.length;

  useEffect(() => {
    const created = blobs.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = (key: string, change: Partial<ProductImage>) => onChange((current) => current.map((image) => (image.key === key ? { ...image, ...change } : image)));

  function add(files: File[]) {
    setNotice(null);
    const accepted = files.slice(0, Math.max(0, room));
    if (accepted.length < files.length) setNotice(t("You can add up to {max} pictures.", { max: PRODUCT_MAX_IMAGES }));
    const added = accepted.map((file) => {
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (url) blobs.current.add(url);
      return { file, image: { key: nextKey(), fileId: null, url, status: "uploading", progress: 0, error: null } satisfies ProductImage };
    });
    onChange((current) => [...current, ...added.map((a) => a.image)]);
    for (const { file, image } of added) {
      uploadFile(file, "product_image", (fraction) => patch(image.key, { progress: Math.min(fraction, 0.99) }))
        .then((view) => patch(image.key, { status: "ready", fileId: view.id, progress: 1 }))
        .catch((e: unknown) => patch(image.key, { status: "rejected", error: errorMessage(e) }));
    }
  }

  function remove(key: string) {
    onChange((current) => current.filter((image) => image.key !== key));
    setNotice(null);
  }

  function moveEarlier(index: number) {
    onChange((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index - 1, 0, item!);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <span id={`${inputId}-label`} className="text-sm font-medium text-ink">
          Pictures
        </span>
        <span className="text-xs text-secondary">{t("{count} of {max}", { count: live.length, max: PRODUCT_MAX_IMAGES })}</span>
      </div>
      {value.length > 0 && (
        <ul aria-labelledby={`${inputId}-label`} className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {value.map((image, index) => (
            <li key={image.key} className="flex flex-col gap-1">
              <div className={cn("relative aspect-square overflow-hidden rounded-lg border bg-muted", image.status === "rejected" ? "border-error" : "border-line")}>
                {image.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview or permission-checked API media
                  <img src={image.url} alt="" className={cn("h-full w-full object-cover", image.status !== "ready" && "opacity-50")} />
                )}
                {index === 0 && image.status === "ready" && (
                  <span className="absolute start-1.5 top-1.5 rounded-full bg-primary-dark/80 px-2 py-0.5 text-[11px] font-medium text-inverse">Cover</span>
                )}
                {image.status === "uploading" && (
                  <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-card/70" aria-hidden="true">
                    <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(image.progress * 100)}%` }} />
                  </span>
                )}
                <div className="absolute end-1 top-1 flex gap-1">
                  {index > 0 && image.status === "ready" && (
                    <button
                      type="button"
                      onClick={() => moveEarlier(index)}
                      aria-label={t("Move picture {number} earlier", { number: index + 1 })}
                      className="flex size-7 items-center justify-center rounded-full bg-card/90 text-ink shadow hover:bg-card"
                    >
                      <Icon name="chevron-left" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(image.key)}
                    aria-label={t("Remove picture {number}", { number: index + 1 })}
                    className="flex size-7 items-center justify-center rounded-full bg-card/90 text-ink shadow hover:bg-card hover:text-error"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
              </div>
              <span aria-live="polite" className="text-[11px] leading-tight empty:hidden">
                {image.status === "uploading" && <span className="text-secondary">{image.progress >= 0.99 ? t("Checking…") : t("Uploading…")}</span>}
                {image.status === "rejected" && <span className="text-error">{image.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={UPLOAD_LIMITS.product_image.mimes.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) add(files);
          }}
        />
        <Button variant="secondary" size="small" disabled={room <= 0} onClick={() => input.current?.click()} aria-describedby={`${inputId}-hint`}>
          <Icon name="image" size={16} />
          Add pictures
        </Button>
      </div>
      <p id={`${inputId}-hint`} className="text-xs text-secondary">
        JPEG, PNG or WebP, up to 8 MB each. The first picture is the one people see first.
      </p>
      {notice && (
        <p role="status" className="text-xs text-warning">
          {notice}
        </p>
      )}
    </div>
  );
}
