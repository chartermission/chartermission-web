"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChapterRef, ChapterSummary } from "@chartermission/contracts";
import { Button, ChapterAvatar, Icon, cn, type IconName } from "@chartermission/ui";
import { Dialog } from "@/components/social/dialog";
import { useIntlTag, useT } from "@/i18n/client";
import { countryNameOf, translatePlace } from "@/i18n/places";
import type { Translate } from "@/i18n/translate";
import { useChapterList } from "./chapter-list";

/*
 * One way to choose chapters anywhere on the site. The field shows only what is chosen (as chips)
 * and a button; the button opens a popup with a search box and the chapters in sections: yours
 * first, then each African region, then the diaspora. Lists of six or fewer (say, the chapters
 * you lead) show inline as chips to tap instead.
 */

/** What a caller may pass to restrict the list: any chapter reference. */
export type ChapterChoice = Pick<ChapterRef, "id" | "slug" | "name" | "countryCode">;

/** A row in the popup that is not a chapter, such as "Any chapter" or "Chapters I follow". */
export type ChapterExtra = { value: string | null; label: string; icon?: IconName };

/** Lists this long or shorter are shown inline as chips. */
export const CHAPTER_INLINE_MAX = 6;

type ValueKey = "id" | "slug";

type Entry = {
  id: string;
  slug: string;
  name: string;
  /** The name in the page language. */
  label: string;
  countryCode: string;
  region: string | null;
  diaspora: boolean;
  imageUrl: string | null;
  followers: number | null;
  mine: boolean;
  /** Everything the search box matches, folded. */
  search: string;
};

type Section = { key: string; title: string; entries: Entry[] };

const DIASPORA = "Diaspora";
const DIASPORA_NAME = /\bDiaspora Chapter$/i;
/** Words members type for the diaspora, in each language. */
const DIASPORA_ALIASES = "diaspora المهجر الشتات";

/** Lower-case without accents or Arabic marks, so "cote" finds "Côte d’Ivoire". */
function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "").toLocaleLowerCase();
}

function toEntry(base: ChapterChoice, summary: ChapterSummary | undefined, intl: string, t: Translate): Entry {
  const region = summary?.region ?? null;
  const diaspora = region === DIASPORA || DIASPORA_NAME.test(base.name);
  const label = translatePlace(base.name, intl, t) ?? base.name;
  const words = [
    base.name,
    label,
    base.slug.replace(/-/g, " "),
    base.countryCode,
    summary?.countryName,
    countryNameOf(base.countryCode, "en-GB"),
    countryNameOf(base.countryCode, "fr-FR"),
    countryNameOf(base.countryCode, "ar"),
    region && region !== DIASPORA ? `${region} ${t(region)}` : "",
    summary?.hashtag,
    diaspora ? DIASPORA_ALIASES : "",
  ];
  return {
    id: base.id,
    slug: base.slug,
    name: base.name,
    label,
    countryCode: base.countryCode,
    region,
    diaspora,
    imageUrl: summary?.imageUrl ?? null,
    followers: summary?.followers ?? null,
    mine: !!summary && (summary.viewer.following || !!summary.viewer.leads),
    search: fold(words.filter(Boolean).join(" ")),
  };
}

/** The chapters a picker offers: `options` when given (enriched from GET /chapters), else every active chapter. */
function useEntries(options: ChapterChoice[] | undefined) {
  const t = useT();
  const intl = useIntlTag();
  const { chapters, error, retry } = useChapterList();
  const entries = useMemo(() => {
    const base: ChapterChoice[] | null = options ?? chapters;
    if (!base) return null;
    const byId = new Map((chapters ?? []).map((c) => [c.id, c]));
    return base.map((c) => toEntry(c, byId.get(c.id), intl, t));
  }, [options, chapters, intl, t]);
  return { entries, error: options ? null : error, retry };
}

function sectionsOf(entries: Entry[], homeCountry: string | null | undefined, t: Translate, intl: string): Section[] {
  const collator = new Intl.Collator(intl);
  const byLabel = (a: Entry, b: Entry) => collator.compare(a.label, b.label);
  const mine: Entry[] = [];
  const home: Entry[] = [];
  const diaspora: Entry[] = [];
  const other: Entry[] = [];
  const regions = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.mine) mine.push(entry);
    else if (homeCountry && entry.countryCode === homeCountry) home.push(entry);
    else if (entry.diaspora) diaspora.push(entry);
    else if (entry.region) regions.set(entry.region, [...(regions.get(entry.region) ?? []), entry]);
    else other.push(entry);
  }
  const regional = [...regions.entries()]
    .map(([region, list]) => ({ key: `region:${region}`, title: t(region), entries: list.sort(byLabel) }))
    .sort((a, b) => collator.compare(a.title, b.title));
  return [
    { key: "mine", title: t("Your chapters"), entries: mine.sort(byLabel) },
    { key: "home", title: t("From your country"), entries: home.sort(byLabel) },
    ...regional,
    { key: "diaspora", title: t("Diaspora chapters"), entries: diaspora.sort(byLabel) },
    { key: "other", title: regional.length || diaspora.length ? t("More chapters") : t("Chapters"), entries: other.sort(byLabel) },
  ].filter((section) => section.entries.length > 0);
}

const keyOf = (entry: Pick<Entry, "id" | "slug">, valueKey: ValueKey) => (valueKey === "slug" ? entry.slug : entry.id);

function membersText(t: Translate, count: number | null) {
  return count === null ? null : t("{count} members", { count });
}

/* ------------------------------------------------------------------ popup */

type Row = { kind: "extra"; extra: ChapterExtra; domId: string } | { kind: "chapter"; entry: Entry; domId: string };

/**
 * The popup: a search box that keeps focus while the arrow keys move through the list (Enter picks),
 * the chapters in sections, and for several at once "Clear" and "Done (n)". Esc or × closes it and
 * focus goes back to the button that opened it. A full-screen sheet on phones.
 */
function ChapterPickerDialog({
  title,
  entries,
  error,
  retry,
  multiple,
  initial,
  max,
  extras = [],
  extraValue,
  homeCountry,
  valueKey,
  onPick,
  onDone,
  onClose,
}: {
  title: string;
  entries: Entry[] | null;
  error: unknown;
  retry: () => void;
  multiple: boolean;
  /** Keys chosen when the popup opened. */
  initial: string[];
  max?: number;
  extras?: ChapterExtra[];
  /** Which extra row is current (single choice, nothing else chosen). */
  extraValue?: string | null;
  homeCountry?: string | null;
  valueKey: ValueKey;
  onPick: (key: string | null) => void;
  onDone: (keys: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const intl = useIntlTag();
  const id = useId();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [draft, setDraft] = useState<string[]>(initial);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const q = fold(deferred.trim());
  const sections = useMemo(() => {
    if (!entries) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const shown = words.length ? entries.filter((e) => words.every((w) => e.search.includes(w))) : entries;
    return sectionsOf(shown, homeCountry, t, intl);
  }, [entries, q, homeCountry, t, intl]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = q ? [] : extras.map((extra, i) => ({ kind: "extra" as const, extra, domId: `${id}-x${i}` }));
    for (const section of sections) for (const entry of section.entries) out.push({ kind: "chapter", entry, domId: `${id}-${entry.id}` });
    return out;
  }, [sections, extras, q, id]);

  // Start on the current choice; after typing, on the first match.
  const chosen = new Set(draft);
  const startIndex = q ? 0 : Math.max(0, rows.findIndex((r) => (r.kind === "chapter" ? chosen.has(keyOf(r.entry, valueKey)) : !draft.length && r.extra.value === (extraValue ?? null))));
  const [lastQ, setLastQ] = useState<string | null>(null);
  if (lastQ !== q && entries) {
    setLastQ(q);
    setActive(startIndex);
  }
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    const row = rows[current];
    if (row) document.getElementById(row.domId)?.scrollIntoView({ block: "nearest" });
  }, [current, rows]);

  const full = multiple && max !== undefined && draft.length >= max;

  function close() {
    bodyRef.current?.closest("dialog")?.close();
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "extra") {
      onPick(row.extra.value);
      close();
      return;
    }
    const key = keyOf(row.entry, valueKey);
    if (!multiple) {
      onPick(key);
      close();
      return;
    }
    if (chosen.has(key)) setDraft(draft.filter((k) => k !== key));
    else if (!full) setDraft([...draft, key]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = rows.length - 1;
    if (event.key === "ArrowDown") setActive(Math.min(current + 1, last));
    else if (event.key === "ArrowUp") setActive(Math.max(current - 1, 0));
    else if (event.key === "Home" && !query) setActive(0);
    else if (event.key === "End" && !query) setActive(last);
    else if (event.key === "PageDown") setActive(Math.min(current + 8, last));
    else if (event.key === "PageUp") setActive(Math.max(current - 8, 0));
    else if (event.key === "Enter") choose(rows[current]);
    else return;
    event.preventDefault();
  }

  const rowClass = (on: boolean, isActive: boolean, disabled = false) =>
    cn(
      "flex cursor-pointer items-center gap-3 px-5 py-2.5 text-start max-sm:px-4",
      isActive ? "bg-primary-tint-2" : "hover:bg-muted",
      on && "font-medium",
      disabled && "cursor-not-allowed opacity-50",
    );

  const mark = (on: boolean) =>
    multiple ? (
      <span aria-hidden="true" className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border", on ? "border-primary bg-primary text-inverse" : "border-line-strong bg-card")}>
        {on && <Icon name="check" size={12} />}
      </span>
    ) : (
      <span aria-hidden="true" className="flex size-[18px] shrink-0 items-center justify-center text-primary">
        {on && <Icon name="check" size={18} />}
      </span>
    );

  const indexOf = new Map(rows.map((row, i) => [row.domId, i]));

  return (
    <Dialog
      title={title}
      description={multiple && max !== undefined ? t("Choose up to {max}.", { max }) : undefined}
      onClose={onClose}
      width={480}
      flush
      bodyClassName="min-h-0 flex-1"
      initialFocus="[data-chapter-search]"
      className="open:flex open:flex-col max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen! max-sm:max-w-none max-sm:rounded-none"
      footer={
        multiple ? (
          <>
            <span className="me-auto text-sm text-secondary" aria-live="polite">
              {full ? t("You can choose up to {max}.", { max: max! }) : draft.length ? t("{count} selected", { count: draft.length }) : null}
            </span>
            <Button variant="ghost" size="small" onClick={() => setDraft([])} disabled={!draft.length}>
              {t("Clear")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                onDone(draft);
                close();
              }}
            >
              {draft.length ? t("Done ({count})", { count: draft.length }) : t("Done")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pt-4 pb-3 max-sm:px-4">
          <label className="flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 text-disabled focus-within:border-primary-light focus-within:ring-2 focus-within:ring-primary-light/20">
            <Icon name="search" size={18} className="shrink-0" />
            <span className="sr-only">{t("Search chapters")}</span>
            <input
              data-chapter-search
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={rows[current]?.domId}
              autoComplete="off"
              enterKeyHint="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("Search by country or chapter")}
              className="h-full w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
          </label>
        </div>
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={title}
          aria-multiselectable={multiple || undefined}
          className="min-h-40 overflow-y-auto overscroll-contain pb-2 sm:max-h-[min(60dvh,520px)] max-sm:flex-1"
        >
          {!q &&
            extras.map((extra, x) => {
              const i = indexOf.get(`${id}-x${x}`) ?? -1;
              const on = !draft.length && (extraValue ?? null) === extra.value;
              return (
                <div key={extra.value ?? ""} id={rows[i]?.domId} role="option" aria-selected={on} onClick={() => choose(rows[i])} className={rowClass(on, i === current)}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
                    <Icon name={extra.icon ?? "globe"} size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink">{extra.label}</span>
                  {mark(on)}
                </div>
              );
            })}
          {sections.map((section) => (
            <div key={section.key} role="group" aria-labelledby={`${id}-${section.key}`}>
              <div id={`${id}-${section.key}`} className="sticky top-0 z-10 bg-card px-5 pt-3 pb-1.5 text-label uppercase text-secondary max-sm:px-4">
                {section.title}
              </div>
              {section.entries.map((entry) => {
                const i = indexOf.get(`${id}-${entry.id}`) ?? -1;
                const on = chosen.has(keyOf(entry, valueKey));
                const disabled = !on && full;
                const count = membersText(t, entry.followers);
                return (
                  <div
                    key={entry.id}
                    id={rows[i]?.domId}
                    role="option"
                    aria-selected={on}
                    aria-disabled={disabled || undefined}
                    onClick={() => {
                      setActive(i);
                      choose(rows[i]);
                    }}
                    className={cn(rowClass(on, i === current, disabled), "[contain-intrinsic-size:auto_52px] [content-visibility:auto]")}
                  >
                    <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={32} className="rounded-full" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-ink" dir="auto">
                        {entry.label}
                      </span>
                      {count && <span className="text-xs font-normal text-secondary">{count}</span>}
                    </span>
                    {mark(on)}
                  </div>
                );
              })}
            </div>
          ))}
          {entries && rows.length === 0 && <p className="px-5 py-6 text-center text-sm text-secondary">{t("No chapters match “{q}”.", { q: query.trim() })}</p>}
          {!entries && !error && (
            <p role="status" className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-secondary">
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line border-t-primary" />
              {t("Loading chapters")}
            </p>
          )}
          {!entries && !!error && (
            <div role="alert" className="flex flex-col items-center gap-3 px-5 py-8 text-center text-sm text-secondary">
              {t("Chapters couldn’t be loaded.")}
              <Button variant="secondary" size="small" onClick={retry}>
                {t("Try again")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ field */

type BaseProps = {
  /** Field label, shown above it; also the popup's title unless `title` is given. */
  label?: string;
  hideLabel?: boolean;
  /** Popup title. */
  title?: string;
  /** Shown in the field while nothing is chosen. */
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  /** Id for the button, so form errors can focus it. */
  id?: string;
  /** Offer only these chapters (e.g. the ones you lead). Default: every active chapter. */
  options?: ChapterChoice[];
  /** What `value` holds: chapter ids (default) or slugs. */
  valueKey?: ValueKey;
  /** List this country's chapters near the top ("From your country"). */
  homeCountry?: string | null;
  disabled?: boolean;
  className?: string;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Show × on the chosen chapter to clear it. */
  clearable?: boolean;
};

type MultiProps = BaseProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
};

/** The chapter field: chips for what is chosen and a button that opens the popup. */
export function ChapterPicker(props: SingleProps | MultiProps) {
  const t = useT();
  const autoId = useId();
  const { label, hideLabel, title, placeholder, hint, error, options, valueKey = "id", homeCountry, disabled, className } = props;
  const id = props.id ?? `${autoId}-button`;
  const multiple = props.multiple === true;
  const values = props.multiple ? props.value : props.value ? [props.value] : [];
  const max = props.multiple ? props.max : 1;
  const [open, setOpen] = useState(false);
  const { entries, error: loadError, retry } = useEntries(options);
  const inline = !!options && options.length <= CHAPTER_INLINE_MAX;

  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [keyOf(e, valueKey), e])), [entries, valueKey]);
  const chosen = values.map((key) => byKey.get(key) ?? null);

  function set(keys: string[]) {
    if (props.multiple) props.onChange(keys);
    else props.onChange(keys[0] ?? null);
  }
  const remove = (key: string) => set(values.filter((k) => k !== key));
  const removable = multiple || (!props.multiple && props.clearable);

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const labelId = `${id}-label`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <span id={labelId} className={hideLabel ? "sr-only" : "text-sm font-medium text-ink"}>
          {label}
        </span>
      )}
      {inline ? (
        <div role={multiple ? "group" : "radiogroup"} aria-labelledby={label ? labelId : undefined} aria-describedby={describedBy} className="flex flex-wrap gap-2">
          {(entries ?? []).map((entry, i) => {
            const key = keyOf(entry, valueKey);
            const on = values.includes(key);
            const blocked = multiple && !on && max !== undefined && values.length >= max;
            return (
              <button
                key={entry.id}
                id={i === 0 ? id : undefined}
                type="button"
                role={multiple ? undefined : "radio"}
                aria-checked={multiple ? undefined : on}
                aria-pressed={multiple ? on : undefined}
                disabled={disabled || blocked}
                onClick={() => (on ? (removable ? remove(key) : undefined) : set(multiple ? [...values, key] : [key]))}
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-not-allowed disabled:opacity-50",
                  on ? "border-primary bg-primary-tint text-primary" : "border-line bg-card text-body hover:border-line-strong hover:bg-muted",
                  error && !on && "border-error",
                )}
              >
                <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={24} className="rounded-full" />
                <span className="truncate" dir="auto">
                  {entry.label}
                </span>
                {on && <Icon name="check" size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {values.length > 0 ? (
            <ul aria-label={label ? t("Chosen: {label}", { label }) : t("Chosen chapters")} className="contents">
              {values.map((key, i) => {
                const entry = chosen[i];
                const name = entry?.label ?? "…";
                return (
                  <li key={key} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-muted py-1 ps-1 pe-1.5 text-sm font-medium text-ink">
                    {entry ? (
                      <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={24} className="rounded-full" />
                    ) : (
                      <span aria-hidden="true" className="size-6 shrink-0 animate-pulse rounded-full bg-line" />
                    )}
                    <span className="truncate" dir="auto">
                      {name}
                    </span>
                    {removable ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => remove(key)}
                        aria-label={t("Remove {name}", { name })}
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-line hover:text-ink"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    ) : (
                      <span className="w-1" />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            placeholder && <span className="text-sm text-secondary">{placeholder}</span>
          )}
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-labelledby={label ? `${labelId} ${id}` : undefined}
            aria-describedby={describedBy}
            onClick={() => setOpen(true)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium text-primary transition-colors hover:border-line-strong hover:bg-muted disabled:opacity-50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light",
              error ? "border-error" : "border-line",
            )}
          >
            <Icon name={values.length ? "edit" : "plus"} size={14} />
            {values.length ? t("Change") : multiple ? t("Choose chapters") : t("Choose chapter")}
          </button>
        </div>
      )}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-error">
          <Icon name="alert" size={14} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="text-xs text-secondary">
          {hint}
        </div>
      ) : null}
      {open && (
        <ChapterPickerDialog
          title={title ?? label ?? (multiple ? t("Choose chapters") : t("Choose a chapter"))}
          entries={entries}
          error={loadError}
          retry={retry}
          multiple={multiple}
          initial={values}
          max={max}
          homeCountry={homeCountry}
          valueKey={valueKey}
          onPick={(key) => set(key ? [key] : [])}
          onDone={set}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ filter */

/**
 * The compact form for filter bars: "Chapter: Any ▾". The popup starts with "Any chapter" (and any
 * `extras`, such as "Chapters I follow"); picking closes it. Values are slugs by default, as in URLs.
 */
export function ChapterFilter({
  value,
  onChange,
  extras = [],
  options,
  valueKey = "slug",
  size = "small",
  prefix = true,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  extras?: ChapterExtra[];
  options?: ChapterChoice[];
  valueKey?: ValueKey;
  /** small: 32px, beside FilterSelect; medium: 40px, beside SelectField. */
  size?: "small" | "medium";
  /** "Chapter: Nigeria" (default), or just "Nigeria" where a "Chapter" label sits above. */
  prefix?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { entries, error, retry } = useEntries(options);
  const all: ChapterExtra[] = [{ value: null, label: t("Any chapter"), icon: "globe" }, ...extras];
  const extra = all.find((x) => x.value === (value ?? null));
  const entry = !extra && value ? (entries ?? []).find((e) => keyOf(e, valueKey) === value) : undefined;
  const name = extra ? extra.label : (entry?.label ?? "…");
  // A chosen chapter shows its picture and name ("Kenya Chapter"); otherwise "Chapter: Any".
  const shown = !prefix || entry ? name : extra?.value === null ? t("Chapter: Any") : t("Chapter: {name}", { name });

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-card ps-2.5 pe-2 text-sm transition-colors hover:border-line-strong",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light",
          size === "small" ? "py-1.5" : "h-10 ps-3",
          value ? "border-primary-light/60 text-ink" : "border-line text-body",
          className,
        )}
      >
        {entry && <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={18} className="rounded-full" />}
        <span className="min-w-0 flex-1 truncate text-start" dir="auto">
          {shown}
        </span>
        {(!prefix || entry) && <span className="sr-only">{t("Chapter")}</span>}
        <Icon name="chevron-down" size={14} className="shrink-0 text-secondary" />
      </button>
      {open && (
        <ChapterPickerDialog
          title={t("Filter by chapter")}
          entries={entries}
          error={error}
          retry={retry}
          multiple={false}
          initial={entry ? [value!] : []}
          extras={all}
          extraValue={extra ? extra.value : undefined}
          valueKey={valueKey}
          onPick={onChange}
          onDone={() => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
