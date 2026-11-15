"use client";

import { useState, type ReactNode } from "react";
import type { PageRef, ProductView } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { EnquiryButton } from "@/components/pages/enquiry-dialog";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

/** The product's pictures: a large one and, when there are more, small thumbnails to switch. */
function ProductGallery({ name, urls }: { name: string; urls: string[] }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const current = urls[Math.min(index, urls.length - 1)];
  if (!current) {
    return (
      <div aria-hidden="true" className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-disabled">
        <Icon name="image" size={32} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
      <img src={current} alt={urls.length > 1 ? t("{name}, picture {number} of {total}", { name, number: index + 1, total: urls.length }) : name} className="aspect-[4/3] w-full bg-muted object-cover" />
      {urls.length > 1 && (
        <div className="flex gap-1.5 px-3">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t("Show picture {number} of {total}", { number: i + 1, total: urls.length })}
              aria-pressed={i === index}
              className={cn("size-11 shrink-0 overflow-hidden rounded-md border-2", i === index ? "border-primary" : "border-transparent opacity-80 hover:opacity-100")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One product on a page: pictures, name, price (or "Price on request"), a short description, and
 * Enquire / Visit site. `manage` holds the admin controls, when the viewer runs the page.
 */
export function ProductCard({ product, page, canEnquire, manage }: { product: ProductView; page: PageRef; canEnquire: boolean; manage?: ReactNode }) {
  return (
    <article aria-labelledby={`product-${product.id}`} className={cn("flex h-full flex-col overflow-hidden rounded-card border border-line bg-card", !product.active && "border-dashed")}>
      <ProductGallery name={product.name} urls={product.imageUrls} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 id={`product-${product.id}`} className="min-w-0 text-md font-semibold text-ink">
            <NoTranslate>{product.name}</NoTranslate>
          </h3>
          {!product.active && (
            <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
              Hidden
            </Chip>
          )}
        </div>
        <p className="text-sm font-medium text-primary">{product.price ? <NoTranslate>{product.price}</NoTranslate> : "Price on request"}</p>
        {product.description && (
          <p className="line-clamp-3 whitespace-pre-line text-sm text-body">
            <NoTranslate>{product.description}</NoTranslate>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {canEnquire && <EnquiryButton page={page} about={{ type: "product", id: product.id, title: product.name }} />}
          {product.link && (
            <a href={product.link} target="_blank" rel="noopener noreferrer nofollow" className={buttonClasses({ variant: "ghost", size: "small" })}>
              Visit site
              <Icon name="external" size={14} />
            </a>
          )}
          {manage}
        </div>
      </div>
    </article>
  );
}
