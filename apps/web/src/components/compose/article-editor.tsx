"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ARTICLE_MAX_CHARS, ARTICLE_MIN_CHARS, readingMinutes, type MemberRef } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { Markdown } from "@/components/social/post-types/markdown";

type Action = "h2" | "h3" | "bold" | "italic" | "ul" | "ol" | "quote" | "link";

const actions: { action: Action; label: string; shortcut?: string; glyph: ReactNode }[] = [
  { action: "h2", label: "Heading", glyph: <span className="text-[13px] font-bold">H2</span> },
  { action: "h3", label: "Subheading", glyph: <span className="text-[12px] font-bold">H3</span> },
  { action: "bold", label: "Bold", shortcut: "B", glyph: <span className="text-[15px] font-bold">B</span> },
  { action: "italic", label: "Italic", shortcut: "I", glyph: <span className="font-serif text-[16px] italic">I</span> },
  {
    action: "ul",
    label: "Bulleted list",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    action: "ol",
    label: "Numbered list",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M10 6h10M10 12h10M10 18h10" />
        <path d="M4 4.5h1.5V9M3.5 9h3" strokeWidth="1.5" />
        <path d="M3.5 14.5a1.5 1.5 0 0 1 3 .3c0 .9-3 2.2-3 3.7h3" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    action: "quote",
    label: "Quote",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 5v14M9 7h11M9 12h11M9 17h7" />
      </svg>
    ),
  },
  { action: "link", label: "Link", shortcut: "K", glyph: <Icon name="link" size={17} /> },
];

type Edit = { value: string; start: number; end: number };

/** Applies a toolbar action to the text and selection; returns the new text and selection. */
function applyAction(action: Action, value: string, start: number, end: number): Edit {
  const selected = value.slice(start, end);
  const wrap = (marker: string, placeholder: string): Edit => {
    const before = value.slice(0, start);
    const after = value.slice(end);
    if (selected && before.endsWith(marker) && after.startsWith(marker)) {
      // Toggle off when the selection is already wrapped.
      return { value: before.slice(0, -marker.length) + selected + after.slice(marker.length), start: start - marker.length, end: end - marker.length };
    }
    const inner = selected || placeholder;
    return { value: before + marker + inner + marker + after, start: start + marker.length, end: start + marker.length + inner.length };
  };
  if (action === "bold") return wrap("**", "bold text");
  if (action === "italic") return wrap("*", "italic text");
  if (action === "link") {
    const text = selected || "link text";
    const insert = `[${text}](https://)`;
    const urlStart = start + text.length + 3;
    return { value: value.slice(0, start) + insert + value.slice(end), start: urlStart, end: urlStart + "https://".length };
  }
  // Line actions: apply to every line the selection touches.
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const prefixes: Record<Exclude<Action, "bold" | "italic" | "link">, RegExp> = {
    h2: /^##\s+/,
    h3: /^###\s+/,
    ul: /^[-*•]\s+/,
    ol: /^\d{1,3}[.)]\s+/,
    quote: /^>\s?/,
  };
  const pattern = prefixes[action];
  const strip = (line: string) => line.replace(/^(#{2,3}\s+|[-*•]\s+|\d{1,3}[.)]\s+|>\s?)/, "");
  const all = lines.every((line) => !line.trim() || pattern.test(line));
  let n = 0;
  const next = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    if (all) return line.replace(pattern, "");
    const base = strip(line);
    if (action === "h2") return `## ${base}`;
    if (action === "h3") return `### ${base}`;
    if (action === "ul") return `- ${base}`;
    if (action === "ol") return `${++n}. ${base}`;
    return `> ${base}`;
  });
  const replaced = next.join("\n");
  let before = value.slice(0, lineStart);
  // Headings and lists read best as their own paragraph.
  if (!all && before && !before.endsWith("\n\n") && (action === "h2" || action === "h3")) before = `${before.replace(/\n?$/, "\n")}\n`;
  const out = before + replaced + value.slice(lineEnd);
  const caret = before.length + replaced.length;
  return { value: out, start: selected ? before.length : caret, end: caret };
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Article body: a roomy textarea with a small Markdown toolbar (roving focus, ⌘/Ctrl+B, I, K),
 * a Write / Preview toggle, word count, reading time and the 20,000-character limit.
 */
export function ArticleEditor({
  value,
  onChange,
  error,
  textareaRef,
  mentions,
  label = "Article text",
  compact = false,
  tall = false,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  mentions?: readonly MemberRef[];
  label?: string;
  compact?: boolean;
  /** On the full writing page: the editor fills most of the screen. */
  tall?: boolean;
}) {
  const id = useId();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [focusIndex, setFocusIndex] = useState(0);
  /** Selection to restore once the edited text has rendered. */
  const pending = useRef<{ value: string; start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const next = pending.current;
    const textarea = ref.current;
    if (!next || !textarea || textarea.value !== next.value) return;
    pending.current = null;
    textarea.focus();
    textarea.setSelectionRange(next.start, next.end);
  }, [value, ref]);

  function run(action: Action) {
    const textarea = ref.current;
    if (!textarea) return;
    const edit = applyAction(action, value, textarea.selectionStart, textarea.selectionEnd);
    if (edit.value.length > ARTICLE_MAX_CHARS) return;
    pending.current = edit;
    onChange(edit.value);
  }

  function onToolbarKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = null;
    if (step) next = (focusIndex + step + actions.length) % actions.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = actions.length - 1;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    buttons.current[next]?.focus();
  }

  function onTextKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const action = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
    if (!action) return;
    event.preventDefault();
    run(action);
  }

  const words = wordCount(value);
  const minutes = readingMinutes(value);
  const count = value.length;
  const nearLimit = count > ARTICLE_MAX_CHARS - 1000;
  const tooShort = count > 0 && count < ARTICLE_MIN_CHARS;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-card border bg-card", error ? "border-error" : "border-line focus-within:border-primary-light")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1.5">
        <div
          role="toolbar"
          aria-label="Formatting"
          aria-controls={`${id}-input`}
          onKeyDown={onToolbarKey}
          className={cn("flex flex-wrap items-center gap-0.5", mode === "preview" && "pointer-events-none opacity-40")}
          aria-disabled={mode === "preview" || undefined}
        >
          {actions.map((item, index) => (
            <span key={item.action} className="flex items-center">
              {(index === 2 || index === 4 || index === 7) && <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />}
              <button
                ref={(node) => {
                  buttons.current[index] = node;
                }}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                disabled={mode === "preview"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setFocusIndex(index);
                  run(item.action);
                }}
                aria-label={item.shortcut ? `${item.label} (Ctrl+${item.shortcut})` : item.label}
                title={item.shortcut ? `${item.label} (⌘/Ctrl+${item.shortcut})` : item.label}
                className="flex size-8 items-center justify-center rounded-md text-body hover:bg-card hover:text-primary hover:shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]"
              >
                {item.glyph}
              </button>
            </span>
          ))}
        </div>
        <div role="tablist" aria-label="Editor view" className="ms-auto inline-flex gap-0.5 rounded-md bg-muted p-0.5">
          {(["write", "preview"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${id}-tab-${value}`}
              aria-selected={mode === value}
              aria-controls={`${id}-panel`}
              onClick={() => setMode(value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = mode === "write" ? "preview" : "write";
                  setMode(next);
                  document.getElementById(`${id}-tab-${next}`)?.focus();
                }
              }}
              tabIndex={mode === value ? 0 : -1}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-xs font-medium",
                mode === value ? "bg-card text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
              )}
            >
              {value === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${mode}`}>
        {mode === "write" ? (
          <>
            <label htmlFor={`${id}-input`} className="sr-only">
              {label}
            </label>
            <textarea
              ref={ref}
              id={`${id}-input`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onTextKey}
              maxLength={ARTICLE_MAX_CHARS}
              spellCheck
              placeholder="Start writing… Use ## for a heading, **bold**, *italic*, - for a list and > for a quote."
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-meta${error ? ` ${id}-error` : ""}`}
              className={cn(
                "block w-full resize-y bg-transparent px-4 py-3 text-md leading-7 text-ink outline-none placeholder:text-disabled",
                compact ? "min-h-[240px]" : tall ? "min-h-[58vh] max-sm:min-h-[50vh]" : "min-h-[320px] max-sm:min-h-[260px]",
              )}
            />
          </>
        ) : (
          <div className={cn("overflow-y-auto px-4 py-3", compact ? "min-h-[240px]" : tall ? "min-h-[58vh] max-sm:min-h-[50vh]" : "min-h-[320px] max-sm:min-h-[260px]")}>
            {value.trim() ? (
              <Markdown text={value} mentions={mentions} headingOffset={1} />
            ) : (
              <p className="text-sm text-secondary">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div id={`${id}-meta`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-xs text-secondary">
        <span>
          {words.toLocaleString("en-US")} word{words === 1 ? "" : "s"} · {minutes} min read
          {tooShort && <span className="text-warning"> · {(ARTICLE_MIN_CHARS - count).toLocaleString("en-US")} more characters needed</span>}
        </span>
        <span className={cn(count >= ARTICLE_MAX_CHARS ? "text-error" : nearLimit ? "text-warning" : undefined)}>
          {count.toLocaleString("en-US")} / {ARTICLE_MAX_CHARS.toLocaleString("en-US")}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="border-t border-error/30 bg-error-light px-4 py-2 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
