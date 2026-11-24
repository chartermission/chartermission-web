"use client";

import { useMemo, useState } from "react";
import type { BulkResult, MemberRef } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { PersonRow, SearchField, useConnections, useMemberSearch } from "@/components/messages/group-dialogs";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { ApiError, api } from "@/lib/api/client";

const MAX_INVITES = 50;

/**
 * Invite people to a group: the viewer's connections first, any other member by search (2+
 * letters). Several can be picked; the group's admins see who invited whom.
 */
export function GroupInviteDialog({ group, viewerHandle, onClose }: { group: { slug: string; name: string }; viewerHandle: string; onClose: () => void }) {
  const t = useT();
  const { people, error: loadError } = useConnections(viewerHandle);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MemberRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const connectionIds = useMemo(() => new Set((people ?? []).map((p) => p.id)), [people]);
  const others = useMemberSearch(query, connectionIds);
  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q));
  const pickedIds = new Set(picked.map((p) => p.id));

  const toggle = (person: MemberRef) =>
    setPicked((current) => (current.some((p) => p.id === person.id) ? current.filter((p) => p.id !== person.id) : current.length >= MAX_INVITES ? current : [...current, person]));

  async function send() {
    if (busy || !picked.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Partial<BulkResult> | null>(`/groups/${group.slug}/invitations`, { method: "POST", body: { memberIds: picked.map((p) => p.id) } });
      const sent = result?.done?.length ?? picked.length;
      const failed = result?.failed ?? [];
      if (sent > 0) toast.success(t("Invitation sent to {count} people", { count: sent }));
      if (failed.length) {
        const names = failed.map((f) => picked.find((p) => p.id === f.id)?.name ?? f.id);
        toast.error(new ApiError(422, "UNKNOWN", t("Not invited: {names}. They may already be in the group or can’t be invited.", { names: names.join(", ") })));
      }
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("Invite people to {name}", { name: group.name })}
      description={t("They get a notification and can accept from the group’s page.")}
      onClose={onClose}
      width={480}
      flush
      footer={
        <>
          {error ? <ErrorNotice error={error} className="w-full" /> : null}
          <Button onClick={send} aria-disabled={busy || !picked.length}>
            {busy ? t("Sending…") : picked.length ? t("Invite ({count})", { count: picked.length }) : t("Invite")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 border-b border-line px-5 py-3">
        <SearchField value={query} onChange={setQuery} placeholder={t("Search your connections or any member")} />
        {picked.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("Picked")}>
            {picked.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  className="flex items-center gap-1 rounded-full bg-primary-tint px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-tint-2"
                  aria-label={t("Remove {name}", { name: person.name })}
                >
                  {person.name}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="max-h-[360px] min-h-[160px] overflow-y-auto">
        {loadError ? (
          <div className="p-5">
            <ErrorNotice error={loadError} />
          </div>
        ) : !people ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : (
          <>
            {shown.length > 0 && (
              <>
                <p className="px-5 pb-1 pt-3 text-label text-secondary">{t("Your connections")}</p>
                <ul>
                  {shown.map((person) => (
                    <li key={person.id}>
                      <PersonRow person={person} selected={pickedIds.has(person.id)} onClick={() => toggle(person)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {others.length > 0 && (
              <>
                <p className="px-5 pb-1 pt-3 text-label text-secondary">{t("Other members")}</p>
                <ul>
                  {others.map((person) => (
                    <li key={person.id}>
                      <PersonRow person={person} selected={pickedIds.has(person.id)} onClick={() => toggle(person)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {shown.length === 0 && others.length === 0 && (
              <p className="p-6 text-center text-sm text-secondary">
                {q.length >= 2 ? t("No one matches that name.") : people.length ? t("No connections match. Type 2 or more letters to search every member.") : t("Type 2 or more letters to search for members.")}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
