import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ManagedPage, Page, PagesSettings, PageSummary } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { PageCard } from "@/components/pages/page-card";
import { PageDirectory } from "@/components/pages/page-directory";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Pages"),
    description: t("Organisations, companies and initiatives on Charter Mission. Follow a page to see its updates in your feed."),
  };
}

/** "Create a page", unless the platform keeps page creation to staff. */
async function CreateAction() {
  await requireViewer("/pages");
  const settings = await apiGet<PagesSettings>("/pages/settings").catch(() => null);
  if (settings?.memberCreation === "closed") return null;
  return (
    <Link href="/pages/new" className={buttonClasses()}>
      <Icon name="plus" size={18} />
      Create a page
    </Link>
  );
}

async function PagesMain() {
  await requireViewer("/pages");
  const [mine, all] = await Promise.all([settle(apiGet<ManagedPage[]>("/me/pages")), settle(apiGet<Page<PageSummary>>("/pages", { limit: 24 }))]);
  if (!all.ok) return <SectionError message={errorMessage(all.error)} retryHref="/pages" />;
  return (
    <>
      {mine.ok && mine.data.length > 0 && (
        <section aria-labelledby="your-pages" className="flex flex-col gap-3">
          <h2 id="your-pages" className="text-h3 text-ink">
            Pages you manage
          </h2>
          <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {mine.data.map((page) => (
              <li key={page.id}>
                <PageCard page={page} role={page.role} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="all-pages" className="flex flex-col gap-3">
        <h2 id="all-pages" className="text-h3 text-ink">
          {mine.ok && mine.data.length > 0 ? "All pages" : "Find pages to follow"}
        </h2>
        <PageDirectory initial={all.data} />
      </section>
    </>
  );
}

/** Pages: organisations, companies and initiatives members can follow. */
export default function PagesIndex() {
  return (
    <PageShell>
      <PageHeader
        title="Pages"
        description="Organisations, companies and initiatives. Follow a page to see its updates in your feed."
        actions={
          <Suspense fallback={null}>
            <CreateAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading pages" />
            <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {Array.from({ length: 6 }, (_, i) => (
                <PanelSkeleton key={i} className="h-[168px]" lines={3} />
              ))}
            </div>
          </>
        }
      >
        <PagesMain />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
