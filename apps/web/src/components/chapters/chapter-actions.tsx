"use client";

import { useId, useState, type FormEvent } from "react";
import { Avatar, Button, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";

/** "✓ Member" pill on the chapter header; toggles to "Join chapter" when left. */
export function MembershipToggle({ chapterName }: { chapterName: string }) {
  const [member, setMember] = useState(true);
  return (
    <button
      type="button"
      aria-pressed={member}
      aria-label={member ? `Member of ${chapterName}. Leave chapter` : `Join ${chapterName}`}
      onClick={() => setMember((value) => !value)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-inverse transition-colors",
        member ? "bg-white/12 hover:bg-white/20" : "border border-white/40 hover:bg-white/12",
      )}
    >
      {member ? <Icon name="check" size={16} /> : <Icon name="plus" size={16} />}
      {member ? "Member" : "Join chapter"}
    </button>
  );
}

/** "Invite people" — copies the chapter invite link and confirms. */
export function InviteButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function invite() {
    const url = `${window.location.origin}/chapters/${slug}?invite=1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this invite link", url);
    }
  }

  return (
    <>
      <button type="button" onClick={invite} className={buttonClasses({ variant: "accent" })}>
        {copied ? "Invite link copied" : "Invite people"}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Invite link copied to clipboard" : ""}
      </span>
    </>
  );
}

/** Compact chapter composer (Figma 18:2265): an inline post field. */
export function ChapterComposer({ chapterName, viewerName }: { chapterName: string; viewerName: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const [posted, setPosted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    // No backend yet: the post would be created in the chapter here.
    setText("");
    setPosted(true);
  }

  return (
    <Panel className="p-4">
      <form onSubmit={submit} className="flex items-center gap-3">
        <Avatar name={viewerName} tone="primary" />
        <label htmlFor={id} className="sr-only">
          Post to {chapterName}
        </label>
        <input
          id={id}
          name="body"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPosted(false);
          }}
          placeholder={`Post to ${chapterName}…`}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-[22px] bg-muted px-4 text-sm text-ink placeholder:text-disabled hover:bg-primary-tint-2 focus:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
        />
        {text.trim() && (
          <Button type="submit" size="small">
            Post
          </Button>
        )}
      </form>
      <p role="status" className={cn("text-xs text-success", posted ? "pt-2" : "sr-only")}>
        {posted ? `Posted to ${chapterName}.` : ""}
      </p>
    </Panel>
  );
}
