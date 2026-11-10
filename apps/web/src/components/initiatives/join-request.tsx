"use client";

import { createContext, useContext, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Icon, buttonClasses, cn, type ButtonSize, type ButtonVariant } from "@chartermission/ui";
import { Modal } from "./modal";

type JoinTarget = {
  slug: string;
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

const NOTE_MIN = 20;
const NOTE_MAX = 500;

/**
 * Owns the "Request to join" dialog for one initiative. Any number of
 * <JoinRequestTrigger>s inside it (hero button, per-role "Apply") open the
 * same dialog, optionally with a role preselected.
 */
export function JoinRequestProvider({ initiative, children }: { initiative: JoinTarget; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [sent, setSent] = useState(false);

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
        title={sent ? "Request sent" : `Request to join ${initiative.title}`}
        description={
          sent ? undefined : `Tell ${initiative.leadName} how you can help. Leads usually reply within 3 days.`
        }
      >
        {sent ? (
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
            onSent={() => setSent(true)}
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
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < NOTE_MIN) {
      setError(`Write at least ${NOTE_MIN} characters so the lead knows how you can help.`);
      noteRef.current?.focus();
      return;
    }
    // No backend yet: the request would be POSTed here with role, skills and note.
    onSent();
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
              defaultValue={defaultRoleId}
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
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-secondary"
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
          autoComplete="off"
          placeholder="e.g. Logistics, SQL, export certification"
          className={fieldClasses}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
          Note to {target.leadName}
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
              At least {NOTE_MIN} characters.
            </p>
          )}
          <span className="shrink-0 text-secondary" aria-hidden="true">
            {note.length}/{NOTE_MAX}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="accent">
          Send request
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
