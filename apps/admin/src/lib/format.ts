/** Absolute console dates, e.g. "3 Nov 2026, 14:05". `timeZone` undefined = the browser's zone. */
export function formatDateTime(iso: string, timeZone?: string, tag = "en-GB"): string {
  return new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

/** "3 Nov 2026" */
export function formatDate(iso: string, timeZone?: string, tag = "en-GB"): string {
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

/** Compact age for queues: "now", "12m", "3h", "2d", "5w". */
export function relativeAge(iso: string, now: number, tag = "en-GB"): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  const unit = (value: number, name: "minute" | "hour" | "day" | "week") =>
    new Intl.NumberFormat(tag, { style: "unit", unit: name, unitDisplay: "narrow" }).format(value).replace(/\s+/g, tag.startsWith("en") ? "" : "\u00a0");
  if (minutes < 1) return tag.startsWith("en") ? "now" : new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(0, "second");
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 14) return unit(days, "day");
  return unit(Math.floor(days / 7), "week");
}

/** "2 min ago", "3 h ago", "in 4 days" — for status lines. */
export function relativePhrase(iso: string, now: number, tag = "en-GB"): string {
  const diff = new Date(iso).getTime() - now;
  if (!tag.startsWith("en")) {
    const minutes = Math.round(diff / 60_000);
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    if (Math.abs(minutes) < 60 * 48) return rtf.format(Math.round(minutes / 60), "hour");
    return rtf.format(Math.round(minutes / 1440), "day");
  }
  const future = diff > 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  let text: string;
  if (minutes < 1) return "just now";
  if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 60 * 48) text = `${Math.round(minutes / 60)} h`;
  else text = `${Math.round(minutes / 1440)} days`;
  return future ? `in ${text}` : `${text} ago`;
}

/** Median resolve time: "45m", "3h 12m", "2d 4h". */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 48) return `${hours}h${total % 60 ? ` ${total % 60}m` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

export const formatCount = (value: number) => value.toLocaleString("en-GB");

/** Hours → "24 hours", "7 days". */
export function formatHours(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** First 8 characters of a UUID, for compact references. */
export const shortId = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? id.slice(0, 8) : id);
