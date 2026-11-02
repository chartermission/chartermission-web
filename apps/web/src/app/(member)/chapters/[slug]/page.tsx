import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar, Icon, MemberCard, Panel, chipClasses, type IconName } from "@chartermission/ui";
import { ChapterComposer, InviteButton, MembershipToggle } from "@/components/chapters/chapter-actions";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { FeedList } from "@/components/feed-list";
import { InitiativeTile, toInitiativeSummary } from "@/components/initiatives/initiative-tile";
import { DateBadge } from "@/components/right-rail";
import { chapters, getChapter, type Chapter } from "@/lib/mock/chapters";
import { initiatives } from "@/lib/mock/initiatives";
import { viewer } from "@/lib/mock-data";

export function generateStaticParams() {
  return chapters.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/chapters/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const chapter = getChapter(slug);
  return chapter ? { title: chapter.name, description: chapter.about } : {};
}

const numberFormat = new Intl.NumberFormat("en-GB");

/** Chapter page — Figma "Web / Chapter page" (node 18:2157; header 18:2210, body 18:2263). */
export default function ChapterPage({ params }: PageProps<"/chapters/[slug]">) {
  // params are URL data: read them inside Suspense so the App Shell stays shareable.
  return (
    <Suspense fallback={<ChapterSkeleton />}>
      <ChapterDetail params={params} />
    </Suspense>
  );
}

function ChapterSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading chapter…</span>
      <div className="h-[175px] bg-gradient-to-r from-primary-dark to-primary-light" />
      <div className="mx-auto flex w-full max-w-[1240px] gap-6 px-4 pb-12 pt-6">
        <div className="h-[420px] flex-1 animate-pulse rounded-card border border-line bg-card" />
        <div className="hidden h-[420px] w-[400px] animate-pulse rounded-card border border-line bg-card lg:block" />
      </div>
    </div>
  );
}

async function ChapterDetail({ params }: Pick<PageProps<"/chapters/[slug]">, "params">) {
  const { slug } = await params;
  const chapter = getChapter(slug);
  if (!chapter) notFound();

  const chapterInitiatives = initiatives.filter((initiative) => initiative.chapter?.slug === chapter.slug);
  const meta: { icon: IconName; label: string }[] = [
    { icon: "map-pin", label: chapter.location },
    { icon: "users", label: `${numberFormat.format(chapter.members)} members` },
    { icon: "calendar", label: chapter.meets },
  ];
  const tabs = [
    { value: "feed", label: "Feed" },
    { value: "events", label: `Events (${chapter.events.length})` },
    { value: "members", label: "Members" },
    { value: "initiatives", label: `Initiatives (${chapter.initiativesCount})` },
    { value: "about", label: "About" },
  ];

  return (
    <Tabs values={tabs.map((tab) => tab.value)} defaultValue="feed">
      <header className="bg-gradient-to-r from-primary-dark to-primary-light">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-10">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-5">
              <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-card text-primary">
                <Icon name="globe" size={40} />
              </span>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-h1 text-inverse">{chapter.name}</h1>
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {meta.map((item) => (
                    <li key={item.icon} className="flex items-center gap-1.5 text-sm text-primary-tint">
                      <Icon name={item.icon} size={16} />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MembershipToggle chapterName={chapter.name} />
              <InviteButton slug={chapter.slug} />
            </div>
          </div>
          <TabList label={`${chapter.name} sections`} tabs={tabs} tone="inverse" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start gap-6 px-4 pb-12 pt-6 lg:flex-row">
        <main id="main" className="flex w-full min-w-0 flex-1 flex-col">
          <TabPanel value="feed">
            <h2 className="sr-only">Chapter feed</h2>
            <ChapterComposer chapterName={chapter.name} viewerName={viewer.name} />
            <FeedList posts={chapter.posts} />
          </TabPanel>
          <TabPanel value="events">
            <EventsPanel chapter={chapter} />
          </TabPanel>
          <TabPanel value="members">
            <h2 className="sr-only">Members</h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {chapter.memberPreview.map((member) => (
                <li key={member.handle} className="flex">
                  <MemberCard {...member} href={`/members/${member.handle}`} linkAs={Link} />
                </li>
              ))}
            </ul>
          </TabPanel>
          <TabPanel value="initiatives">
            <h2 className="sr-only">Initiatives</h2>
            {chapterInitiatives.map((initiative) => (
              <InitiativeTile key={initiative.slug} initiative={toInitiativeSummary(initiative)} />
            ))}
            <Link href="/initiatives" className="self-start text-sm font-medium text-primary-light hover:underline">
              Browse all initiatives
            </Link>
          </TabPanel>
          <TabPanel value="about">
            <Panel aria-labelledby="about-heading" className="flex flex-col gap-3 p-5">
              <h2 id="about-heading" className="text-h3 text-ink">
                About {chapter.name}
              </h2>
              <p className="text-md text-body">{chapter.about}</p>
              <p className="flex items-center gap-1.5 text-sm text-secondary">
                <Icon name="calendar" size={16} />
                {chapter.meets}
              </p>
            </Panel>
          </TabPanel>
        </main>

        <aside aria-label="Chapter details" className="flex w-full shrink-0 flex-col gap-4 lg:w-[400px]">
          <Panel aria-labelledby="chapter-team-heading" className="flex flex-col gap-3 p-5">
            <h2 id="chapter-team-heading" className="text-h3 text-ink">
              Chapter team
            </h2>
            <ul className="flex flex-col gap-3">
              {chapter.team.map((member) => (
                <li key={member.handle} className="flex items-center gap-2.5">
                  <Avatar name={member.name} size={32} tone={member.tone} />
                  <Link href={`/members/${member.handle}`} className="group flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-ink group-hover:underline">{member.name}</span>
                    <span className="text-xs text-secondary">{member.role}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel aria-labelledby="chapter-events-heading" className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="chapter-events-heading" className="text-h3 text-ink">
                Upcoming chapter events
              </h2>
              <a href="#events" className="text-sm font-medium text-primary-light hover:underline">
                See all
              </a>
            </div>
            <EventRows events={chapter.events.slice(0, 2)} />
          </Panel>

          <Panel aria-labelledby="chapter-stats-heading" className="flex flex-col gap-2.5 p-5">
            <h2 id="chapter-stats-heading" className="text-h3 text-ink">
              This month
            </h2>
            <dl className="flex flex-col gap-2.5">
              {chapter.stats.map((stat) => (
                <div key={stat.label} className="flex justify-between gap-3 text-sm">
                  <dt className="text-secondary">{stat.label}</dt>
                  <dd className="font-medium text-ink">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel aria-labelledby="nearby-heading" className="flex flex-col gap-2.5 p-5">
            <h2 id="nearby-heading" className="text-h3 text-ink">
              Nearby chapters
            </h2>
            <ul className="flex flex-wrap gap-2">
              {chapter.nearby.map((nearby) => (
                <li key={nearby.name}>
                  {nearby.slug ? (
                    <Link href={`/chapters/${nearby.slug}`} className={chipClasses("filter", "hover:border-line-strong hover:text-ink")}>
                      {nearby.name}
                    </Link>
                  ) : (
                    <span className={chipClasses("filter")}>{nearby.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </Tabs>
  );
}

function EventRows({ events }: { events: Chapter["events"] }) {
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.slug}>
          <Link href={`/events/${event.slug}`} className="group flex items-center gap-3">
            <DateBadge month={event.month} day={event.day} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink group-hover:underline">{event.title}</span>
              <span className="text-xs text-secondary">{event.meta}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EventsPanel({ chapter }: { chapter: Chapter }) {
  return (
    <Panel aria-labelledby="all-events-heading" className="flex flex-col gap-3 p-5">
      <h2 id="all-events-heading" className="text-h3 text-ink">
        Chapter events
      </h2>
      <EventRows events={chapter.events} />
    </Panel>
  );
}
