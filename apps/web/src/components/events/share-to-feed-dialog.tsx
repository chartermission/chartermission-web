"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { POST_MAX_CHARS, type EventSummary, type PostView } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import { SharedEventCard } from "./shared-event-card";

/** Members can share an event while it is live and not over (the API checks the same). */
export const canShareToFeed = (event: Pick<EventSummary, "status" | "cancelledAt" | "past">) =>
  (event.status === "published" || event.status === "archived") && !event.cancelledAt && !event.past;

/** Share an event to the member's feed with an optional comment (POST /posts with eventId). */
export function ShareToFeedDialog({ event, onClose }: { event: EventSummary; onClose: () => void }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<PostView>("/posts", { method: "POST", body: { body: body.trim(), eventId: event.id } });
      announcePostCreated(created);
      toast.success("Shared to your feed");
      formRef.current?.closest("dialog")?.close();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const close = () => formRef.current?.closest("dialog")?.close();

  return (
    <Dialog title="Share to feed" onClose={onClose} width={560} initialFocus="textarea">
      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-ink">
          Add your thoughts <span className="font-normal text-secondary">(optional)</span>
        </label>
        <textarea
          id={`${id}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={POST_MAX_CHARS}
          rows={3}
          placeholder="Who should come, and why?"
          className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-md text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
        <p className={cn("-mt-2 self-end text-xs", body.length > POST_MAX_CHARS - 200 ? "text-warning" : "text-secondary")}>
          {body.length.toLocaleString("en-US")} / {POST_MAX_CHARS.toLocaleString("en-US")}
        </p>
        <SharedEventCard event={event} preview />
        <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
