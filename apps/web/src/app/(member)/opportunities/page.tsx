import type { Metadata } from "next";
import Link from "next/link";
import { Icon, OpportunityCard, Panel, buttonClasses } from "@chartermission/ui";
import { formatDayMonth, isRestOfMonth } from "@/components/discover/dates";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { opportunities, opportunitiesToday, savedOpportunities } from "@/lib/mock/opportunities";
import { CreateAlertButton } from "./create-alert-button";
import { OpportunityBrowser, type OpportunityEntry } from "./opportunity-browser";

export const metadata: Metadata = { title: "Opportunities" };

function OpportunitiesRail() {
  return (
    <aside aria-label="Alerts and saved opportunities" className="flex w-72 shrink-0 flex-col gap-4 xl:w-80">
      <section className="flex flex-col gap-3 rounded-card bg-primary p-5">
        <h2 className="flex items-center gap-2 text-h3 text-inverse">
          <Icon name="bell" size={20} />
          Get alerts for this search
        </h2>
        <p className="text-sm text-primary-tint">
          We’ll email you when new jobs or fellowships matching these filters are published.
        </p>
        <CreateAlertButton />
      </section>

      <Panel className="flex flex-col gap-3 p-5">
        <h2 className="text-h3 text-ink">Saved opportunities</h2>
        <ul className="flex flex-col gap-3">
          {savedOpportunities.map((item) => (
            <li key={item.slug} className="flex items-center justify-between gap-3">
              <Link href={`/opportunities/${item.slug}`} className="group flex min-w-0 flex-col">
                <span className="text-sm font-medium text-ink group-hover:underline">{item.title}</span>
                <span className="text-xs text-secondary">{item.closes}</span>
              </Link>
              <Icon name="bookmark" size={18} className="shrink-0 text-accent" label="Saved" />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="flex flex-col gap-2.5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Icon name="shield" size={18} className="text-success" />
          Reviewed listings
        </h2>
        <p className="text-xs text-secondary">
          Every listing is checked by our team, links are monitored, and expired roles close automatically. Spot
          something wrong? Report it from the card.
        </p>
      </Panel>
    </aside>
  );
}

/** Opportunities directory — Figma "Web / Opportunities" (node 10:907). */
export default function OpportunitiesPage() {
  const entries: OpportunityEntry[] = opportunities.map((opportunity) => ({
    ...opportunity,
    card: (
      <OpportunityCard
        title={opportunity.title}
        meta={`${opportunity.organisation} · ${opportunity.place} · ${opportunity.workMode}`}
        chips={[
          { label: opportunity.engagement },
          { label: opportunity.sectorLabel },
          {
            label: `Closes ${formatDayMonth(opportunity.deadline)}`,
            tone: isRestOfMonth(opportunity.deadline, opportunitiesToday) ? "warning" : "neutral",
          },
        ]}
        href={`/opportunities/${opportunity.slug}`}
        linkAs={Link}
      />
    ),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Opportunities"
        description="Jobs, fellowships, grants and calls for partners — every listing is reviewed before it goes live."
        actions={
          <Link href="/opportunities/new" className={buttonClasses({ variant: "accent" })}>
            Post an opportunity
          </Link>
        }
      />
      <OpportunityBrowser entries={entries} today={opportunitiesToday} rail={<OpportunitiesRail />} />
    </PageShell>
  );
}
