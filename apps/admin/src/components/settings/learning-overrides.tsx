"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminLearningMember } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";

function accessChip(m: AdminLearningMember) {
  const a = m.access;
  if (a.reason === "override") return <Chip tone="info">Unlocked by admin</Chip>;
  if (a.reason === "staff") return <Chip tone="info">Staff</Chip>;
  if (a.reason === "open") return <Chip>Open to all</Chip>;
  if (a.reason === "met") return <Chip tone="success">Rules met</Chip>;
  const done = a.requirements.filter((r) => r.done).length;
  return <Chip tone="warning">{`Locked · ${done} of ${a.requirements.length} done`}</Chip>;
}

function MemberRow({ member, onChange }: { member: AdminLearningMember; onChange: (m: AdminLearningMember) => void }) {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const missing = member.access.requirements.filter((r) => !r.done);

  async function unlock(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const next = await api<AdminLearningMember>(`/admin/learning/access/overrides/${member.id}`, {
        method: "PUT",
        body: note.trim() ? { note: note.trim() } : {},
      });
      onChange(next);
      setAsking(false);
      setNote("");
      toast(`Learning unlocked for ${member.name}.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function relock() {
    setBusy(true);
    try {
      const next = await api<AdminLearningMember>(`/admin/learning/access/overrides/${member.id}`, { method: "DELETE" });
      onChange(next);
      toast(`${member.name} is back under the unlock rules.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={member.name} src={member.avatarUrl ?? undefined} size={40} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{member.name}</span>
              {accessChip(member)}
            </span>
            <span className="truncate text-xs text-secondary">
              @{member.handle} · {member.email}
            </span>
            {member.override && (
              <span className="text-xs text-secondary">
                Unlocked <DateTime iso={member.override.grantedAt} dateOnly />
                {member.override.grantedBy ? ` by ${member.override.grantedBy}` : ""}
                {member.override.note ? ` · “${member.override.note}”` : ""}
              </span>
            )}
            {!member.override && member.access.reason === "locked" && missing.length > 0 && (
              <span className="text-xs text-secondary">
                Still to do:{" "}
                {missing.map((r) => (r.target > 1 ? `${r.label} (${r.current}/${r.target})` : r.label)).join(", ")}
              </span>
            )}
          </div>
        </div>
        {member.override ? (
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void relock()}>
            Remove override
          </Button>
        ) : member.access.reason === "locked" || member.access.reason === "met" ? (
          !asking && (
            <Button size="small" variant="secondary" disabled={busy} onClick={() => setAsking(true)}>
              Unlock Learning
            </Button>
          )
        ) : null}
      </div>
      {asking && (
        <form onSubmit={unlock} className="flex flex-wrap items-end gap-2 pl-[52px]">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-xs text-secondary">Reason (optional, kept in the audit log)</span>
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Partner organisation staff"
              className={inputClasses(false)}
              autoFocus
            />
          </label>
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            Unlock
          </Button>
          <Button type="button" size="small" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

/**
 * Per-member overrides (course.curate): search any member to see where they stand and unlock Learning
 * for them regardless of the rules. With no search, lists everyone currently unlocked by an admin.
 */
export function LearningOverrides() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [members, setMembers] = useState<AdminLearningMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<AdminLearningMember[]>(`/admin/learning/access/members${submitted ? `?q=${encodeURIComponent(submitted)}` : ""}`)
      .then((rows) => !cancelled && setMembers(rows))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [submitted]);

  const replace = (m: AdminLearningMember) => setMembers((list) => (list ?? []).map((x) => (x.id === m.id ? m : x)));

  return (
    <section aria-labelledby="learning-overrides" className="flex flex-col rounded-card border border-line bg-card">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <div className="flex flex-col gap-1">
          <h2 id="learning-overrides" className="text-h3 text-ink">
            Member overrides
          </h2>
          <p className="text-sm text-secondary">
            Unlock Learning for a member whatever the rules say, for example partner staff or invited trainers. Removing the override puts
            them back under the rules.
          </p>
        </div>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
          className="flex gap-2"
        >
          <label htmlFor="learning-member-search" className="sr-only">
            Search members
          </label>
          <span className="relative flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-secondary" />
            <input
              id="learning-member-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) setSubmitted("");
              }}
              placeholder="Name, @handle or email"
              className={inputClasses(false, "pl-9")}
            />
          </span>
          <Button type="submit" size="small" variant="secondary">
            Search
          </Button>
        </form>
      </div>
      {error ? (
        <div className="p-5">
          <FormNotice tone="error">{error}</FormNotice>
        </div>
      ) : loading && !members ? (
        <div className="h-24 animate-pulse" />
      ) : members && members.length > 0 ? (
        <ul className="divide-y divide-line" aria-busy={loading}>
          {members.map((m) => (
            <MemberRow key={m.id} member={m} onChange={replace} />
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-secondary">
          {submitted ? `No members match “${submitted}”.` : "No members have been unlocked by an admin yet. Search for a member to unlock them."}
        </p>
      )}
    </section>
  );
}
