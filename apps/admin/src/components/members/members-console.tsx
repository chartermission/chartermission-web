"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AdminAssignableRole, AdminBadge, AdminMemberRow, AdminMembersQuery, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, ProfileBadgeChip, SegmentedControl, cn } from "@chartermission/ui";
import { FormModal, selectClasses } from "@/components/ambassadors/modal";
import { inputClasses } from "@/components/form-field";
import { EmptyState } from "@/components/states";
import { ReasonDialog } from "@/components/reason-dialog";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { WEB_URL } from "@/lib/navigation";
import { useT } from "@/i18n/client";

type Filter = Exclude<AdminMembersQuery["filter"], "badge"> | `badge:${string}`;

/** Members (GET /admin/members): search, then verify, feature in sign-up suggestions or award badges. */
/** Who may change roles in the console, and whether that includes Super Admin. */
export type AccessRights = { viewerId: string; canManageRoles: boolean; canAssignSuperAdmin: boolean };

const ROLE_INFO: { role: AdminAssignableRole; name: string; description: string; console: boolean }[] = [
  { role: "moderator", name: "Moderator", description: "Works the report queue: hides and removes content, warns, restricts and suspends members.", console: true },
  { role: "platform_admin", name: "Platform Admin", description: "Everything in the console except Super Admin: members, chapters, events, pages, settings.", console: true },
  { role: "super_admin", name: "Super Admin", description: "Everything, including giving and taking away Super Admin.", console: true },
  { role: "event_host", name: "Event Host", description: "Publishes events without review (no console access).", console: false },
];

export function MembersConsole({
  initial,
  badges,
  canManageBadges,
  access,
}: {
  initial: Page<AdminMemberRow>;
  badges: AdminBadge[];
  canManageBadges: boolean;
  access: AccessRights;
}) {
  const t = useT();
  const [page, setPage] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [badgeFor, setBadgeFor] = useState<AdminMemberRow | null>(null);
  const [officialFor, setOfficialFor] = useState<AdminMemberRow | null>(null);
  const first = useRef(true);

  const queryFor = (cursor?: string | null) => ({
    q: query.trim() || undefined,
    filter: filter.startsWith("badge:") ? "badge" : filter,
    badge: filter.startsWith("badge:") ? filter.slice(6) : undefined,
    cursor: cursor ?? undefined,
  });

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        setPage(await api<Page<AdminMemberRow>>("/admin/members", { query: queryFor(), signal: controller.signal }));
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
    // queryFor reads query and filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  async function more() {
    setLoading(true);
    try {
      const next = await api<Page<AdminMemberRow>>("/admin/members", { query: queryFor(page.nextCursor) });
      setPage((p) => ({ items: [...p.items, ...next.items], nextCursor: next.nextCursor }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  const replace = (row: AdminMemberRow) => setPage((p) => ({ ...p, items: p.items.map((r) => (r.id === row.id ? row : r)) }));

  async function set(row: AdminMemberRow, what: "verified" | "featured" | "official", value: boolean) {
    setBusyId(row.id);
    try {
      replace(await api<AdminMemberRow>(`/admin/members/${row.id}/${what}`, { method: "PUT", body: { [what]: value } }));
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

  const activeBadges = badges.filter((b) => b.status === "active");
  const [accessFor, setAccessFor] = useState<AdminMemberRow | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[260px] flex-1">
          <span className="sr-only">Search members</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 left-3 my-auto h-fit text-secondary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, @handle or email"
            className={inputClasses(false, "pl-9")}
          />
        </label>
        <SegmentedControl
          label="Show"
          size="small"
          value={filter.startsWith("badge:") ? "all" : (filter as Exclude<Filter, `badge:${string}`>)}
          onChange={setFilter}
          items={[
            { value: "all", label: "All" },
            { value: "verified", label: "Verified" },
            { value: "unverified", label: "Not verified" },
            { value: "featured", label: "Suggested on sign-up" },
          ]}
        />
        <span className="relative w-[200px]">
          <select
            aria-label="Filter by badge"
            value={filter.startsWith("badge:") ? filter : ""}
            onChange={(e) => setFilter((e.target.value || "all") as Filter)}
            className={selectClasses(false)}
          >
            <option value="">Any badge</option>
            {badges.map((b) => (
              <option key={b.id} value={`badge:${b.slug}`}>
                {b.name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} className="pointer-events-none absolute inset-y-0 right-3 my-auto h-fit text-secondary" />
        </span>
      </div>

      {filter === "featured" && (
        <p className="rounded-lg bg-info-light px-3 py-2 text-sm text-body">
          These members are suggested first in the “People to follow” step when someone signs up (as long as their profile is discoverable), oldest
          pick first. The rest of the suggestions come from shared country, sector and interests.
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
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <caption className="sr-only">Members</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2.5 pr-2.5 pl-4 font-semibold">Member</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Email</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Badges</th>
                <th scope="col" className="py-2.5 pr-4 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => {
                const busy = busyId === row.id;
                return (
                  <tr key={row.id} className="border-t border-line align-top first:border-t-0">
                    <td className="py-3 pr-2.5 pl-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} size={40} src={row.avatarUrl ?? undefined} />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1 font-medium text-ink">
                            <Link href={`${WEB_URL}/${row.handle}`} target="_blank" className="hover:underline">
                              {row.name}
                            </Link>
                            {row.verified && <Icon name="verified" size={16} className="text-primary-light" label="Verified" />}
                          </span>
                          <span className="text-xs text-secondary">
                            @{row.handle}
                            {row.countryCode && ` · ${row.countryCode}`}
                            {row.status !== "active" && ` · ${row.status}`}
                          </span>
                          {(row.featured || row.staff || row.official || row.roles.length > 0) && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {ROLE_INFO.filter((r) => row.roles.includes(r.role)).map((r) => (
                                <Chip key={r.role} tone={r.console ? "success" : "neutral"}>
                                  {r.name}
                                </Chip>
                              ))}
                              {row.featured && <Chip tone="info">Suggested on sign-up</Chip>}
                              {row.official && <Chip tone="warning">Official account · follow only</Chip>}
                              {row.staff && !row.official && <Chip tone="neutral">Team member</Chip>}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-2.5 text-body">{row.email}</td>
                    <td className="py-3 pr-2.5">
                      {row.badges.length ? (
                        <div className="flex flex-wrap gap-1">
                          {row.badges.map((b) => (
                            <ProfileBadgeChip key={b.id} badge={b} size="small" />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-secondary">None</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => void set(row, "verified", !row.verified)}>
                          {row.verified ? "Remove tick" : "Verify"}
                        </Button>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => setOfficialFor(row)}>
                          {row.official ? "Make ordinary account" : "Make official"}
                        </Button>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => void set(row, "featured", !row.featured)}>
                          {row.featured ? "Stop suggesting" : "Suggest on sign-up"}
                        </Button>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => setBadgeFor(row)}>
                          Badges
                        </Button>
                        {access.canManageRoles && row.id !== access.viewerId && (
                          <Button variant="ghost" size="small" disabled={busy} onClick={() => setAccessFor(row)}>
                            Access
                          </Button>
                        )}
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
      {accessFor && (
        <MemberAccess
          member={accessFor}
          canAssignSuperAdmin={access.canAssignSuperAdmin}
          onSaved={(row) => {
            replace(row);
            setAccessFor(null);
            toast(t("Access updated for {name}.", { name: row.name }));
          }}
          onClose={() => setAccessFor(null)}
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

function AwardBadges({
  member,
  badges,
  canManageBadges,
  onSaved,
  onClose,
}: {
  member: AdminMemberRow;
  badges: AdminBadge[];
  canManageBadges: boolean;
  onSaved: (row: AdminMemberRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = new Set(member.badges.map((b) => b.id));
  // Badges that are turned off can still be taken away.
  const offHeld = member.badges.filter((b) => !badges.some((a) => a.id === b.id));
  return (
    <FormModal
      title={t("Badges for {name}", { name: member.name })}
      description="Badges show on the member’s profile."
      submitLabel="Save badges"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        const want = new Set(data.getAll("badge").map(String));
        const note = String(data.get("note") ?? "").trim();
        try {
          let row = member;
          for (const id of want) {
            if (!held.has(id)) row = await api<AdminMemberRow>(`/admin/members/${member.id}/badges`, { method: "POST", body: { badgeId: id, ...(note ? { note } : {}) } });
          }
          for (const id of held) {
            if (!want.has(id)) row = await api<AdminMemberRow>(`/admin/members/${member.id}/badges/${id}`, { method: "DELETE" });
          }
          onSaved(row);
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      {badges.length === 0 && offHeld.length === 0 ? (
        <p className="text-sm text-secondary">
          No badges are turned on.{" "}
          {canManageBadges ? (
            <Link href="/badges" className="text-primary underline">
              Create one on Badges
            </Link>
          ) : (
            "Ask a Platform Admin to create one."
          )}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Badges</legend>
          {[...badges, ...offHeld].map((b) => (
            <label key={b.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-surface">
              <input type="checkbox" name="badge" value={b.id} defaultChecked={held.has(b.id)} className="mt-1 size-4 accent-primary" />
              <span className="flex flex-col gap-1">
                <ProfileBadgeChip badge={b} size="small" />
                <span className="text-xs text-secondary">{b.description || "No description"}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">Note for the audit log (optional)</span>
        <input name="note" maxLength={200} className={inputClasses(false)} placeholder="Why this badge was awarded" />
      </label>
    </FormModal>
  );
}

/** Team access: console roles (two-step verification required at their next sign-in) and Event Host. */
function MemberAccess({
  member,
  canAssignSuperAdmin,
  onSaved,
  onClose,
}: {
  member: AdminMemberRow;
  canAssignSuperAdmin: boolean;
  onSaved: (row: AdminMemberRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = new Set(member.roles);
  return (
    <FormModal
      title={t("Access for {name}", { name: member.name })}
      description="Console roles let them sign in to this admin console; they will set up two-step verification at their first sign-in, and we email them. Every change is in the audit log."
      submitLabel="Save access"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        const want = new Set(data.getAll("role").map(String) as AdminAssignableRole[]);
        try {
          let row = member;
          for (const { role } of ROLE_INFO) {
            if (role === "super_admin" && !canAssignSuperAdmin) continue;
            if (want.has(role) !== held.has(role)) {
              row = await api<AdminMemberRow>(`/admin/members/${member.id}/roles`, { method: "PUT", body: { role, granted: want.has(role) } });
            }
          }
          onSaved(row);
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Roles</legend>
        {ROLE_INFO.map((r) => {
          const locked = r.role === "super_admin" && !canAssignSuperAdmin;
          return (
            <label key={r.role} className={cn("flex items-start gap-3 rounded-lg border border-line px-3 py-2.5", locked ? "opacity-60" : "cursor-pointer hover:bg-surface")}>
              <input type="checkbox" name="role" value={r.role} defaultChecked={held.has(r.role)} disabled={locked} className="mt-1 size-4 accent-primary" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{r.name}</span>
                <span className="text-xs text-secondary">{locked ? "Only a Super Admin can change this." : r.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </FormModal>
  );
}
