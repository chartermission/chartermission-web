import type { Metadata } from "next";
import type { LinkPreviewInfo } from "@chartermission/contracts";
import { apiGetOrNull } from "@/lib/api/server";
import { SHARE_IMAGE } from "@/lib/share-image";

/*
 * Share-preview metadata (Open Graph and X cards) for a site path, from what the API allows to be
 * shown about it (GET /public/preview): used by the link-preview page that bots get, and by pages
 * that also want full previews for crawlers the proxy doesn't recognise (posts).
 */

export const SITE_URL = process.env.NEXT_PUBLIC_WEB_URL || "https://chartermission.com";

export async function loadPreviewInfo(path: string): Promise<LinkPreviewInfo | null> {
  if (path === "/") return null;
  return apiGetOrNull<LinkPreviewInfo>("/public/preview", { path }).catch(() => null);
}

const absolute = (image: string) => (/^https?:\/\//.test(image) ? image : `${SITE_URL}/api/v1${image}`);

/** What a link is, for the generated card shown when it has no picture of its own. */
function kindOf(path: string): string {
  const first = path.split("/")[1] ?? "";
  const kinds: Record<string, string> = {
    chapters: "Chapter",
    events: "Event",
    pages: "Page",
    opportunities: "Opportunity",
    posts: "Post",
    articles: "Article",
    initiatives: "Initiative",
  };
  return kinds[first] ?? "Member";
}

/** A card generated for this link (brand, kind, title, detail), so no two links share one image. */
function generatedCard(path: string, info: LinkPreviewInfo) {
  const query = new URLSearchParams({
    kind: kindOf(path),
    title: info.title.replace(/ · Charter Mission$/, ""),
    detail: info.description.slice(0, 160),
  });
  return { url: `${SITE_URL}/brand/card?${query.toString()}`, width: 1200, height: 630, alt: info.title, type: "image/png" };
}

/** Metadata for a shared link: its title, summary and picture (or the logo when there's nothing to show). */
export function previewMetadata(path: string, info: LinkPreviewInfo | null): Metadata {
  const url = `${SITE_URL}${path}`;
  if (!info)
    return {
      title: { absolute: "Charter Mission" },
      openGraph: { url, siteName: "Charter Mission", images: [SHARE_IMAGE] },
      twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
    };
  const images = info.image ? [{ url: absolute(info.image), alt: info.title, type: "image/jpeg" }] : [generatedCard(path, info)];
  return {
    title: { absolute: info.title },
    description: info.description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: "Charter Mission", url, title: info.title, description: info.description, images },
    twitter: { card: "summary_large_image", title: info.title, description: info.description, images: images.map((i) => i.url) },
  };
}
