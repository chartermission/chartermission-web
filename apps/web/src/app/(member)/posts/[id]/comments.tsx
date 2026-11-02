"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { Avatar, Icon, Panel, cn } from "@chartermission/ui";
import { RichSegments, parseRichText, type Mentionable } from "@/components/social/rich-text";
import type { CommentEntry, PostComment } from "@/lib/mock/posts";

const MAX_COMMENT = 1250;

type Viewer = { name: string; handle: string };

function validateComment(text: string): string | null {
  const value = text.trim();
  if (!value) return "Write something before posting your comment.";
  if (value.length > MAX_COMMENT) return `Comments can be up to ${MAX_COMMENT.toLocaleString("en-US")} characters.`;
  return null;
}

function CommentItem({
  comment,
  onReply,
  nested,
}: {
  comment: PostComment;
  onReply: (name: string) => void;
  nested?: boolean;
}) {
  const [liked, setLiked] = useState(false);
  const [reported, setReported] = useState(false);
  const likes = comment.likes + (liked ? 1 : 0);
  const name = comment.author.handle ? (
    <Link href={`/members/${comment.author.handle}`} className="text-sm font-medium text-ink hover:underline">
      {comment.author.name}
    </Link>
  ) : (
    <span className="text-sm font-medium text-ink">{comment.author.name}</span>
  );

  return (
    <li className={cn("flex flex-col gap-4", nested && "pl-[42px]")}>
      <article className="flex items-start gap-2.5" aria-label={`Comment by ${comment.author.name}`}>
        <Avatar name={comment.author.name} size={32} tone={comment.author.tone} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-col gap-1 rounded-card bg-surface px-3.5 py-2.5">
            <p className="flex items-center gap-1.5">
              {name}
              <span className="text-xs text-secondary">· {comment.meta}</span>
            </p>
            <p className="text-sm text-body">
              <RichSegments segments={comment.body} />
            </p>
          </div>
          <div className="flex items-center gap-4 px-1 text-xs">
            <button
              type="button"
              aria-pressed={liked}
              onClick={() => setLiked((value) => !value)}
              className={cn("rounded-sm hover:text-primary", liked ? "font-medium text-primary" : "text-secondary")}
            >
              Like · {likes}
              <span className="sr-only"> likes, comment by {comment.author.name}</span>
            </button>
            <button type="button" onClick={() => onReply(comment.author.name)} className="rounded-sm text-secondary hover:text-primary">
              Reply<span className="sr-only"> to {comment.author.name}</span>
            </button>
            <button
              type="button"
              disabled={reported}
              onClick={() => setReported(true)}
              className="rounded-sm text-disabled hover:text-error disabled:hover:text-disabled"
            >
              {reported ? "Reported" : "Report"}
              <span className="sr-only"> comment by {comment.author.name}</span>
            </button>
          </div>
        </div>
      </article>
      {comment.replies && comment.replies.length > 0 && (
        <ul className="flex flex-col gap-4">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} onReply={onReply} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Comments panel with sort, an accessible comment form and the thread. */
export function Comments({
  initialComments,
  total,
  viewer,
  people,
}: {
  initialComments: CommentEntry[];
  total: number;
  viewer: Viewer;
  people: Mentionable[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [added, setAdded] = useState(0);
  const [sort, setSort] = useState<"relevant" | "newest">("relevant");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const count = total + added;
  const remaining = Math.max(total - initialComments.length, 0);
  const ordered = sort === "newest" ? [...comments].reverse() : comments;

  function focusWith(value: string) {
    setText(value);
    setError(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(value.length, value.length);
    });
  }

  function insertMention() {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const insert = before && !/\s$/.test(before) ? " @" : "@";
    const next = before + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      input?.focus();
      const caret = start + insert.length;
      input?.setSelectionRange(caret, caret);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateComment(text);
    setError(problem);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    const comment: PostComment = {
      id: `new-${Date.now()}`,
      author: { name: viewer.name, handle: viewer.handle, tone: "primary" },
      meta: "Just now",
      body: parseRichText(text.trim(), people),
      likes: 0,
    };
    setComments((current) => (sort === "newest" ? [...current, comment] : [comment, ...current]));
    setAdded((value) => value + 1);
    setText("");
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
    setAnnouncement("Your comment was posted.");
  }

  return (
    <Panel aria-labelledby={`${id}-title`} className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 id={`${id}-title`} className="text-h3 text-ink">
          {count.toLocaleString("en-US")} comments
        </h2>
        <span className="relative inline-flex items-center">
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="appearance-none rounded-md bg-transparent py-0.5 pl-1 pr-5 text-sm font-medium text-body hover:text-ink"
          >
            <option value="relevant">Most relevant</option>
            <option value="newest">Newest first</option>
          </select>
          <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-0.5 text-secondary" />
        </span>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={viewer.name} size={32} tone="primary" />
          <div
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[20px] bg-muted px-3.5 focus-within:ring-2",
              error ? "ring-2 ring-error focus-within:ring-error" : "focus-within:ring-primary-light",
            )}
          >
            <label htmlFor={`${id}-input`} className="sr-only">
              Add a comment
            </label>
            <input
              ref={inputRef}
              id={`${id}-input`}
              name="comment"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError(null);
              }}
              maxLength={MAX_COMMENT}
              autoComplete="off"
              placeholder="Add a comment… use @ to mention"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
            <button type="button" onClick={insertMention} aria-label="Mention someone" className="rounded-sm text-secondary hover:text-primary">
              <Icon name="at" size={16} />
            </button>
            <label className="cursor-pointer rounded-sm text-secondary focus-within:ring-2 focus-within:ring-primary-light hover:text-primary">
              <Icon name="image" size={16} />
              <span className="sr-only">Attach an image</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? null)}
              />
            </label>
            {text.trim() && (
              <button type="submit" className="rounded-sm text-sm font-medium text-primary hover:text-primary-light">
                Post
              </button>
            )}
          </div>
        </div>
        {attachment && (
          <p className="flex items-center gap-1.5 pl-[42px] text-xs text-secondary">
            <Icon name="image" size={14} />
            {attachment} · appears after a quick safety scan
            <button
              type="button"
              className="rounded-sm text-error hover:underline"
              onClick={() => {
                setAttachment(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Remove
            </button>
          </p>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className="pl-[42px] text-xs text-error">
            {error}
          </p>
        )}
      </form>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ul className="flex flex-col gap-4">
        {ordered.map((entry) =>
          "hidden" in entry ? (
            <li key={entry.id} className="flex items-center gap-2 rounded-[10px] bg-muted p-3 text-xs text-secondary">
              <Icon name="eye-off" size={16} className="shrink-0" />
              A comment was hidden by moderators for breaking community guidelines.
            </li>
          ) : (
            <CommentItem key={entry.id} comment={entry} onReply={(name) => focusWith(`@${name} `)} />
          ),
        )}
      </ul>

      {remaining > 0 && (
        <div className="flex justify-center">
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Load {remaining.toLocaleString("en-US")} more comments
          </button>
        </div>
      )}
    </Panel>
  );
}
