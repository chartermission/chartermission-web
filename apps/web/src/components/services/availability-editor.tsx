"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import { AvailabilityInput, type AvailabilityView, type ServiceHostInput } from "@chartermission/contracts";
import { Button, Icon, Panel, cn } from "@chartermission/ui";
import { FieldError, inputClasses } from "@/components/auth/fields";
import { dayKey, timeZoneOptions } from "@/components/events/time";
import { useNow, useViewerZone } from "@/components/events/use-viewer-zone";
import { SaveBar } from "@/components/settings/save-bar";
import { ErrorNotice } from "@/components/social/errors";
import { api, isApiError } from "@/lib/api/client";
import { useIntlTag, useT } from "@/i18n/client";
import { addDays, availabilityQuery, durationLabel, formatDate } from "./format";

/** Monday first. weekday: 0 = Sunday … 6 = Saturday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
/** 2023-01-01 was a Sunday: adding the weekday number gives a date with that weekday. */
const SUNDAY = "2023-01-01";

type WindowDraft = { key: string; weekday: number; start: string; end: string };
type Draft = { timezone: string | null; windows: WindowDraft[]; daysOff: string[]; bufferMinutes: string; maxPerDay: string };

let seq = 0;
const nextKey = () => `w${++seq}`;
const byWeekThenStart = (a: { weekday: number; start: string }, b: { weekday: number; start: string }) =>
  WEEK.indexOf(a.weekday as (typeof WEEK)[number]) - WEEK.indexOf(b.weekday as (typeof WEEK)[number]) || a.start.localeCompare(b.start);

function draftOf(initial: AvailabilityView): Draft {
  const windows = initial.windows.length
    ? [...initial.windows].sort(byWeekThenStart).map((w) => ({ key: nextKey(), ...w }))
    : initial.configured
      ? []
      : [1, 2, 3, 4, 5].map((weekday) => ({ key: nextKey(), weekday, start: "09:00", end: "17:00" }));
  return {
    timezone: initial.configured ? initial.timezone : null,
    windows,
    daysOff: [...initial.daysOff].sort(),
    bufferMinutes: String(initial.bufferMinutes),
    maxPerDay: initial.maxPerDay == null ? "" : String(initial.maxPerDay),
  };
}

/** "17:00" + 60 minutes, capped at 23:59. */
function later(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Weekly hours for consultations (GET/PUT /availability): the host's time zone (the browser's until
 * saved), one or more windows per weekday, days off, the gap between consultations and a daily cap.
 */
export function AvailabilityEditor({ host, initial }: { host: ServiceHostInput; initial: AvailabilityView }) {
  const t = useT();
  const intl = useIntlTag();
  const router = useRouter();
  const uid = useId();
  const browserZone = useViewerZone();
  const now = useNow();
  const zones = useMemo(() => timeZoneOptions(), []);
  const [saved, setSaved] = useState<AvailabilityView>(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [dayOff, setDayOff] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const timezone = draft.timezone ?? browserZone ?? saved.timezone ?? "UTC";
  const knownZone = zones.some((g) => g.zones.some((z) => z.value === timezone));
  const today = dayKey(new Date(now), timezone);
  const weekdayName = (weekday: number, style: "long" | "short" = "long") => formatDate(addDays(SUNDAY, weekday), intl, { weekday: style });

  function body() {
    return {
      timezone,
      windows: draft.windows.map(({ weekday, start, end }) => ({ weekday, start, end })),
      daysOff: draft.daysOff,
      bufferMinutes: Number(draft.bufferMinutes),
      maxPerDay: draft.maxPerDay.trim() === "" ? null : /^\d+$/.test(draft.maxPerDay.trim()) ? Number(draft.maxPerDay) : NaN,
    };
  }
  const current = body();
  const dirty = !saved.configured || JSON.stringify({ ...current, windows: [...current.windows].sort(byWeekThenStart) }) !== JSON.stringify(baselineOf(saved, timezone));

  function update(next: (d: Draft) => Draft) {
    setDraft(next);
    setJustSaved(false);
  }

  function setDayWindows(weekday: number, fn: (list: WindowDraft[]) => WindowDraft[]) {
    update((d) => {
      const others = d.windows.filter((w) => w.weekday !== weekday);
      const mine = fn(d.windows.filter((w) => w.weekday === weekday));
      // Keep the rows in the order they were added while editing, so a row never jumps under the cursor.
      return { ...d, windows: [...others, ...mine] };
    });
  }

  function copyMonday() {
    const monday = draft.windows.filter((w) => w.weekday === 1);
    update((d) => ({
      ...d,
      windows: [
        ...d.windows.filter((w) => w.weekday === 1 || w.weekday === 0 || w.weekday === 6),
        ...[2, 3, 4, 5].flatMap((weekday) => monday.map((w) => ({ key: nextKey(), weekday, start: w.start, end: w.end }))),
      ].sort(byWeekThenStart),
    }));
  }

  function addDayOff() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOff)) {
      setErrors((e) => ({ ...e, newDayOff: t("Choose a date") }));
      return;
    }
    update((d) => ({ ...d, daysOff: d.daysOff.includes(dayOff) ? d.daysOff : [...d.daysOff, dayOff].sort() }));
    setErrors((current) => {
      const next = { ...current };
      delete next.newDayOff;
      return next;
    });
    setDayOff("");
  }

  function discard() {
    setDraft(draftOf(saved));
    setErrors({});
    setServerError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const payload = body();
    const next: Record<string, string> = {};
    if (Number.isNaN(payload.maxPerDay) || (payload.maxPerDay != null && (payload.maxPerDay < 1 || payload.maxPerDay > 24))) {
      next.maxPerDay = t("Enter a number from 1 to 24, or leave it empty");
    }
    const parsed = AvailabilityInput.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [field, index] = issue.path;
        const key = field === "windows" && typeof index === "number" ? `w-${draft.windows[index]?.key}` : String(field ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
    }
    if (Object.keys(next).length || !parsed.success) {
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) document.querySelector<HTMLElement>(`[data-error-key="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await api<AvailabilityView>("/availability", { method: "PUT", query: availabilityQuery(host), body: parsed.data });
      setSaved(result);
      setDraft(draftOf(result));
      setJustSaved(true);
      router.refresh();
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) {
        const mapped: Record<string, string> = {};
        for (const [field, message] of Object.entries(e.fields)) {
          const m = /^windows\.(\d+)/.exec(field);
          const key = m ? `w-${draft.windows[Number(m[1])]?.key}` : field.split(".")[0]!;
          if (!mapped[key]) mapped[key] = message;
        }
        setErrors(mapped);
      }
      setServerError(e);
    } finally {
      setSaving(false);
    }
  }

  const errorCount = Object.keys(errors).filter((k) => k !== "newDayOff").length;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {!saved.configured && (
        <p role="status" className="flex items-start gap-2.5 rounded-lg bg-info-light p-3 text-sm text-body">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-info" />
          {initial.windows.length === 0
            ? "Nothing can be booked until you save your hours. We filled in weekdays, 09:00 to 17:00, to start you off."
            : "Nothing can be booked until you save your hours."}
        </p>
      )}

      <Panel aria-labelledby={`${uid}-zone-heading`} className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${uid}-zone-heading`} className="text-h3 text-ink">
            Time zone
          </h2>
          <p className="text-sm text-secondary">Your hours below are in this zone. People who book see times in their own.</p>
        </div>
        <div className="relative">
          <label htmlFor={`${uid}-timezone`} className="sr-only">
            Time zone
          </label>
          <select
            id={`${uid}-timezone`}
            data-error-key="timezone"
            value={timezone}
            onChange={(e) => update((d) => ({ ...d, timezone: e.target.value }))}
            aria-invalid={!!errors.timezone || undefined}
            className={inputClasses(!!errors.timezone, "cursor-pointer appearance-none pe-9")}
          >
            {!knownZone && <option value={timezone}>{timezone.replace(/_/g, " ")}</option>}
            {zones.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.zones.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Icon name="chevron-down" size={16} className="pointer-events-none absolute inset-y-0 end-3 my-auto text-secondary" />
        </div>
        <FieldError id={`${uid}-timezone-error`} message={errors.timezone} />
        {browserZone && browserZone !== timezone && (
          <button type="button" onClick={() => update((d) => ({ ...d, timezone: browserZone }))} className="self-start rounded-sm text-sm font-medium text-primary-light hover:underline">
            {t("Use this device’s time zone ({zone})", { zone: browserZone.replace(/_/g, " ") })}
          </button>
        )}
      </Panel>

      <Panel aria-labelledby={`${uid}-hours-heading`} className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={`${uid}-hours-heading`} className="text-h3 text-ink">
              Weekly hours
            </h2>
            <p className="text-sm text-secondary">When consultations can start and end. Add more than one stretch for a break.</p>
          </div>
          <Button variant="secondary" size="small" onClick={copyMonday} disabled={!draft.windows.some((w) => w.weekday === 1)}>
            <Icon name="copy" size={16} />
            Copy Monday to weekdays
          </Button>
        </div>
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {WEEK.map((weekday) => {
            const name = weekdayName(weekday);
            const list = draft.windows.filter((w) => w.weekday === weekday);
            const on = list.length > 0;
            return (
              <li key={weekday} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                <label className="flex w-40 shrink-0 cursor-pointer items-center gap-2.5 sm:h-11">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setDayWindows(weekday, () => (e.target.checked ? [{ key: nextKey(), weekday, start: "09:00", end: "17:00" }] : []))}
                    className="size-4 cursor-pointer accent-primary"
                  />
                  <span className="text-sm font-medium text-ink">{name}</span>
                </label>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {!on && <p className="text-sm text-secondary sm:leading-[44px]">Unavailable</p>}
                  {list.map((w, i) => {
                    const error = errors[`w-${w.key}`];
                    return (
                      <div key={w.key} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.start}
                            step={300}
                            data-error-key={`w-${w.key}`}
                            onChange={(e) => setDayWindows(weekday, (ws) => ws.map((x) => (x.key === w.key ? { ...x, start: e.target.value } : x)))}
                            aria-label={t("{day}, from", { day: name })}
                            aria-invalid={!!error || undefined}
                            aria-describedby={error ? `${uid}-${w.key}-error` : undefined}
                            className={inputClasses(!!error, "w-32 tabular-nums")}
                          />
                          <span aria-hidden="true" className="text-secondary">
                            –
                          </span>
                          <input
                            type="time"
                            value={w.end}
                            step={300}
                            onChange={(e) => setDayWindows(weekday, (ws) => ws.map((x) => (x.key === w.key ? { ...x, end: e.target.value } : x)))}
                            aria-label={t("{day}, until", { day: name })}
                            aria-invalid={!!error || undefined}
                            aria-describedby={error ? `${uid}-${w.key}-error` : undefined}
                            className={inputClasses(!!error, "w-32 tabular-nums")}
                          />
                          <button
                            type="button"
                            onClick={() => setDayWindows(weekday, (ws) => ws.filter((x) => x.key !== w.key))}
                            aria-label={t("Remove {day} hours {number}", { day: name, number: i + 1 })}
                            className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
                          >
                            <Icon name="trash" size={18} />
                          </button>
                        </div>
                        <FieldError id={`${uid}-${w.key}-error`} message={error} />
                      </div>
                    );
                  })}
                  {on && (
                    <button
                      type="button"
                      onClick={() =>
                        setDayWindows(weekday, (ws) => {
                          const last = ws[ws.length - 1]!;
                          const start = later(last.end, 60);
                          return [...ws, { key: nextKey(), weekday, start, end: later(start, 120) }];
                        })
                      }
                      className="flex items-center gap-1.5 self-start rounded-sm text-sm font-medium text-primary-light hover:underline"
                    >
                      <Icon name="plus" size={16} />
                      Add hours
                      <span className="sr-only"> {name}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <FieldError id={`${uid}-windows-error`} message={errors.windows} />
        {draft.windows.length === 0 && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-warning">
            <Icon name="alert" size={16} />
            With no hours set, nobody can book you.
          </p>
        )}
      </Panel>

      <Panel aria-labelledby={`${uid}-off-heading`} className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${uid}-off-heading`} className="text-h3 text-ink">
            Days off
          </h2>
          <p className="text-sm text-secondary">Holidays, travel or anything else. No times are offered on these days.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-dayoff`} className="sr-only">
              Date
            </label>
            <input
              id={`${uid}-dayoff`}
              type="date"
              value={dayOff}
              min={today}
              onChange={(e) => setDayOff(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDayOff();
                }
              }}
              aria-invalid={!!errors.newDayOff || undefined}
              aria-describedby={errors.newDayOff ? `${uid}-dayoff-error` : undefined}
              className={inputClasses(!!errors.newDayOff, "w-48")}
            />
            <FieldError id={`${uid}-dayoff-error`} message={errors.newDayOff} />
          </div>
          <Button variant="secondary" onClick={addDayOff} className="h-11">
            <Icon name="plus" size={16} />
            Add day off
          </Button>
        </div>
        {draft.daysOff.length > 0 ? (
          <ul aria-label="Days off" className="flex flex-wrap gap-2" data-error-key="daysOff" tabIndex={-1}>
            {draft.daysOff.map((date) => (
              <li key={date} className={cn("flex items-center gap-1 rounded-full border border-line py-1 ps-3 pe-1 text-sm", date < today ? "text-disabled" : "text-ink")}>
                {formatDate(date, intl, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                <button
                  type="button"
                  onClick={() => update((d) => ({ ...d, daysOff: d.daysOff.filter((x) => x !== date) }))}
                  aria-label={t("Remove {date}", { date: formatDate(date, intl, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })}
                  className="rounded-full p-1 text-secondary hover:bg-muted hover:text-error"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">No days off.</p>
        )}
        <FieldError id={`${uid}-daysoff-error`} message={errors.daysOff} />
      </Panel>

      <Panel aria-labelledby={`${uid}-limits-heading`} className="flex flex-col gap-4 p-5">
        <h2 id={`${uid}-limits-heading`} className="text-h3 text-ink">
          Limits
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-buffer`} className="text-sm font-medium text-ink">
              Break between consultations
            </label>
            <div className="relative">
              <select
                id={`${uid}-buffer`}
                data-error-key="bufferMinutes"
                value={draft.bufferMinutes}
                onChange={(e) => update((d) => ({ ...d, bufferMinutes: e.target.value }))}
                className={inputClasses(!!errors.bufferMinutes, "cursor-pointer appearance-none pe-9")}
              >
                {!BUFFERS.includes(Number(draft.bufferMinutes) as never) && <option value={draft.bufferMinutes}>{durationLabel(t, Number(draft.bufferMinutes))}</option>}
                {BUFFERS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t("No break") : durationLabel(t, m)}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} className="pointer-events-none absolute inset-y-0 end-3 my-auto text-secondary" />
            </div>
            <FieldError id={`${uid}-buffer-error`} message={errors.bufferMinutes} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-max`} className="text-sm font-medium text-ink">
              Most consultations in a day
            </label>
            <input
              id={`${uid}-max`}
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              data-error-key="maxPerDay"
              value={draft.maxPerDay}
              onChange={(e) => update((d) => ({ ...d, maxPerDay: e.target.value }))}
              placeholder="No limit"
              aria-invalid={!!errors.maxPerDay || undefined}
              aria-describedby={`${uid}-max-hint${errors.maxPerDay ? ` ${uid}-max-error` : ""}`}
              className={inputClasses(!!errors.maxPerDay)}
            />
            <p id={`${uid}-max-hint`} className="text-xs text-secondary">
              Leave it empty for no limit.
            </p>
            <FieldError id={`${uid}-max-error`} message={errors.maxPerDay} />
          </div>
        </div>
      </Panel>

      {serverError && !errorCount ? <ErrorNotice error={serverError} /> : null}
      <SaveBar
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        error={errorCount ? t("Check the highlighted fields.") : null}
        onDiscard={discard}
        saveLabel={saved.configured ? t("Save changes") : t("Save availability")}
      />
    </form>
  );
}

/** What the saved availability looks like as a request body, to tell whether anything changed. */
function baselineOf(saved: AvailabilityView, timezone: string) {
  return {
    timezone: saved.configured ? saved.timezone : timezone,
    windows: [...saved.windows]
      .sort(byWeekThenStart)
      .map(({ weekday, start, end }) => ({ weekday, start, end })),
    daysOff: [...saved.daysOff].sort(),
    bufferMinutes: saved.bufferMinutes,
    maxPerDay: saved.maxPerDay,
  };
}
