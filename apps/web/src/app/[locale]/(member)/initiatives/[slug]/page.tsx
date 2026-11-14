import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import type { InitiativeDetail, Page, PostView } from "@chartermission/contracts";
import { Chip, Icon, chipClasses } from "@chartermission/ui";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { InitiativeHeaderActions } from "@/components/initiatives/initiative-header-actions";
import {
  AboutPanel,
  HostPanel,
  HowJoiningWorks,
  Milestones,
  RelatedOpportunities,
  RolesNeeded,
  TeamPanel,
} from "@/components/initiatives/initiative-sections";
import { InitiativeUpdates } from "@/components/initiatives/initiative-updates";
import { JoinRequestProvider } from "@/components/initiatives/join-request";
import { hostHref, hostName, initiativeStatusMeta } from "@/components/initiatives/format";
import { requireClientViewer, settle } from "@/components/social/data";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { NoTranslate } from "@/i18n/auto";
import { getIntlTag, getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/initiatives/[slug]">;

const UPDATES_PAGE = 10;
const getInitiative = cache((slug: string) => apiGetOrNull<InitiativeDetail>(`/initiatives/${encodeURIComponent(slug)}`));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const initiative = await getInitiative(slug).catch(() => null);
  return initiative ? { title: initiative.title, description: initiative.summary } : {};
}

/** Initiative detail — Figma "Web / Initiative detail" (node 18:1849, content 18:1902). */
export default function InitiativePage({ params }: Props) {
  // params are URL data: read them inside Suspense so the App Shell stays shareable.
  return (
    <Suspense fallback={<InitiativeSkeleton />}>
      <InitiativeDetailView params={params} />
    </Suspense>
  );
}

function InitiativeSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-6 pb-12">
      <span className="sr-only">Loading initiative…</span>
      <div className="h-[18px] w-48 rounded bg-muted" />
      <div className="h-[360px] w-full animate-pulse rounded-2xl border border-line bg-card" />
      <div className="flex gap-6">
        <div className="h-[420px] flex-1 animate-pulse rounded-card border border-line bg-card" />
        <div className="hidden h-[300px] w-[380px] animate-pulse rounded-card border border-line bg-card lg:block" />
      </div>
    </div>
  );
}

async function InitiativeDetailView({ params }: Pick<Props, "params">) {
  const t = await getT();
  const intl = await getIntlTag();
  const { slug } = await params;
  const viewer = await requireClientViewer(`/initiatives/${slug}`);
  const initiative = await getInitiative(slug);
  if (!initiative) notFound();
  const updates = await settle(apiGet<Page<PostView>>("/feed", { initiative: initiative.id, limit: String(UPDATES_PAGE) }));

  const number = new Intl.NumberFormat(intl);
  const status = initiativeStatusMeta[initiative.status];
  const { viewer: me } = initiative;
  const canApply = initiative.status === "recruiting" && !me.member && !me.canManage && me.request?.status !== "pending";
  const stats = [
    { value: number.format(initiative.teamCount), label: "on the team" },
    { value: t("{done} of {total}", { done: initiative.milestones.done, total: initiative.milestones.total }), label: "milestones" },
    { value: number.format(initiative.countryCount), label: initiative.countryCount === 1 ? "country represented" : "countries represented" },
    { value: number.format(initiative.followerCount), label: initiative.followerCount === 1 ? "follower" : "followers" },
  ];
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "updates", label: t("Updates ({count})", { count: initiative.updatesCount }) },
    { value: "milestones", label: "Milestones" },
    { value: "people", label: t("People ({count})", { count: initiative.teamCount }) },
  ];

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-6 pb-12">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1.5 text-sm">
          <li className="flex items-center gap-1.5">
            <Link href="/initiatives" className="text-primary-light hover:underline">
              Initiatives
            </Link>
            <Icon name="chevron-right" size={14} className="text-disabled rtl:rotate-180" />
          </li>
          <li aria-current="page" className="truncate text-secondary">
            <NoTranslate>{initiative.title}</NoTranslate>
          </li>
        </ol>
      </nav>

      {initiative.moderationState && (
        <p role="status" className="flex items-start gap-2.5 rounded-[10px] bg-warning-light p-3.5 text-sm text-ink">
          <Icon name="eye-off" size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>
            <span className="font-medium">{initiative.moderationState === "removed" ? "This initiative was removed by a moderator." : "This initiative is hidden by a moderator."}</span>{" "}
            Only its organisers and the moderation team can see it. Members can’t find it, ask to join or follow it.
          </span>
        </p>
      )}

      <JoinRequestProvider
        initiative={{ id: initiative.id, title: initiative.title, leadName: initiative.lead.name, roles: initiative.openRoles }}
        pending={me.request?.status === "pending"}
      >
        <section aria-labelledby="initiative-title" className="overflow-hidden rounded-2xl border border-line bg-card">
          {initiative.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded cover of any size
            <img src={initiative.coverUrl} alt="" className="h-40 w-full object-cover max-sm:h-28" />
          ) : (
            <div aria-hidden="true" className="h-40 bg-gradient-to-r from-primary-dark via-primary-light via-60% to-accent max-sm:h-24" />
          )}
          <div className="flex flex-wrap items-end justify-between gap-6 px-7 pt-6 pb-7 max-sm:px-4">
            <div className="flex min-w-0 flex-1 basis-[480px] flex-col gap-2.5">
              <div className="flex flex-wrap gap-2">
                {initiative.theme && <Chip>{initiative.theme.name}</Chip>}
                <Chip tone={status.tone}>{status.label}</Chip>
                {initiative.country && <Chip tone="filter">{initiative.country.name}</Chip>}
                {initiative.host.type !== "member" && (
                  <Link href={hostHref(initiative.host)} className={chipClasses("info", "hover:underline")}>
                    {hostName(initiative.host)}
                  </Link>
                )}
              </div>
              <h1 id="initiative-title" className="text-h1 text-ink">
                <NoTranslate>{initiative.title}</NoTranslate>
              </h1>
              <p className="max-w-[840px] text-md text-body">
                <NoTranslate>{initiative.summary}</NoTranslate>
              </p>
              <dl className="flex flex-wrap gap-x-7 gap-y-3 pt-1.5">
                {stats.map((stat) => (
                  <div key={stat.label} className="flex flex-col-reverse">
                    <dt className="text-xs text-secondary">{stat.label}</dt>
                    <dd className="text-h3 text-ink">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <InitiativeHeaderActions initiative={initiative} viewerId={viewer.id} />
          </div>
        </section>

        <Tabs values={tabs.map((tab) => tab.value)} defaultValue="overview">
          <TabList label={t("{title} sections", { title: initiative.title })} tabs={tabs} />

          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col">
              <TabPanel value="overview">
                <AboutPanel description={initiative.description} />
                {initiative.roles.length > 0 && <RolesNeeded initiative={initiative} canApply={canApply} />}
                <Milestones milestones={initiative.milestoneList} headingId="overview-milestones" />
              </TabPanel>
              <TabPanel value="updates">
                <InitiativeUpdates
                  initiative={{ id: initiative.id, slug: initiative.slug, title: initiative.title, leadName: initiative.lead.name }}
                  initial={updates.ok ? updates.data : undefined}
                  viewer={viewer}
                  canPost={me.canManage && !initiative.moderationState}
                  limit={UPDATES_PAGE}
                />
              </TabPanel>
              <TabPanel value="milestones">
                <Milestones milestones={initiative.milestoneList} headingId="tab-milestones" />
              </TabPanel>
              <TabPanel value="people">
                <TeamPanel team={initiative.team} total={initiative.teamCount} headingId="people-heading" />
              </TabPanel>
            </div>

            <aside aria-label="About this initiative" className="flex w-full shrink-0 flex-col gap-4 lg:w-[380px]">
              <TeamPanel team={initiative.team.slice(0, 5)} total={initiative.teamCount} seeAllHref="#people" headingId="team-heading" />
              <HostPanel initiative={initiative} />
              {initiative.status === "recruiting" && !me.member && <HowJoiningWorks />}
              <RelatedOpportunities items={initiative.related} />
            </aside>
          </div>
        </Tabs>
      </JoinRequestProvider>
      <Toaster />
    </main>
  );
}
