"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminAssignableRole, AdminBadge, AdminMemberRow } from "@chartermission/contracts";
import { Button, Chip, ProfileBadgeChip, cn } from "@chartermission/ui";
import { FormModal, selectClasses } from "@/components/ambassadors/modal";
import { inputClasses } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

export const ROLE_INFO: { role: AdminAssignableRole; name: string; description: string; console: boolean }[] = [
  { role: "moderator", name: "Moderator", description: "Works the report queue: hides and removes content, warns, restricts and suspends members.", console: true },
  { role: "platform_admin", name: "Platform Admin", description: "Everything in the console except Super Admin: members, chapters, events, pages, settings.", console: true },
  { role: "super_admin", name: "Super Admin", description: "Everything, including giving and taking away Super Admin.", console: true },
  { role: "event_host", name: "Event Host", description: "Publishes events without review (no console access).", console: false },
];

/** Award or remove badges on one member. */
export function AwardBadges({
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
export function MemberAccess({
  member,
  canAssignSuperAdmin,
  canResetTwoStep,
  onSaved,
  onTwoStepReset,
  onClose,
}: {
  member: AdminMemberRow;
  canAssignSuperAdmin: boolean;
  canResetTwoStep: boolean;
  onSaved: (row: AdminMemberRow) => void;
  onTwoStepReset: (row: AdminMemberRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reset is asked for twice: the button, then "Yes, reset". */
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function resetTwoStep() {
    setBusy(true);
    setError(null);
    try {
      onTwoStepReset(await api<AdminMemberRow>(`/admin/members/${member.id}/two-step/reset`, { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      setConfirmingReset(false);
    }
  }
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
      {canResetTwoStep && (
        <section className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-ink">Two-step verification</h3>
            <Chip tone={member.twoStep ? "success" : "neutral"}>{member.twoStep ? "On" : "Off"}</Chip>
          </div>
          {member.twoStep ? (
            <>
              <p className="text-xs text-secondary">
                For someone who has lost every device. Resetting removes their authenticator devices, signs them out everywhere and emails them; a team member sets it up again at their next sign-in. Make sure
                it really is them asking before you reset.
              </p>
              {confirmingReset ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{t("Reset two-step verification for {name}?", { name: member.name })}</span>
                  <Button variant="accent" size="small" disabled={busy} onClick={() => void resetTwoStep()}>
                    Yes, reset
                  </Button>
                  <Button variant="ghost" size="small" disabled={busy} onClick={() => setConfirmingReset(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="small" disabled={busy} className="self-start" onClick={() => setConfirmingReset(true)}>
                  Reset two-step verification
                </Button>
              )}
            </>
          ) : (
            <p className="text-xs text-secondary">Not set up on this account, so there is nothing to reset.</p>
          )}
        </section>
      )}
    </FormModal>
  );
}

/**
 * Award or remove one badge on the picked members (POST /admin/members/bulk). The parent confirms
 * nothing more: this dialog says how many members it changes.
 */
export function BulkBadgeDialog({
  mode,
  count,
  badges,
  onSubmit,
  onClose,
}: {
  mode: "award" | "remove";
  count: number;
  badges: AdminBadge[];
  onSubmit: (badgeId: string, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={mode === "award" ? t("Award a badge to {count} members", { count }) : t("Remove a badge from {count} members", { count })}
      description={mode === "award" ? "Members who already hold the badge keep it." : "Members who don’t hold the badge are left as they are."}
      submitLabel={mode === "award" ? "Award badge" : "Remove badge"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        const badgeId = String(data.get("badge") ?? "");
        if (!badgeId) {
          setError(t("Choose a badge."));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await onSubmit(badgeId, String(data.get("note") ?? "").trim());
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      {badges.length === 0 ? (
        <p className="text-sm text-secondary">No badges are turned on.</p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink">Badge</span>
          <select name="badge" defaultValue="" className={selectClasses(false)}>
            <option value="" disabled>
              Choose a badge
            </option>
            {badges.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "award" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink">Note for the audit log (optional)</span>
          <input name="note" maxLength={200} className={inputClasses(false)} placeholder="Why this badge was awarded" />
        </label>
      )}
    </FormModal>
  );
}
