"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";
import {
  celebrationCategories,
  celebrationMeta,
  requestCategories,
  isoDaysAhead,
  requestMeta,
  todayIso,
} from "@/components/social/post-types/meta";
import { MAX_SKILL_LENGTH, MAX_SKILLS, type CelebrationFields, type FieldErrors, type RequestFields } from "./composition";

export const inputClasses =
  "h-[38px] w-full rounded-lg border bg-card px-3 text-sm text-ink outline-none placeholder:text-disabled focus:ring-2 focus:ring-primary-tint";

const border = (invalid: boolean) => (invalid ? "border-error" : "border-line focus:border-primary-light");

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-error">
      {message}
    </p>
  );
}

/** Labelled single-line input with an optional counter and error. */
export function TextField({
  label,
  value,
  onChange,
  max,
  required,
  optional,
  placeholder,
  error,
  hint,
  icon,
  type = "text",
  min,
  inputMax,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  required?: boolean;
  optional?: boolean;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  icon?: IconName;
  type?: "text" | "date";
  min?: string;
  inputMax?: string;
  className?: string;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label text-body">
          {label}
          {required && <span className="sr-only"> (required)</span>}
          {optional && <span className="ms-1 font-normal text-secondary">(optional)</span>}
        </label>
        {max && value.length > max * 0.6 && (
          <span className={cn("text-[11px]", value.length >= max ? "text-error" : "text-secondary")} aria-hidden="true">
            {value.length}/{max}
          </span>
        )}
      </div>
      <div className="relative">
        {icon && <Icon name={icon} size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-secondary" />}
        <input
          id={id}
          type={type}
          value={value}
          maxLength={max}
          min={min}
          max={inputMax}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClasses, border(!!error), icon && "ps-9")}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-secondary">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Category tiles as a radio group: arrows move and select, Tab leaves the group. */
export function CategoryPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: readonly { value: T; label: string; icon: IconName }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusable = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | null = null;
    if (event.key in keys) next = (index + keys[event.key]! + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="text-label text-body">
        {label}
        <span className="sr-only"> (required)</span>
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className="grid grid-cols-3 gap-2"
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === focusable ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-sm transition-colors max-sm:flex-col max-sm:gap-1 max-sm:px-1.5 max-sm:text-center max-sm:text-xs",
                checked ? "border-primary bg-primary-tint-2 font-medium text-primary" : "border-line bg-card text-body hover:border-line-strong hover:bg-surface",
                error && !value && "border-error/60",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  checked ? "bg-primary text-inverse" : "bg-muted text-secondary",
                )}
              >
                <Icon name={option.icon} size={15} />
              </span>
              <span className="min-w-0 truncate max-sm:whitespace-normal">{option.label}</span>
            </button>
          );
        })}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

const celebrationOptions = celebrationCategories.map((value) => ({ value, ...celebrationMeta[value] }));
const requestOptions = requestCategories.map((value) => ({ value, ...requestMeta[value] }));

export function CelebrationForm({
  value,
  onChange,
  errors,
}: {
  value: CelebrationFields;
  onChange: (value: CelebrationFields) => void;
  errors: FieldErrors;
}) {
  const placeholder = value.category ? celebrationMeta[value.category].placeholder : "What happened? e.g. Closed our seed round";
  return (
    <div className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4">
      <CategoryPicker
        label="What are you celebrating?"
        options={celebrationOptions}
        value={value.category}
        onChange={(category) => onChange({ ...value, category })}
        error={errors["celebration.category"]}
      />
      <TextField
        label="Headline"
        required
        value={value.headline}
        max={120}
        onChange={(headline) => onChange({ ...value, headline })}
        placeholder={placeholder}
        error={errors["celebration.headline"]}
      />
      <TextField
        label="Organisation"
        optional
        icon="building"
        value={value.organisation}
        max={80}
        onChange={(organisation) => onChange({ ...value, organisation })}
        placeholder="e.g. GreenGrid Africa"
        error={errors["celebration.organisation"]}
      />
    </div>
  );
}

/** Skills as removable chips: Enter or comma adds, Backspace on an empty field removes the last. */
export function SkillsInput({ skills, onChange, error }: { skills: string[]; onChange: (skills: string[]) => void; error?: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const full = skills.length >= MAX_SKILLS;

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " ").slice(0, MAX_SKILL_LENGTH))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...skills];
    for (const part of parts) {
      if (next.length >= MAX_SKILLS) break;
      if (!next.some((skill) => skill.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setText("");
    setNotice(next.length >= MAX_SKILLS ? `Added. That’s the maximum of ${MAX_SKILLS} skills.` : `Added ${parts.join(", ")}.`);
  }

  function removeAt(index: number) {
    const removed = skills[index];
    onChange(skills.filter((_, i) => i !== index));
    setNotice(`Removed ${removed}.`);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label text-body">
          Skills <span className="ms-1 font-normal text-secondary">(optional, up to {MAX_SKILLS})</span>
        </label>
        <span className="text-[11px] text-secondary" aria-hidden="true">
          {skills.length}/{MAX_SKILLS}
        </span>
      </div>
      <div
        className={cn(
          "flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary-tint",
          error ? "border-error" : "border-line focus-within:border-primary-light",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <ul className="contents" aria-label="Skills added">
          {skills.map((skill, index) => (
            <li key={skill} className="flex items-center gap-1 rounded-full bg-primary-tint py-0.5 ps-2.5 pe-1 text-xs font-medium text-primary">
              {skill}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeAt(index);
                }}
                aria-label={`Remove ${skill}`}
                className="rounded-full p-0.5 text-primary-light hover:bg-primary hover:text-inverse"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          id={id}
          value={text}
          disabled={full}
          maxLength={MAX_SKILL_LENGTH * 2}
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(",")) commit(value);
            else setText(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(text);
            } else if (event.key === "Backspace" && !text && skills.length) {
              event.preventDefault();
              removeAt(skills.length - 1);
            }
          }}
          onBlur={() => commit(text)}
          placeholder={full ? "Maximum reached" : skills.length ? "Add another" : "e.g. IoT, Logistics — press Enter to add"}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-disabled disabled:cursor-not-allowed"
        />
      </div>
      <p id={`${id}-hint`} className="sr-only">
        Press Enter or type a comma to add a skill. Backspace removes the last one.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function RequestForm({ value, onChange, errors }: { value: RequestFields; onChange: (value: RequestFields) => void; errors: FieldErrors }) {
  const placeholder = value.category ? requestMeta[value.category].placeholder : "e.g. A technical co-founder for a cold-chain startup";
  const remoteId = useId();
  const today = todayIso();
  const maxDay = isoDaysAhead(365);
  return (
    <div className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4">
      <CategoryPicker
        label="What are you looking for?"
        options={requestOptions}
        value={value.category}
        onChange={(category) => onChange({ ...value, category })}
        error={errors["request.category"]}
      />
      <TextField
        label="Title"
        required
        value={value.title}
        max={120}
        onChange={(title) => onChange({ ...value, title })}
        placeholder={placeholder}
        error={errors["request.title"]}
      />
      <SkillsInput skills={value.skills} onChange={(skills) => onChange({ ...value, skills })} error={errors["request.skills"]} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-sm:grid-cols-1">
        <TextField
          label="Location"
          optional
          icon="map-pin"
          value={value.location}
          max={80}
          onChange={(location) => onChange({ ...value, location })}
          placeholder="e.g. Lagos, Nigeria"
          error={errors["request.location"]}
        />
        <label htmlFor={remoteId} className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-body hover:border-line-strong">
          <input
            id={remoteId}
            type="checkbox"
            checked={value.remote}
            onChange={(event) => onChange({ ...value, remote: event.target.checked })}
            className="size-4 accent-primary"
          />
          Remote is fine
        </label>
      </div>
      <TextField
        label="Respond by"
        optional
        type="date"
        icon="calendar"
        min={today}
        inputMax={maxDay}
        value={value.closesOn}
        onChange={(closesOn) => onChange({ ...value, closesOn })}
        hint="After this day the request shows as closed."
        error={errors["request.closesOn"]}
        className="sm:max-w-[260px]"
      />
    </div>
  );
}
