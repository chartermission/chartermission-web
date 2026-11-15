import type { ProductInput, ProductView } from "@chartermission/contracts";

/** The whole product as a PATCH body (the form, reorder and show/hide always send every field). */
export function productBody(product: ProductView, change: Partial<ProductInput> = {}): ProductInput {
  return {
    name: product.name,
    description: product.description,
    price: product.price,
    imageFileIds: product.imageFileIds,
    link: product.link,
    active: product.active,
    position: product.position,
    ...change,
  };
}
