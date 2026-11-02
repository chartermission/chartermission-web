import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { TrendingControls } from "@/components/trending/trending-controls";
import { TrendingRunStatus } from "@/components/trending/trending-run-status";
import { trendRankings, trendRules } from "@/lib/mock/trending";

export const metadata: Metadata = { title: "Trending controls" };

/** Trending controls — Figma "Web / Admin — Trending controls" (node 20:3372). */
export default function TrendingPage() {
  return (
    <>
      <PageHeader
        title="Trending controls"
        description="Trending is computed every 5 minutes from how fast a hashtag’s use is rising against its normal level."
        actions={<TrendingRunStatus initialLastRun="2 min ago" />}
      />
      <section aria-label="Trending rules" className="rounded-card border border-line bg-card px-5 py-1">
        <dl className="grid grid-cols-2 xl:grid-cols-4">
          {trendRules.map((rule) => (
            <div key={rule.label} className="flex min-w-0 flex-col gap-1 py-4 pr-4">
              <dt className="text-xs text-secondary">{rule.label}</dt>
              <dd className="text-h3 text-ink">{rule.value}</dd>
              <dd className="text-xs text-disabled">{rule.note}</dd>
            </div>
          ))}
        </dl>
      </section>
      <TrendingControls initialRankings={trendRankings} />
    </>
  );
}
