"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon, cn } from "@chartermission/ui";
import { cleanQuery } from "./explore-params";
import { useExploreNav } from "./explore-state";

const DEBOUNCE_MS = 300;

/** Topic search (GET /topics?q=), kept in the URL as ?q= while you type. */
export function TopicSearch({ q }: { q: string }) {
  const id = useId();
  const { go, pending } = useExploreNav();
  const [value, setValue] = useState(q);
  const [synced, setSynced] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward changed ?q= under us: show it.
  if (q !== synced) {
    setSynced(q);
    if (cleanQuery(value) !== q) setValue(q);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function submit(next: string, mode: "push" | "replace") {
    if (timer.current) clearTimeout(timer.current);
    const clean = cleanQuery(next);
    if (clean === q) return;
    // Starting a search gets its own history entry, so Back returns to the explore view.
    go({ q: clean || null }, q ? mode : "push");
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(next, "replace"), DEBOUNCE_MS);
  }

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit(value, "push");
      }}
      className="relative"
    >
      <label htmlFor={`${id}-q`} className="sr-only">
        Search topics
      </label>
      <Icon name="search" size={18} className="pointer-events-none absolute start-3.5 inset-y-0 my-auto h-fit text-secondary" />
      <input
        id={`${id}-q`}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            setValue("");
            submit("", "replace");
          }
        }}
        placeholder="Search topics, e.g. #AfCFTA"
        autoComplete="off"
        spellCheck={false}
        maxLength={51}
        className={cn(
          "h-11 w-full rounded-lg border border-line bg-surface ps-10 pe-20 text-md text-ink placeholder:text-disabled",
          "transition-colors hover:border-line-strong focus:border-primary-light focus:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-tint",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      <span className="absolute end-2 inset-y-0 my-auto h-fit flex items-center gap-1">
        {pending && (
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-primary-light" />
        )}
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              submit("", "replace");
            }}
            className="flex size-8 items-center justify-center rounded-md text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name="x" size={16} />
            <span className="sr-only">Clear search</span>
          </button>
        )}
      </span>
    </form>
  );
}
