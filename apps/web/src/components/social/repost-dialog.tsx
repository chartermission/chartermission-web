"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { POST_MAX_CHARS, type PostView } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { Dialog } from "./dialog";
import { ErrorNotice } from "./errors";
import { announcePostCreated } from "./post-events";
import { RepostEmbed } from "./post-parts";
import { toast } from "./toast";

/** Repost with an optional comment (POST /posts with repostOfId). */
export function RepostDialog({ post, onClose, onReposted }: { post: PostView; onClose: () => void; onReposted: (repost: PostView) => void }) {
  const id = useId();
  const original = post.repostOf && !post.body ? post.repostOf : post;
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<PostView>("/posts", { method: "POST", body: { body: body.trim(), repostOfId: original.id } });
      onReposted(created);
      announcePostCreated(created);
      toast.success(body.trim() ? "Reposted with your thoughts" : "Reposted to your network");
      formRef.current?.closest("dialog")?.close();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const close = () => formRef.current?.closest("dialog")?.close();

  return (
    <Dialog title="Repost" onClose={onClose} width={560} initialFocus="textarea">
      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-ink">
          Add your thoughts <span className="font-normal text-secondary">(optional)</span>
        </label>
        <textarea
          id={`${id}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={POST_MAX_CHARS}
          rows={3}
          placeholder="Why does this matter to your network?"
          className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-md text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
        <p className={cn("-mt-2 self-end text-xs", body.length > POST_MAX_CHARS - 200 ? "text-warning" : "text-secondary")}>
          {body.length.toLocaleString("en-US")} / {POST_MAX_CHARS.toLocaleString("en-US")}
        </p>
        <RepostEmbed original={original} />
        <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Reposting…" : "Repost"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
