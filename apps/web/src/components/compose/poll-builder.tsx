"use client";

import { useId, useRef } from "react";
import { Icon, cn } from "@chartermission/ui";
import { pollDurations } from "@/lib/mock/compose";

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 4;
export const MAX_POLL_OPTION_LENGTH = 80;

export type PollDraft = { options: string[]; duration: string };

export const emptyPoll = (): PollDraft => ({ options: ["", ""], duration: "3" });

const inputClasses =
  "h-[38px] w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint";

/** Poll options (2–4) and duration, shown when the Poll tool is active. */
export function PollBuilder({
  poll,
  onChange,
  onRemove,
  error,
}: {
  poll: PollDraft;
  onChange: (poll: PollDraft) => void;
  onRemove: () => void;
  error?: string | null;
}) {
  const id = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setOption(index: number, value: string) {
    const options = [...poll.options];
    options[index] = value;
    onChange({ ...poll, options });
  }

  function addOption(value: string) {
    if (poll.options.length >= MAX_POLL_OPTIONS) return;
    const index = poll.options.length;
    onChange({ ...poll, options: [...poll.options, value] });
    requestAnimationFrame(() => {
      const input = refs.current[index];
      input?.focus();
      input?.setSelectionRange(value.length, value.length);
    });
  }

  function removeOption(index: number) {
    onChange({ ...poll, options: poll.options.filter((_, i) => i !== index) });
    requestAnimationFrame(() => refs.current[Math.max(index - 1, 0)]?.focus());
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn("flex flex-col gap-2.5 rounded-card border bg-surface p-4", error ? "border-error" : "border-line")}
    >
      <div className="flex items-center justify-between">
        <h3 id={`${id}-title`} className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Icon name="chart" size={16} className="text-accent" />
          Poll
        </h3>
        <button type="button" onClick={onRemove} className="rounded-sm text-xs text-error hover:underline">
          Remove<span className="sr-only"> poll</span>
        </button>
      </div>

      {poll.options.map((option, index) => (
        <div key={index} className="relative">
          <label htmlFor={`${id}-option-${index}`} className="sr-only">
            Option {index + 1}
            {index < MIN_POLL_OPTIONS ? " (required)" : ""}
          </label>
          <input
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${id}-option-${index}`}
            value={option}
            maxLength={MAX_POLL_OPTION_LENGTH}
            onChange={(event) => setOption(index, event.target.value)}
            placeholder={`Option ${index + 1}`}
            aria-invalid={error && !option.trim() && index < MIN_POLL_OPTIONS ? true : undefined}
            className={cn(inputClasses, index >= MIN_POLL_OPTIONS && "pr-9")}
          />
          {index >= MIN_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => removeOption(index)}
              aria-label={`Remove option ${index + 1}`}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}

      {poll.options.length < MAX_POLL_OPTIONS && (
        <div>
          <label htmlFor={`${id}-add`} className="sr-only">
            Add option {poll.options.length + 1} (up to {MAX_POLL_OPTIONS})
          </label>
          <input
            id={`${id}-add`}
            value=""
            maxLength={MAX_POLL_OPTION_LENGTH}
            onChange={(event) => addOption(event.target.value)}
            placeholder={`Add option (up to ${MAX_POLL_OPTIONS})`}
            className={inputClasses}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-duration`} className="text-sm text-secondary">
          Closes in
        </label>
        <span className="relative inline-flex">
          <select
            id={`${id}-duration`}
            value={poll.duration}
            onChange={(event) => onChange({ ...poll, duration: event.target.value })}
            className="appearance-none rounded-lg border border-line bg-card py-1.5 pl-2.5 pr-7 text-sm text-body hover:border-line-strong"
          >
            {pollDurations.map((duration) => (
              <option key={duration.value} value={duration.value}>
                {duration.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary" />
        </span>
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
