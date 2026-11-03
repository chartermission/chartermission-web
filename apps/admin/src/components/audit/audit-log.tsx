"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuditEntry, Page } from "@chartermission/contracts";
import { Avatar, Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { SkeletonBar, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { AUDIT_PAGE_SIZE, auditApiQuery, auditSearch, type AuditFilters } from "@/lib/audit";
import { shortId } from "@/lib/format";

const ACTION_PREFIXES = [
  { value: "", label: "All actions" },
  { value: "moderation.", label: "Moderation actions" },
  { value: "report.", label: "Reports and assignment" },
  { value: "appeal.", label: "Appeals" },
  { value: "trending.", label: "Trending controls" },
  { value: "auth.", label: "Sign-ins and security" },
  { value: "audit.", label: "Audit exports" },
];

const TARGET_TYPES = [
  { value: "", label: "All targets" },
  { value: "post", label: "Posts" },
  { value: "comment", label: "Comments" },
  { value: "member", label: "Members" },
  { value: "hashtag", label: "Topics" },
  { value: "user", label: "Accounts" },
  { value: "session", label: "Sessions" },
  { value: "setting", label: "Settings" },
  { value: "audit_log", label: "Audit log" },
];

type More = { base: string | null; items: AuditEntry[]; cursor: string | null };

function FilterSelectField({
  id,
  label,
  name,
  options,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <span className="relative">
        <select id={id} name={name} defaultValue={defaultValue ?? ""} className={inputClasses(false, "appearance-none pr-9")}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary" />
      </span>
    </div>
  );
}

function targetText(entry: AuditEntry) {
  if (!entry.targetType) return "—";
  const type = entry.targetType.replace(/_/g, " ");
  if (!entry.targetId) return type;
  return entry.targetType === "hashtag" ? `#${entry.targetId}` : `${type} ${shortId(entry.targetId)}`;
}

/** First 8 characters of the salted IP hash; the full value is in the tooltip and the CSV export. */
function IpHash({ value }: { value: string | null }) {
  if (!value) return <span className="text-secondary">—</span>;
  return (
    <code className="font-mono text-xs text-secondary" title={value}>
      {value.slice(0, 8)}
    </code>
  );
}

/** Audit log table with URL filters, cursor paging and (for audit.export) CSV export. */
export function AuditLog({
  filters,
  initialItems,
  initialCursor,
  canExport,
}: {
  filters: AuditFilters;
  initialItems: AuditEntry[];
  initialCursor: string | null;
  canExport: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [navigating, startNavigation] = useTransition();
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const extra = more && more.base === initialCursor ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const items = [...initialItems, ...(extra?.items ?? [])];
  const filtered = !!(filters.actor || filters.action || filters.targetType || filters.from || filters.to);
  const exportHref = `/audit/export${auditSearch(filters)}`;

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim() || undefined;
    const next: AuditFilters = {
      actor: get("actor"),
      action: get("action"),
      targetType: get("target"),
      from: get("from"),
      to: get("to"),
    };
    if (next.from && next.to && next.from > next.to) {
      setRangeError("The start date must be on or before the end date.");
      return;
    }
    setRangeError(null);
    startNavigation(() => router.push(`/audit${auditSearch(next)}`, { scroll: false }));
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AuditEntry>>("/admin/audit", {
        query: { ...auditApiQuery(filters), cursor, limit: AUDIT_PAGE_SIZE },
      });
      setMore({ base: initialCursor, items: [...(extra?.items ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <form
        onSubmit={apply}
        aria-label="Filter the audit log"
        className="flex flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${ids}-actor`} className="text-label text-ink">
              Actor
            </label>
            <input
              id={`${ids}-actor`}
              name="actor"
              defaultValue={filters.actor}
              placeholder="@handle, member ID or “system”"
              autoComplete="off"
              className={inputClasses(false)}
            />
          </div>
          <FilterSelectField id={`${ids}-action`} label="Action" name="action" options={ACTION_PREFIXES} defaultValue={filters.action} />
          <FilterSelectField id={`${ids}-target`} label="Target" name="target" options={TARGET_TYPES} defaultValue={filters.targetType} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${ids}-from`} className="text-label text-ink">
              From <span className="font-normal text-secondary">(UTC)</span>
            </label>
            <input id={`${ids}-from`} type="date" name="from" defaultValue={filters.from} className={inputClasses(!!rangeError)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${ids}-to`} className="text-label text-ink">
              To <span className="font-normal text-secondary">(UTC)</span>
            </label>
            <input
              id={`${ids}-to`}
              type="date"
              name="to"
              defaultValue={filters.to}
              aria-invalid={rangeError ? true : undefined}
              aria-describedby={rangeError ? `${ids}-range` : undefined}
              className={inputClasses(!!rangeError)}
            />
          </div>
        </div>
        {rangeError && (
          <p id={`${ids}-range`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
            <Icon name="alert" size={14} />
            {rangeError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="small" disabled={navigating} aria-busy={navigating}>
              {navigating ? "Filtering…" : "Apply filters"}
            </Button>
            {filtered && (
              <Button
                variant="ghost"
                size="small"
                onClick={() => startNavigation(() => router.push("/audit", { scroll: false }))}
              >
                Clear
              </Button>
            )}
          </div>
          {canExport && (
            <a href={exportHref} download className={buttonClasses({ variant: "secondary", size: "small" })}>
              <Icon name="arrow-up-right" size={16} className="rotate-90" />
              Export CSV
            </a>
          )}
        </div>
      </form>

      <div className={cn("flex flex-col gap-3 transition-opacity", navigating && "opacity-70")} aria-busy={navigating}>
        <div className="relative overflow-hidden rounded-card border border-line bg-card">
          {items.length === 0 ? (
            <EmptyState icon="clock" title={filtered ? "No entries match these filters" : "The audit log is empty"} />
          ) : (
            <>
              <table className="hidden w-full table-fixed border-collapse text-left text-sm md:table">
                <caption className="sr-only">Audit log entries, newest first</caption>
                <colgroup>
                  <col className="w-[164px]" />
                  <col className="w-[200px]" />
                  <col />
                  <col className="w-[170px]" />
                  <col className="w-[104px]" />
                </colgroup>
                <thead className="bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="py-3 pr-3 pl-4 font-semibold">Time</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Actor</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Action</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Target</th>
                    <th scope="col" className="py-3 pr-4 font-semibold">
                      IP<span className="sr-only"> address hash</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry) => (
                    <tr key={entry.id} className="border-t border-line align-top first:border-t-0">
                      <td className="py-3 pr-3 pl-4 whitespace-nowrap text-body">
                        <DateTime iso={entry.createdAt} />
                      </td>
                      <td className="py-3 pr-3">
                        {entry.actor ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar name={entry.actor.name} size={24} tone={entry.actor.tone} src={entry.actor.avatarUrl ?? undefined} />
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate text-ink">{entry.actor.name}</span>
                              <span className="truncate text-xs text-secondary">@{entry.actor.handle}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-secondary">System</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <span className="block text-ink">{entry.summary}</span>
                        <code className="font-mono text-xs text-secondary">{entry.action}</code>
                      </td>
                      <td className="py-3 pr-3 break-words text-body">{targetText(entry)}</td>
                      <td className="py-3 pr-4">
                        <IpHash value={entry.ipHash} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="flex flex-col md:hidden" aria-label="Audit log entries, newest first">
                {items.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 border-t border-line px-4 py-3 first:border-t-0">
                    <span className="flex items-center justify-between gap-2 text-xs text-secondary">
                      <span className="truncate">{entry.actor ? `${entry.actor.name} · @${entry.actor.handle}` : "System"}</span>
                      <DateTime iso={entry.createdAt} className="shrink-0" />
                    </span>
                    <span className="text-sm text-ink">{entry.summary}</span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-secondary">
                      <code className="font-mono">{entry.action}</code>
                      <span>{targetText(entry)}</span>
                      {entry.ipHash && (
                        <span>
                          IP <IpHash value={entry.ipHash} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
        {cursor && (
          <div className="flex justify-center">
            <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
              {loadingMore ? "Loading…" : "Load older entries"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export function AuditLogSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-5" aria-hidden="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBar key={i} className="h-[58px]" />
          ))}
        </div>
        <SkeletonBar className="h-8 w-28" />
      </div>
      <SkeletonTable label="Loading the audit log" rows={8} />
    </>
  );
}
