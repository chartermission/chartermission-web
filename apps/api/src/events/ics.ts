/**
 * iCalendar (RFC 5545) for one event: a single VEVENT with UTC times. The online join link is
 * never included (it is only shown on the event page to registered members, CM-EVT-06/08).
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  url: string;
  cancelled: boolean;
  /** Bumped on every change so calendar apps update the copy they imported. */
  sequence: number;
  updatedAt: Date;
}

/** 20261203T170000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** TEXT escaping (RFC 5545 3.3.11): backslash, semicolon, comma, newlines. */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold to 75 octets per line (RFC 5545 3.1), never splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

export function renderIcs(e: IcsEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Charter Mission//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${e.timezone}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `LAST-MODIFIED:${icsDate(e.updatedAt)}`,
    `SEQUENCE:${e.sequence}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `DESCRIPTION:${icsEscape(e.description)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    `URL:${e.url}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
