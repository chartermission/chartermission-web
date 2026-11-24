"use client";

import { useId, useState } from "react";
import type { GroupDetail, GroupMembership, GroupSummary } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, type ButtonProps } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";

export type JoinableGroup = Pick<GroupSummary, "slug" | "name" | "visibility" | "status"> & {
  /** Undefined when not known yet (cards): it is fetched before asking. */
  joinQuestion?: string | null;
};

type Status = GroupMembership["status"];

/** POST /groups/{slug}/leave: leave, cancel a request or turn down an invitation. */
export function leaveGroup(slug: string) {
  return api(`/groups/${slug}/leave`, { method: "POST", body: {} });
}

/**
 * Join / Ask to join / Accept / Joined / Requested, by the viewer's membership. Changes show at
 * once and roll back if the API refuses. Asking to join a group with a join question opens a
 * short form first.
 */
export function JoinGroupButton({
  group,
  membership,
  size = "small",
  block = false,
  onChange,
}: {
  group: JoinableGroup;
  membership: Pick<GroupMembership, "status">;
  size?: ButtonProps["size"];
  block?: boolean;
  onChange?: (status: Status) => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<Status>(membership.status);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ question: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const update = (next: Status) => {
    setStatus(next);
    onChange?.(next);
  };

  async function join(answer?: string) {
    const before = status;
    const next: Status = before === "invited" || group.visibility === "public" ? "active" : "pending";
    setBusy(true);
    update(next);
    try {
      await api(`/groups/${group.slug}/join`, { method: "POST", body: answer ? { answer } : {} });
      toast.success(next === "active" ? t("You joined {name}", { name: group.name }) : t("Request sent. You’ll be told when the group’s admins decide."));
    } catch (e) {
      update(before);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy) return;
    if (status === "none" && group.visibility === "private") {
      let question = group.joinQuestion;
      if (question === undefined) {
        setBusy(true);
        try {
          question = (await api<GroupDetail>(`/groups/${group.slug}`)).joinQuestion;
        } catch {
          question = null;
        } finally {
          setBusy(false);
        }
      }
      if (question) {
        setAsking({ question });
        return;
      }
    }
    join().catch((e: unknown) => toast.error(e));
  }

  if (status === "banned") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-secondary">
        <Icon name="ban" size={14} />
        {t("You can’t join this group")}
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={buttonClasses({ variant: "secondary", size, block, className: "cursor-default hover:bg-card" })}>
        <Icon name="check" size={16} className="text-success" />
        {t("Member")}
      </span>
    );
  }
  if (status === "none" && group.status !== "active") return null;

  return (
    <>
      {status === "pending" ? (
        <Button variant="secondary" size={size} block={block} onClick={() => setCancelling(true)}>
          <Icon name="clock" size={16} />
          {t("Requested")}
          <span className="sr-only"> {t("Cancel your request to join {name}", { name: group.name })}</span>
        </Button>
      ) : (
        <Button size={size} block={block} onClick={start} aria-disabled={busy}>
          <Icon name={status === "invited" ? "check" : group.visibility === "private" ? "user-plus" : "plus"} size={16} />
          {status === "invited" ? t("Accept") : group.visibility === "private" ? t("Ask to join") : t("Join")}
          <span className="sr-only"> {group.name}</span>
        </Button>
      )}
      {asking && <AskDialog group={group} question={asking.question} onAsk={join} onClose={() => setAsking(null)} />}
      {cancelling && (
        <ConfirmDialog
          title={t("Cancel your request to join {name}?", { name: group.name })}
          confirmLabel={t("Cancel request")}
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await leaveGroup(group.slug);
            update("none");
            toast.success(t("Request cancelled"));
          }}
        >
          {t("You can ask again later.")}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Asking to join a private group: the group's question and the viewer's answer. */
function AskDialog({ group, question, onAsk, onClose }: { group: JoinableGroup; question: string; onAsk: (answer: string) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const empty = !answer.trim();

  async function send() {
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(answer.trim());
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("Ask to join {name}", { name: group.name })}
      description={t("The group’s admins read your answer before they decide.")}
      onClose={onClose}
      width={480}
      initialFocus="textarea"
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={onClose}>
            {t("Cancel")}
          </button>
          <Button onClick={send} aria-disabled={busy || empty}>
            {busy ? t("Sending…") : t("Send request")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-answer`} className="text-sm font-medium text-ink" dir="auto">
          <NoTranslate>{question}</NoTranslate>
        </label>
        <textarea
          id={`${id}-answer`}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          maxLength={1000}
          rows={4}
          dir="auto"
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-md text-ink focus:border-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
        />
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}
