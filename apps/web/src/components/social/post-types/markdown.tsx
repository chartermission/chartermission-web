import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { MemberRef } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { memberHref, topicHref } from "../links";
import { tokenize } from "../rich-text";

/*
 * The article Markdown subset, rendered to React elements (never raw HTML):
 *   ## Heading, ### Subheading, paragraphs, **bold**, *italic* / _italic_,
 *   - bulleted and 1. numbered lists, > quotes, [text](https://link).
 * Plain URLs, #hashtags and @mentions inside text use the same rules as posts.
 */

type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flush();
      blocks.push({ kind: heading[1]!.length === 2 ? "h2" : "h3", text: heading[2]!.trim() });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ kind: "quote", text: quoted.join("\n") });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      const start = ordered ? Number(NUMBERED.exec(line)![1]) : 1;
      while (i < lines.length && pattern.test(lines[i]!)) {
        const match = pattern.exec(lines[i]!)!;
        items.push((ordered ? match[2] : match[1])!.trim());
        i++;
      }
      i--;
      blocks.push({ kind: ordered ? "ol" : "ul", items, start });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Plain text for excerpts and previews: Markdown markers removed, whitespace collapsed. */
export function stripMarkdown(source: string): string {
  return source
    .replace(/^\s*#{2,3}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/gm, "")
    .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const highlight = "font-medium text-primary-light hover:underline";
const hashtag = "font-medium text-accent-hover hover:underline";

const INLINE = /\*\*(.+?)\*\*|(?<![\w*])\*(?![\s*])(.+?)\*(?![\w*])|(?<![\w])_(?![\s_])(.+?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function TextRun({ text, mentions }: { text: string; mentions?: Map<string, MemberRef> | null }) {
  return (
    <>
      {tokenize(text).map((segment, index) => {
        switch (segment.kind) {
          case "tag":
            return (
              <Link key={index} href={topicHref(segment.tag)} className={hashtag}>
                {segment.text}
              </Link>
            );
          case "mention": {
            const member = mentions?.get(segment.handle);
            if (mentions && !member) return <Fragment key={index}>{segment.text}</Fragment>;
            return (
              <Link key={index} href={memberHref(member?.handle ?? segment.handle)} className={highlight}>
                {member?.name ?? segment.text}
              </Link>
            );
          }
          case "link": {
            const href = safeHref(segment.url);
            return href ? (
              <a key={index} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn(highlight, "break-all")}>
                {segment.url.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            );
          }
          default:
            return <Fragment key={index}>{segment.text}</Fragment>;
        }
      })}
    </>
  );
}

function Inline({ text, mentions }: { text: string; mentions?: Map<string, MemberRef> | null }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(<TextRun key={`t${last}`} text={text.slice(last, index)} mentions={mentions} />);
    if (match[1] !== undefined) {
      out.push(
        <strong key={`b${index}`} className="font-semibold text-ink">
          <Inline text={match[1]} mentions={mentions} />
        </strong>,
      );
    } else if (match[2] !== undefined || match[3] !== undefined) {
      out.push(
        <em key={`i${index}`}>
          <Inline text={(match[2] ?? match[3])!} mentions={mentions} />
        </em>,
      );
    } else {
      const href = safeHref(match[5]!);
      out.push(
        href ? (
          <a key={`a${index}`} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn(highlight, "underline underline-offset-2")}>
            {match[4]}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Fragment key={`a${index}`}>{match[4]}</Fragment>
        ),
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push(<TextRun key={`t${last}`} text={text.slice(last)} mentions={mentions} />);
  return out;
}

/** Renders the article Markdown subset with reading typography. */
export function Markdown({
  text,
  mentions,
  className,
  headingOffset = 0,
}: {
  text: string;
  mentions?: readonly MemberRef[];
  className?: string;
  /** Shift heading levels, e.g. 1 renders ## as h3 where the page already has an h2. */
  headingOffset?: 0 | 1;
}) {
  const known = mentions ? new Map(mentions.map((member) => [member.handle.toLowerCase(), member])) : null;
  const H2 = headingOffset ? "h3" : "h2";
  const H3 = headingOffset ? "h4" : "h3";
  return (
    <div className={cn("flex flex-col gap-4 break-words text-md leading-7 text-body", className)}>
      {parseBlocks(text).map((block, index) => {
        switch (block.kind) {
          case "h2":
            return (
              <H2 key={index} className="mt-3 text-h2 text-ink max-sm:text-h3">
                <Inline text={block.text} mentions={known} />
              </H2>
            );
          case "h3":
            return (
              <H3 key={index} className="mt-1 text-h3 text-ink">
                <Inline text={block.text} mentions={known} />
              </H3>
            );
          case "quote":
            return (
              <blockquote key={index} className="whitespace-pre-wrap border-s-[3px] border-accent bg-accent-light/50 py-2 ps-4 pe-3 italic text-ink">
                <Inline text={block.text} mentions={known} />
              </blockquote>
            );
          case "ul":
            return (
              <ul key={index} className="flex list-disc flex-col gap-1.5 ps-6 marker:text-accent">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} mentions={known} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index} start={block.start} className="flex list-decimal flex-col gap-1.5 ps-6 marker:font-semibold marker:text-secondary">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} mentions={known} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-wrap">
                <Inline text={block.text} mentions={known} />
              </p>
            );
        }
      })}
    </div>
  );
}
