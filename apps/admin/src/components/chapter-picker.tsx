"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChapterSummary } from "@chartermission/contracts";
import { Button, ChapterAvatar, Icon, cn, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { useIntlTag, useT } from "@/i18n/client";
import { countryNameOf, translatePlace } from "@/i18n/places";
import type { Translate } from "@/i18n/translate";

/*
 * Choosing chapters anywhere in the console. A field shows only what is chosen (chips) and a button;
 * filters show "Chapter: Any ▾". Both open one popup: a search box (chapter, country in English,
 * French or Arabic, "diaspora"), the chapters by region with the diaspora last, arrow keys and
 * Enter to pick, Esc to close. Lists of six or fewer show inline as chips instead.
 */

/** A chapter to offer. Region, picture and member count are filled in from GET /chapters when missing. */
export type ChapterChoice = {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  region?: string;
  imageUrl?: string | null;
  followers?: number;
};

/** A popup row that is not a chapter ("Any chapter"). */
export type ChapterExtra = { value: string | null; label: string; icon?: IconName };

export const CHAPTER_INLINE_MAX = 6;

type ValueKey = "id" | "slug";

type Entry = {
  id: string;
  slug: string;
  name: string;
  label: string;
  countryCode: string;
  region: string | null;
  diaspora: boolean;
  imageUrl: string | null;
  followers: number | null;
  search: string;
};

const DIASPORA = "Diaspora";
const DIASPORA_NAME = /\bDiaspora Chapter$/i;
const DIASPORA_ALIASES = "diaspora المهجر الشتات";

/* Every active chapter, fetched once per visit and shared by every picker. */
let cached: Promise<ChapterSummary[]> | null = null;
function loadChapters() {
  cached ??= api<ChapterSummary[]>("/chapters").catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

function useChapterList() {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadChapters().then(
      (list) => alive && setChapters(list),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  return {
    chapters,
    error,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "").toLocaleLowerCase();
}

function useEntries(options: ChapterChoice[] | undefined) {
  const t = useT();
  const intl = useIntlTag();
  const { chapters, error, retry } = useChapterList();
  const entries = useMemo(() => {
    const base: ChapterChoice[] | null = options ?? chapters;
    if (!base) return null;
    const byId = new Map((chapters ?? []).map((c) => [c.id, c]));
    return base.map((c): Entry => {
      const summary = byId.get(c.id);
      const region = c.region ?? summary?.region ?? null;
      const diaspora = region === DIASPORA || DIASPORA_NAME.test(c.name);
      const label = translatePlace(c.name, intl, t) ?? c.name;
      const words = [
        c.name,
        label,
        c.slug.replace(/-/g, " "),
        c.countryCode,
        countryNameOf(c.countryCode, "en-GB"),
        countryNameOf(c.countryCode, "fr-FR"),
        countryNameOf(c.countryCode, "ar"),
        region && region !== DIASPORA ? `${region} ${t(region)}` : "",
        summary?.hashtag,
        diaspora ? DIASPORA_ALIASES : "",
      ];
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        label,
        countryCode: c.countryCode,
        region,
        diaspora,
        imageUrl: c.imageUrl !== undefined ? c.imageUrl : (summary?.imageUrl ?? null),
        followers: c.followers ?? summary?.followers ?? null,
        search: fold(words.filter(Boolean).join(" ")),
      };
    });
  }, [options, chapters, intl, t]);
  return { entries, error: entries ? null : error, retry };
}

const keyOf = (entry: Pick<Entry, "id" | "slug">, valueKey: ValueKey) => (valueKey === "slug" ? entry.slug : entry.id);

function sectionsOf(entries: Entry[], t: Translate, intl: string) {
  const collator = new Intl.Collator(intl);
  const byLabel = (a: Entry, b: Entry) => collator.compare(a.label, b.label);
  const regions = new Map<string, Entry[]>();
  const diaspora: Entry[] = [];
  const other: Entry[] = [];
  for (const entry of entries) {
    if (entry.diaspora) diaspora.push(entry);
    else if (entry.region) regions.set(entry.region, [...(regions.get(entry.region) ?? []), entry]);
    else other.push(entry);
  }
  const regional = [...regions.entries()]
    .map(([region, list]) => ({ key: `region:${region}`, title: t(region), entries: list.sort(byLabel) }))
    .sort((a, b) => collator.compare(a.title, b.title));
  return [
    ...regional,
    { key: "diaspora", title: t("Diaspora chapters"), entries: diaspora.sort(byLabel) },
    { key: "other", title: regional.length || diaspora.length ? t("More chapters") : t("Chapters"), entries: other.sort(byLabel) },
  ].filter((s) => s.entries.length > 0);
}

type Row = { domId: string; extra?: ChapterExtra; entry?: Entry };

function PickerDialog({
  title,
  entries,
  error,
  retry,
  multiple,
  initial,
  max,
  extras = [],
  extraValue,
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
  initial: string[];
  max?: number;
  extras?: ChapterExtra[];
  extraValue?: string | null;
  valueKey: ValueKey;
  onPick: (key: string | null) => void;
  onDone: (keys: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const intl = useIntlTag();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [draft, setDraft] = useState(initial);
  const [active, setActive] = useState(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Open on mount; focus the search box; give focus back to the opener when it closes.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const q = fold(deferred.trim());
  const sections = useMemo(() => {
    if (!entries) return [];
    const words = q.split(/\s+/).filter(Boolean);
    return sectionsOf(words.length ? entries.filter((e) => words.every((w) => e.search.includes(w))) : entries, t, intl);
  }, [entries, q, t, intl]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = q ? [] : extras.map((extra, i) => ({ domId: `${id}-x${i}`, extra }));
    for (const section of sections) for (const entry of section.entries) out.push({ domId: `${id}-${entry.id}`, entry });
    return out;
  }, [sections, extras, q, id]);
  const indexOf = new Map(rows.map((row, i) => [row.domId, i]));

  const chosen = new Set(draft);
  const [lastQ, setLastQ] = useState<string | null>(null);
  if (lastQ !== q && entries) {
    setLastQ(q);
    setActive(q ? 0 : Math.max(0, rows.findIndex((r) => (r.entry ? chosen.has(keyOf(r.entry, valueKey)) : !draft.length && r.extra!.value === (extraValue ?? null)))));
  }
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    const row = rows[current];
    if (row) document.getElementById(row.domId)?.scrollIntoView({ block: "nearest" });
  }, [current, rows]);

  const full = multiple && max !== undefined && draft.length >= max;

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.extra) {
      onPick(row.extra.value);
      ref.current?.close();
      return;
    }
    const key = keyOf(row.entry!, valueKey);
    if (!multiple) {
      onPick(key);
      ref.current?.close();
    } else if (chosen.has(key)) setDraft(draft.filter((k) => k !== key));
    else if (!full) setDraft([...draft, key]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = rows.length - 1;
    if (event.key === "ArrowDown") setActive(Math.min(current + 1, last));
    else if (event.key === "ArrowUp") setActive(Math.max(current - 1, 0));
    else if (event.key === "PageDown") setActive(Math.min(current + 8, last));
    else if (event.key === "PageUp") setActive(Math.max(current - 8, 0));
    else if (event.key === "Enter") choose(rows[current]);
    else return;
    event.preventDefault();
  }

  const mark = (on: boolean) =>
    multiple ? (
      <span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-inverse" : "border-line-strong")}>
        {on && <Icon name="check" size={12} />}
      </span>
    ) : (
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center text-primary">
        {on && <Icon name="check" size={16} />}
      </span>
    );
  const rowClass = (isActive: boolean, on: boolean, disabled = false) =>
    cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm text-body", isActive ? "bg-primary-tint-2" : "hover:bg-muted", on && "font-medium text-ink", disabled && "cursor-not-allowed opacity-50");

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={() => onCloseRef.current()}
      onKeyDown={(event) => {
        // Esc closes this popup only, not a panel or dialog around it.
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40 open:flex open:max-h-[min(640px,calc(100dvh-32px))] open:flex-col max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-h3 text-ink">
            {title}
          </h2>
          {multiple && max !== undefined && <p className="text-sm text-secondary">{t("You can choose up to {max}.", { max })}</p>}
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink">
          <Icon name="x" size={18} label={t("Close")} />
        </button>
      </div>
      <div className="relative mx-5 mb-2 flex items-center">
        <Icon name="search" size={14} className="pointer-events-none absolute start-2.5 text-secondary" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={t("Search chapters")}
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={rows[current]?.domId}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("Search chapters")}
          className="w-full rounded-lg border border-line bg-card py-1.5 ps-8 pe-3 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-light/20"
        />
      </div>
      <div id={`${id}-list`} role="listbox" aria-label={title} aria-multiselectable={multiple || undefined} className="min-h-32 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {!q &&
          extras.map((extra, x) => {
            const i = indexOf.get(`${id}-x${x}`) ?? -1;
            const on = !draft.length && (extraValue ?? null) === extra.value;
            return (
              <div key={extra.value ?? ""} id={`${id}-x${x}`} role="option" aria-selected={on} onClick={() => choose(rows[i])} className={rowClass(i === current, on)}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
                  <Icon name={extra.icon ?? "globe"} size={14} />
                </span>
                <span className="min-w-0 flex-1">{extra.label}</span>
                {mark(on)}
              </div>
            );
          })}
        {sections.map((section) => (
          <div key={section.key} role="group" aria-labelledby={`${id}-${section.key}`}>
            <div id={`${id}-${section.key}`} className="sticky top-0 z-10 bg-card px-2 pt-2.5 pb-1 text-label uppercase text-secondary">
              {section.title}
            </div>
            {section.entries.map((entry) => {
              const i = indexOf.get(`${id}-${entry.id}`) ?? -1;
              const on = chosen.has(keyOf(entry, valueKey));
              const disabled = !on && full;
              return (
                <div
                  key={entry.id}
                  id={`${id}-${entry.id}`}
                  role="option"
                  aria-selected={on}
                  aria-disabled={disabled || undefined}
                  onClick={() => {
                    setActive(i);
                    choose(rows[i]);
                  }}
                  className={cn(rowClass(i === current, on, disabled), "[contain-intrinsic-size:auto_36px] [content-visibility:auto]")}
                >
                  <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={24} className="rounded-full" />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {entry.label}
                  </span>
                  {entry.followers !== null && <span className="shrink-0 text-xs font-normal text-secondary tabular-nums">{t("{count} members", { count: entry.followers })}</span>}
                  {mark(on)}
                </div>
              );
            })}
          </div>
        ))}
        {entries && rows.length === 0 && <p className="px-2 py-4 text-center text-sm text-secondary">{t("Nothing matches “{q}”.", { q: query.trim() })}</p>}
        {!entries && !error && <p className="px-2 py-6 text-center text-sm text-secondary">{t("Loading…")}</p>}
        {!entries && !!error && (
          <div role="alert" className="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-secondary">
            {t("Chapters couldn’t be loaded.")}
            <Button variant="secondary" size="small" onClick={retry}>
              {t("Try again")}
            </Button>
          </div>
        )}
      </div>
      {multiple && (
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <span className="me-auto text-sm text-secondary" aria-live="polite">
            {draft.length ? t("{count} selected", { count: draft.length }) : null}
          </span>
          <Button variant="ghost" size="small" onClick={() => setDraft([])} disabled={!draft.length}>
            {t("Clear")}
          </Button>
          <Button
            size="small"
            onClick={() => {
              onDone(draft);
              ref.current?.close();
            }}
          >
            {draft.length ? t("Done ({count})", { count: draft.length }) : t("Done")}
          </Button>
        </div>
      )}
    </dialog>
  );
}

type BaseProps = {
  label?: string;
  hideLabel?: boolean;
  title?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  id?: string;
  options?: ChapterChoice[];
  valueKey?: ValueKey;
  disabled?: boolean;
  className?: string;
};
type SingleProps = BaseProps & { multiple?: false; value: string | null; onChange: (value: string | null) => void; clearable?: boolean };
type MultiProps = BaseProps & { multiple: true; value: string[]; onChange: (value: string[]) => void; max?: number };

/** A chapter field: the chosen chapter(s) as chips and a "Choose" / "Change" button that opens the popup. */
export function ChapterPicker(props: SingleProps | MultiProps) {
  const t = useT();
  const autoId = useId();
  const { label, hideLabel, title, placeholder, hint, error, options, valueKey = "id", disabled, className } = props;
  const id = props.id ?? `${autoId}-button`;
  const multiple = props.multiple === true;
  const values = props.multiple ? props.value : props.value ? [props.value] : [];
  const max = props.multiple ? props.max : 1;
  const [open, setOpen] = useState(false);
  const { entries, error: loadError, retry } = useEntries(options);
  const inline = !!options && options.length <= CHAPTER_INLINE_MAX;
  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [keyOf(e, valueKey), e])), [entries, valueKey]);
  const removable = multiple || (!props.multiple && props.clearable);

  function set(keys: string[]) {
    if (props.multiple) props.onChange(keys);
    else props.onChange(keys[0] ?? null);
  }
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const labelId = `${id}-label`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <span id={labelId} className={hideLabel ? "sr-only" : "text-label text-ink"}>
          {label}
        </span>
      )}
      {inline ? (
        <div role={multiple ? "group" : "radiogroup"} aria-labelledby={label ? labelId : undefined} aria-describedby={describedBy} className="flex flex-wrap gap-1.5">
          {(entries ?? []).map((entry, i) => {
            const key = keyOf(entry, valueKey);
            const on = values.includes(key);
            return (
              <button
                key={entry.id}
                id={i === 0 ? id : undefined}
                type="button"
                role={multiple ? undefined : "radio"}
                aria-checked={multiple ? undefined : on}
                aria-pressed={multiple ? on : undefined}
                disabled={disabled || (multiple && !on && max !== undefined && values.length >= max)}
                onClick={() => (on ? removable && set(values.filter((k) => k !== key)) : set(multiple ? [...values, key] : [key]))}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 ps-0.5 pe-2.5 text-sm font-medium disabled:opacity-50",
                  on ? "border-primary bg-primary-tint text-primary" : "border-line bg-card text-body hover:bg-muted",
                )}
              >
                <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={20} className="rounded-full" />
                <span className="truncate" dir="auto">
                  {entry.label}
                </span>
                {on && <Icon name="check" size={12} />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {values.length > 0 ? (
            <ul aria-label={t("Chosen")} className="contents">
              {values.map((key) => {
                const entry = byKey.get(key);
                const name = entry?.label ?? "…";
                return (
                  <li key={key} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-tint py-0.5 ps-0.5 pe-1 text-xs font-medium text-primary">
                    {entry ? (
                      <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={20} className="rounded-full" />
                    ) : (
                      <span aria-hidden="true" className="size-5 shrink-0 rounded-full bg-primary-tint-2" />
                    )}
                    <span className="truncate" dir="auto">
                      {name}
                    </span>
                    {removable ? (
                      <button type="button" disabled={disabled} onClick={() => set(values.filter((k) => k !== key))} className="rounded-full p-0.5 hover:bg-primary-tint-2">
                        <Icon name="x" size={12} label={t("Remove {name}", { name })} />
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
              "inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-sm font-medium text-primary hover:bg-muted disabled:opacity-50",
              error ? "border-error" : "border-line",
            )}
          >
            <Icon name={values.length ? "edit" : "plus"} size={14} />
            {values.length ? t("Change") : multiple ? t("Choose chapters") : t("Choose a chapter")}
          </button>
        </div>
      )}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-secondary">
          {hint}
        </p>
      ) : null}
      {open && (
        <PickerDialog
          title={title ?? label ?? (multiple ? t("Choose chapters") : t("Choose a chapter"))}
          entries={entries}
          error={loadError}
          retry={retry}
          multiple={multiple}
          initial={values}
          max={max}
          valueKey={valueKey}
          onPick={(key) => set(key ? [key] : [])}
          onDone={set}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The filter form: "Chapter: Any ▾" (or the chosen chapter). The popup starts with "Any chapter";
 * picking closes it. Values are chapter ids by default.
 */
export function ChapterFilter({
  value,
  onChange,
  options,
  valueKey = "id",
  anyLabel,
  allowAny = true,
  emptyText,
  prefix = true,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options?: ChapterChoice[];
  valueKey?: ValueKey;
  /** The "any" row (default "Any chapter"). */
  anyLabel?: string;
  /** false: no "Any chapter" row, for a choice that needs a chapter (trending in one chapter). */
  allowAny?: boolean;
  /** Button text while nothing is chosen, instead of "Chapter: Any". */
  emptyText?: string;
  /** "Chapter: Nigeria" (default), or just "Nigeria" under a "Chapter" label. */
  prefix?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { entries, error, retry } = useEntries(options);
  const any: ChapterExtra = { value: null, label: anyLabel ?? t("Any chapter"), icon: "globe" };
  const entry = value ? (entries ?? []).find((e) => keyOf(e, valueKey) === value) : undefined;
  const name = value ? (entry?.label ?? "…") : prefix ? t("Any") : any.label;
  // A chosen chapter shows its picture and name; otherwise "Chapter: Any".
  const text = !value && emptyText ? emptyText : prefix && !value ? t("Chapter: {name}", { name }) : name;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-lg border bg-card py-1.5 ps-2.5 pe-2 text-sm text-body hover:border-line-strong",
          value ? "border-primary-light/60 text-ink" : "border-line",
          className,
        )}
      >
        {entry && <ChapterAvatar name={entry.name} countryCode={entry.countryCode} src={entry.imageUrl} size={16} className="rounded-full" />}
        <span className="min-w-0 flex-1 truncate text-start" dir="auto">
          {text}
        </span>
        {(!prefix || !!value) && <span className="sr-only">{t("Chapter")}</span>}
        <Icon name="chevron-down" size={14} className="shrink-0 text-secondary" />
      </button>
      {open && (
        <PickerDialog
          title={t("Filter by chapter")}
          entries={entries}
          error={error}
          retry={retry}
          multiple={false}
          initial={entry ? [value!] : []}
          extras={allowAny ? [any] : []}
          extraValue={value ? undefined : null}
          valueKey={valueKey}
          onPick={onChange}
          onDone={() => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
