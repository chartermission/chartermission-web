import Link from "next/link";
import { Fragment } from "react";
import type { MemberRef } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { memberHref, topicHref } from "./links";

export type RichSegment =
  | { kind: "text"; text: string }
  | { kind: "tag"; text: string; tag: string }
  | { kind: "mention"; text: string; handle: string }
  | { kind: "link"; text: string; url: string };

/*
 * Same token rules as the API (apps/api/src/posts/text-parse.ts): #Tag is 2–50 letters,
 * digits or underscores; @handle is 3–30 letters, digits or hyphens; links are http(s) URLs.
 */
const TOKENS =
  /(https?:\/\/[^\s<>"'`]+)|(?<![\w&/#])#([A-Za-z0-9_]{2,50})(?![A-Za-z0-9_])|(?<![\w@./-])@([A-Za-z0-9][A-Za-z0-9-]{1,28}[A-Za-z0-9])(?![A-Za-z0-9-])/g;

/** Splits text into plain runs, hashtags, @mentions and links. Concatenating `text` gives the input back. */
export function tokenize(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let last = 0;
  const push = (segment: RichSegment) => {
    const prev = out[out.length - 1];
    if (segment.kind === "text" && prev?.kind === "text") prev.text += segment.text;
    else out.push(segment);
  };
  for (const match of text.matchAll(TOKENS)) {
    const index = match.index ?? 0;
    if (index > last) push({ kind: "text", text: text.slice(last, index) });
    if (match[1]) {
      const url = match[1].replace(/[.,;:!?)\]]+$/, "");
      push({ kind: "link", text: url, url });
      if (url.length < match[1].length) push({ kind: "text", text: match[1].slice(url.length) });
    } else if (match[2]) push({ kind: "tag", text: match[0], tag: match[2] });
    else if (match[3]) push({ kind: "mention", text: match[0], handle: match[3].toLowerCase() });
    last = index + match[0].length;
  }
  if (last < text.length) push({ kind: "text", text: text.slice(last) });
  return out;
}

const highlight = "font-medium text-primary-light hover:underline";
/** Hashtags use the Figma hashtag colour (orange); mentions and links stay primary. */
const hashtag = "font-medium text-accent-hover hover:underline";

/**
 * User-written text with linked #hashtags, @mentions and URLs. Pass `mentions` (from a
 * PostView) to show mentioned members by name and only link handles the API resolved;
 * without it every @handle links to its profile.
 */
export function RichText({
  text,
  mentions,
  className,
}: {
  text: string;
  mentions?: readonly MemberRef[];
  className?: string;
}) {
  const known = mentions ? new Map(mentions.map((member) => [member.handle.toLowerCase(), member])) : null;
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {tokenize(text).map((segment, index) => {
        switch (segment.kind) {
          case "tag":
            return (
              <Link key={index} href={topicHref(segment.tag)} className={hashtag}>
                {segment.text}
              </Link>
            );
          case "mention": {
            if (known) {
              const member = known.get(segment.handle);
              return member ? (
                <Link key={index} href={memberHref(member.handle)} className={highlight}>
                  {member.name}
                </Link>
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              );
            }
            return (
              <Link key={index} href={memberHref(segment.handle)} className={highlight}>
                {segment.text}
              </Link>
            );
          }
          case "link":
            return (
              <a key={index} href={segment.url} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn(highlight, "break-all")}>
                {segment.url.replace(/^https?:\/\//, "")}
              </a>
            );
          default:
            return <Fragment key={index}>{segment.text}</Fragment>;
        }
      })}
    </div>
  );
}
