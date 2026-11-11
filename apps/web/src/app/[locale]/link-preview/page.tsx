import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { LinkPreviewInfo } from "@chartermission/contracts";
import { apiGetOrNull } from "@/lib/api/server";
import { SHARE_IMAGE } from "@/lib/share-image";

/*
 * What link-preview bots (WhatsApp, LinkedIn, X, Slack, Telegram…) are shown instead of a page that
 * needs a sign-in. The proxy sends only those bots here; people always get the real page. The API
 * decides what may be shown (GET /public/preview): a member's photo, a post's picture, a chapter's
 * cover, an event's cover, a page's logo. A link with no picture of its own gets a generated card
 * (/brand/card) with its kind and title, so no two links share one image.
 */

const SITE_URL =
  process.env.NEXT_PUBLIC_WEB_URL || "https://chartermission.com";

type Props = { searchParams: Promise<{ path?: string | string[] }> };

async function load(searchParams: Props["searchParams"]) {
  const raw = (await searchParams).path;
  const path =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
      ? raw
      : "/";
  const info =
    path === "/"
      ? null
      : await apiGetOrNull<LinkPreviewInfo>("/public/preview", { path }).catch(
          () => null,
        );
  return { path, info };
}

const absolute = (image: string) =>
  /^https?:\/\//.test(image) ? image : `${SITE_URL}/api/v1${image}`;

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
  return {
    url: `${SITE_URL}/brand/card?${query.toString()}`,
    width: 1200,
    height: 630,
    alt: info.title,
  };
}

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const { path, info } = await load(searchParams);
  const url = `${SITE_URL}${path}`;
  if (!info)
    return {
      title: { absolute: "Charter Mission" },
      openGraph: { url, siteName: "Charter Mission", images: [SHARE_IMAGE] },
      twitter: { card: "summary_large_image" },
    };
  const images = info.image
    ? [{ url: absolute(info.image), alt: info.title }]
    : [generatedCard(path, info)];
  return {
    title: { absolute: info.title },
    description: info.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Charter Mission",
      url,
      title: info.title,
      description: info.description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: info.title,
      description: info.description,
      images: images.map((i) => i.url),
    },
  };
}

export default function LinkPreviewPage({ searchParams }: Props) {
  return (
    <Suspense>
      <Preview searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ searchParams }: Props) {
  const { path, info } = await load(searchParams);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-16">
      <h1 className="text-h2 text-ink">{info?.title ?? "Charter Mission"}</h1>
      {info?.description && <p className="text-body">{info.description}</p>}
      <Link href={path} className="text-primary underline">
        {"Open on Charter Mission"}
      </Link>
    </main>
  );
}
