"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Button, Icon, cn } from "@chartermission/ui";
import { SearchField } from "@/components/discover/filter-controls";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

export type ChipOption = { id: string; label: string; badge?: ReactNode };

/** How many options show before "Show all": catalogues come most useful first. */
const VISIBLE_OPTIONS = 14;

/** Lower-case without accents, so "energie" finds "Énergie". */
export function foldText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** Options whose label (in English or the page language) contains `query`, ignoring case and accents. */
function matching(t: Translate, options: ChipOption[], query: string) {
  const q = foldText(query.trim());
  if (!q) return options;
  return options.filter((option) => foldText(option.label).includes(q) || foldText(t(option.label)).includes(q));
}

function ChipToggle({
  option,
  on,
  disabled,
  tone,
  onToggle,
}: {
  option: ChipOption;
  on: boolean;
  disabled: boolean;
  tone: "primary" | "hashtag";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? tone === "hashtag"
            ? "border-accent bg-accent-light text-accent-hover"
            : "border-primary bg-primary text-inverse"
          : "border-line bg-card text-body hover:border-line-strong hover:bg-muted",
      )}
    >
      {on ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} className="text-secondary" />}
      {option.label}
      {option.badge}
    </button>
  );
}

/**
 * Multi-select as a group of toggle buttons (aria-pressed). Stops adding at `max` and says so.
 * Long lists show the first `visible` options plus everything selected; "Show all" opens a
 * dialog with the whole list and a search box.
 */
export function ChipPicker({
  label,
  description,
  options,
  selected,
  onChange,
  max,
  tone = "primary",
  emptyText = "Nothing to choose from yet.",
  visible = VISIBLE_OPTIONS,
  id: anchorId,
}: {
  label: string;
  description?: string;
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  tone?: "primary" | "hashtag";
  emptyText?: string;
  /** Options shown before "Show all" (selected ones always show). */
  visible?: number;
  /** Anchor for links to this picker (e.g. /settings/profile#sectors). */
  id?: string;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  // Chips stay put once shown, so unselecting one doesn't pull it from under the pointer or focus.
  const [pinned, setPinned] = useState<string[]>(() => selected);
  const atMax = max !== undefined && selected.length >= max;
  const status = max !== undefined ? t("{count} selected · up to {max}", { count: selected.length, max }) : t("{count} selected", { count: selected.length });

  const shown = useMemo(
    () => options.filter((option, index) => index < visible || selected.includes(option.id) || pinned.includes(option.id)),
    [options, visible, selected, pinned],
  );
  const hidden = options.length - shown.length;

  function toggle(optionId: string) {
    if (selected.includes(optionId)) onChange(selected.filter((value) => value !== optionId));
    else if (!atMax) onChange([...selected, optionId]);
  }

  function closeAll() {
    setOpen(false);
    setPinned(selected);
  }

  return (
    <fieldset id={anchorId} className={cn("flex flex-col gap-2.5", anchorId && "scroll-mt-24")} aria-describedby={`${id}-count`}>
      <legend className="contents">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-md font-medium text-ink">{label}</span>
          <span id={`${id}-count`} aria-live="polite" className={cn("text-xs", atMax ? "text-warning" : "text-secondary")}>
            {status}
          </span>
        </span>
      </legend>
      {description && <p className="-mt-1.5 text-sm text-secondary">{description}</p>}
      {options.length === 0 ? (
        <p className="text-sm text-secondary">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-2">
          {shown.map((option) => {
            const on = selected.includes(option.id);
            return (
              <li key={option.id}>
                <ChipToggle option={option} on={on} disabled={!on && atMax} tone={tone} onToggle={() => toggle(option.id)} />
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-[5px] text-sm font-medium text-primary-light hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
              >
                {t("Show all {count}", { count: options.length })}
                <span className="sr-only"> {label}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          )}
        </ul>
      )}
      {open && <ChipPickerDialog label={label} options={options} selected={selected} atMax={atMax} status={status} tone={tone} onToggle={toggle} onClose={closeAll} />}
    </fieldset>
  );
}

/** The whole list with a search box: filters as you type, toggles in place, Done closes. */
function ChipPickerDialog({
  label,
  options,
  selected,
  atMax,
  status,
  tone,
  onToggle,
  onClose,
}: {
  label: string;
  options: ChipOption[];
  selected: string[];
  atMax: boolean;
  status: string;
  tone: "primary" | "hashtag";
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const found = matching(t, options, query);

  return (
    <Dialog
      title={label}
      description={
        <span aria-live="polite" className={atMax ? "text-warning" : undefined}>
          {status}
        </span>
      }
      onClose={onClose}
      width={560}
      initialFocus="input[type=search]"
      footer={
        <Button size="small" onClick={(event) => closeDialog(event.currentTarget)}>
          Done
        </Button>
      }
    >
      <SearchField
        label="Search this list"
        placeholder="Search"
        value={query}
        autoComplete="off"
        aria-controls={`${id}-options`}
        onChange={(event) => setQuery(event.target.value)}
        // The picker sits inside forms: Enter here must not submit them.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <p aria-live="polite" className="sr-only">
        {query.trim() ? t("{count} matches", { count: found.length }) : ""}
      </p>
      <div className="-mx-1 h-[min(360px,50dvh)] overflow-y-auto px-1 py-1">
        {found.length ? (
          <ul id={`${id}-options`} aria-label={label} className="flex flex-wrap gap-2">
            {found.map((option) => {
              const on = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <ChipToggle option={option} on={on} disabled={!on && atMax} tone={tone} onToggle={() => onToggle(option.id)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p id={`${id}-options`} className="text-sm text-secondary">
            No matches. Try another word.
          </p>
        )}
      </div>
    </Dialog>
  );
}
