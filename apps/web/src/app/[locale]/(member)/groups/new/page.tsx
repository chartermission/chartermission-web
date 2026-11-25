import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ChapterDetail, EventHostOptions, ManagedPage, MyAmbassadorView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { GroupForm, type OwnerOption } from "@/components/groups/group-form";
import { settle } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Create a group") };
}

type Search = PageProps<"/[locale]/groups/new">["searchParams"];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() || undefined;
const SLUG = /^[a-z0-9-]{2,80}$/;

/**
 * Who the member may create a group for: live pages they manage, chapters they lead (and staff
 * with event rights: every chapter), the chapter they are an Ambassador of, and a chapter they
 * came from (?chapter=) when they are on its team.
 */
async function ownerOptions(t: Awaited<ReturnType<typeof getT>>, chapterSlug: string | undefined): Promise<OwnerOption[]> {
  const [pages, hosts, ambassador] = await Promise.all([
    settle(apiGet<ManagedPage[]>("/me/pages")),
    settle(apiGet<EventHostOptions>("/events/host-options")),
    settle(apiGet<MyAmbassadorView>("/ambassadors/me")),
  ]);
  const chapters = new Map<string, { id: string; slug: string; name: string; countryCode: string }>();
  if (hosts.ok) for (const chapter of hosts.data.chapters) chapters.set(chapter.slug, chapter);
  // Chapters the member may be on the team of without leading them: check each one's own answer.
  const candidates = new Set<string>();
  if (chapterSlug && SLUG.test(chapterSlug)) candidates.add(chapterSlug);
  if (ambassador.ok && ambassador.data.status === "ambassador" && ambassador.data.chapter) candidates.add(ambassador.data.chapter.slug);
  const extra = await Promise.all(
    [...candidates].filter((slug) => !chapters.has(slug)).map((slug) => apiGetOrNull<ChapterDetail>(`/chapters/${slug}`).catch(() => null)),
  );
  for (const chapter of extra) if (chapter?.viewer.canManage) chapters.set(chapter.slug, chapter);
  return [
    ...(pages.ok ? pages.data.filter((p) => p.status === "active") : []).map(
      (page): OwnerOption => ({ type: "page", id: page.id, slug: page.slug, name: page.name, logoUrl: page.logoUrl, note: t("The page’s admins run it with you.") }),
    ),
    ...[...chapters.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((chapter): OwnerOption => ({ type: "chapter", id: chapter.id, slug: chapter.slug, name: chapter.name, countryCode: chapter.countryCode, note: t("The chapter team runs it with you.") })),
  ];
}

async function NewGroup({ searchParams }: { searchParams: Search }) {
  const t = await getT();
  const viewer = await requireViewer("/groups/new");
  const sp = await searchParams;
  const pageSlug = first(sp.page);
  const chapterSlug = first(sp.chapter);
  if (!viewer.emailVerified) {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <h1 className="text-h2 text-ink">Verify your email first</h1>
        <p className="text-md text-body">Confirm your email address, then come back to create a group.</p>
      </Panel>
    );
  }
  const [owners, taxonomies] = await Promise.all([ownerOptions(t, chapterSlug), getTaxonomies()]);
  const presetOwner = owners.find((o) => (o.type === "page" && o.slug === pageSlug) || (o.type === "chapter" && o.slug === chapterSlug));
  const preset = presetOwner ? `${presetOwner.type}:${presetOwner.id}` : undefined;

  return (
    <Panel className="flex flex-col gap-5 p-6 max-sm:p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Create a group</h1>
        <p className="text-md text-secondary">A group is a place for members to talk about a shared interest. You can add admins and moderators once it’s created.</p>
      </div>
      <GroupForm owners={owners} preset={preset} countries={groupCountries(taxonomies.countries)} />
    </Panel>
  );
}

export default function NewGroupPage({ searchParams }: PageProps<"/[locale]/groups/new">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Link href="/groups" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
        Groups
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the form" />
            <PanelSkeleton className="h-[560px]" lines={8} />
          </>
        }
      >
        <NewGroup searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </main>
  );
}
