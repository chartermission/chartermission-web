"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { InitiativeDetail, InitiativeJoinRequestView, InitiativeTeamMember } from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { TimeAgo } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { initiativeHref } from "./format";
import { NoTranslate } from "@/i18n/auto";
import { T, useT } from "@/i18n/client";

/** One join request: who, for which role, their note; accept or decline with an optional message. */
function RequestCard({ initiativeId, request, onDecided }: { initiativeId: string; request: InitiativeJoinRequestView; onDecided: (r: InitiativeJoinRequestView) => void }) {
  const t = useT();
  const id = useId();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  async function decide(decision: "accept" | "decline") {
    setBusy(decision);
    try {
      const updated = await api<InitiativeJoinRequestView>(`/initiatives/${initiativeId}/join-requests/${request.id}/decision`, {
        method: "POST",
        body: { decision, message: message.trim() || null },
      });
      toast.success(decision === "accept" ? t("{name} is on the team", { name: request.member.name }) : "Request declined");
      onDecided(updated);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  }

  const pending = request.status === "pending";
  return (
    <li className="flex flex-col gap-3 rounded-[10px] border border-line bg-card p-4">
      <div className="flex items-start gap-3">
        <MemberAvatar member={request.member} size={40} link />
        <div className="flex min-w-0 flex-1 flex-col">
          <Link href={memberHref(request.member.handle)} className="truncate text-md font-medium text-ink hover:underline">
            {request.member.name}
          </Link>
          {request.member.headline && <span className="truncate text-xs text-secondary">{request.member.headline}</span>}
          <span className="text-xs text-secondary">
            {request.role ? (
              <T vars={{ role: request.role.title }}>{"For {role}"}</T>
            ) : (
              "Any role"
            )}{" "}
            · <TimeAgo iso={request.createdAt} />
          </span>
        </div>
        {!pending && <Chip tone={request.status === "accepted" ? "success" : "neutral"}>{request.status === "accepted" ? "Accepted" : "Declined"}</Chip>}
      </div>
      <NoTranslate>
        <p className="text-sm whitespace-pre-line text-body">{request.note}</p>
      </NoTranslate>
      {request.skills && (
        <p className="text-xs text-secondary">
          <span className="font-medium text-ink">Skills: </span>
          <NoTranslate>{request.skills}</NoTranslate>
        </p>
      )}
      {pending && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <label htmlFor={`${id}-message`} className="text-xs font-medium text-secondary">
            Message to them (optional)
          </label>
          <input
            id={`${id}-message`}
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Welcome! We meet on Thursdays."
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="small" disabled={!!busy} onClick={() => void decide("decline")}>
              {busy === "decline" ? "Declining…" : "Decline"}
            </Button>
            <Button size="small" disabled={!!busy} onClick={() => void decide("accept")}>
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** A team member row: what they do, organiser or not, and remove. */
function TeamRow({ initiativeId, member, onChanged }: { initiativeId: string; member: InitiativeTeamMember; onChanged: (d: InitiativeDetail) => void }) {
  const t = useT();
  const [role, setRole] = useState(member.role ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function patch(body: { role?: string | null; organiser?: boolean }) {
    setSaving(true);
    try {
      onChanged(await api<InitiativeDetail>(`/initiatives/${initiativeId}/team/${member.member.id}`, { method: "PATCH", body }));
      toast.success("Saved");
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <MemberAvatar member={member.member} size={40} link />
      <div className="flex min-w-[160px] flex-1 flex-col">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {member.member.name}
          {member.lead && <Chip tone="hashtag">Lead</Chip>}
        </span>
        <input
          value={role}
          maxLength={80}
          aria-label={t("What {name} does", { name: member.member.name })}
          placeholder="What they do, e.g. Trade advisor · Casablanca"
          onChange={(e) => setRole(e.target.value)}
          onBlur={() => role.trim() !== (member.role ?? "") && void patch({ role: role.trim() || null })}
          className="-ms-1.5 mt-1 w-full max-w-[360px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-secondary hover:border-line focus:border-primary-light focus:outline-none"
        />
      </div>
      <label className={cn("flex items-center gap-2 text-sm", member.lead ? "text-disabled" : "text-ink")}>
        <input
          type="checkbox"
          checked={member.organiser}
          disabled={member.lead || saving}
          onChange={(e) => void patch({ organiser: e.target.checked })}
          className="size-4 accent-primary"
        />
        Organiser
      </label>
      {!member.lead && (
        <button
          type="button"
          onClick={() => setRemoving(true)}
          aria-label={t("Remove {name} from the team", { name: member.member.name })}
          className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
        >
          <Icon name="x" size={18} />
        </button>
      )}
      {removing && (
        <ConfirmDialog
          title={t("Remove {name}?", { name: member.member.name })}
          confirmLabel="Remove"
          danger
          onConfirm={async () => {
            onChanged(await api<InitiativeDetail>(`/initiatives/${initiativeId}/team/${member.member.id}`, { method: "DELETE" }));
            toast.success("Removed from the team");
          }}
          onClose={() => setRemoving(false)}
        >
          They stop appearing on the team. They can ask to join again while the initiative is recruiting.
        </ConfirmDialog>
      )}
    </li>
  );
}

/**
 * Organisers' page for an initiative: join requests waiting for an answer (and the ones answered),
 * the team (what each person does, who organises), and deleting it.
 */
export function ManageInitiative({ initiative: initial, requests: initialRequests }: { initiative: InitiativeDetail; requests: InitiativeJoinRequestView[] }) {
  const t = useT();
  const router = useRouter();
  const [initiative, setInitiative] = useState(initial);
  const [requests, setRequests] = useState(initialRequests);
  const [deleting, setDeleting] = useState(false);
  const pending = requests.filter((r) => r.status === "pending");
  const answered = requests.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col gap-6">
      <Panel aria-labelledby="requests-heading" className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="requests-heading" className="text-h3 text-ink">
            Join requests
          </h2>
          <span className="text-sm text-secondary">
            <T vars={{ count: pending.length }}>{"{count} waiting"}</T>
          </span>
        </div>
        {initiative.status !== "recruiting" && (
          <p className="flex items-start gap-2 rounded-[10px] bg-muted p-3 text-sm text-body">
            <Icon name="info" size={16} className="mt-0.5 shrink-0 text-secondary" />
            New requests open when the status is Recruiting. You can still answer the ones waiting.
          </p>
        )}
        {pending.length ? (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <RequestCard
                key={r.id}
                initiativeId={initiative.id}
                request={r}
                onDecided={(updated) => {
                  setRequests((rs) => rs.map((x) => (x.id === updated.id ? updated : x)));
                  router.refresh();
                  if (updated.status === "accepted") {
                    void api<InitiativeDetail>(`/initiatives/${initiative.id}`).then(setInitiative, () => undefined);
                  }
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">No requests waiting. When members ask to join, they appear here and you get a notification.</p>
        )}
        {answered.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-primary-light hover:underline">
              <T vars={{ count: answered.length }}>{"Answered requests ({count})"}</T>
            </summary>
            <ul className="mt-3 flex flex-col gap-3">
              {answered.map((r) => (
                <RequestCard key={r.id} initiativeId={initiative.id} request={r} onDecided={() => undefined} />
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <Panel aria-labelledby="team-heading" className="flex flex-col gap-1 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="team-heading" className="text-h3 text-ink">
            Team
          </h2>
          <span className="text-sm text-secondary">{t("{count} people", { count: initiative.team.length })}</span>
        </div>
        <p className="text-sm text-secondary">Organisers can edit the initiative, answer requests, manage the team and post updates.</p>
        <ul className="divide-y divide-line">
          {initiative.team.map((m) => (
            <TeamRow key={m.member.id} initiativeId={initiative.id} member={m} onChanged={setInitiative} />
          ))}
        </ul>
      </Panel>

      {initiative.viewer.canDelete && (
        <Panel aria-labelledby="delete-heading" className="flex flex-wrap items-center justify-between gap-3 border-error/30 p-5">
          <div className="flex flex-col gap-1">
            <h2 id="delete-heading" className="text-h3 text-ink">
              Delete this initiative
            </h2>
            <p className="text-sm text-secondary">It disappears from Initiatives and its page closes. Updates already posted stay in people’s feeds.</p>
          </div>
          <Button variant="secondary" className="text-error" onClick={() => setDeleting(true)}>
            Delete initiative
          </Button>
        </Panel>
      )}
      {deleting && (
        <ConfirmDialog
          title={t("Delete {title}?", { title: initiative.title })}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            try {
              await api(`/initiatives/${initiative.id}`, { method: "DELETE" });
            } catch (e) {
              throw isApiError(e) ? new Error(e.message) : e;
            }
            toast.success("Initiative deleted");
            router.push("/initiatives");
            router.refresh();
          }}
          onClose={() => setDeleting(false)}
        >
          This can’t be undone.
        </ConfirmDialog>
      )}
      <Link href={initiativeHref(initiative.slug)} className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        Back to the initiative
      </Link>
    </div>
  );
}
