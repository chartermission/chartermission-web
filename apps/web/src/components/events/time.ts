/*
 * Time-zone helpers for events. Every event is stored in UTC with an IANA zone; members see the
 * event's own local time and, when it differs, their own ("18:00 WAT · 21:00 your time").
 * Pure functions (no React), safe on the server and in the browser.
 */

const LOCALE = "en-GB";

/** Conventional abbreviations Intl doesn't produce in en-GB (it prints "GMT+1" for Lagos). */
const KNOWN_ABBREVIATIONS: Record<string, string> = {
  "West Africa Time": "WAT",
  "West Africa Standard Time": "WAT",
  "Central Africa Time": "CAT",
  "East Africa Time": "EAT",
  "South Africa Standard Time": "SAST",
  "South Africa Time": "SAST",
  "Coordinated Universal Time": "UTC",
  "India Standard Time": "IST",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** "WAT", "GMT", "GST", "EAT"… for the zone at that instant. */
export function zoneAbbreviation(timeZone: string, at: Date | string = new Date()): string {
  const date = typeof at === "string" ? new Date(at) : at;
  const short = part(formatter(timeZone, { timeZoneName: "short", hour: "numeric" }).formatToParts(date), "timeZoneName");
  if (short && !/^(GMT|UTC)[+-]/.test(short)) return short;
  const long = part(formatter(timeZone, { timeZoneName: "long", hour: "numeric" }).formatToParts(date), "timeZoneName");
  if (KNOWN_ABBREVIATIONS[long]) return KNOWN_ABBREVIATIONS[long];
  const words = long.split(/\s+/).filter(Boolean);
  const initials = (list: string[]) => list.map((w) => w[0]!.toUpperCase()).join("");
  const withoutStandard = initials(words.filter((w) => w !== "Standard"));
  const guess = withoutStandard.length >= 3 ? withoutStandard : initials(words);
  return guess.length >= 3 && guess.length <= 5 ? guess : short || "UTC";
}

/** Offset from UTC in minutes for the zone at that instant (Lagos → 60). */
export function zoneOffsetMinutes(timeZone: string, at: Date | number): number {
  const date = typeof at === "number" ? new Date(at) : at;
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const asUtc = Date.UTC(
    Number(part(parts, "year")),
    Number(part(parts, "month")) - 1,
    Number(part(parts, "day")),
    Number(part(parts, "hour")),
    Number(part(parts, "minute")),
    Number(part(parts, "second")),
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** "GMT+1", "GMT+5:30", "GMT" */
export function gmtLabel(timeZone: string, at: Date | number = Date.now()): string {
  const offset = zoneOffsetMinutes(timeZone, at);
  if (offset === 0) return "GMT";
  const sign = offset > 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const minutes = abs % 60;
  return `GMT${sign}${Math.floor(abs / 60)}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** True when both zones show the same wall-clock time at that instant. */
export function sameWallClock(a: string, b: string, at: Date | string): boolean {
  const date = typeof at === "string" ? new Date(at) : at;
  return a === b || zoneOffsetMinutes(a, date) === zoneOffsetMinutes(b, date);
}

/** "18:00" */
export function formatClock(iso: string, timeZone: string): string {
  return formatter(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "Sat 21 Nov" (adds the year when it isn't the current one). */
export function formatDay(iso: string, timeZone: string, { weekday = "short" }: { weekday?: "short" | "long" } = {}): string {
  const date = new Date(iso);
  const sameYear = formatter(timeZone, { year: "numeric" }).format(date) === formatter(timeZone, { year: "numeric" }).format(new Date());
  return formatter(timeZone, { weekday, day: "numeric", month: "short", year: sameYear ? undefined : "numeric" }).format(date).replace(",", "");
}

/** "Saturday 21 November 2026" */
export function formatLongDay(iso: string, timeZone: string): string {
  return formatter(timeZone, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)).replace(",", "");
}

/** "YYYY-MM-DD" of the instant in the zone. */
export function dayKey(iso: string | Date, timeZone: string): string {
  const parts = formatter(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** { month: "NOV", day: "21", weekday: "Saturday" } for date badges. */
export function badgeParts(iso: string, timeZone: string) {
  const date = new Date(iso);
  return {
    month: formatter(timeZone, { month: "short" }).format(date).slice(0, 3).toUpperCase(),
    day: formatter(timeZone, { day: "2-digit" }).format(date),
    weekday: formatter(timeZone, { weekday: "long" }).format(date),
  };
}

/** "November 2026" in the zone — list group headings. */
export function monthHeading(iso: string, timeZone: string): string {
  return formatter(timeZone, { month: "long", year: "numeric" }).format(new Date(iso));
}

/** "Lagos" from "Africa/Lagos", "Port of Spain" from "America/Port_of_Spain". */
export function zoneCity(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/** "18:00–20:00 WAT" (or "18:00 WAT – Sun 22 Nov 10:00 WAT" across days). */
export function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  const abbr = zoneAbbreviation(timeZone, startsAt);
  if (dayKey(startsAt, timeZone) === dayKey(endsAt, timeZone)) {
    return `${formatClock(startsAt, timeZone)}–${formatClock(endsAt, timeZone)} ${abbr}`;
  }
  return `${formatClock(startsAt, timeZone)} ${abbr} – ${formatDay(endsAt, timeZone)} ${formatClock(endsAt, timeZone)}`;
}

/* ---------- Wall-clock ⇄ UTC for the host form ---------- */

/** "2026-11-21T18:00" in the zone for an ISO instant (datetime-local value). */
export function toZonedInput(iso: string, timeZone: string): string {
  return `${dayKey(iso, timeZone)}T${formatClock(iso, timeZone)}`;
}

/**
 * The UTC ISO string for a wall-clock "YYYY-MM-DDTHH:mm" in the zone, or null if unparsable.
 * Two passes settle on the right offset around daylight-saving changes.
 */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall)) return null;
  let guess = wall - zoneOffsetMinutes(timeZone, wall) * 60_000;
  guess = wall - zoneOffsetMinutes(timeZone, guess) * 60_000;
  return new Date(guess).toISOString();
}

/** IANA zones for the picker, African zones first, each with its current GMT offset. */
export function timeZoneOptions(): { label: string; zones: { value: string; label: string }[] }[] {
  const all: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC", "Africa/Lagos"];
  const now = Date.now();
  const groups = new Map<string, { value: string; label: string; offset: number }[]>();
  for (const zone of all) {
    const region = zone.includes("/") ? zone.split("/")[0]! : "Other";
    const offset = zoneOffsetMinutes(zone, now);
    const list = groups.get(region) ?? [];
    list.push({ value: zone, label: `${zone.replace(/_/g, " ")} (${gmtLabel(zone, now)})`, offset });
    groups.set(region, list);
  }
  const order = ["Africa", "Europe", "Asia", "America", "Atlantic", "Indian", "Australia", "Pacific", "Antarctica", "Arctic", "Other"];
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map(([label, zones]) => ({ label: label === "America" ? "Americas" : label, zones: zones.map(({ value, label }) => ({ value, label })) }));
}
