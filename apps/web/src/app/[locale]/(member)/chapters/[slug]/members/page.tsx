import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type {
  ChapterDetail,
  DirectoryMember,
  Page,
} from "@chartermission/contracts";
import { ChapterAvatar, Icon, Panel } from "@chartermission/ui";
import { ChapterMemberDirectory } from "@/components/chapters/chapter-member-directory";
import { InvitePeopleButton } from "@/components/invite/invite-dialog";
import { requireClientViewer } from "@/components/social/data";
import { AuthorName, MemberAvatar } from "@/components/social/post-parts";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/chapters/[slug]/members">): Promise<Metadata> {
  const { slug } = await params;
  const chapter = await apiGetOrNull<ChapterDetail>(
    `/chapters/${encodeURIComponent(slug.toLowerCase())}`,
  ).catch(() => null);
  return { title: chapter ? `Members · ${chapter.name}` : "Chapter members" };
}

/** A chapter's members on a page of their own: the chapter team first, then everyone, searchable. */
export default function ChapterMembersPage({
  params,
}: PageProps<"/[locale]/chapters/[slug]/members">) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          className="mx-auto h-[480px] w-full max-w-[1240px] animate-pulse px-4 pt-6"
        />
      }
    >
      <MembersView params={params} />
    </Suspense>
  );
}

async function MembersView({
  params,
}: Pick<PageProps<"/[locale]/chapters/[slug]/members">, "params">) {
  const t = await getT();
  const slug = (await params).slug.toLowerCase();
  const viewer = await requireClientViewer(`/chapters/${slug}/members`);
  const chapter = await apiGetOrNull<ChapterDetail>(
    `/chapters/${encodeURIComponent(slug)}`,
  );
  if (!chapter) notFound();
  const initial = await apiGet<Page<DirectoryMember>>("/members", {
    chapter: chapter.slug,
    sort: "name",
    limit: 24,
  }).catch(() => ({ items: [], nextCursor: null }) as Page<DirectoryMember>);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-6 pb-12">
      <Link
        href={`/chapters/${chapter.slug}`}
        className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
      >
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        {t("Back to {name}", { name: chapter.name })}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ChapterAvatar
            name={chapter.name}
            countryCode={chapter.countryCode}
            src={chapter.imageUrl}
            size={64}
            className="rounded-2xl"
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 text-ink">
              {t("{name} members", { name: chapter.name })}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-secondary">
              <Icon name="users" size={16} />
              {t("{count} members", { count: chapter.counts.followers })}
            </p>
          </div>
        </div>
        <InvitePeopleButton
          inviterHandle={viewer.handle}
          chapter={{ slug: chapter.slug, name: chapter.name }}
        />
      </header>

      {chapter.team.length > 0 && (
        <section
          aria-labelledby="chapter-team-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="chapter-team-heading" className="text-h3 text-ink">
            {t("Chapter team")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {chapter.team.map(({ member, label }) => (
              <li key={member.id}>
                <Panel className="flex h-full items-center gap-3 p-4">
                  <MemberAvatar member={member} link />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <AuthorName member={member} />
                    <p className="truncate text-xs font-medium text-primary-light">
                      {t(label)}
                    </p>
                    {member.headline && (
                      <p className="truncate text-xs text-secondary">
                        {member.headline}
                      </p>
                    )}
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ChapterMemberDirectory slug={chapter.slug} initial={initial} />
    </div>
  );
}
