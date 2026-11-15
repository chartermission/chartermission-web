import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { loadPreviewInfo, previewMetadata } from "@/lib/link-preview";

/*
 * What link-preview bots (WhatsApp, LinkedIn, X, Slack, Telegram…) are shown instead of a page that
 * needs a sign-in. The proxy sends only those bots here; people always get the real page. The API
 * decides what may be shown (GET /public/preview): a member's photo, a post's picture, a chapter's
 * cover, an event's cover, a page's logo. A link with no picture of its own gets a generated card
 * (/brand/card) with its kind and title, so no two links share one image.
 */

type Props = { searchParams: Promise<{ path?: string | string[] }> };

async function load(searchParams: Props["searchParams"]) {
  const raw = (await searchParams).path;
  const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return { path, info: await loadPreviewInfo(path) };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { path, info } = await load(searchParams);
  return previewMetadata(path, info);
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
