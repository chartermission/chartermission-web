"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AnnouncementAudience } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { ChapterPicker } from "@/components/chapter-picker";
import { inputClasses } from "@/components/form-field";
import { Select } from "@/components/exams/select";
import { useIntlTag, useT } from "@/i18n/client";
import { countryNameOf } from "@/i18n/places";
import { LANGUAGE_NAMES, type AudienceOptions } from "@/lib/messages";

type Option = { value: string; label: string };

/**
 * Pick several from a long list: the chosen ones as removable chips, and a search box that opens the
 * list (Esc or a click outside closes it).
 */
function MultiPicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  max,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chosen = new Set(value);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase() === needle) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle(v: string) {
    if (chosen.has(v)) onChange(value.filter((x) => x !== v));
    else if (value.length < max) onChange([...value, v]);
  }

  const full = value.length >= max;
  return (
    <div
      ref={box}
      className="relative flex flex-col gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        // Esc closes the list first (and not the dialog or page around it).
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <label htmlFor={`${id}-q`} className="text-label text-ink">
        {label}
      </label>
      {value.length > 0 && (
        <ul aria-label={t("Chosen")} className="flex flex-wrap gap-1">
          {value.map((v) => {
            const name = options.find((o) => o.value === v)?.label ?? v;
            return (
              <li key={v}>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-tint py-0.5 ps-2.5 pe-1 text-xs font-medium text-primary">
                  {name}
                  <button type="button" onClick={() => toggle(v)} className="rounded-full p-0.5 hover:bg-primary-tint-2">
                    <Icon name="x" size={12} label={t("Remove {name}", { name })} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="relative flex items-center">
        <Icon name="search" size={14} className="pointer-events-none absolute start-2.5 text-secondary" />
        <input
          id={`${id}-q`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={inputClasses(false, "py-1.5 ps-8 pe-3")}
        />
      </div>
      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-multiselectable
          aria-label={label}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-[0_8px_28px_rgba(25,37,80,0.16)]"
        >
          {full && <p className="px-2 py-1 text-xs text-warning">{t("You can choose up to {max}.", { max })}</p>}
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-secondary">{t("Nothing matches “{q}”.", { q })}</p>
          ) : (
            shown.map((o) => {
              const on = chosen.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={!on && full}
                  // Keeps focus in the search box, so the list stays open in every browser.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.value)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-body hover:bg-muted disabled:opacity-50", on && "font-medium text-ink")}
                >
                  <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-inverse" : "border-line-strong")}>
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Who gets the bulk message. Every filter is optional; lists match any of their values and different
 * filters must all match. Empty: every active member.
 */
export function AudienceFilters({
  value,
  onChange,
  options,
  joinedError,
}: {
  value: AnnouncementAudience;
  onChange: (next: AnnouncementAudience) => void;
  options: AudienceOptions;
  joinedError?: string | null;
}) {
  const t = useT();
  const tag = useIntlTag();
  const id = useId();
  const set = <K extends keyof AnnouncementAudience>(key: K, v: AnnouncementAudience[K]) => onChange({ ...value, [key]: v });

  const countries = useMemo(
    () => options.countries.map((c) => ({ value: c.code, label: countryNameOf(c.code, tag) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label, tag)),
    [options.countries, tag],
  );
  const sectors = useMemo(() => options.sectors.map((s) => ({ value: s.id, label: s.name })), [options.sectors]);
  const exams = useMemo(() => (options.exams ?? []).map((e) => ({ value: e.id, label: e.title })), [options.exams]);
  const locales = value.locales ?? [];
  const empty =
    !value.countries?.length &&
    !value.chapterIds?.length &&
    !value.sectorIds?.length &&
    (!value.verified || value.verified === "any") &&
    !value.joinedFrom &&
    !value.joinedTo &&
    !value.passedExamIds?.length &&
    !value.locales?.length &&
    !value.ambassadorsOnly;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-h3 text-ink">
            Audience
          </h2>
          <p className="text-sm text-secondary">
            Members who match every filter you set. Leave them empty to write to every active member. Suspended members and official accounts never get it.
          </p>
        </div>
        {!empty && (
          <button type="button" onClick={() => onChange({})} className="text-sm font-medium text-primary hover:underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MultiPicker label={t("Countries")} placeholder={t("Search countries")} options={countries} value={value.countries ?? []} onChange={(v) => set("countries", v)} max={60} />
        <ChapterPicker
          multiple
          label={t("Chapters")}
          placeholder={t("Any chapter")}
          options={options.chapters.length ? options.chapters : undefined}
          value={value.chapterIds ?? []}
          onChange={(v) => set("chapterIds", v)}
          max={60}
        />
        <MultiPicker label={t("Sectors")} placeholder={t("Search sectors")} options={sectors} value={value.sectorIds ?? []} onChange={(v) => set("sectorIds", v)} max={40} />
        {options.exams && (
          <MultiPicker label={t("Passed exams")} placeholder={t("Search exams")} options={exams} value={value.passedExamIds ?? []} onChange={(v) => set("passedExamIds", v)} max={20} />
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-verified`} className="text-label text-ink">
            Verified
          </label>
          <Select id={`${id}-verified`} value={value.verified ?? "any"} onChange={(v) => set("verified", v as AnnouncementAudience["verified"])}>
            <option value="any">Any member</option>
            <option value="verified">Verified members only</option>
            <option value="unverified">Members without the verified tick</option>
          </Select>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label text-ink">Joined between</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label={t("Joined on or after")}
              value={value.joinedFrom ?? ""}
              max={value.joinedTo || undefined}
              onChange={(e) => set("joinedFrom", e.target.value || undefined)}
              className={inputClasses(false, "w-auto flex-1 py-1.5")}
            />
            <span className="text-sm text-secondary">and</span>
            <input
              type="date"
              aria-label={t("Joined on or before")}
              data-field="joinedTo"
              aria-invalid={joinedError ? true : undefined}
              value={value.joinedTo ?? ""}
              min={value.joinedFrom || undefined}
              onChange={(e) => set("joinedTo", e.target.value || undefined)}
              className={inputClasses(!!joinedError, "w-auto flex-1 py-1.5")}
            />
          </div>
          {joinedError && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-error">
              <Icon name="alert" size={14} />
              {joinedError}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label text-ink">Language</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(["en", "fr", "ar"] as const).map((l) => (
              <label key={l} className="flex items-center gap-2 text-sm text-body">
                <input
                  type="checkbox"
                  checked={locales.includes(l)}
                  onChange={(e) => set("locales", e.target.checked ? [...locales, l] : locales.filter((x) => x !== l))}
                  className="size-4 accent-primary"
                />
                <span lang={l} dir={l === "ar" ? "rtl" : "ltr"}>
                  {LANGUAGE_NAMES[l]}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-secondary">The language members use the site in. None ticked: any language.</p>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink">Ambassadors</span>
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={!!value.ambassadorsOnly} onChange={(e) => set("ambassadorsOnly", e.target.checked || undefined)} className="size-4 accent-primary" />
            Ambassadors only
          </label>
        </div>
      </div>
    </section>
  );
}
