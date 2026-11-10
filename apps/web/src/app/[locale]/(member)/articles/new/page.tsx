import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { DraftView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { ArticleWriter } from "@/components/articles/article-writer";
import { articleBlockedReason } from "@/components/articles/article-blocked";
import { requireClientViewer } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull } from "@/lib/api/server";
import { getT, getIntlTag } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Write an article") };
}

type SearchParams = PageProps<"/[locale]/articles/new">["searchParams"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function Writer({ searchParams }: { searchParams: SearchParams }) {
  const intl = await getIntlTag();
  const t = await getT();
  const params = await searchParams;
  const draftId = Array.isArray(params.draft) ? params.draft[0] : params.draft;
  const viewer = await requireClientViewer(draftId ? `/articles/new?draft=${draftId}` : "/articles/new");
  const blocked = articleBlockedReason(intl, t, viewer);
  if (blocked) {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <h1 className="text-h2 text-ink">You can’t publish right now</h1>
        <p className="text-md text-body">{blocked}</p>
        <Link href="/articles" className="text-sm font-medium text-primary-light hover:underline">
          Back to articles
        </Link>
      </Panel>
    );
  }
  let draft: DraftView | undefined;
  if (draftId) {
    const found = UUID.test(draftId) ? await apiGetOrNull<DraftView>(`/drafts/${draftId}`) : null;
    // A draft that was published or deleted in another tab: start from the drafts list instead.
    if (!found) redirect("/drafts");
    draft = found;
  }
  return <ArticleWriter viewer={viewer} draft={draft} />;
}

/** Write an article on its own page (replaces the article tab of the create-post dialog). */
export default function NewArticlePage({ searchParams }: PageProps<"/[locale]/articles/new">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-6 pb-16 pt-6 max-sm:px-3 max-sm:pt-4">
      <Link href="/articles" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Articles
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Opening the editor" />
            <PanelSkeleton className="h-[640px]" lines={8} />
          </>
        }
      >
        <Writer searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </main>
  );
}
