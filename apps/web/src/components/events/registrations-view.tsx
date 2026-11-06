"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventDetail, Page, RegistrationStatus, RegistrationView } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, Panel, cn } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { Bone } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { formatClock, formatDay } from "./time";
import { useNow, useViewerZone } from "./use-viewer-zone";

type Tab = RegistrationStatus;

const tabs: { value: Tab; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "attended", label: "Attended" },
  { value: "cancelled", label: "Cancelled" },
];

const MAX_PAGES = 100;

async function loadAll(eventId: string): Promise<RegistrationView[]> {
  const rows: RegistrationView[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api<Page<RegistrationView>>(`/events/${eventId}/registrations`, { query: { status: "all", limit: 100, cursor: cursor ?? undefined } });
    rows.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return rows;
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` : text;
}

function downloadCsv(event: EventDetail, rows: RegistrationView[], label: string) {
  const header = ["Name", "Handle", "Headline", "Status", "Waitlist position", "Registered at (UTC)", "Promoted at (UTC)", "Attended at (UTC)", "Cancelled at (UTC)"];
  const lines = [header, ...rows.map((r) => [r.member.name, r.member.handle, r.member.headline ?? "", r.status, r.position ?? "", r.registeredAt, r.promotedAt ?? "", r.attendedAt ?? "", r.cancelledAt ?? ""])];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.slug}-${label.toLowerCase()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Host view of an event's registrations: counts, tabs, search, attendance, CSV export. */
export function RegistrationsView({ event }: { event: EventDetail }) {
  const zone = useViewerZone() ?? event.timezone;
  const [rows, setRows] = useState<RegistrationView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("registered");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const now = useNow();
  const started = Date.parse(event.startsAt) <= now;

  const load = useCallback(() => {
    setError(null);
    loadAll(event.id).then(setRows, setError);
  }, [event.id]);

  useEffect(() => {
    let live = true;
    loadAll(event.id).then(
      (data) => live && setRows(data),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [event.id]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { registered: 0, waitlisted: 0, attended: 0, cancelled: 0 };
    for (const r of rows ?? []) c[r.status] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => r.status === tab)
      .filter((r) => !term || r.member.name.toLowerCase().includes(term) || r.member.handle.includes(term))
      .sort((a, b) => (tab === "waitlisted" ? (a.position ?? 0) - (b.position ?? 0) : a.registeredAt.localeCompare(b.registeredAt)));
  }, [rows, tab, q]);

  async function setAttendance(row: RegistrationView, attended: boolean) {
    setPending(row.member.id);
    try {
      const updated = await api<RegistrationView>(`/events/${event.id}/registrations/${row.member.id}/attendance`, { method: "PUT", body: { attended } });
      setRows((current) => (current ?? []).map((r) => (r.member.id === row.member.id ? updated : r)));
      toast.success(attended ? `${row.member.name} marked as attended` : `${row.member.name} moved back to registered`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(null);
    }
  }

  const when = (iso: string) => `${formatDay(iso, zone)}, ${formatClock(iso, zone)}`;
  const seats = counts.registered + counts.attended;
  const tiles = [
    { label: "Seats taken", value: rows ? `${seats}${event.capacity ? ` / ${event.capacity}` : ""}` : "–", icon: "users" as const },
    { label: "Waitlisted", value: rows ? String(counts.waitlisted) : "–", icon: "clock" as const },
    { label: "Attended", value: rows ? String(counts.attended) : "–", icon: "verified" as const },
    { label: "Cancelled", value: rows ? String(counts.cancelled) : "–", icon: "x" as const },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ul className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-sm:gap-3">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Panel className="flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary">
                <Icon name={tile.icon} size={20} />
              </span>
              <span className="flex flex-col">
                <span className="text-h2 text-ink">{tile.value}</span>
                <span className="text-xs text-secondary">{tile.label}</span>
              </span>
            </Panel>
          </li>
        ))}
      </ul>

      <Panel className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-3 max-sm:px-3">
          <div role="tablist" aria-label="Registration status" className="flex gap-5 overflow-x-auto">
            {tabs.map((t) => {
              const selected = t.value === tab;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="registrations-panel"
                  onClick={() => setTab(t.value)}
                  className={cn("-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap", selected ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink")}
                >
                  {t.label}
                  <span className={cn("rounded-full px-1.5 text-xs", selected ? "bg-primary text-inverse" : "bg-muted text-secondary")}>{rows ? counts[t.value] : "·"}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pb-2.5 max-sm:w-full">
            <label className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-disabled focus-within:border-primary-light max-sm:flex-1">
              <Icon name="search" size={16} />
              <span className="sr-only">Search registrations</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="w-40 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled max-sm:w-full" />
            </label>
            <Button variant="secondary" size="small" disabled={!rows || !visible.length} onClick={() => downloadCsv(event, visible, tabs.find((t) => t.value === tab)!.label)}>
              <Icon name="arrow-up-right" size={16} className="rotate-90" />
              Export CSV
            </Button>
          </div>
        </div>
        <div id="registrations-panel" role="tabpanel" aria-live="polite" aria-busy={!rows && !error}>
          {error ? (
            <div className="p-5">
              <ErrorNotice error={error} onRetry={load} />
            </div>
          ) : !rows ? (
            <div className="flex flex-col gap-3 p-5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Bone key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : visible.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {visible.map((row) => (
                <li key={row.member.id} className="flex items-center gap-3 px-5 py-3.5 max-sm:flex-wrap max-sm:px-3">
                  {row.status === "waitlisted" && <span className="w-7 shrink-0 text-center text-sm font-semibold text-warning">#{row.position}</span>}
                  <Avatar name={row.member.name} src={row.member.avatarUrl ?? undefined} tone={row.member.tone} size={40} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={memberHref(row.member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
                      {row.member.name}
                    </Link>
                    <span className="truncate text-xs text-secondary">{row.member.headline ?? `@${row.member.handle}`}</span>
                  </div>
                  <span className="text-xs text-secondary max-sm:order-last max-sm:w-full max-sm:pl-[52px]">
                    {row.status === "cancelled" && row.cancelledAt
                      ? `Cancelled ${when(row.cancelledAt)}`
                      : row.status === "attended" && row.attendedAt
                        ? `Attended · registered ${when(row.registeredAt)}`
                        : row.promotedAt
                          ? `Promoted from waitlist ${when(row.promotedAt)}`
                          : `Registered ${when(row.registeredAt)}`}
                  </span>
                  {(row.status === "registered" || row.status === "attended") &&
                    (started ? (
                      <Button size="small" variant={row.status === "attended" ? "ghost" : "secondary"} disabled={pending === row.member.id} onClick={() => setAttendance(row, row.status !== "attended")} aria-label={row.status === "attended" ? `Undo attendance for ${row.member.name}` : `Mark ${row.member.name} as attended`}>
                        {row.status === "attended" ? (
                          <>
                            <Icon name="check" size={16} className="text-success" />
                            Attended
                          </>
                        ) : (
                          "Mark attended"
                        )}
                      </Button>
                    ) : (
                      <Chip tone="success">Registered</Chip>
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
              <Icon name="users" size={24} className="text-disabled" />
              <p className="text-md font-medium text-ink">{q ? "Nobody matches that name" : `No ${tabs.find((t) => t.value === tab)!.label.toLowerCase()} members`}</p>
              {tab === "attended" && !started && <p className="text-sm text-secondary">You can mark attendance once the event has started.</p>}
            </div>
          )}
        </div>
      </Panel>
      {!started && <p className="text-xs text-secondary">Attendance can be marked once the event starts.</p>}
    </div>
  );
}
