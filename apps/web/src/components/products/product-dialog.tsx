"use client";

import { useId, useState, type FormEvent } from "react";
import { PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX, PRODUCT_PRICE_MAX, ProductInput, type ProductView } from "@chartermission/contracts";
import { Button, buttonClasses } from "@chartermission/ui";
import { Checkbox, Field, inputClasses } from "@/components/auth/fields";
import { withScheme } from "@/components/pages/page-ref";
import { closeDialog, Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { api, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { ProductImagesField, imagesFromProduct, type ProductImage } from "./product-images-field";

/** Add a product to a page, or edit one (POST / PATCH /pages/{slug}/products). */
export function ProductDialog({
  pageSlug,
  product,
  position,
  onSaved,
  onClose,
}: {
  pageSlug: string;
  /** Leave out to add a new product. */
  product?: ProductView;
  /** Where a new product goes in the list. */
  position: number;
  onSaved: (product: ProductView) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [link, setLink] = useState(product?.link ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [images, setImages] = useState<ProductImage[]>(() => imagesFromProduct(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const uploading = images.some((image) => image.status === "uploading");
  const fid = (key: string) => `${id}-${key}`;

  function clear(key: string) {
    if (errors[key])
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (uploading) return;
    const body = {
      name,
      description: description.trim(),
      price: price.trim() || null,
      imageFileIds: images.filter((image) => image.status === "ready" && image.fileId).map((image) => image.fileId!),
      link: withScheme(link),
      active,
      position: product?.position ?? position,
    };
    const parsed = ProductInput.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      document.getElementById(fid(Object.keys(next)[0] ?? "name"))?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = product
        ? await api<ProductView>(`/pages/${pageSlug}/products/${product.id}`, { method: "PATCH", body: parsed.data })
        : await api<ProductView>(`/pages/${pageSlug}/products`, { method: "POST", body: parsed.data });
      onSaved(saved);
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) {
        setErrors(e.fields);
        document.getElementById(fid(Object.keys(e.fields)[0] ?? "name"))?.focus();
      } else setError(e);
    }
  }

  const counter = (n: number, max: number) => (
    <span className="text-xs text-secondary">
      {n} / {max}
    </span>
  );

  return (
    <Dialog
      title={product ? t("Edit product") : t("Add a product")}
      description="Members see it in the page’s Products tab and can enquire about it."
      onClose={onClose}
      width={600}
      initialFocus="[data-first]"
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={(event) => closeDialog(event.currentTarget)}>
            Cancel
          </button>
          <Button type="submit" form={fid("form")} disabled={busy || uploading}>
            {busy ? "Saving…" : uploading ? "Uploading pictures…" : product ? "Save changes" : "Add product"}
          </Button>
        </>
      }
    >
      <form id={fid("form")} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Field id={fid("name")} label="Name" hint={counter(name.length, PRODUCT_NAME_MAX)} error={errors.name}>
          <input
            id={fid("name")}
            data-first
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clear("name");
            }}
            maxLength={PRODUCT_NAME_MAX}
            placeholder="e.g. Dried hibiscus, 25 kg bags"
            aria-invalid={errors.name ? true : undefined}
            className={inputClasses(!!errors.name)}
          />
        </Field>
        <Field id={fid("price")} label="Price (optional)" hint={counter(price.length, PRODUCT_PRICE_MAX)} error={errors.price}>
          <input
            id={fid("price")}
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              clear("price");
            }}
            maxLength={PRODUCT_PRICE_MAX}
            placeholder="e.g. USD 25 / kg or From $1,200"
            aria-invalid={errors.price ? true : undefined}
            aria-describedby={fid("price-hint")}
            className={inputClasses(!!errors.price)}
          />
          <p id={fid("price-hint")} className="text-xs text-secondary">
            Leave it empty to show “Price on request”.
          </p>
        </Field>
        <Field id={fid("description")} label="Description (optional)" hint={counter(description.length, PRODUCT_DESCRIPTION_MAX)} error={errors.description}>
          <textarea
            id={fid("description")}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              clear("description");
            }}
            maxLength={PRODUCT_DESCRIPTION_MAX}
            rows={5}
            placeholder="What it is, who it’s for, minimum orders and delivery"
            aria-invalid={errors.description ? true : undefined}
            className={inputClasses(!!errors.description, "h-auto resize-y py-2.5")}
          />
        </Field>
        <Field id={fid("link")} label="Link (optional)" error={errors.link}>
          <input
            id={fid("link")}
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
              clear("link");
            }}
            inputMode="url"
            maxLength={500}
            placeholder="https://"
            aria-invalid={errors.link ? true : undefined}
            aria-describedby={fid("link-hint")}
            className={inputClasses(!!errors.link)}
          />
          <p id={fid("link-hint")} className="text-xs text-secondary">
            Where to buy it or read more, on your own site.
          </p>
        </Field>
        <ProductImagesField
          id={fid("imageFileIds")}
          value={images}
          onChange={(update) => {
            setImages(update);
            clear("imageFileIds");
          }}
        />
        {errors.imageFileIds && <p className="-mt-2 text-xs text-error">{errors.imageFileIds}</p>}
        <div className="flex flex-col gap-1">
          <Checkbox name="active" checked={active} onChange={(event) => setActive(event.target.checked)}>
            <span className="text-ink">Show on the page</span>
          </Checkbox>
          <p className="ps-[26px] text-xs text-secondary">Untick to hide it from members for now. Only the page’s admins see hidden products.</p>
        </div>
        <div aria-live="polite" className="empty:hidden">
          {error ? <ErrorNotice error={error} /> : null}
        </div>
      </form>
    </Dialog>
  );
}
