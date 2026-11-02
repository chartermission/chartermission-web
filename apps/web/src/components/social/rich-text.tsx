import Link from "next/link";
import { Fragment } from "react";
import { topicHref } from "@/components/feed-list";
import type { CommentSegment } from "@/lib/mock/posts";

export type Mentionable = { name: string; handle: string };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits user-typed text into plain text, @mentions and #hashtags. Mentions
 * match known member names first ("@Amara Okafor"), then single words.
 */
export function parseRichText(text: string, people: readonly Mentionable[] = []): CommentSegment[] {
  const names = [...people].sort((a, b) => b.name.length - a.name.length).map((person) => escape(person.name));
  const pattern = new RegExp(`${names.length ? `@(${names.join("|")})|` : ""}@([\\p{L}\\p{N}_-]+)|#([\\p{L}\\p{N}_]+)`, "gu");
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index) });
    const known = names.length ? match[1] : undefined;
    const word = names.length ? match[2] : match[1];
    const tag = names.length ? match[3] : match[2];
    if (tag) segments.push({ tag });
    else {
      const name = known ?? word ?? "";
      segments.push({ mention: name, handle: people.find((person) => person.name === name)?.handle });
    }
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** Renders segments with linked, highlighted mentions and hashtags. */
export function RichSegments({ segments }: { segments: readonly CommentSegment[] }) {
  const highlight = "font-semibold text-primary-light hover:underline";
  return (
    <>
      {segments.map((segment, index) => {
        if ("tag" in segment) {
          return (
            <Link key={index} href={topicHref(segment.tag)} className={highlight}>
              #{segment.tag}
            </Link>
          );
        }
        if ("mention" in segment) {
          return segment.handle ? (
            <Link key={index} href={`/members/${segment.handle}`} className={highlight}>
              @{segment.mention}
            </Link>
          ) : (
            <span key={index} className="font-semibold text-primary-light">
              @{segment.mention}
            </span>
          );
        }
        return <Fragment key={index}>{segment.text}</Fragment>;
      })}
    </>
  );
}
