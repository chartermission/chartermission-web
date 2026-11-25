import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ProfileViewsPage } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { StatTile, change, formatCount } from "@/components/analytics/parts";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { ViewerList } from "@/components/profile-views/viewer-list";
import { ViewsChart } from "@/components/profile-views/views-chart";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getIntlTag, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Who viewed your profile") };
}

async function Views() {
  const t = await getT();
  const intl = await getIntlTag();
  await requireViewer("/profile-views");
  const result = await settle(apiGet<ProfileViewsPage>("/me/profile-views"));
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref="/profile-views" />;
  const page = result.data;
  const summary = page.summary!;
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <>
      <section aria-label="Totals" className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <StatTile icon="eye" label="Profile views" value={formatCount(summary.total)} note="In the last 90 days" />
        <StatTile icon="chart" label="Last 30 days" value={formatCount(summary.last30)} trend={change(t, summary.last30, summary.previous30)} note={t("{count} in the last 7 days", { count: summary.last7 })} />
        <StatTile
          icon="search"
          label="Search appearances"
          value={formatCount(summary.searchAppearances.last7)}
          trend={change(t, summary.searchAppearances.last7, summary.searchAppearances.previous7)}
          note="Times you appeared in people search in the last 7 days"
        />
      </section>

      <Panel className="flex flex-col gap-3 p-5">
        <h2 className="text-h3 text-ink">Views in the last 30 days</h2>
        <ViewsChart daily={summary.daily} dayLabel={dayLabel} countLabel={(count) => t("{count} views", { count })} />
      </Panel>

      <h2 className="text-h3 text-ink">Who viewed your profile</h2>
      {summary.canSeeViewers ? (
        <ViewerList initial={page} />
      ) : (
        <Panel className="flex items-start gap-3 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
            <Icon name="eye-off" size={20} />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-md font-medium text-ink">You’re browsing in private mode</span>
            <span className="text-sm text-secondary">
              Members in private mode see how many people viewed their profile, but not who. To see your viewers, show your name and headline when you view
              profiles.
            </span>
            <Link href="/settings/privacy#profile-viewing" className="w-fit text-sm font-medium text-primary-light hover:underline">
              Change in Settings → Privacy
            </Link>
          </span>
        </Panel>
      )}

      <p className="flex items-start gap-2 text-xs text-secondary">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
        Only you can see this. Views are kept for 90 days, and members browsing in private mode are never named.
      </p>
    </>
  );
}

/** Who viewed your profile (LinkedIn-style): counts, a 30-day chart, search appearances and the viewers. */
export default function ProfileViewsRoute() {
  return (
    <PageShell className="max-w-[808px]">
      <PageHeader title="Who viewed your profile" description="Members who looked at your profile in the last 90 days, and how often you appear in search." />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading profile views" />
            <PanelSkeleton className="h-[120px]" lines={2} />
            <PanelSkeleton className="h-[320px]" lines={6} />
          </>
        }
      >
        <Views />
      </Suspense>
    </PageShell>
  );
}
