"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { JOIN_NOTE_MAX, JOIN_NOTE_MIN, type InitiativeDetail } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn, type ButtonSize, type ButtonVariant } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Modal } from "./modal";
import { T, useT } from "@/i18n/client";

type JoinTarget = {
  id: string;
  title: string;
  leadName: string;
  roles: { id: string; title: string }[];
};

type JoinContextValue = {
  target: JoinTarget;
  sent: boolean;
  open: (roleId?: string) => void;
};

const JoinContext = createContext<JoinContextValue | null>(null);

const NOTE_MIN = JOIN_NOTE_MIN;
const NOTE_MAX = JOIN_NOTE_MAX;

/**
 * Owns the "Request to join" dialog for one initiative. Any number of
 * <JoinRequestTrigger>s inside it (hero button, per-role "Apply") open the
 * same dialog, optionally with a role preselected.
 */
export function JoinRequestProvider({ initiative, pending = false, children }: { initiative: JoinTarget; pending?: boolean; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [sent, setSent] = useState(pending);
  const [justSent, setJustSent] = useState(false);

  return (
    <JoinContext.Provider
      value={{
        target: initiative,
        sent,
        open: (id) => {
          setRoleId(id ?? "");
          setOpen(true);
        },
      }}
    >
      {children}
      <Modal
        open={isOpen}
        onClose={() => setOpen(false)}
        title={justSent ? "Request sent" : t("Request to join {title}", { title: initiative.title })}
        description={
          justSent ? undefined : t("Tell {leadName} how you can help. Leads usually reply within 3 days.", { leadName: initiative.leadName })
        }
      >
        {justSent ? (
          <div className="flex flex-col gap-4">
            <p role="status" className="flex items-start gap-3 rounded-[10px] bg-success-light p-4 text-sm text-ink">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-inverse">
                <Icon name="check" size={14} />
              </span>
              Your request has been sent to {initiative.leadName}. You’ll get a notification when they reply.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <JoinForm
            target={initiative}
            defaultRoleId={roleId}
            onCancel={() => setOpen(false)}
            onSent={() => {
              setSent(true);
              setJustSent(true);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </JoinContext.Provider>
  );
}

function JoinForm({
  target,
  defaultRoleId,
  onCancel,
  onSent,
}: {
  target: JoinTarget;
  defaultRoleId: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const t = useT();
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [skills, setSkills] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < NOTE_MIN) {
      setError(t("Write at least {NOTEMIN} characters so the lead knows how you can help.", { NOTEMIN: NOTE_MIN }));
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api<InitiativeDetail>(`/initiatives/${target.id}/join-requests`, {
        method: "POST",
        body: { roleId: roleId || null, skills: skills.trim() || null, note: trimmed },
      });
      onSent();
    } catch (e) {
      setBusy(false);
      if (isApiError(e) && e.fields?.note) setError(e.fields.note);
      else setFormError(isApiError(e) ? (e.fields ? Object.values(e.fields)[0]! : e.message) : "Something went wrong. Please try again.");
    }
  }

  const fieldClasses =
    "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-disabled hover:border-line-strong focus:border-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/30";

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      {target.roles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-role`} className="text-sm font-medium text-ink">
            Role
          </label>
          <span className="relative flex">
            <select
              id={`${id}-role`}
              name="role"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              className={cn(fieldClasses, "appearance-none pe-9")}
            >
              <option value="">Any role — I’ll help where needed</option>
              {target.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </select>
            <Icon
              name="chevron-down"
              size={16}
              className="pointer-events-none absolute end-3 inset-y-0 my-auto h-fit text-secondary"
            />
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-skills`} className="text-sm font-medium text-ink">
          Skills you can offer <span className="font-normal text-secondary">(optional)</span>
        </label>
        <input
          id={`${id}-skills`}
          name="skills"
          type="text"
          maxLength={200}
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          autoComplete="off"
          placeholder="e.g. Logistics, SQL, export certification"
          className={fieldClasses}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
          <T vars={{ leadName: target.leadName }}>{"Note to {leadName}"}</T>
        </label>
        <textarea
          ref={noteRef}
          id={`${id}-note`}
          name="note"
          required
          rows={5}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            if (error && event.target.value.trim().length >= NOTE_MIN) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-note-error` : `${id}-note-hint`}
          placeholder="Share your experience, what you’d like to work on and how much time you can give."
          className={cn(fieldClasses, "resize-y", error && "border-error focus:border-error")}
        />
        <div className="flex justify-between gap-3 text-xs">
          {error ? (
            <p id={`${id}-note-error`} className="text-error">
              {error}
            </p>
          ) : (
            <p id={`${id}-note-hint`} className="text-secondary">
              <T vars={{ NOTEMIN: NOTE_MIN }}>{"At least {NOTEMIN} characters."}</T>
            </p>
          )}
          <span className="shrink-0 text-secondary" aria-hidden="true">
            {note.length}/{NOTE_MAX}
          </span>
        </div>
      </div>

      {formError && (
        <p role="alert" className="rounded-[10px] bg-error-light p-3 text-sm text-error">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="accent" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

/** Button that opens the surrounding JoinRequestProvider's dialog. */
export function JoinRequestTrigger({
  roleId,
  children,
  variant = "secondary",
  size = "small",
  className,
  "aria-label": ariaLabel,
}: {
  roleId?: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  "aria-label"?: string;
}) {
  const context = useContext(JoinContext);
  if (!context) throw new Error("JoinRequestTrigger must be used inside JoinRequestProvider");
  const { sent, open } = context;

  return (
    <button
      type="button"
      onClick={() => open(roleId)}
      disabled={sent}
      aria-label={sent ? undefined : ariaLabel}
      className={buttonClasses({ variant, size, className })}
    >
      {sent ? (
        <>
          <Icon name="check" size={size === "small" ? 14 : 16} />
          Requested
        </>
      ) : (
        children
      )}
    </button>
  );
}
