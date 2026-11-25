"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AdminMemberOverview, AdminMemberRow, MemberRef, Taxonomies } from "@chartermission/contracts";
import { Avatar, Button, Icon, ProfileBadgeChip, cn, VerifiedBadge } from "@chartermission/ui";
import { RowMenu, type RowMenuItem } from "@/components/row-menu";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { WEB_URL } from "@/lib/navigation";
import { useIntlTag, useT } from "@/i18n/client";
import { MemberChips } from "./member-chips";

/**
 * Member detail panel (GET /admin/members/{id}/overview), a drawer on the end side of the window.
 * `row` is the list's current copy of the member: the panel reloads when it changes, so an action
 * taken from here (or the list) shows at once. Mount it to open; the parent unmounts it on close.
 */
export function MemberDetailPanel({
  row,
  taxonomies,
  primary,
  menu,
  onClose,
}: {
  row: AdminMemberRow;
  taxonomies: Taxonomies | null;
  primary: { label: string; onSelect: () => void; disabled?: boolean };
  menu: RowMenuItem[];
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<AdminMemberOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<AdminMemberOverview>(`/admin/members/${row.id}/overview`, { signal: controller.signal }).then(
      (next) => {
        setData(next);
        setError(null);
      },
      (e: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      },
    );
    return () => controller.abort();
  }, [row]);

  const country = row.countryCode ? (taxonomies?.countries.find((c) => c.code === row.countryCode)?.name ?? row.countryCode) : null;
  const place = [data?.city, country].filter(Boolean).join(", ");

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-0 ms-auto h-dvh max-h-dvh w-[480px] max-w-full overflow-y-auto border-s border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-start gap-3">
          <Avatar name={row.name} size={56} src={row.avatarUrl ?? undefined} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={`${id}-title`} className="flex items-center gap-1 text-h3 text-ink">
              <span className="truncate">{row.name}</span>
              {row.verified && <VerifiedBadge size={18} className="shrink-0" label="Verified" />}
            </h2>
            <span className="text-sm text-secondary">@{row.handle}</span>
            {row.headline && <p className="text-sm text-body">{row.headline}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink">
            <Icon name="x" size={18} label="Close" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="small" disabled={primary.disabled} onClick={primary.onSelect}>
            {primary.label}
          </Button>
          <RowMenu label={t("More actions for {name}", { name: row.name })} items={menu} align="start" />
        </div>

        <MemberChips row={row} />

        <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-2 text-sm">
          <Fact label="Email">
            <span className="break-all">{row.email}</span>
          </Fact>
          <Fact label="Lives in">{place || <Muted>Not given</Muted>}</Fact>
          <Fact label="Chapters">
            {data ? data.chapters.length ? data.chapters.map((c) => c.name).join(", ") : <Muted>None</Muted> : <Muted>…</Muted>}
          </Fact>
          <Fact label="Joined">
            <DateTime iso={row.joinedAt} dateOnly />
          </Fact>
          <Fact label="Last active">{row.lastActiveAt ? <DateTime iso={row.lastActiveAt} /> : <Muted>Never</Muted>}</Fact>
          <Fact label="Email confirmed">{row.emailVerified ? "Yes" : "No"}</Fact>
          <Fact label="Two-step">{row.twoStep ? "On" : "Off"}</Fact>
          <Fact label="Claude access">
            {row.mcpAccess ? (row.mcpConnections > 0 ? t("On · {count} active connections", { count: row.mcpConnections }) : "On") : "Off"}
          </Fact>
        </dl>

        {error && (
          <p role="alert" className="rounded-lg bg-error-light p-3 text-sm text-error">
            {error}
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Posts" value={data.counts.posts} />
              <Stat label="Connections" value={data.counts.connections} />
              <Stat label="Followers" value={data.counts.followers} />
            </div>

            <Section title="Badges">
              {row.badges.length ? (
                <div className="flex flex-wrap gap-1">
                  {row.badges.map((b) => (
                    <ProfileBadgeChip key={b.id} badge={b} size="small" />
                  ))}
                </div>
              ) : (
                <Muted>None</Muted>
              )}
            </Section>

            <Section title="Invitations">
              <p className="text-sm text-body">
                {data.invitedBy ? (
                  <>
                    {t("Invited by")} <PersonLink person={data.invitedBy} />
                  </>
                ) : (
                  t("Joined on their own.")
                )}
              </p>
              {data.invited.total > 0 ? (
                <p className="text-sm text-body">
                  {t("Invited {count} people", { count: data.invited.total })}:{" "}
                  {data.invited.recent.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <PersonLink person={p} />
                    </span>
                  ))}
                  {data.invited.total > data.invited.recent.length && " …"}
                </p>
              ) : (
                <p className="text-sm text-secondary">Hasn’t invited anyone yet.</p>
              )}
            </Section>

            {data.groups && (
              <Section title={data.groups.total ? t("Groups they run · {count}", { count: data.groups.total }) : t("Groups they run")}>
                {data.groups.items.length ? (
                  <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                    {data.groups.items.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <Link href={`/groups/${g.id}`} className="min-w-0 truncate font-medium text-primary hover:underline" dir="auto">
                          {g.name}
                        </Link>
                        <span className="shrink-0 text-xs text-secondary">
                          {g.role === "owner" ? t("Owner") : t("Admin")} · {g.visibility === "private" ? t("Private") : t("Public")} · {t("{count} members", { count: g.memberCount })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Muted>Doesn’t own or run any groups.</Muted>
                )}
              </Section>
            )}

            <Section title={data.openReports.total ? t("Open reports · {count}", { count: data.openReports.total }) : t("Open reports")}>
              {data.openReports.recent.length ? (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {data.openReports.recent.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-ink">
                        {r.reasonCode.replace(/_/g, " ")} <span className="text-secondary">· {r.targetType}</span>
                      </span>
                      <DateTime iso={r.createdAt} dateOnly className="shrink-0 text-xs text-secondary" />
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>No open reports.</Muted>
              )}
            </Section>

            <Section title="Recent changes">
              {data.audit.length ? (
                <ul className="flex flex-col gap-2">
                  {data.audit.map((a) => (
                    <li key={a.id} className="flex flex-col text-sm">
                      <span className="text-ink">{a.summary}</span>
                      <span className="text-xs text-secondary">
                        {a.actor ? a.actor.name : t("System")} · <DateTime iso={a.createdAt} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>Nothing in the audit log yet.</Muted>
              )}
            </Section>
          </>
        )}
        {!data && !error && <p className="text-sm text-secondary">Loading…</p>}
      </div>
    </dialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-sm text-secondary">{children}</span>;

function Stat({ label, value }: { label: string; value: number }) {
  const numbers = new Intl.NumberFormat(useIntlTag());
  return (
    <div className="flex flex-col rounded-lg border border-line px-3 py-2">
      <span className="text-h3 text-ink tabular-nums">{numbers.format(value)}</span>
      <span className="text-xs text-secondary">{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-2 border-t border-line pt-4")}>
      <h3 className="text-label font-semibold text-ink uppercase">{title}</h3>
      {children}
    </section>
  );
}

function PersonLink({ person }: { person: MemberRef }) {
  return (
    <a href={`${WEB_URL}/${person.handle}`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
      {person.name}
    </a>
  );
}
