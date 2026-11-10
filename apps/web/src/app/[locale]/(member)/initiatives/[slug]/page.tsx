import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Chip, Icon, chipClasses } from "@chartermission/ui";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { FollowButton, ShareButton } from "@/components/initiatives/initiative-actions";
import {
  HowJoiningWorks,
  Milestones,
  RelatedOpportunities,
  RolesNeeded,
  TeamPanel,
  UpdatesList,
} from "@/components/initiatives/initiative-sections";
import { JoinRequestProvider, JoinRequestTrigger } from "@/components/initiatives/join-request";
import { getInitiative, initiativeStatusMeta, initiatives } from "@/lib/mock/initiatives";
import { getT } from "@/i18n/server";

export function generateStaticParams() {
  return initiatives.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/initiatives/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const initiative = getInitiative(slug);
  return initiative ? { title: initiative.title, description: initiative.summary } : {};
}

const numberFormat = new Intl.NumberFormat("en-GB");

/** Initiative detail — Figma "Web / Initiative detail" (node 18:1849, content 18:1902). */
export default function InitiativePage({ params }: PageProps<"/[locale]/initiatives/[slug]">) {
  // params are URL data: read them inside Suspense so the App Shell stays shareable.
  return (
    <Suspense fallback={<InitiativeSkeleton />}>
      <InitiativeDetail params={params} />
    </Suspense>
  );
}

function InitiativeSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pb-12 pt-6">
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

async function InitiativeDetail({ params }: Pick<PageProps<"/[locale]/initiatives/[slug]">, "params">) {
  const t = await getT();
  const { slug } = await params;
  const initiative = getInitiative(slug);
  if (!initiative) notFound();

  const status = initiativeStatusMeta[initiative.status];
  const done = initiative.milestones.filter((milestone) => milestone.state === "done").length;
  const recruiting = initiative.status === "recruiting";
  const stats = [
    { value: numberFormat.format(initiative.collaborators), label: "collaborators" },
    { value: t("{done} of {total}", { done, total: initiative.milestones.length }), label: "milestones" },
    { value: numberFormat.format(initiative.countries), label: "countries" },
    { value: numberFormat.format(initiative.followers), label: "followers" },
  ];
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "updates", label: t("Updates ({count})", { count: initiative.updatesCount }) },
    { value: "milestones", label: "Milestones" },
    { value: "people", label: t("People ({count})", { count: initiative.collaborators }) },
  ];

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pb-12 pt-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1.5 text-sm">
          <li className="flex items-center gap-1.5">
            <Link href="/initiatives" className="text-primary-light hover:underline">
              Initiatives
            </Link>
            <Icon name="chevron-right" size={14} className="text-disabled" />
          </li>
          <li aria-current="page" className="text-secondary">
            {initiative.title}
          </li>
        </ol>
      </nav>

      <JoinRequestProvider
        initiative={{
          slug: initiative.slug,
          title: initiative.title,
          leadName: initiative.lead.name,
          roles: initiative.roles.map(({ id, title }) => ({ id, title })),
        }}
      >
        <section aria-labelledby="initiative-title" className="overflow-hidden rounded-2xl border border-line bg-card">
          <div aria-hidden="true" className="h-40 bg-gradient-to-r from-primary-dark via-primary-light via-60% to-accent" />
          <div className="flex flex-wrap items-end justify-between gap-6 px-7 pb-7 pt-6">
            <div className="flex min-w-0 flex-1 basis-[480px] flex-col gap-2.5">
              <div className="flex flex-wrap gap-2">
                <Chip>{initiative.theme}</Chip>
                <Chip tone={status.tone}>{status.label}</Chip>
                {initiative.chapter && (
                  <Link
                    href={`/chapters/${initiative.chapter.slug}`}
                    className={chipClasses("info", "hover:underline")}
                  >
                    {initiative.chapter.name}
                  </Link>
                )}
              </div>
              <h1 id="initiative-title" className="text-h1 text-ink">
                {initiative.title}
              </h1>
              <p className="max-w-[840px] text-md text-body">{initiative.description}</p>
              <dl className="flex flex-wrap gap-x-7 gap-y-3 pt-1.5">
                {stats.map((stat) => (
                  <div key={stat.label} className="flex flex-col-reverse">
                    <dt className="text-xs text-secondary">{stat.label}</dt>
                    <dd className="text-h3 text-ink">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex items-center gap-2">
              {recruiting && (
                <JoinRequestTrigger variant="accent" size="default">
                  Request to join
                </JoinRequestTrigger>
              )}
              <FollowButton title={initiative.title} size="default" />
              <ShareButton title={initiative.title} />
            </div>
          </div>
        </section>

        <Tabs values={tabs.map((tab) => tab.value)} defaultValue="overview">
          <TabList label={t("{title} sections", { title: initiative.title })} tabs={tabs} />

          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col">
              <TabPanel value="overview">
                {initiative.roles.length > 0 && <RolesNeeded initiative={initiative} />}
                <Milestones milestones={initiative.milestones} headingId="overview-milestones" />
                <UpdatesList initiative={initiative} />
              </TabPanel>
              <TabPanel value="updates">
                <UpdatesList initiative={initiative} />
              </TabPanel>
              <TabPanel value="milestones">
                <Milestones milestones={initiative.milestones} headingId="tab-milestones" />
              </TabPanel>
              <TabPanel value="people">
                <TeamPanel team={initiative.team} total={initiative.collaborators} headingId="people-heading" />
              </TabPanel>
            </div>

            <aside aria-label="About this initiative" className="flex w-full shrink-0 flex-col gap-4 lg:w-[380px]">
              <TeamPanel
                team={initiative.team.slice(0, 4)}
                total={initiative.collaborators}
                seeAllHref="#people"
                headingId="team-heading"
              />
              {recruiting && <HowJoiningWorks />}
              <RelatedOpportunities items={initiative.related} />
            </aside>
          </div>
        </Tabs>
      </JoinRequestProvider>
    </main>
  );
}
