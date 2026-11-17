/** @jsxImportSource react */
// What members (and the Charter Mission team) write is shown as written: this file opts out of the translating JSX runtime (see i18n/jsx).
import { Fragment } from "react";
import { cn } from "@chartermission/ui";
import { tokenize } from "@/components/social/rich-text";

/**
 * A message's text with its web addresses made clickable. Line breaks and blank lines (paragraphs)
 * come from the caller's `whitespace-pre-wrap`; #tags and @handles stay plain text in messages.
 */
export function MessageText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <>
      {tokenize(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            dir="ltr"
            className={cn("break-all underline underline-offset-2", mine ? "text-inverse" : "text-primary-light")}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
