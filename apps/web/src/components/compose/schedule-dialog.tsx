"use client";

import { useId, useRef, useState } from "react";
import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_MINUTES } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { ApiError } from "@/lib/api/client";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { todayIso } from "@/components/social/post-types/meta";
import { inputClasses } from "./type-fields";
import { T, useT, useIntlTag } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

const pad = (n: number) => String(n).padStart(2, "0");
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Asia/Dubai (GMT+4)" for the viewer's time zone. */
export function timeZoneLabel(intl: string, at = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const short = new Intl.DateTimeFormat(intl, { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value;
  return short && short !== zone ? `${zone.replace(/_/g, " ")} (${short})` : zone;
}

/** "Thu 5 Nov 2026, 09:00 GMT+4" */
export function scheduleLabel(intl: string, iso: string): string {
  return new Date(iso).toLocaleString(intl, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function combine(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const at = new Date(y!, m! - 1, d!, h!, min!, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

function check(t: Translate, value: Date | null, now: number): string | null {
  if (!value) return "Choose a date and time.";
  if (value.getTime() < now + SCHEDULE_MIN_MINUTES * 60_000) return t("Pick a time at least {count} minutes from now.", { count: SCHEDULE_MIN_MINUTES });
  if (value.getTime() > now + SCHEDULE_MAX_DAYS * 24 * 3600_000) return t("Posts can be scheduled up to {count} days ahead.", { count: SCHEDULE_MAX_DAYS });
  return null;
}

function defaultStart(initial: string | null): Date {
  return initial ? new Date(initial) : roundUp(new Date(Date.now() + 60 * 60_000));
}

function roundUp(date: Date, minutes = 15): Date {
  const out = new Date(date);
  out.setSeconds(0, 0);
  const extra = (minutes - (out.getMinutes() % minutes)) % minutes;
  out.setMinutes(out.getMinutes() + extra);
  return out;
}

function presets(now = new Date()) {
  const inHour = roundUp(new Date(now.getTime() + 60 * 60_000));
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    { label: "In 1 hour", at: inHour },
    { label: "Tomorrow, 09:00", at: tomorrow },
    { label: "Monday, 09:00", at: monday },
  ];
}

/**
 * Date and time picker for a scheduled post (local time, 5 minutes to 60 days ahead).
 * `onConfirm` saves; throw an ApiError with a `scheduledFor` field to show it here.
 */
export function ScheduleDialog({
  initial,
  onConfirm,
  onClose,
  confirmLabel = "Schedule",
}: {
  initial: string | null;
  onConfirm: (iso: string) => Promise<void>;
  onClose: () => void;
  confirmLabel?: string;
}) {
  const intl = useIntlTag();
  const t = useT();
  const id = useId();
  const footerRef = useRef<HTMLDivElement>(null);
  const [now] = useState(() => new Date());
  const [date, setDate] = useState(() => todayIso(defaultStart(initial)));
  const [time, setTime] = useState(() => localTime(defaultStart(initial)));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const maxDate = new Date(now.getTime() + SCHEDULE_MAX_DAYS * 24 * 3600_000);
  const at = combine(date, time);

  async function confirm() {
    const problem = check(t, at, Date.now());
    setFieldError(problem);
    setError(null);
    if (problem || !at) return;
    setBusy(true);
    try {
      await onConfirm(at.toISOString());
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.fields?.scheduledFor) setFieldError(e.fields.scheduledFor);
      else setError(e);
    }
  }

  return (
    <Dialog
      title="Schedule post"
      description={
        <span className="flex items-center gap-1.5">
          <Icon name="globe" size={14} />
          Times are in your time zone: {timeZoneLabel(intl, at ?? now)}
        </span>
      }
      onClose={onClose}
      width={440}
      initialFocus="input[type=date]"
      footer={
        <div ref={footerRef} className="flex w-full items-center justify-end gap-2.5">
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={() => footerRef.current?.closest("dialog")?.close()}>
            Cancel
          </button>
          <Button onClick={confirm} disabled={busy}>
            <Icon name="clock" size={16} />
            {busy ? "Scheduling…" : confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
        {presets(now)
          .filter((p) => p.at.getTime() <= maxDate.getTime())
          .map((preset) => {
            const selected = at?.getTime() === preset.at.getTime();
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setDate(todayIso(preset.at));
                  setTime(localTime(preset.at));
                  setFieldError(null);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selected ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong hover:bg-surface",
                )}
              >
                {preset.label}
              </button>
            );
          })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 max-sm:grid-cols-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-date`} className="text-label text-body">
            Date
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            min={todayIso(now)}
            max={todayIso(maxDate)}
            onChange={(event) => {
              setDate(event.target.value);
              setFieldError(null);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-error` : undefined}
            className={cn(inputClasses, fieldError ? "border-error" : "border-line focus:border-primary-light")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-time`} className="text-label text-body">
            Time
          </label>
          <input
            id={`${id}-time`}
            type="time"
            value={time}
            step={300}
            onChange={(event) => {
              setTime(event.target.value);
              setFieldError(null);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-error` : undefined}
            className={cn(inputClasses, fieldError ? "border-error" : "border-line focus:border-primary-light")}
          />
        </div>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {fieldError ? (
          <p id={`${id}-error`} role="alert" className="text-xs text-error">
            {fieldError}
          </p>
        ) : at ? (
          <p className="flex items-center gap-2 rounded-lg bg-primary-tint-2 px-3 py-2.5 text-sm text-ink">
            <Icon name="calendar" size={16} className="shrink-0 text-primary-light" />
            <span>
              Posts <span className="font-medium">{scheduleLabel(intl, at.toISOString())}</span>
            </span>
          </p>
        ) : null}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
      <p className="text-xs text-secondary">
        <T vars={{ SCHEDULEMINMINUTES: SCHEDULE_MIN_MINUTES, SCHEDULEMAXDAYS: SCHEDULE_MAX_DAYS }}>{"Between {SCHEDULEMINMINUTES} minutes and {SCHEDULEMAXDAYS} days from now. You can change or cancel it from Drafts until it goes out."}</T>
      </p>
    </Dialog>
  );
}
