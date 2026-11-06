/* Event times in an IANA zone (the event’s own, UTC, or the admin’s browser zone when undefined). */

/** "Wed 9 Dec 2026, 16:00 GMT" — a time in a given IANA zone with the zone's short name. */
export function formatInZone(iso: string, timeZone: string | undefined, opts: { weekday?: boolean; zoneName?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: opts.weekday === false ? undefined : "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: opts.zoneName === false ? undefined : "short",
  }).format(new Date(iso));
}

/** "16:00" in a zone (for agenda rows and same-day end times). */
export function formatClock(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}

/** Whether two instants fall on the same calendar day in a zone. */
export function sameDay(a: string, b: string, timeZone: string | undefined): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return f.format(new Date(a)) === f.format(new Date(b));
}
