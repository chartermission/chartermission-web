/*
 * Time-zone helpers for consultations (no dependency: Intl only). Copied from events/event-util.ts
 * and extended with wall-clock → UTC conversion that copes with daylight-saving changes.
 */

export const DEFAULT_TIMEZONE = 'Africa/Lagos';
export const DAY_MS = 86_400_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, date: Date) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at `date`, in milliseconds (e.g. +3_600_000 for Africa/Lagos). */
export function tzOffsetMs(tz: string, date: Date): number {
  const p = parts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of the wall-clock time y-m-d hh:mm in `tz`, or null when that time does not exist
 * there (the hour skipped when clocks go forward). An ambiguous time (clocks going back) resolves to
 * the earlier of the two instants.
 */
export function zonedTime(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets in force around that day: before, at and after any change.
  const offsets = new Set([tzOffsetMs(tz, new Date(guess - DAY_MS)), tzOffsetMs(tz, new Date(guess)), tzOffsetMs(tz, new Date(guess + DAY_MS))]);
  let best: number | null = null;
  for (const offset of offsets) {
    const t = guess - offset;
    const p = parts(tz, new Date(t));
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
}

/** YYYY-MM-DD of `date` in `tz`. */
export function dayKey(date: Date, tz: string): string {
  const p = parts(tz, date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Calendar arithmetic on YYYY-MM-DD keys. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:30" → 570. */
export function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** "Thursday 3 December 2026, 18:00 (Africa/Lagos)" for emails. */
export function formatLocal(date: Date, tz: string): string {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${s} (${tz.replace(/_/g, ' ')})`;
}

/** "Thu 3 Dec, 18:00" for notification lines. */
export function formatShort(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** "45 minutes" / "1 hour" / "23 hours". */
export function formatLeadTime(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The main time zone of a country, for hosts who haven't saved availability yet (profiles and pages
 * keep a country, not a time zone). Countries spanning several zones get their most populous one.
 */
const COUNTRY_ZONES: Record<string, string> = {
  DZ: 'Africa/Algiers', AO: 'Africa/Luanda', BJ: 'Africa/Porto-Novo', BW: 'Africa/Gaborone', BF: 'Africa/Ouagadougou',
  BI: 'Africa/Bujumbura', CV: 'Atlantic/Cape_Verde', CM: 'Africa/Douala', CF: 'Africa/Bangui', TD: 'Africa/Ndjamena',
  KM: 'Indian/Comoro', CG: 'Africa/Brazzaville', CI: 'Africa/Abidjan', CD: 'Africa/Kinshasa', DJ: 'Africa/Djibouti',
  EG: 'Africa/Cairo', GQ: 'Africa/Malabo', ER: 'Africa/Asmara', SZ: 'Africa/Mbabane', ET: 'Africa/Addis_Ababa',
  GA: 'Africa/Libreville', GM: 'Africa/Banjul', GH: 'Africa/Accra', GN: 'Africa/Conakry', GW: 'Africa/Bissau',
  KE: 'Africa/Nairobi', LS: 'Africa/Maseru', LR: 'Africa/Monrovia', LY: 'Africa/Tripoli', MG: 'Indian/Antananarivo',
  MW: 'Africa/Blantyre', ML: 'Africa/Bamako', MR: 'Africa/Nouakchott', MU: 'Indian/Mauritius', MA: 'Africa/Casablanca',
  MZ: 'Africa/Maputo', NA: 'Africa/Windhoek', NE: 'Africa/Niamey', NG: 'Africa/Lagos', RW: 'Africa/Kigali',
  ST: 'Africa/Sao_Tome', SN: 'Africa/Dakar', SC: 'Indian/Mahe', SL: 'Africa/Freetown', SO: 'Africa/Mogadishu',
  ZA: 'Africa/Johannesburg', SS: 'Africa/Juba', SD: 'Africa/Khartoum', TZ: 'Africa/Dar_es_Salaam', TG: 'Africa/Lome',
  TN: 'Africa/Tunis', UG: 'Africa/Kampala', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare', EH: 'Africa/El_Aaiun',
  GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', CH: 'Europe/Zurich',
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', AT: 'Europe/Vienna',
  PL: 'Europe/Warsaw', GR: 'Europe/Athens', TR: 'Europe/Istanbul', RU: 'Europe/Moscow', UA: 'Europe/Kyiv',
  US: 'America/New_York', CA: 'America/Toronto', BR: 'America/Sao_Paulo', MX: 'America/Mexico_City', JM: 'America/Jamaica',
  TT: 'America/Port_of_Spain', BB: 'America/Barbados', HT: 'America/Port-au-Prince', CO: 'America/Bogota', AR: 'America/Argentina/Buenos_Aires',
  AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat',
  IL: 'Asia/Jerusalem', LB: 'Asia/Beirut', JO: 'Asia/Amman', IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka',
  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur',
  ID: 'Asia/Jakarta', PH: 'Asia/Manila', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
};

/** The zone for a country code, or Africa/Lagos. */
export function zoneForCountry(code: string | null | undefined): string {
  return (code && COUNTRY_ZONES[code.toUpperCase()]) || DEFAULT_TIMEZONE;
}
