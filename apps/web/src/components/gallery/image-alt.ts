import type { AttachmentView } from "@chartermission/contracts";

/** The author's description, or a generic one that still says where the image sits in the set. */
export function imageAlt(image: Pick<AttachmentView, "alt">, index: number, count: number): string {
  const alt = image.alt?.trim();
  if (alt) return alt;
  return count > 1 ? `Photo ${index + 1} of ${count} attached to this post` : "Photo attached to this post";
}

/** True when the author wrote a description (the lightbox caption says so otherwise). */
export function hasAuthorAlt(image: Pick<AttachmentView, "alt">): boolean {
  return Boolean(image.alt?.trim());
}
