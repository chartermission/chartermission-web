"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRODUCTS_MAX_PER_PAGE, type PageRef, type ProductView } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Menu, type MenuItem } from "@/components/social/menu";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { productBody } from "./product-body";
import { ProductCard } from "./product-card";
import { ProductDialog } from "./product-dialog";

const byPosition = (a: ProductView, b: ProductView) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);

/**
 * A page's products (GET /pages/{slug}/products). Visitors see the active ones and can enquire;
 * the page's admins add, edit, hide, reorder and delete them here.
 */
export function PageProducts({ page, initial, canManage }: { page: PageRef; initial: ProductView[]; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [products, setProducts] = useState<ProductView[]>(() => [...initial].sort(byPosition));
  const [editing, setEditing] = useState<ProductView | "new" | null>(null);
  const [removing, setRemoving] = useState<ProductView | null>(null);
  const [moving, setMoving] = useState(false);
  const shown = canManage ? products : products.filter((p) => p.active);
  const nextPosition = products.reduce((max, p) => Math.max(max, p.position + 1), 0);
  const full = products.length >= PRODUCTS_MAX_PER_PAGE;

  function saved(product: ProductView) {
    const isNew = editing === "new";
    setProducts((list) => (list.some((p) => p.id === product.id) ? list.map((p) => (p.id === product.id ? product : p)) : [...list, product]).sort(byPosition));
    setEditing(null);
    toast.success(isNew ? t("{name} added", { name: product.name }) : t("{name} saved", { name: product.name }));
    router.refresh();
  }

  /** Moves a product one place and saves the new positions of every product that changed. */
  async function move(index: number, to: number) {
    if (to < 0 || to >= products.length || moving) return;
    const before = products;
    const order = [...products];
    const [item] = order.splice(index, 1);
    order.splice(to, 0, item!);
    const changed = order.map((p, position) => ({ p, position })).filter(({ p, position }) => p.position !== position);
    setProducts(order.map((p, position) => ({ ...p, position })));
    setMoving(true);
    try {
      await Promise.all(changed.map(({ p, position }) => api<ProductView>(`/pages/${page.slug}/products/${p.id}`, { method: "PATCH", body: productBody(p, { position }) })));
    } catch (e) {
      setProducts(before);
      toast.error(e);
      router.refresh();
    } finally {
      setMoving(false);
    }
  }

  async function setActive(product: ProductView, active: boolean) {
    try {
      const next = await api<ProductView>(`/pages/${page.slug}/products/${product.id}`, { method: "PATCH", body: productBody(product, { active }) });
      setProducts((list) => list.map((p) => (p.id === next.id ? next : p)));
      toast.success(active ? t("{name} is shown on the page", { name: product.name }) : t("{name} is hidden", { name: product.name }));
      router.refresh();
    } catch (e) {
      toast.error(e);
    }
  }

  const addButton = !full && (
    <Button size="small" onClick={() => setEditing("new")}>
      <Icon name="plus" size={16} />
      Add product
    </Button>
  );

  return (
    <section aria-labelledby="products-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="products-heading" className={canManage ? "text-h3 text-ink" : "sr-only"}>
          Products
        </h2>
        {canManage && shown.length > 0 && addButton}
      </div>
      {canManage && full && <p className="text-sm text-secondary">{t("A page can list up to {max} products. Delete one to add another.", { max: PRODUCTS_MAX_PER_PAGE })}</p>}

      {shown.length === 0 ? (
        <EmptyState icon="briefcase" title="No products yet" actions={canManage ? addButton : undefined}>
          {canManage ? "Add what you sell, with pictures and a price, so members can enquire about it." : "This page hasn’t listed any products yet."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shown.map((product, index) => {
            const items: MenuItem[] = [
              { label: t("Move up"), onSelect: () => void move(index, index - 1), disabled: index === 0 || moving },
              { label: t("Move down"), onSelect: () => void move(index, index + 1), disabled: index === shown.length - 1 || moving },
              product.active
                ? { label: t("Hide from the page"), icon: "eye-off", onSelect: () => void setActive(product, false) }
                : { label: t("Show on the page"), icon: "eye", onSelect: () => void setActive(product, true) },
              { label: t("Delete"), icon: "trash", danger: true, onSelect: () => setRemoving(product) },
            ];
            return (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  page={page}
                  canEnquire={!canManage}
                  manage={
                    canManage && (
                      <span className="ms-auto flex items-center gap-1">
                        <Button variant="secondary" size="small" onClick={() => setEditing(product)}>
                          <Icon name="edit" size={14} />
                          Edit
                        </Button>
                        <Menu label={t("More actions for {name}", { name: product.name })} items={items} />
                      </span>
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ProductDialog pageSlug={page.slug} product={editing === "new" ? undefined : editing} position={nextPosition} onSaved={saved} onClose={() => setEditing(null)} />
      )}
      {removing && (
        <ConfirmDialog
          title={t("Delete {name}?", { name: removing.name })}
          confirmLabel={t("Delete product")}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/pages/${page.slug}/products/${removing.id}`, { method: "DELETE" });
            setProducts((list) => list.filter((p) => p.id !== removing.id));
            toast.success(t("{name} deleted", { name: removing.name }));
            router.refresh();
          }}
        >
          It’s removed from the page for good. Enquiries already sent about it stay in your list.
        </ConfirmDialog>
      )}
    </section>
  );
}
