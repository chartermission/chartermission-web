import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InitiativeStatus, type InitiativeSummary, type Page } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { InitiativeDirectory, type DirectoryFilters } from "@/components/initiatives/initiative-directory";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { initiativeOptions } from "./options";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Initiatives"), description: t("Projects members are running across Africa and the diaspora. Join one, or start your own.") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Directory({ searchParams }: { searchParams: PageProps<"/[locale]/initiatives">["searchParams"] }) {
  const t = await getT();
  await requireViewer("/initiatives");
  const params = await searchParams;
  const status = first(params.status);
  const filters: DirectoryFilters = {
    status: InitiativeStatus.safeParse(status).success ? status : "",
    theme: first(params.theme).slice(0, 80),
    country: /^[A-Za-z]{2}$/.test(first(params.country)) ? first(params.country).toUpperCase() : "",
    q: first(params.q).trim().slice(0, 100),
    scope: first(params.scope) === "mine" ? "mine" : "all",
  };
  const query: Record<string, string> = { limit: "20" };
  for (const [k, v] of Object.entries(filters)) if (v && !(k === "scope" && v === "all")) query[k] = v;
  const [result, options] = await Promise.all([settle(apiGet<Page<InitiativeSummary>>("/initiatives", query)), initiativeOptions()]);
  if (!result.ok) return <SectionError message={t("Initiatives couldn’t load. {error}", { error: errorMessage(result.error) })} retryHref="/initiatives" />;
  return <InitiativeDirectory initial={result.data} filters={filters} themes={options.themes} countries={options.countries} />;
}

/** Initiatives directory — Figma "Web / Initiatives" (node 17:1868, content 17:1921). */
export default function InitiativesPage({ searchParams }: PageProps<"/[locale]/initiatives">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pb-12 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-ink">Initiatives</h1>
          <p className="text-md text-secondary">Projects members are running across Africa and the diaspora. Join one, or start your own.</p>
        </div>
        <Link href="/initiatives/new" className={buttonClasses({ variant: "accent" })}>
          Start an initiative
        </Link>
      </header>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading initiatives" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PanelSkeleton className="h-[260px]" lines={4} />
              <PanelSkeleton className="h-[260px]" lines={4} />
            </div>
          </>
        }
      >
        <Directory searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </main>
  );
}
