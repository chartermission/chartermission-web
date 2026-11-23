"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminBadge, AdminMemberCounts, AdminMemberRow, AdminMembersBulkAction, AdminMembersPage, Taxonomies } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, ProfileBadgeChip, cn } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { EmptyState } from "@/components/states";
import { ReasonDialog, type ConfirmTone } from "@/components/reason-dialog";
import { RowMenu, type RowMenuItem } from "@/components/row-menu";
import { MessageMemberDialog } from "@/components/messages/message-member-dialog";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { datedFileName } from "@/lib/csv";
import { MEMBERS_PAGE_SIZE, membersApiQuery, membersSearch, type MembersFilters } from "@/lib/members-filters";
import { WEB_URL } from "@/lib/navigation";
import { useT } from "@/i18n/client";
import { ClaudeAccessDialog } from "./claude-access";
import { MemberChips } from "./member-chips";
import { MemberDetailPanel } from "./member-detail";
import { AwardBadges, BulkBadgeDialog, MemberAccess } from "./member-dialogs";
import { MemberFilterBar, STATUS_LABELS } from "./member-filters";

/** Who may change roles in the console, and whether that includes Super Admin. */
export type AccessRights = { viewerId: string; canManageRoles: boolean; canAssignSuperAdmin: boolean; /** Super Admins: reset another account's two-step verification. */ canResetTwoStep?: boolean; canMessage?: boolean };

/** "12,345 members", for the page header: every account except deleted ones. */
export function MembersTotal({ count }: { count: number }) {
  const t = useT();
  return <p className="text-h2 text-ink tabular-nums">{t("{count} members", { count })}</p>;
}

type SimpleBulk = Exclude<AdminMembersBulkAction, "award_badge" | "remove_badge">;

/** Batch actions without extra choices: the button, the confirmation (for more than one member) and the toast. */
const BULK: Record<SimpleBulk, { label: string; title: string; description: string; confirm: string; done: string; tone?: ConfirmTone }> = {
  verify: {
    label: "Verify",
    title: "Verify {count} members?",
    description: "They get the verified tick on their profile.",
    confirm: "Verify",
    done: "{count} members verified.",
  },
  unverify: {
    label: "Remove tick",
    title: "Remove the verified tick from {count} members?",
    description: "The tick disappears from their profiles.",
    confirm: "Remove tick",
    done: "Verified tick removed from {count} members.",
  },
  feature: {
    label: "Suggest on sign-up",
    title: "Suggest {count} members on sign-up?",
    description: "New members see them first in the “People to follow” step.",
    confirm: "Suggest them",
    done: "{count} members will be suggested to new members.",
  },
  unfeature: {
    label: "Stop suggesting",
    title: "Stop suggesting {count} members?",
    description: "New members are no longer offered them first.",
    confirm: "Stop suggesting",
    done: "{count} members are no longer suggested to new members.",
  },
  claude_on: {
    label: "Claude access on",
    title: "Give {count} members Claude access?",
    description: "They can connect Claude to their own account and use it to post and engage as themselves.",
    confirm: "Turn on",
    done: "Claude access turned on for {count} members.",
  },
  claude_off: {
    label: "Claude access off",
    title: "Turn off Claude access for {count} members?",
    description: "Their Claude connections stop working at once. Team members keep access.",
    confirm: "Turn off",
    done: "Claude access turned off for {count} members.",
    tone: "danger",
  },
};

/** What a batch action does to a row, so the list updates without reloading. */
function applied(row: AdminMemberRow, action: AdminMembersBulkAction, badge?: AdminBadge): AdminMemberRow {
  switch (action) {
    case "verify":
      return { ...row, verified: true };
    case "unverify":
      return { ...row, verified: false };
    case "feature":
      return { ...row, featured: true };
    case "unfeature":
      return { ...row, featured: false };
    case "claude_on":
      return { ...row, mcpAccess: true };
    case "claude_off":
      return { ...row, mcpAccess: row.staff, mcpConnections: row.staff ? row.mcpConnections : 0 };
    case "award_badge":
      if (!badge || row.badges.some((b) => b.id === badge.id)) return row;
      return { ...row, badges: [...row.badges, { id: badge.id, slug: badge.slug, name: badge.name, description: badge.description, tone: badge.tone, icon: badge.icon }] };
    case "remove_badge":
      return badge ? { ...row, badges: row.badges.filter((b) => b.id !== badge.id) } : row;
  }
}

/** Tab counts after rows changed (verified, suggested, Claude access). */
function recount(counts: AdminMemberCounts | null, pairs: { before: AdminMemberRow; after: AdminMemberRow }[]): AdminMemberCounts | null {
  if (!counts) return counts;
  let verified = 0;
  let featured = 0;
  let claude = 0;
  for (const { before, after } of pairs) {
    verified += Number(after.verified) - Number(before.verified);
    featured += Number(after.featured) - Number(before.featured);
    claude += Number(after.mcpAccess) - Number(before.mcpAccess);
  }
  return { ...counts, verified: counts.verified + verified, unverified: counts.unverified - verified, featured: counts.featured + featured, claude: counts.claude + claude };
}

/** Members (GET /admin/members): filters in the URL, batch changes, one action per row and a detail panel. */
export function MembersConsole({
  initial,
  initialFilters,
  badges,
  taxonomies,
  canManageBadges,
  access,
}: {
  initial: AdminMembersPage;
  initialFilters: MembersFilters;
  badges: AdminBadge[];
  taxonomies: Taxonomies | null;
  canManageBadges: boolean;
  access: AccessRights;
}) {
  const t = useT();
  const [filters, setFilters] = useState<MembersFilters>(initialFilters);
  const [page, setPage] = useState(initial);
  /** Per filter, from the last first page (later pages don't count again). */
  const [counts, setCounts] = useState<AdminMemberCounts | null>(initial.counts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<SimpleBulk | null>(null);
  const [bulkBadge, setBulkBadge] = useState<"award" | "remove" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [badgeFor, setBadgeFor] = useState<AdminMemberRow | null>(null);
  const [officialFor, setOfficialFor] = useState<AdminMemberRow | null>(null);
  const [claudeFor, setClaudeFor] = useState<AdminMemberRow | null>(null);
  const [accessFor, setAccessFor] = useState<AdminMemberRow | null>(null);
  const [messageFor, setMessageFor] = useState<AdminMemberRow | null>(null);
  const selection = useSelection();
  const first = useRef(true);

  const countryNames = useMemo(() => new Map((taxonomies?.countries ?? []).map((c) => [c.code, c.name])), [taxonomies]);
  const activeBadges = badges.filter((b) => b.status === "active");
  const visibleIds = page.items.map((r) => r.id);
  const detail = detailId ? (page.items.find((r) => r.id === detailId) ?? null) : null;

  // A filter change: the URL follows (shareable, survives a reload) and the first page reloads.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.history.replaceState(window.history.state, "", `/members${membersSearch(filters)}`);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await api<AdminMembersPage>("/admin/members", { query: { ...membersApiQuery(filters), limit: MEMBERS_PAGE_SIZE }, signal: controller.signal });
        setPage(next);
        if (next.counts) setCounts(next.counts);
        // Batch actions only touch members that are shown.
        selection.retain(next.items.map((r) => r.id));
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // selection.retain is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const change = (patch: Partial<MembersFilters>) => setFilters((f) => ({ ...f, ...patch }));

  async function more() {
    setLoading(true);
    try {
      const next = await api<AdminMembersPage>("/admin/members", { query: { ...membersApiQuery(filters), limit: MEMBERS_PAGE_SIZE, cursor: page.nextCursor } });
      // The total and counts came with the first page.
      setPage((p) => ({ ...p, items: [...p.items, ...next.items], nextCursor: next.nextCursor }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  /** Puts updated rows in the list and keeps the tab counts in step. */
  function replaceRows(updated: AdminMemberRow[]) {
    const byId = new Map(updated.map((r) => [r.id, r]));
    const pairs = page.items.filter((r) => byId.has(r.id)).map((before) => ({ before, after: byId.get(before.id)! }));
    setPage((p) => ({ ...p, items: p.items.map((r) => byId.get(r.id) ?? r) }));
    setCounts((c) => recount(c, pairs));
  }
  const replace = (row: AdminMemberRow) => replaceRows([row]);

  async function set(row: AdminMemberRow, what: "verified" | "featured" | "official", value: boolean) {
    setBusyId(row.id);
    try {
      const updated = await api<AdminMemberRow>(`/admin/members/${row.id}/${what}`, { method: "PUT", body: { [what]: value } });
      replace(updated);
      toast(
        what === "official"
          ? value
            ? t("{name} is now an official account. Members follow it; its connections became followers.", { name: row.name })
            : t("{name} is an ordinary account again and can connect with members.", { name: row.name })
          : what === "verified"
            ? value
              ? t("{name} is verified.", { name: row.name })
              : t("{name}’s verified tick was removed.", { name: row.name })
            : value
              ? t("{name} will be suggested to new members.", { name: row.name })
              : t("{name} is no longer suggested to new members.", { name: row.name }),
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  /** The one action shown on each row: give or take away the verified tick. */
  const primaryFor = (row: AdminMemberRow) => ({
    label: row.verified ? t("Remove tick") : t("Verify"),
    onSelect: () => void set(row, "verified", !row.verified),
    disabled: busyId === row.id,
  });

  /** Everything else, in the row's ⋯ menu (and the detail panel's). */
  const menuFor = (row: AdminMemberRow, inPanel = false): RowMenuItem[] => {
    const busy = busyId === row.id;
    return [
      { label: t("Details"), onSelect: () => setDetailId(row.id), hidden: inPanel },
      { label: row.official ? t("Make ordinary account") : t("Make official"), onSelect: () => setOfficialFor(row), disabled: busy },
      { label: row.featured ? t("Stop suggesting") : t("Suggest on sign-up"), onSelect: () => void set(row, "featured", !row.featured), disabled: busy },
      { label: t("Badges…"), onSelect: () => setBadgeFor(row), disabled: busy },
      { label: t("Message"), onSelect: () => setMessageFor(row), hidden: !access.canMessage || row.official || row.id === access.viewerId },
      { label: t("Claude…"), onSelect: () => setClaudeFor(row) },
      { label: t("Access…"), onSelect: () => setAccessFor(row), hidden: !access.canManageRoles || row.id === access.viewerId },
      { label: `${t("View profile")} ↗`, onSelect: () => window.open(`${WEB_URL}/${row.handle}`, "_blank", "noopener") },
    ];
  };

  /** Sends a batch change for the picked members; failures stay picked so they can be retried. */
  async function bulk(action: AdminMembersBulkAction, done: string, extra: { badgeId?: string; note?: string } = {}) {
    const ids = selection.list.filter((id) => visibleIds.includes(id));
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const result = await runBulk("/admin/members/bulk", { ids, action, ...extra }, t, done);
      if (!result) return;
      const badge = extra.badgeId ? badges.find((b) => b.id === extra.badgeId) : undefined;
      const changed = new Set(result.done);
      replaceRows(page.items.filter((r) => changed.has(r.id)).map((r) => applied(r, action, badge)));
      selection.remove(result.done);
    } finally {
      setBulkBusy(false);
    }
  }

  function startBulk(action: SimpleBulk) {
    if (selection.count > 1) setConfirmBulk(action);
    else void bulk(action, BULK[action].done);
  }

  async function exportSelected() {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/v1/admin/members/export.csv", {
        method: "POST",
        headers: { accept: "text/csv", "content-type": "application/json", "x-cm-audience": "admin", "x-cm-csrf": "1" },
        body: JSON.stringify({ ids: selection.list, sort: filters.sort ?? "newest" }),
        credentials: "same-origin",
      });
      if (!res.ok) throw await ApiError.from(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = datedFileName("members");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBulkBusy(false);
    }
  }

  const allState = selection.state(visibleIds);

  return (
    <section className="flex flex-col gap-4">
      <MemberFilterBar
        filters={filters}
        counts={counts}
        badges={badges}
        taxonomies={taxonomies}
        exportHref={`/members/export${membersSearch(filters)}`}
        onChange={change}
      />

      {filters.filter === "featured" && (
        <p className="rounded-lg bg-info-light px-3 py-2 text-sm text-body">
          These members are suggested first in the “People to follow” step when someone signs up (as long as their profile is discoverable), oldest
          pick first. The rest of the suggestions come from shared country, sector and interests.
        </p>
      )}

      {filters.filter === "claude" && (
        <p className="rounded-lg bg-info-light px-3 py-2 text-sm text-body">
          These members can connect Claude to their own account: those given Claude access here, and the team, who always have it. Open “Claude” on a
          member to see what Claude did for them or to turn access off.
        </p>
      )}

      {!error && page.total !== null && page.items.length > 0 && (
        <p role="status" className="text-sm text-secondary tabular-nums">
          {t("Showing {from}–{to} of {total}", { from: 1, to: page.items.length, total: page.total })}
        </p>
      )}

      <div className={cn("overflow-x-auto rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {error ? (
          <p role="alert" className="px-5 py-6 text-sm text-error">
            {error}
          </p>
        ) : page.items.length === 0 ? (
          <EmptyState icon="users" title="No members match" />
        ) : (
          <table className="w-full min-w-[1000px] border-collapse text-start text-sm">
            <caption className="sr-only">Members</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="w-10 py-2.5 ps-4 pe-2 text-start">
                  <SelectAllBox state={allState} onToggle={() => selection.toggleAll(visibleIds)} disabled={bulkBusy} />
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Member
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Country
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Joined
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Badges
                </th>
                <th scope="col" className="py-2.5 pe-4 text-end font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => {
                const primary = primaryFor(row);
                return (
                  <tr key={row.id} className={cn("border-t border-line first:border-t-0", selection.has(row.id) && "bg-primary-light/5")}>
                    <td className="py-2.5 ps-4 pe-2">
                      <SelectBox checked={selection.has(row.id)} label={t("Select {name}", { name: row.name })} onChange={(on) => selection.toggle(row.id, on)} disabled={bulkBusy} />
                    </td>
                    <td className="max-w-[420px] py-2.5 pe-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} size={32} src={row.avatarUrl ?? undefined} />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailId(row.id)}
                              className="truncate text-start font-medium text-ink hover:underline"
                            >
                              {row.name}
                            </button>
                            {row.verified && <Icon name="verified" size={16} className="shrink-0 text-primary-light" label="Verified" />}
                            <MemberChips row={row} compact max={2} />
                          </span>
                          <span className="truncate text-xs text-secondary">@{row.handle}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap text-body">
                      {row.countryCode ? (countryNames.get(row.countryCode) ?? row.countryCode) : <span className="text-secondary">—</span>}
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap text-body tabular-nums">
                      <DateTime iso={row.joinedAt} dateOnly />
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap">
                      <StatusChip status={row.status} />
                    </td>
                    <td className="py-2.5 pe-3">
                      {row.badges.length ? (
                        <div className="flex flex-nowrap items-center gap-1">
                          {row.badges.slice(0, 2).map((b) => (
                            <ProfileBadgeChip key={b.id} badge={b} size="small" />
                          ))}
                          {row.badges.length > 2 && (
                            <span className="text-xs text-secondary" title={row.badges.slice(2).map((b) => b.name).join(", ")}>
                              +{row.badges.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-secondary">None</span>
                      )}
                    </td>
                    <td className="py-2.5 pe-4">
                      <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
                        <Button variant="ghost" size="small" disabled={primary.disabled} onClick={primary.onSelect}>
                          {primary.label}
                        </Button>
                        <RowMenu label={t("More actions for {name}", { name: row.name })} items={menuFor(row)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {page.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" size="small" disabled={loading} onClick={() => void more()}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
        {(["verify", "unverify", "feature", "unfeature"] as const).map((action) => (
          <Button key={action} variant="ghost" size="small" disabled={bulkBusy} onClick={() => startBulk(action)}>
            {t(BULK[action].label)}
          </Button>
        ))}
        <Button variant="ghost" size="small" disabled={bulkBusy || activeBadges.length === 0} onClick={() => setBulkBadge("award")}>
          Award badge…
        </Button>
        <Button variant="ghost" size="small" disabled={bulkBusy || badges.length === 0} onClick={() => setBulkBadge("remove")}>
          Remove badge…
        </Button>
        {(["claude_on", "claude_off"] as const).map((action) => (
          <Button key={action} variant="ghost" size="small" disabled={bulkBusy} onClick={() => startBulk(action)}>
            {t(BULK[action].label)}
          </Button>
        ))}
        <Button variant="ghost" size="small" disabled={bulkBusy} onClick={() => void exportSelected()}>
          Export selected
        </Button>
      </BulkBar>

      {confirmBulk && (
        <ReasonDialog
          title={t(BULK[confirmBulk].title, { count: selection.count })}
          description={t(BULK[confirmBulk].description)}
          confirmLabel={t(BULK[confirmBulk].confirm)}
          tone={BULK[confirmBulk].tone}
          reasonField="none"
          onConfirm={async () => {
            const action = confirmBulk;
            setConfirmBulk(null);
            await bulk(action, BULK[action].done);
          }}
          onClose={() => setConfirmBulk(null)}
        />
      )}
      {bulkBadge && (
        <BulkBadgeDialog
          mode={bulkBadge}
          count={selection.count}
          badges={bulkBadge === "award" ? activeBadges : badges}
          onSubmit={async (badgeId, note) => {
            const mode = bulkBadge;
            setBulkBadge(null);
            await bulk(
              mode === "award" ? "award_badge" : "remove_badge",
              mode === "award" ? "Badge awarded to {count} members." : "Badge removed from {count} members.",
              { badgeId, ...(note ? { note } : {}) },
            );
          }}
          onClose={() => setBulkBadge(null)}
        />
      )}

      {detail && (
        <MemberDetailPanel row={detail} taxonomies={taxonomies} primary={primaryFor(detail)} menu={menuFor(detail, true)} onClose={() => setDetailId(null)} />
      )}
      {officialFor && (
        <ReasonDialog
          title={officialFor.official ? t("Make {name} an ordinary account?", { name: officialFor.name }) : t("Make {name} an official account?", { name: officialFor.name })}
          description={
            officialFor.official ? (
              "It will be able to send and receive connection requests like any member. Its followers stay; nobody is reconnected automatically."
            ) : (
              <>
                Use this for an account that speaks for an organisation, such as the Charter Mission account. Members will only be able to <strong>follow</strong> it: the Connect button
                disappears, its current connections and pending requests become followers, and it gets the verified tick. People on the team should stay ordinary accounts so they can
                connect as themselves.
              </>
            )
          }
          confirmLabel={officialFor.official ? "Make ordinary" : "Make official"}
          reasonField="none"
          onConfirm={async () => {
            const row = officialFor;
            setOfficialFor(null);
            await set(row, "official", !row.official);
          }}
          onClose={() => setOfficialFor(null)}
        />
      )}
      {messageFor && <MessageMemberDialog member={messageFor} onClose={() => setMessageFor(null)} />}
      {accessFor && (
        <MemberAccess
          member={accessFor}
          canAssignSuperAdmin={access.canAssignSuperAdmin}
          canResetTwoStep={!!access.canResetTwoStep}
          onSaved={(row) => {
            replace(row);
            setAccessFor(null);
            toast(t("Access updated for {name}.", { name: row.name }));
          }}
          onTwoStepReset={(row) => {
            replace(row);
            setAccessFor(null);
            toast(t("Two-step verification was reset for {name}. They have been signed out everywhere.", { name: row.name }));
          }}
          onClose={() => setAccessFor(null)}
        />
      )}
      {claudeFor && (
        <ClaudeAccessDialog
          member={claudeFor}
          onChanged={(row) => {
            replace(row);
            toast(
              row.mcpAccess
                ? t("{name} can now connect Claude to their account.", { name: row.name })
                : t("Claude access turned off for {name}. Their connections were disconnected.", { name: row.name }),
            );
          }}
          onClose={() => setClaudeFor(null)}
        />
      )}
      {badgeFor && (
        <AwardBadges
          member={badgeFor}
          badges={activeBadges}
          canManageBadges={canManageBadges}
          onSaved={(row) => {
            replace(row);
            setBadgeFor(null);
            toast(t("Badges updated for {name}.", { name: row.name }));
          }}
          onClose={() => setBadgeFor(null)}
        />
      )}
    </section>
  );
}

const STATUS_TONES: Record<string, "success" | "neutral" | "warning" | "error"> = {
  active: "success",
  unverified: "neutral",
  suspended: "error",
  deactivated: "neutral",
  deletion_pending: "warning",
};

function StatusChip({ status }: { status: string }) {
  const t = useT();
  return (
    <Chip tone={STATUS_TONES[status] ?? "neutral"} className="px-2 py-0.5 text-xs">
      {t(STATUS_LABELS[status] ?? status)}
    </Chip>
  );
}
