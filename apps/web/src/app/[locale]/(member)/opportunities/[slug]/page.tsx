import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OPPORTUNITY_TYPE_LABELS, opportunityPlace, type OpportunityDetail } from "@chartermission/contracts";
import { Chip, Icon, Panel } from "@chartermission/ui";
import { formatDayMonth } from "@/components/discover/dates";
import { OpportunityActions } from "@/components/opportunities/opportunity-actions";
import { deadlineChip } from "@/components/opportunities/opportunity-dates";
import { requireClientViewer } from "@/components/social/data";
import { AuthorName, MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGetOrNull } from "@/lib/api/server";
import { getT, getIntlTag } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/opportunities/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const o = await apiGetOrNull<OpportunityDetail>(`/opportunities/${encodeURIComponent(slug)}`).catch(() => null);
  return o ? { title: `${o.title} · ${o.organisation}`, description: o.summary } : { title: "Opportunity" };
}

async function Detail({ params }: Pick<PageProps<"/[locale]/opportunities/[slug]">, "params">) {
  const intl = await getIntlTag();
  const t = await getT();
  const { slug } = await params;
  await requireClientViewer(`/opportunities/${slug}`);
  const o = await apiGetOrNull<OpportunityDetail>(`/opportunities/${encodeURIComponent(slug)}`);
  if (!o) notFound();
  const deadline = deadlineChip(intl, t, o);
  const facts: { icon: "map-pin" | "calendar" | "briefcase" | "target"; label: string; value: string }[] = [
    { icon: "briefcase", label: "Type", value: OPPORTUNITY_TYPE_LABELS[o.type] },
    { icon: "map-pin", label: "Where", value: opportunityPlace(o) },
    { icon: "calendar", label: "Deadline", value: o.deadline ? formatDayMonth(intl, o.deadline) : "Rolling" },
    ...(o.compensation ? [{ icon: "target" as const, label: "Pay or award", value: o.compensation }] : []),
  ];

  return (
    <div className="flex items-start gap-6 max-lg:flex-col">
      <article className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip tone="info">{OPPORTUNITY_TYPE_LABELS[o.type]}</Chip>
            {o.sector && <Chip>{o.sector.name}</Chip>}
            <Chip tone={deadline.tone}>{deadline.label}</Chip>
          </div>
          <h1 className="text-h1 text-ink max-sm:text-h2">{o.title}</h1>
          <p className="text-md text-secondary">
            {o.organisation} · {opportunityPlace(o)}
          </p>
          <p className="text-md text-body">{o.summary}</p>
        </header>

        <Panel className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-secondary">
                <Icon name={f.icon} size={14} />
                {f.label}
              </span>
              <span className="text-sm font-medium text-ink">{f.value}</span>
            </div>
          ))}
        </Panel>

        <Panel aria-labelledby="about-role" className="flex flex-col gap-3 p-5">
          <h2 id="about-role" className="text-h3 text-ink">
            About the opportunity
          </h2>
          <div className="whitespace-pre-line text-md text-body">{o.description}</div>
        </Panel>

        <Panel className="flex items-center gap-3 p-5">
          <MemberAvatar member={o.poster} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs text-secondary">Posted by</span>
            <AuthorName member={o.poster} />
            {o.poster.headline && <span className="truncate text-xs text-secondary">{o.poster.headline}</span>}
          </div>
          <span className="text-xs text-secondary">
            <TimeAgo iso={o.createdAt} />
          </span>
        </Panel>
      </article>

      <aside aria-label="Apply" className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-24 lg:w-[360px]">
        <OpportunityActions opportunity={o} />
      </aside>
    </div>
  );
}

/** One listing, with the apply panel (or the poster's tools). */
export default function OpportunityPage({ params }: PageProps<"/[locale]/opportunities/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 pb-12 pt-6 max-sm:px-3">
      <Link href="/opportunities" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        All opportunities
      </Link>
      <Suspense fallback={<PanelSkeleton className="h-[480px]" lines={8} />}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}
