"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { Avatar, Icon, cn } from "@chartermission/ui";
import { parseRichText } from "@/components/social/rich-text";
import { hashtagSuggestions, mentionSuggestions } from "@/lib/mock/compose";

export const MAX_POST_LENGTH = 3000;

type Token = { trigger: "#" | "@"; query: string; start: number; end: number };

type Suggestion =
  | { kind: "tag"; id: string; insert: string; tag: string; posts: number; trending?: boolean }
  | { kind: "person"; id: string; insert: string; name: string; headline: string; tone: (typeof mentionSuggestions)[number]["tone"] };

const people = mentionSuggestions.map(({ name, handle }) => ({ name, handle }));

/** The #tag / @name being typed immediately before the caret, if any. */
function tokenAt(text: string, caret: number): Token | null {
  const match = /(^|\s)([#@])([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const trigger = match[2] as Token["trigger"];
  return { trigger, query: match[3], start: caret - match[3].length - 1, end: caret };
}

function suggestionsFor(token: Token | null): Suggestion[] {
  if (!token) return [];
  const query = token.query.toLowerCase();
  if (token.trigger === "#") {
    return hashtagSuggestions
      .filter((item) => item.tag.toLowerCase().startsWith(query) && item.tag.toLowerCase() !== query)
      .sort((a, b) => Number(!!b.trending) - Number(!!a.trending) || b.posts - a.posts)
      .slice(0, 4)
      .map((item) => ({ kind: "tag", id: `tag-${item.tag}`, insert: `#${item.tag} `, ...item }));
  }
  return mentionSuggestions
    .filter((person) => person.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(query)))
    .slice(0, 4)
    .map((person) => ({
      kind: "person",
      id: `person-${person.handle}`,
      insert: `@${person.name} `,
      name: person.name,
      headline: person.headline,
      tone: person.tone,
    }));
}

/**
 * Post text area with live #hashtag / @mention highlighting and an
 * autocomplete list. The highlighted copy sits behind a transparent textarea
 * so native editing, selection and caret behaviour are preserved.
 */
export function ComposeEditor({
  value,
  caret,
  onChange,
  onCaretChange,
  textareaRef,
  labelledBy,
  describedBy,
  invalid,
  onSuggestionsOpenChange,
}: {
  value: string;
  caret: number;
  onChange: (value: string, caret: number) => void;
  onCaretChange: (caret: number) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  onSuggestionsOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const token = useMemo(() => tokenAt(value, caret), [value, caret]);
  const suggestions = useMemo(() => suggestionsFor(token), [token]);
  const tokenKey = token ? `${token.start}:${token.trigger}${token.query}` : "";
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<{ key: string; index: number }>({ key: "", index: 0 });
  const active = activeState.key === tokenKey ? Math.min(activeState.index, Math.max(suggestions.length - 1, 0)) : 0;
  const open = suggestions.length > 0 && dismissedKey !== tokenKey;

  useEffect(() => {
    onSuggestionsOpenChange?.(open);
  }, [open, onSuggestionsOpenChange]);

  const segments = useMemo(() => parseRichText(value, people), [value]);

  function choose(suggestion: Suggestion) {
    if (!token) return;
    const before = value.slice(0, token.start);
    const after = value.slice(token.end).replace(/^\s+/, "");
    const next = (before + suggestion.insert + after).slice(0, MAX_POST_LENGTH);
    const nextCaret = Math.min(before.length + suggestion.insert.length, next.length);
    onChange(next, nextCaret);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveState({ key: tokenKey, index: (active + step + suggestions.length) % suggestions.length });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedKey(tokenKey);
    }
  }

  const syncCaret = () => onCaretChange(textareaRef.current?.selectionStart ?? value.length);
  const listId = `${id}-suggestions`;
  const kindLabel = token?.trigger === "#" ? "hashtag" : "people";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative">
        <div aria-hidden="true" className="min-h-[44px] whitespace-pre-wrap break-words text-md text-ink">
          {segments.map((segment, index) =>
            "text" in segment ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <span key={index} className="text-primary-light [text-shadow:0.35px_0_0_currentColor]">
                {"tag" in segment ? `#${segment.tag}` : `@${segment.mention}`}
              </span>
            ),
          )}
          {"​"}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          maxLength={MAX_POST_LENGTH}
          onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          autoFocus
          spellCheck
          placeholder="Share an update, ask a question or start a poll… Use # for topics and @ to mention"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${id}-${suggestions[active]?.id}` : undefined}
          className="absolute inset-0 size-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent text-md text-transparent caret-ink outline-none selection:bg-primary-tint selection:text-transparent placeholder:text-disabled"
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {open ? `${suggestions.length} ${kindLabel} suggestions. Use up and down arrows, Enter to insert, Escape to dismiss.` : ""}
      </p>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={token?.trigger === "#" ? "Hashtag suggestions" : "People to mention"}
          className="flex w-[340px] max-w-full flex-col overflow-hidden rounded-[10px] border border-line bg-card shadow-[0px_8px_20px_0px_rgba(0,0,0,0.1)]"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${id}-${suggestion.id}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveState({ key: tokenKey, index })}
              onClick={() => choose(suggestion)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5",
                index === active && "bg-primary-tint-2",
              )}
            >
              {suggestion.kind === "tag" ? (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name="hash" size={16} className="shrink-0 text-primary-light" />
                    <span className="truncate text-sm font-medium text-ink">#{suggestion.tag}</span>
                    <span className="shrink-0 text-xs text-secondary">{suggestion.posts.toLocaleString("en-US")} posts</span>
                  </span>
                  {suggestion.trending && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-accent-hover">
                      <Icon name="trending" size={14} className="text-accent" />
                      Trending
                    </span>
                  )}
                </>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={suggestion.name} size={24} tone={suggestion.tone} />
                  <span className="truncate text-sm font-medium text-ink">{suggestion.name}</span>
                  <span className="truncate text-xs text-secondary">{suggestion.headline}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
