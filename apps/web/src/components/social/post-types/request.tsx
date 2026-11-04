"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { Dialog } from "../dialog";
import { ErrorNotice } from "../errors";
import { postHref } from "../links";
import { toast } from "../toast";
import { formatDay, requestMeta } from "./meta";

const NOTE_MAX = 500;

/** "I can help" with an optional note (PUT /posts/{id}/help). */
function HelpDialog({ post, onClose, onOffered }: { post: PostView; onClose: () => void; onOffered: (post: PostView) => void }) {
  const id = useId();
  const footer = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const firstName = post.author.name.split(" ")[0] ?? post.author.name;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<PostView>(`/posts/${post.id}/help`, { method: "PUT", body: { note: note.trim() } });
      onOffered(updated);
      toast.success(`${firstName} will see your offer to help`);
      footer.current?.closest("dialog")?.close();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Offer to help"
      description={<>Let {post.author.name} know you can help with “{post.request?.title}”.</>}
      onClose={onClose}
      width={480}
      initialFocus="textarea"
      footer={
        <div ref={footer} className="flex w-full items-center justify-end gap-2.5">
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={() => footer.current?.closest("dialog")?.close()}>
            Cancel
          </button>
          <Button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send offer"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${id}-note`} className="text-label text-body">
            Add a note <span className="font-normal text-secondary">(optional)</span>
          </label>
          <span className="text-[11px] text-secondary" aria-hidden="true">
            {note.length}/{NOTE_MAX}
          </span>
        </div>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={NOTE_MAX}
          rows={4}
          onChange={(event) => setNote(event.target.value)}
          placeholder="How you can help, relevant experience, or the best way to reach you"
          className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
      </div>
      <p className="flex items-start gap-2 text-xs text-secondary">
        <Icon name="eye" size={14} className="mt-px shrink-0" />
        Only {firstName} sees your offer and note, with your name and headline. You can withdraw it any time.
      </p>
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </Dialog>
  );
}

/** "Looking for" details: category, status, title, skills, where and until when, and the help action. */
export function RequestBlock({
  post,
  viewerId,
  detail,
  onUpdated,
}: {
  post: PostView;
  viewerId: string;
  detail: boolean;
  onUpdated: (post: PostView) => void;
}) {
  const request = post.request!;
  const meta = requestMeta[request.category];
  const isOwn = post.author.id === viewerId;
  const [helping, setHelping] = useState(false);
  const [busy, setBusy] = useState(false);
  const TitleTag = detail ? "h2" : "h3";
  const offersHref = detail ? "#offers" : `${postHref(post.id)}#offers`;

  async function withdraw() {
    setBusy(true);
    try {
      onUpdated(await api<PostView>(`/posts/${post.id}/help`, { method: "DELETE" }));
      toast.success("Your offer was withdrawn");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const details: { icon: "map-pin" | "globe" | "calendar"; text: string }[] = [];
  if (request.location) details.push({ icon: "map-pin", text: request.location });
  if (request.remote) details.push({ icon: "globe", text: "Remote OK" });
  if (request.closesOn) details.push({ icon: "calendar", text: `Respond by ${formatDay(request.closesOn)}` });

  return (
    <section
      aria-label={`Looking for: ${request.title}`}
      className={cn("flex w-full flex-col gap-3 rounded-[10px] border p-4", request.closed ? "border-line bg-muted/60" : "border-primary-tint bg-primary-tint-2")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-label text-primary shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <Icon name="search" size={13} className="text-accent" />
          {meta.label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-label",
            request.closed ? "bg-line text-body" : "bg-success-light text-success",
          )}
        >
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", request.closed ? "bg-secondary" : "bg-success")} />
          {request.closed ? "Closed" : "Open"}
        </span>
      </div>
      <TitleTag className={cn("text-h3", request.closed ? "text-body" : "text-ink")}>
        {detail ? (
          request.title
        ) : (
          <Link href={postHref(post.id)} className="hover:underline">
            {request.title}
          </Link>
        )}
      </TitleTag>
      {request.skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
          {request.skills.map((skill) => (
            <li key={skill} className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-medium text-body">
              {skill}
            </li>
          ))}
        </ul>
      )}
      {details.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-body">
          {details.map((item) => (
            <span key={item.icon} className="flex items-center gap-1">
              <Icon name={item.icon} size={14} className="shrink-0 text-secondary" />
              {item.text}
            </span>
          ))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line/80 pt-3">
        {isOwn ? (
          request.helpOffers > 0 ? (
            <Link href={offersHref} className="flex items-center gap-1.5 text-sm font-medium text-primary-light hover:underline">
              <Icon name="users" size={16} />
              {request.helpOffers} {request.helpOffers === 1 ? "person" : "people"} offered to help
              <Icon name="chevron-right" size={14} />
            </Link>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-secondary">
              <Icon name="users" size={16} />
              {request.closed ? "No offers of help" : "No offers yet — members can tap “I can help”."}
            </p>
          )
        ) : request.closed ? (
          <p className="flex items-center gap-1.5 text-sm text-secondary">
            <Icon name="check" size={16} />
            {request.viewerOffered ? "You offered to help. This request is now closed." : "This request is closed."}
          </p>
        ) : request.viewerOffered ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-light px-3 py-1.5 text-sm font-medium text-success">
              <Icon name="check" size={16} />
              Offered
            </span>
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="rounded-sm text-sm font-medium text-secondary hover:text-error hover:underline disabled:opacity-60"
            >
              {busy ? "Withdrawing…" : "Withdraw"}
              <span className="sr-only"> your offer to help {post.author.name}</span>
            </button>
          </>
        ) : (
          <Button size="small" onClick={() => setHelping(true)} aria-haspopup="dialog">
            <Icon name="users" size={16} />
            I can help
          </Button>
        )}
        {!isOwn && !request.closed && request.helpOffers > 0 && (
          <span className="ml-auto text-xs text-secondary">
            {request.helpOffers} {request.helpOffers === 1 ? "member has" : "members have"} offered
          </span>
        )}
      </div>
      {helping && <HelpDialog post={post} onClose={() => setHelping(false)} onOffered={onUpdated} />}
    </section>
  );
}
