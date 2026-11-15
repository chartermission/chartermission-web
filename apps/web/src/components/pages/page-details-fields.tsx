"use client";

import { useState, type KeyboardEvent } from "react";
import { Button, Icon, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

export type SectorOption = { id: string; name: string };

function RemovableChip({ label, onRemove, removeLabel, translate = false }: { label: string; onRemove: () => void; removeLabel: string; translate?: boolean }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-tint-2 py-1 ps-3 pe-1 text-sm font-medium text-primary">
      <span className="truncate">{translate ? label : <NoTranslate>{label}</NoTranslate>}</span>
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-primary-tint">
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/** Up to `max` sectors from the catalogue: chosen ones as chips, the rest in a select. */
export function SectorPicker({
  id,
  options,
  value,
  onChange,
  max,
  invalid,
}: {
  id: string;
  options: SectorOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  max: number;
  invalid: boolean;
}) {
  const t = useT();
  const byId = new Map(options.map((o) => [o.id, o.name]));
  const full = value.length >= max;
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Chosen sectors")}>
          {value.map((sectorId) => {
            const name = byId.get(sectorId) ?? sectorId;
            return (
              <RemovableChip
                key={sectorId}
                label={t(name)}
                translate
                removeLabel={t("Remove {name}", { name: t(name) })}
                onRemove={() => onChange(value.filter((v) => v !== sectorId))}
              />
            );
          })}
        </ul>
      )}
      <select
        id={id}
        value=""
        disabled={full}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const next = event.target.value;
          if (next && !value.includes(next) && !full) onChange([...value, next]);
        }}
        className={inputClasses(invalid, "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <option value="">{full ? t("You’ve chosen {max} sectors", { max }) : value.length ? t("Add another sector") : t("Choose a sector")}</option>
        {options
          .filter((o) => !value.includes(o.id))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
    </div>
  );
}

/** Short phrases typed one at a time: Enter or a comma adds one, each shown as a removable chip. */
export function SpecialtiesInput({
  id,
  value,
  onChange,
  max,
  maxLength,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLength: number;
  invalid: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const full = value.length >= max;

  function add() {
    const phrase = draft.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (!phrase || full) return;
    if (!value.some((v) => v.toLowerCase() === phrase.toLowerCase())) onChange([...value, phrase]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Specialties")}>
          {value.map((phrase) => (
            <RemovableChip key={phrase} label={phrase} removeLabel={t("Remove {name}", { name: phrase })} onRemove={() => onChange(value.filter((v) => v !== phrase))} />
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          disabled={full}
          maxLength={maxLength}
          enterKeyHint="done"
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint`}
          placeholder={full ? undefined : "e.g. Cold-chain logistics"}
          className={cn(inputClasses(invalid), "min-w-0 flex-1 disabled:opacity-60")}
        />
        <Button variant="secondary" onClick={add} disabled={full || !draft.trim()}>
          Add
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-secondary">
        {full ? t("That’s the most you can add ({max}).", { max }) : t("Press Enter after each one. Up to {max}.", { max })}
      </p>
    </div>
  );
}
