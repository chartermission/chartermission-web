"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { POST_MAX_CHARS, type DirectoryMember, type HashtagSuggestion, type Page } from "@chartermission/contracts";
import { Avatar, Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { tokenize } from "@/components/social/rich-text";
import { T, useT } from "@/i18n/client";

type Token = { trigger: "#" | "@"; query: string; start: number; end: number };

type Suggestion =
  | { kind: "tag"; id: string; insert: string; tag: string; posts: number; trending: boolean }
  | { kind: "person"; id: string; insert: string; member: DirectoryMember };

/** The #tag / @handle being typed immediately before the caret, if any. */
function tokenAt(text: string, caret: number): Token | null {
  const match = /(^|\s)([#@])([A-Za-z0-9_-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const trigger = match[2] as Token["trigger"];
  return { trigger, query: match[3], start: caret - match[3].length - 1, end: caret };
}

/** Debounced suggestions: GET /hashtags/suggest?q= for #, GET /members?q= for @. */
function useSuggestions(token: Token | null): { key: string; items: Suggestion[] } {
  const key = token ? `${token.trigger}${token.query}` : "";
  const [result, setResult] = useState<{ key: string; items: Suggestion[] }>({ key: "", items: [] });

  useEffect(() => {
    if (!token) return;
    if (token.trigger === "@" && token.query.length < 1) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        if (token.trigger === "#") {
          const tags = await api<HashtagSuggestion[]>("/hashtags/suggest", { query: { q: token.query }, signal: controller.signal });
          setResult({
            key,
            items: tags
              .filter((t) => t.tag.toLowerCase() !== token.query.toLowerCase())
              .slice(0, 6)
              .map((t) => ({ kind: "tag", id: `tag-${t.tag}`, insert: `#${t.tag} `, ...t })),
          });
        } else {
          const page = await api<Page<DirectoryMember>>("/members", { query: { q: token.query, limit: 6 }, signal: controller.signal });
          setResult({
            key,
            items: page.items
              .filter((m) => !m.relationship.self && !m.relationship.blocked)
              .map((member) => ({ kind: "person", id: `person-${member.handle}`, insert: `@${member.handle} `, member })),
          });
        }
      } catch {
        // Autocomplete is best-effort; typing still works without it.
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the token text
  }, [key]);

  return result.key === key ? result : { key, items: [] };
}

/**
 * Post text area with live #hashtag / @mention highlighting and an autocomplete list.
 * The highlighted copy sits behind a transparent textarea so native editing, selection
 * and caret behaviour are preserved. Mentions insert @handle, which the API resolves.
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
  placeholder = "Share an update, ask a question or start a poll… Use # for topics and @ to mention",
  maxLength = POST_MAX_CHARS,
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
  placeholder?: string;
  maxLength?: number;
}) {
  const t = useT();
  const id = useId();
  const token = useMemo(() => tokenAt(value, caret), [value, caret]);
  const { items: suggestions } = useSuggestions(token);
  const tokenKey = token ? `${token.start}:${token.trigger}${token.query}` : "";
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<{ key: string; index: number }>({ key: "", index: 0 });
  const active = activeState.key === tokenKey ? Math.min(activeState.index, Math.max(suggestions.length - 1, 0)) : 0;
  const open = !!token && suggestions.length > 0 && dismissedKey !== tokenKey;

  useEffect(() => {
    onSuggestionsOpenChange?.(open);
  }, [open, onSuggestionsOpenChange]);

  const segments = useMemo(() => tokenize(value), [value]);

  function choose(suggestion: Suggestion) {
    if (!token) return;
    const before = value.slice(0, token.start);
    const after = value.slice(token.end).replace(/^\s+/, "");
    const next = (before + suggestion.insert + after).slice(0, maxLength);
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
        <div aria-hidden="true" className="min-h-[88px] whitespace-pre-wrap break-words text-md text-ink">
          {segments.map((segment, index) =>
            segment.kind === "text" ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <span key={index} className="text-primary-light [text-shadow:0.35px_0_0_currentColor]">
                {segment.text}
              </span>
            ),
          )}
          {"​"}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          spellCheck
          placeholder={placeholder}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${id}-${suggestions[active]?.id}` : undefined}
          role="combobox"
          className="absolute inset-0 size-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent text-md text-transparent caret-ink outline-none selection:bg-primary-tint selection:text-transparent placeholder:text-disabled"
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {open ? t("{count} {kindLabel} suggestions. Use up and down arrows, Enter to insert, Escape to dismiss.", { count: suggestions.length, kindLabel }) : ""}
      </p>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={token?.trigger === "#" ? "Hashtag suggestions" : "People to mention"}
          className="flex w-[360px] max-w-full flex-col overflow-hidden rounded-[10px] border border-line bg-card shadow-[0px_8px_20px_0px_rgba(0,0,0,0.1)]"
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
              className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5", index === active && "bg-primary-tint-2")}
            >
              {suggestion.kind === "tag" ? (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name="hash" size={16} className="shrink-0 text-primary-light" />
                    <span className="truncate text-sm font-medium text-ink">#{suggestion.tag}</span>
                    <span className="shrink-0 text-xs text-secondary"><T vars={{ count: suggestion.posts.toLocaleString("en-US") }}>{"{count} posts"}</T></span>
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
                  <span aria-hidden="true" className="flex">
                    <Avatar name={suggestion.member.name} src={suggestion.member.avatarUrl ?? undefined} size={24} tone={suggestion.member.tone} />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{suggestion.member.name}</span>
                  <span className="truncate text-xs text-secondary">@{suggestion.member.handle}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
