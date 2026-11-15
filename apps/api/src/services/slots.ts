import { addDays, clockMinutes, DAY_MS, dayKey, weekdayOf, zonedTime } from './time.js';

/** A busy stretch of time (a confirmed booking). */
export interface Busy {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotRules {
  /** The host's zone: windows, days off and the daily limit are in it. */
  hostTimezone: string;
  windows: { weekday: number; start: string; end: string }[];
  daysOff: string[];
  bufferMinutes: number;
  maxPerDay: number | null;
  durationMinutes: number;
  noticeHours: number;
  windowDays: number;
}

export interface SlotsInput extends SlotRules {
  now: Date;
  /** Every confirmed booking of the host, across all their services. */
  hostBusy: Busy[];
  /** The viewer's own confirmed consultations (as booker or host). */
  viewerBusy: Busy[];
  /** Zone to group days in (the viewer's), and the range in it. */
  timezone: string;
  from: string;
  days: number;
}

export interface SlotsResult {
  days: { date: string; slots: { startsAt: string; endsAt: string }[] }[];
  nextAvailable: string | null;
}

/** Candidate slots never start closer together than this. */
export const SLOT_STEP_MAX = 30;

const overlaps = (s: number, e: number, b: Busy, padMs = 0) => s < b.endsAt.getTime() + padMs && e > b.startsAt.getTime() - padMs;

/**
 * Every open slot from `fromKey` to `toKey` (host-zone dates, inclusive), in time order. Slots start
 * at each window's start and every min(duration, 30) minutes after, and must end inside the window.
 * Excluded: days off, wall times that don't exist (clocks going forward), slots inside the notice
 * period or past the booking window, slots clashing with the host's bookings (widened by the buffer)
 * or the viewer's own, and days where the host already has maxPerDay bookings.
 */
export function openSlots(input: Omit<SlotsInput, 'timezone' | 'from' | 'days'>, fromKey: string, toKey: string): Busy[] {
  const { now, hostTimezone: tz, durationMinutes } = input;
  if (durationMinutes <= 0 || !input.windows.length) return [];
  const step = Math.min(durationMinutes, SLOT_STEP_MAX);
  const durationMs = durationMinutes * 60_000;
  const earliest = now.getTime() + input.noticeHours * 3_600_000;
  const latest = now.getTime() + input.windowDays * DAY_MS;
  const padMs = input.bufferMinutes * 60_000;
  const daysOff = new Set(input.daysOff);
  const perDay = new Map<string, number>();
  for (const b of input.hostBusy) {
    const k = dayKey(b.startsAt, tz);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const out: Busy[] = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    if (daysOff.has(key)) continue;
    if (input.maxPerDay !== null && (perDay.get(key) ?? 0) >= input.maxPerDay) continue;
    const weekday = weekdayOf(key);
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    const windows = input.windows.filter((w) => w.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
    for (const w of windows) {
      const end = clockMinutes(w.end);
      for (let t = clockMinutes(w.start); t + durationMinutes <= end; t += step) {
        const start = zonedTime(tz, y, m, d, Math.floor(t / 60), t % 60);
        if (!start) continue;
        const s = start.getTime();
        const e = s + durationMs;
        if (s < earliest || s > latest) continue;
        if (input.hostBusy.some((b) => overlaps(s, e, b, padMs))) continue;
        if (input.viewerBusy.some((b) => overlaps(s, e, b))) continue;
        out.push({ startsAt: start, endsAt: new Date(e) });
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Open slots grouped by calendar day in `timezone`, for `days` days from `from`; every day in the
 * range is listed, with or without slots. nextAvailable is the first later day with a slot (as far
 * as the booking window reaches). Pure: give it `now` and the bookings.
 */
export function computeSlots(input: SlotsInput): SlotsResult {
  const { now, timezone } = input;
  const days = Math.max(1, Math.min(input.days, 31));
  const toKey = addDays(input.from, days - 1);
  const todayHost = dayKey(now, input.hostTimezone);
  const lastBookable = dayKey(new Date(now.getTime() + input.windowDays * DAY_MS), input.hostTimezone);
  // Host dates covering the range in the viewer's zone (zones differ by up to ~26 h), and the
  // booking window for nextAvailable.
  const startKey = [addDays(input.from, -2), addDays(todayHost, -1)].sort()[1]!;
  const endKey = [addDays(toKey, 2), addDays(lastBookable, 1)].sort()[1]!;
  const slots = startKey <= endKey ? openSlots(input, startKey, endKey) : [];
  const byDay = new Map<string, { startsAt: string; endsAt: string }[]>();
  let nextAvailable: string | null = null;
  for (const slot of slots) {
    const k = dayKey(slot.startsAt, timezone);
    if (k > toKey) {
      if (nextAvailable === null || k < nextAvailable) nextAvailable = k;
      continue;
    }
    if (k < input.from) continue;
    const list = byDay.get(k) ?? [];
    list.push({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() });
    byDay.set(k, list);
  }
  const out: SlotsResult['days'] = [];
  for (let k = input.from; k <= toKey; k = addDays(k, 1)) out.push({ date: k, slots: byDay.get(k) ?? [] });
  return { days: out, nextAvailable };
}
