import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type {
  ChapterDetail,
  EventSummary,
  MemberRef,
  Page,
  PostView,
} from "@chartermission/contracts";
import {
  ChapterAvatar,
  ChapterCover,
  Icon,
  Panel,
  buttonClasses,
  chipClasses,
  type IconName,
} from "@chartermission/ui";
import {
  ChapterAbout,
  ChapterFeed,
  ChapterMembers,
  JoinChapterButton,
} from "@/components/chapters/chapter-actions";
import { InvitePeopleButton } from "@/components/invite/invite-dialog";
import { ChapterReview } from "@/components/chapters/chapter-moderation";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { EventRow } from "@/components/events/event-cards";
import { RailEventList } from "@/components/events/rail-events";
import { requireClientViewer } from "@/components/social/data";
import { AuthorName, MemberAvatar } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { T } from "@/i18n/client";
import { getT } from "@/i18n/server";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/chapters/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const chapter = await apiGetOrNull<ChapterDetail>(
    `/chapters/${encodeURIComponent(slug.toLowerCase())}`,
  ).catch(() => null);
  return chapter
    ? { title: chapter.name, description: chapter.about ?? undefined }
    : { title: "Chapter" };
}

const EMPTY: Page<never> = { items: [], nextCursor: null };

/** Chapter page — Figma "Web / Chapter page" (node 18:2157), on GET /chapters/{slug}. */
export default function ChapterPage({
  params,
}: PageProps<"/[locale]/chapters/[slug]">) {
  // params are URL data: read them inside Suspense so the App Shell stays shareable.
  return (
    <Suspense fallback={<ChapterSkeleton />}>
      <ChapterView params={params} />
    </Suspense>
  );
}

function ChapterSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading chapter…</span>
      <div className="h-[175px] animate-pulse border-b border-line bg-card" />
      <div className="mx-auto flex w-full max-w-[1240px] gap-6 px-4 pb-12 pt-6">
        <div className="h-[420px] flex-1 animate-pulse rounded-card border border-line bg-card" />
        <div className="hidden h-[420px] w-[400px] animate-pulse rounded-card border border-line bg-card lg:block" />
      </div>
    </div>
  );
}

async function ChapterView({
  params,
}: Pick<PageProps<"/[locale]/chapters/[slug]">, "params">) {
  const t = await getT();
  const slug = (await params).slug.toLowerCase();
  const viewer = await requireClientViewer(`/chapters/${slug}`);
  const chapter = await apiGetOrNull<ChapterDetail>(
    `/chapters/${encodeURIComponent(slug)}`,
  );
  if (!chapter) notFound();

  const [feed, members, events] = await Promise.all([
    apiGet<Page<PostView>>("/feed", {
      tab: "latest",
      chapter: chapter.slug,
    }).catch(() => EMPTY as Page<PostView>),
    apiGet<Page<MemberRef>>(`/chapters/${chapter.slug}/members`).catch(
      () => EMPTY as Page<MemberRef>,
    ),
    apiGet<Page<EventSummary>>("/events", {
      chapter: chapter.slug,
      when: "upcoming",
      limit: 12,
    }).catch(() => EMPTY as Page<EventSummary>),
  ]);
  const hostedHere = events.items.filter(
    (e) => e.host.type === "chapter" && e.host.chapter.id === chapter.id,
  );

  const meta: { icon: IconName; label: string; href?: string }[] = [
    { icon: "map-pin", label: chapter.countryName },
    {
      icon: "users",
      label: t("{count} members", { count: chapter.counts.followers }),
      href: `/chapters/${chapter.slug}/members`,
    },
    {
      icon: "calendar",
      label: t("{count} upcoming events", {
        count: chapter.counts.upcomingEvents,
      }),
    },
  ];
  const tabs = [
    { value: "feed", label: "Feed" },
    {
      value: "events",
      label: t("Events ({count})", { count: hostedHere.length }),
    },
    { value: "members", label: "Members" },
    { value: "about", label: "About" },
    // The chapter team's queue of posts waiting for approval.
    ...(chapter.viewer.canManage
      ? [
          {
            value: "review",
            label: chapter.moderation?.pendingPosts
              ? t("Review ({count})", {
                  count: chapter.moderation.pendingPosts,
                })
              : "Review",
          },
        ]
      : []),
  ];

  return (
    <Tabs values={tabs.map((tab) => tab.value)} defaultValue="feed">
      <header className="border-b border-line bg-card">
        <div className="mx-auto w-full max-w-[1240px] px-4 max-sm:px-0">
          <div className="relative aspect-[4/1] max-h-[300px] w-full overflow-hidden rounded-b-2xl max-sm:rounded-none">
            <ChapterCover
              name={chapter.name}
              countryCode={chapter.countryCode}
              src={chapter.coverUrl}
              photo={chapter.photo}
            />
            {!chapter.coverUrl && chapter.photo?.credit && (
              <a
                href={chapter.photo.creditUrl ?? "https://unsplash.com"}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute end-2 bottom-2.5 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white/90 hover:bg-black/65 hover:text-white max-sm:bottom-2"
              >
                <T vars={{ credit: chapter.photo.credit }}>
                  {"Photo: {credit} / Unsplash"}
                </T>
              </a>
            )}
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-5">
              <ChapterAvatar
                name={chapter.name}
                countryCode={chapter.countryCode}
                src={chapter.imageUrl}
                size={88}
                className="relative z-10 -mt-14 rounded-2xl border-4 border-card bg-card shadow-[0_2px_10px_rgb(15_42_42/0.12)] max-sm:-mt-10 max-sm:size-[72px]"
              />
              <div className="flex flex-col gap-1.5">
                <h1 className="text-h1 text-ink">{chapter.name}</h1>
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {meta.map((item) => (
                    <li
                      key={item.icon}
                      className="flex items-center gap-1.5 text-sm text-secondary"
                    >
                      <Icon name={item.icon} size={16} />
                      {item.href ? (
                        <Link
                          href={item.href}
                          className="rounded-sm hover:text-primary hover:underline"
                        >
                          {item.label}
                        </Link>
                      ) : (
                        item.label
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <JoinChapterButton
                chapter={chapter}
                following={chapter.viewer.following}
                banned={chapter.viewer.banned}
              />
              <InvitePeopleButton
                inviterHandle={viewer.handle}
                chapter={{ slug: chapter.slug, name: chapter.name }}
              />
            </div>
          </div>
          <TabList
            label={t("{name} sections", { name: chapter.name })}
            tabs={tabs}
          />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start gap-6 px-4 pb-12 pt-6 lg:flex-row">
        <main id="main" className="flex w-full min-w-0 flex-1 flex-col">
          <TabPanel value="feed">
            <ChapterFeed chapter={chapter} viewer={viewer} initial={feed} />
          </TabPanel>
          <TabPanel value="events">
            <Panel
              aria-labelledby="all-events-heading"
              className="flex flex-col gap-4 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="all-events-heading" className="text-h3 text-ink">
                  Upcoming chapter events
                </h2>
                <Link
                  href="/events/new"
                  className={buttonClasses({
                    variant: chapter.viewer.canHostAsChapter
                      ? "primary"
                      : "secondary",
                    size: "small",
                  })}
                >
                  <Icon name="plus" size={16} />
                  {chapter.viewer.canHostAsChapter
                    ? "Host a chapter event"
                    : "Propose an event"}
                </Link>
              </div>
              {hostedHere.length ? (
                <ul className="flex flex-col divide-y divide-line">
                  {hostedHere.map((event) => (
                    <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                      <EventRow event={event} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="calendar" title="No upcoming events">
                  {chapter.viewer.canHostAsChapter
                    ? "Host one for the chapter: it’s reviewed by the Charter Mission team before it’s listed."
                    : "Have an idea for a meetup? Propose an event and the team will review it."}
                </EmptyState>
              )}
              <Link
                href={`/events?chapter=${chapter.slug}`}
                className="self-start text-sm font-medium text-primary-light hover:underline"
              >
                <T vars={{ name: chapter.name }}>{"See all {name} events"}</T>
              </Link>
            </Panel>
          </TabPanel>
          <TabPanel value="members">
            <h2 className="sr-only">Members</h2>
            <Link
              href={`/chapters/${chapter.slug}/members`}
              className="mb-4 flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
            >
              <Icon name="users" size={16} />
              {t("See all members, search and connect")}
              <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
            </Link>
            <ChapterMembers
              slug={chapter.slug}
              name={chapter.name}
              initial={members}
              canManage={chapter.viewer.canManage}
              viewerId={viewer.id}
              teamIds={chapter.team.map((m) => m.member.id)}
            />
          </TabPanel>
          {chapter.viewer.canManage && (
            <TabPanel value="review">
              <h2 className="sr-only">Review</h2>
              <ChapterReview
                chapter={{ slug: chapter.slug, name: chapter.name }}
                viewer={viewer}
              />
            </TabPanel>
          )}
          <TabPanel value="about">
            <ChapterAbout
              slug={chapter.slug}
              name={chapter.name}
              about={chapter.about}
              hashtag={chapter.hashtag}
              canEdit={chapter.viewer.canManage}
            />
          </TabPanel>
        </main>

        <aside
          aria-label="Chapter details"
          className="flex w-full shrink-0 flex-col gap-4 lg:w-[400px]"
        >
          <Panel
            aria-labelledby="chapter-team-heading"
            className="flex flex-col gap-3 p-5"
          >
            <h2 id="chapter-team-heading" className="text-h3 text-ink">
              Chapter team
            </h2>
            {chapter.team.length ? (
              <ul className="flex flex-col gap-3">
                {chapter.team.map(({ member, label }) => (
                  <li key={member.id} className="flex items-center gap-2.5">
                    <MemberAvatar member={member} size={32} link />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <AuthorName member={member} className="text-sm" />
                      <span className="text-xs text-secondary">{label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">
                This chapter doesn’t have an Ambassador yet.{" "}
                <Link
                  href="/ambassadors"
                  className="font-medium text-primary-light hover:underline"
                >
                  Become one
                </Link>
              </p>
            )}
          </Panel>

          <Panel
            aria-labelledby="chapter-events-heading"
            className="flex flex-col gap-3 p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="chapter-events-heading" className="text-h3 text-ink">
                Upcoming events
              </h2>
              <Link
                href={`/events?chapter=${chapter.slug}`}
                className="text-sm font-medium text-primary-light hover:underline"
              >
                See all
              </Link>
            </div>
            {hostedHere.length ? (
              <RailEventList events={hostedHere.slice(0, 3)} />
            ) : (
              <p className="text-sm text-secondary">No events scheduled yet.</p>
            )}
          </Panel>

          {chapter.nearby.length > 0 && (
            <Panel
              aria-labelledby="nearby-heading"
              className="flex flex-col gap-2.5 p-5"
            >
              <h2 id="nearby-heading" className="text-h3 text-ink">
                Nearby chapters
              </h2>
              <ul className="flex flex-wrap gap-2">
                {chapter.nearby.map((nearby) => (
                  <li key={nearby.id}>
                    <Link
                      href={`/chapters/${nearby.slug}`}
                      className={chipClasses(
                        "filter",
                        "hover:border-line-strong hover:text-ink",
                      )}
                    >
                      {nearby.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </Tabs>
  );
}
