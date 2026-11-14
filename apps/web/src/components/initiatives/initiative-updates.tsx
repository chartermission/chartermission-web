"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { POST_MAX_CHARS, type Page, type PostView } from "@chartermission/contracts";
import { Button, Panel, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { PostStream } from "@/components/social/post-stream";
import { announcePostCreated } from "@/components/social/post-events";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useT } from "@/i18n/client";

/** An organiser's update box: the post goes to the initiative's page and its followers' Following feed. */
function UpdateComposer({ initiativeId, title }: { initiativeId: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const post = await api<PostView>("/posts", { method: "POST", body: { body: body.trim(), initiativeId } });
      announcePostCreated(post);
      setBody("");
      toast.success("Update posted");
      router.refresh();
    } catch (err) {
      setError(isApiError(err) ? (err.fields ? Object.values(err.fields)[0]! : err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col gap-2.5 p-5">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <label htmlFor={id} className="text-md font-medium text-ink">
          Post an update
        </label>
        <textarea
          id={id}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={POST_MAX_CHARS}
          rows={3}
          placeholder={t("What’s new with {title}? Milestones, wins, what you need next…", { title })}
          className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-md text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={cn("text-xs", body.length > POST_MAX_CHARS - 200 ? "text-warning" : "text-secondary")}>
            Followers and the team see it in their feed.
          </span>
          <Button type="submit" size="small" disabled={busy || !body.trim()}>
            {busy ? "Posting…" : "Post update"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** The initiative's updates (GET /feed?initiative=), newest first; organisers post from here. */
export function InitiativeUpdates({
  initiative,
  initial,
  viewer,
  canPost,
  limit,
}: {
  initiative: { id: string; slug: string; title: string; leadName: string };
  initial?: Page<PostView>;
  viewer: Viewer;
  canPost: boolean;
  limit: number;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {canPost && <UpdateComposer initiativeId={initiative.id} title={initiative.title} />}
      <PostStream
        path="/feed"
        query={{ initiative: initiative.id, limit }}
        initial={initial}
        viewer={viewer}
        label={t("Updates on {title}", { title: initiative.title })}
        acceptNew
        acceptCreated={(post) => post.initiative?.id === initiative.id}
        empty={
          <EmptyState icon="message" title="No updates yet">
            {canPost
              ? "Share your first update: what you’ve done, and what help you need next."
              : t("Follow this initiative to hear when {name} posts one.", { name: initiative.leadName })}
          </EmptyState>
        }
      />
    </div>
  );
}
