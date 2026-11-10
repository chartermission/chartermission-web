"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChapterSummary, DirectoryMember, HashtagSuggestion, Page } from "@chartermission/contracts";
import { ChapterAvatar, Icon, cn } from "@chartermission/ui";
import { memberHref, topicHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";

type Suggestion =
  | { kind: "member"; key: string; href: string; member: DirectoryMember }
  | { kind: "topic"; key: string; href: string; topic: HashtagSuggestion }
  | { kind: "chapter"; key: string; href: string; chapter: ChapterSummary }
  | { kind: "all"; key: string; href: string };

const DEBOUNCE_MS = 180;
let chapterList: Promise<ChapterSummary[]> | null = null;
/** Chapters are few and change rarely: fetched once per visit and searched in the browser. */
const chapters = () => (chapterList ??= api<ChapterSummary[]>("/chapters").catch(() => {
  chapterList = null;
  return [];
}));

/**
 * The search box in the top bar. As the member types it suggests members, topics and chapters;
 * arrow keys move through them, Enter opens the highlighted one, and Enter with nothing
 * highlighted (or the last row) opens the full results page.
 */
export function SearchBox({ className }: { className?: string }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = value.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const bare = term.replace(/^[#@]/, "");
      setLoading(true);
      Promise.all([
        term.startsWith("#") ? Promise.resolve(null) : api<Page<DirectoryMember>>("/members", { query: { q: bare, limit: 5 } }).catch(() => null),
        term.startsWith("@") ? Promise.resolve([] as HashtagSuggestion[]) : api<HashtagSuggestion[]>("/hashtags/suggest", { query: { q: bare } }).catch(() => [] as HashtagSuggestion[]),
        term.startsWith("#") || term.startsWith("@") ? Promise.resolve([] as ChapterSummary[]) : chapters(),
      ]).then(([members, topics, allChapters]) => {
        if (!live) return;
        const q = bare.toLowerCase();
        const next: Suggestion[] = [
          ...(members?.items ?? []).slice(0, 5).map((member): Suggestion => ({ kind: "member", key: `m:${member.id}`, href: memberHref(member.handle), member })),
          ...allChapters
            .filter((c) => c.name.toLowerCase().includes(q) || c.countryName.toLowerCase().includes(q))
            .slice(0, 3)
            .map((chapter): Suggestion => ({ kind: "chapter", key: `c:${chapter.id}`, href: `/chapters/${chapter.slug}`, chapter })),
          ...topics.slice(0, 4).map((topic): Suggestion => ({ kind: "topic", key: `t:${topic.tag}`, href: topicHref(topic.tag), topic })),
          { kind: "all", key: "all", href: `/search?q=${encodeURIComponent(term)}` },
        ];
        setItems(next);
        setActive(-1);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const shown = open && term.length >= 2 ? items : [];

  function go(href: string) {
    setOpen(false);
    input.current?.blur();
    router.push(href);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!term) return;
    go(active >= 0 && shown[active] ? shown[active].href : `/search?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!shown.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setOpen(true);
    setActive((current) => (event.key === "ArrowDown" ? (current + 1) % shown.length : current <= 0 ? shown.length - 1 : current - 1));
  }

  const heading = (kind: Suggestion["kind"]) => (kind === "member" ? t("Members") : kind === "chapter" ? t("Chapters") : kind === "topic" ? t("Topics") : null);

  return (
    <form ref={root} action="/search" role="search" onSubmit={onSubmit} className={cn("relative", className)}>
      <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
        <Icon name="search" size={18} className="shrink-0" />
        <span className="sr-only">{t("nav.search")}</span>
        <input
          ref={input}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          value={value}
          placeholder={t("nav.searchPlaceholder")}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
        />
        {loading && term.length >= 2 && open && <span className="block size-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />}
      </label>
      {shown.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t("Suggestions")}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] min-w-[320px] overflow-y-auto rounded-card border border-line bg-card py-1.5 shadow-[0_12px_32px_rgb(15_42_42/0.18)]"
        >
          {shown.map((item, index) => {
            const first = index === 0 || shown[index - 1]!.kind !== item.kind;
            const title = first ? heading(item.kind) : null;
            return (
              <li key={item.key} role="presentation">
                {title && <p className="px-3.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-secondary uppercase">{title}</p>}
                {item.kind === "all" && shown.length > 1 && <div className="my-1.5 h-px bg-line" />}
                <Link
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  onMouseEnter={() => setActive(index)}
                  className={cn("flex items-center gap-3 px-3.5 py-2 text-sm text-ink", index === active && "bg-primary-tint-2")}
                >
                  <NoTranslate>
                    {item.kind === "member" && (
                      <>
                        <MemberAvatar member={item.member} size={32} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1 truncate font-medium">
                            {item.member.name}
                            {item.member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" />}
                          </span>
                          {item.member.headline && <span className="truncate text-xs text-secondary">{item.member.headline}</span>}
                        </span>
                      </>
                    )}
                    {item.kind === "chapter" && (
                      <>
                        <ChapterAvatar name={item.chapter.name} countryCode={item.chapter.countryCode} src={item.chapter.imageUrl} size={32} className="rounded-full" />
                        <span className="truncate font-medium">{item.chapter.name}</span>
                      </>
                    )}
                    {item.kind === "topic" && (
                      <>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                          <Icon name="hash" size={16} />
                        </span>
                        <span dir="auto" className="truncate font-medium">
                          #{item.topic.tag}
                        </span>
                      </>
                    )}
                  </NoTranslate>
                  {item.kind === "all" && (
                    <>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
                        <Icon name="search" size={16} />
                      </span>
                      <span className="truncate">{t("See all results for “{term}”", { term })}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
