"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdminReferrals, InviteKind, MemberRef, ReferralPeriod } from "@chartermission/contracts";
import { Avatar, Button, Chip, FilterSelect, Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { hasReferralFilters, referralsApiQuery, referralsExportQuery, referralsSearch, type ReferralFilters } from "@/lib/referral-filters";
import { useT } from "@/i18n/client";

const numberFormat = new Intl.NumberFormat("en-US");

const KIND_LABEL: Record<InviteKind, string> = { member: "Personal", chapter: "Chapter", event: "Event" };

const KIND_OPTIONS = [
  { value: "", label: "All invitations" },
  { value: "member", label: "Personal invitations" },
  { value: "chapter", label: "Chapter invitations" },
  { value: "event", label: "Event invitations" },
];

const EMAIL_OPTIONS = [
  { value: "", label: "Any email status" },
  { value: "yes", label: "Email confirmed" },
  { value: "no", label: "Email not confirmed" },
];

const dateInput = "rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-body hover:border-line-strong";

type More = { base: string; rows: AdminReferrals["recent"]; cursor: string | null };

/** A member on one line: picture, name and @handle (the handle gives way first on narrow columns). */
function Person({ member, handle = true }: { member: MemberRef; handle?: boolean }) {
  return (
    <a
      href={webHref(`/${member.handle}`)}
      target="_blank"
      rel="noreferrer"
      title={`${member.name} · @${member.handle}`}
      className="flex min-w-0 items-center gap-2 hover:underline"
    >
      <Avatar name={member.name} size={24} src={member.avatarUrl ?? undefined} tone={member.tone} />
      <span className="min-w-0 truncate">
        <span className="font-medium text-ink">{member.name}</span>
        {handle && <span className="text-secondary"> @{member.handle}</span>}
      </span>
    </a>
  );
}

function Tile({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-card p-4">
      <dt className="text-sm text-secondary">{label}</dt>
      {value !== undefined && <dd className="text-h2 text-ink tabular-nums">{value}</dd>}
      {children}
    </div>
  );
}

/**
 * Referrals (GET /admin/referrals): all-time numbers, the top inviters for a period and the
 * sign-ups through invitations, filtered from the URL. Picking a top inviter filters the sign-ups.
 */
export function ReferralsConsole({ filters, data }: { filters: ReferralFilters; data: AdminReferrals }) {
  const t = useT();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastQ = useRef(filters.q ?? "");

  const search = referralsSearch(filters);
  const base = `${search}|${data.nextCursor ?? ""}`;
  const extra = more && more.base === base ? more : null;
  const rows = [...data.recent, ...(extra?.rows ?? [])];
  const cursor = extra ? extra.cursor : data.nextCursor;

  function navigate(next: ReferralFilters) {
    startNavigation(() => router.push(`/referrals${referralsSearch(next)}`, { scroll: false }));
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q === lastQ.current) return;
    const id = window.setTimeout(() => {
      lastQ.current = q;
      navigate({ ...filters, q: q || undefined });
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<AdminReferrals>("/admin/referrals", { query: referralsApiQuery(filters, cursor) });
      setMore({ base, rows: [...(extra?.rows ?? []), ...page.recent], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const set = <K extends keyof ReferralFilters>(key: K, value: ReferralFilters[K]) => navigate({ ...filters, [key]: value });
  const clear = () => {
    lastQ.current = "";
    setQuery("");
    navigate({ period: filters.period });
  };
  const exportQs = new URLSearchParams(Object.entries(referralsExportQuery(filters)).filter((e): e is [string, string] => !!e[1])).toString();
  const { stats } = data;

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label="Joined through invitations" value={numberFormat.format(stats.total)}>
          <dd className="text-xs text-secondary">All time</dd>
        </Tile>
        <Tile label="Last 7 days" value={numberFormat.format(stats.last7Days)} />
        <Tile label="Last 30 days" value={numberFormat.format(stats.last30Days)} />
        <Tile label="Confirmed their email" value={stats.confirmedPercent === null ? "—" : `${stats.confirmedPercent}%`} />
        <Tile label="By invitation">
          <dd className="flex flex-col gap-0.5 text-sm">
            {(Object.keys(KIND_LABEL) as InviteKind[]).map((kind) => (
              <span key={kind} className="flex items-baseline justify-between gap-3">
                <span className="text-body">{KIND_LABEL[kind]}</span>
                <span className="font-semibold text-ink tabular-nums">{numberFormat.format(stats.byKind[kind])}</span>
              </span>
            ))}
          </dd>
        </Tile>
      </dl>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="leaders-heading" className="flex flex-col rounded-card border border-line bg-card xl:order-last">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id="leaders-heading" className="text-h3 text-ink">
              Top inviters
            </h2>
            <SegmentedControl<ReferralPeriod>
              label="Period"
              size="small"
              value={filters.period}
              onChange={(period) => set("period", period)}
              items={[
                { value: "30d", label: "30 days" },
                { value: "90d", label: "90 days" },
                { value: "all", label: "All time" },
              ]}
            />
          </div>
          {data.leaders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-secondary">No one joined through an invitation in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">Top inviters. Pick one to see who they brought.</caption>
                <colgroup>
                  <col className="w-[40px]" />
                  <col />
                  <col className="w-[64px]" />
                  <col className="w-[92px]" />
                  <col className="w-[60px]" />
                </colgroup>
                <thead className="bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="py-2.5 ps-4 pe-1 text-end font-semibold">
                      #
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                      Member
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-end font-semibold">
                      Joined
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-end font-semibold">
                      Confirmed
                    </th>
                    <th scope="col" className="py-2.5 ps-2 pe-4 text-end font-semibold">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaders.map((row, index) => {
                    const picked = filters.inviter === row.inviter.id;
                    return (
                      <tr key={row.inviter.id} className={cn("border-t border-line", picked ? "bg-primary-tint-2" : "hover:bg-surface")}>
                        <td className="py-2.5 ps-4 pe-1 text-end text-secondary tabular-nums">{index + 1}</td>
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            aria-pressed={picked}
                            title={t("Show who {name} invited", { name: row.inviter.name })}
                            onClick={() => set("inviter", picked ? undefined : row.inviter.id)}
                            className="flex w-full min-w-0 items-center gap-2 rounded-sm text-start"
                          >
                            <Avatar name={row.inviter.name} size={24} src={row.inviter.avatarUrl ?? undefined} tone={row.inviter.tone} />
                            <span className="truncate font-medium text-ink">{row.inviter.name}</span>
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-end font-semibold text-ink tabular-nums">{numberFormat.format(row.joined)}</td>
                        <td className="px-2 py-2.5 text-end text-body tabular-nums">{numberFormat.format(row.verified)}</td>
                        <td className="py-2.5 ps-2 pe-4 text-end text-secondary tabular-nums">{row.joined ? Math.round((row.verified / row.joined) * 100) : 0}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="signups-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="signups-heading" className="text-h3 text-ink">
                Sign-ups through invitations
              </h2>
              <a href={`/referrals/export${exportQs ? `?${exportQs}` : ""}`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                <Icon name="download" size={16} />
                Export CSV
              </a>
            </div>
            <div role="group" aria-label="Filter sign-ups" aria-busy={navigating} className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[220px] flex-1">
                <span className="sr-only">Search sign-ups</span>
                <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-fit text-secondary" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, @handle or email"
                  className="w-full rounded-lg border border-line bg-card py-1.5 ps-8 pe-2.5 text-sm text-body hover:border-line-strong"
                />
              </label>
              <FilterSelect label="Invitation" options={KIND_OPTIONS} value={filters.kind ?? ""} onChange={(e) => set("kind", (e.target.value || undefined) as InviteKind | undefined)} />
              <FilterSelect
                label="Email"
                options={EMAIL_OPTIONS}
                value={filters.confirmed ?? ""}
                onChange={(e) => set("confirmed", (e.target.value || undefined) as ReferralFilters["confirmed"])}
              />
              <input type="date" aria-label="Joined from" value={filters.from ?? ""} max={filters.to} onChange={(e) => set("from", e.target.value || undefined)} className={dateInput} />
              <span className="text-sm text-secondary" aria-hidden>
                –
              </span>
              <input type="date" aria-label="Joined until" value={filters.to ?? ""} min={filters.from} onChange={(e) => set("to", e.target.value || undefined)} className={dateInput} />
            </div>
            {(data.inviter || hasReferralFilters(filters)) && (
              <div className="flex flex-wrap items-center gap-2">
                {data.inviter && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint-2 py-1 ps-3 pe-1.5 text-sm text-ink">
                    {t("Invited by {name}", { name: data.inviter.name })}
                    <button
                      type="button"
                      onClick={() => set("inviter", undefined)}
                      className="rounded-full p-0.5 text-secondary hover:bg-card hover:text-ink"
                      aria-label={t("Show everyone’s sign-ups")}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </span>
                )}
                {hasReferralFilters(filters) && (
                  <button type="button" onClick={clear} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={cn("overflow-x-auto rounded-card border border-line bg-card transition-opacity", navigating && "opacity-80")}>
            {rows.length === 0 ? (
              <EmptyState icon="search" title="No sign-ups match these filters">
                Try other filters or clear them.
              </EmptyState>
            ) : (
              <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
                <caption className="sr-only">Sign-ups through invitations, newest first</caption>
                <colgroup>
                  <col />
                  <col className="w-[160px]" />
                  <col className="w-[172px]" />
                  <col className="w-[104px]" />
                  <col className="w-[100px]" />
                </colgroup>
                <thead className="bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="py-2.5 ps-4 pe-2 text-start font-semibold">
                      Member
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                      Invited by
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                      Invitation
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                      Joined
                    </th>
                    <th scope="col" className="py-2.5 ps-2 pe-4 text-start font-semibold">
                      Email
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="h-12 border-t border-line">
                      <td className="py-2 ps-4 pe-2">
                        <Person member={row.invitee} />
                      </td>
                      <td className="px-2 py-2">
                        <Person member={row.inviter} handle={false} />
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Chip tone={row.kind === "member" ? "neutral" : row.kind === "chapter" ? "hashtag" : "info"} className="px-2! py-0.5! text-xs!">
                            {KIND_LABEL[row.kind]}
                          </Chip>
                          {row.target ? (
                            <a href={webHref(row.target.path)} target="_blank" rel="noreferrer" title={row.target.name} className="truncate text-body hover:underline">
                              {row.target.name}
                            </a>
                          ) : row.slug ? (
                            <span title={row.slug} className="truncate text-secondary">
                              {row.slug}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-body">
                        <DateTime iso={row.joinedAt} dateOnly />
                      </td>
                      <td className="py-2 ps-2 pe-4">
                        <Chip tone={row.verified ? "success" : "neutral"} className="px-2! py-0.5! text-xs!">
                          {row.verified ? "Confirmed" : "Not yet"}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
