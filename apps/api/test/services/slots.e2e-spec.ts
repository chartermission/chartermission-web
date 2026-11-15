import { computeSlots, type SlotsInput } from '../../src/services/slots.js';
import { zonedTime } from '../../src/services/time.js';

const d = (iso: string) => new Date(iso);
const times = (r: ReturnType<typeof computeSlots>, date: string) => r.days.find((x) => x.date === date)?.slots.map((s) => s.startsAt.slice(11, 16)) ?? [];

/** Lagos host (UTC+1, no DST), Mondays 09:00–11:00, 30-minute consultations, no notice. */
const base = (extra: Partial<SlotsInput> = {}): SlotsInput => ({
  now: d('2027-01-03T00:00:00Z'), // a Sunday
  hostTimezone: 'Africa/Lagos',
  windows: [{ weekday: 1, start: '09:00', end: '11:00' }],
  daysOff: [],
  bufferMinutes: 0,
  maxPerDay: null,
  durationMinutes: 30,
  noticeHours: 0,
  windowDays: 30,
  hostBusy: [],
  viewerBusy: [],
  timezone: 'Africa/Lagos',
  from: '2027-01-04',
  days: 1,
  ...extra,
});

describe('Services: slot computation (pure)', () => {
  it('steps by the length up to 30 minutes and keeps every slot inside the window', () => {
    expect(times(computeSlots(base()), '2027-01-04')).toEqual(['08:00', '08:30', '09:00', '09:30']);
    expect(times(computeSlots(base({ durationMinutes: 60 })), '2027-01-04')).toEqual(['08:00', '08:30', '09:00']);
    expect(times(computeSlots(base({ durationMinutes: 45 })), '2027-01-04')).toEqual(['08:00', '08:30', '09:00']);
    expect(times(computeSlots(base({ durationMinutes: 15 })), '2027-01-04')).toHaveLength(8);
    expect(times(computeSlots(base({ durationMinutes: 120 })), '2027-01-04')).toEqual(['08:00']);
    const r = computeSlots(base({ durationMinutes: 60 }));
    expect(r.days[0]!.slots[0]).toEqual({ startsAt: '2027-01-04T08:00:00.000Z', endsAt: '2027-01-04T09:00:00.000Z' });
  });

  it('lists every day of the range and groups by day in the viewer’s zone', () => {
    // Mondays 20:00–23:00 in Lagos are Tuesday morning in Tokyo.
    const late = { windows: [{ weekday: 1, start: '20:00', end: '23:00' }] };
    const lagos = computeSlots(base({ ...late, days: 2 }));
    expect(lagos.days.map((x) => x.date)).toEqual(['2027-01-04', '2027-01-05']);
    expect(times(lagos, '2027-01-04')).toHaveLength(6);
    expect(times(lagos, '2027-01-05')).toEqual([]);

    const tokyoMonday = computeSlots(base({ ...late, timezone: 'Asia/Tokyo' }));
    expect(times(tokyoMonday, '2027-01-04')).toEqual([]);
    expect(tokyoMonday.nextAvailable).toBe('2027-01-05');
    const tokyoTuesday = computeSlots(base({ ...late, timezone: 'Asia/Tokyo', from: '2027-01-05' }));
    expect(times(tokyoTuesday, '2027-01-05')).toEqual(['19:00', '19:30', '20:00', '20:30', '21:00', '21:30']);
  });

  it('keeps wall-clock hours across a DST change (Europe/London, March 2027)', () => {
    const london = base({
      now: d('2027-03-20T00:00:00Z'),
      hostTimezone: 'Europe/London',
      timezone: 'Europe/London',
      windows: [
        { weekday: 6, start: '09:00', end: '10:00' },
        { weekday: 1, start: '09:00', end: '10:00' },
      ],
      durationMinutes: 60,
      from: '2027-03-27',
      days: 3,
    });
    const r = computeSlots(london);
    expect(r.days.find((x) => x.date === '2027-03-27')!.slots).toEqual([{ startsAt: '2027-03-27T09:00:00.000Z', endsAt: '2027-03-27T10:00:00.000Z' }]);
    expect(r.days.find((x) => x.date === '2027-03-28')!.slots).toEqual([]);
    expect(r.days.find((x) => x.date === '2027-03-29')!.slots).toEqual([{ startsAt: '2027-03-29T08:00:00.000Z', endsAt: '2027-03-29T09:00:00.000Z' }]);
  });

  it('skips wall times that don’t exist and takes the first of repeated ones (America/New_York)', () => {
    const ny = (date: string, weekday: number) =>
      base({
        now: d('2027-03-01T00:00:00Z'),
        hostTimezone: 'America/New_York',
        timezone: 'UTC',
        windows: [{ weekday, start: '01:00', end: weekday === 0 && date.startsWith('2027-03') ? '04:00' : '02:00' }],
        from: date,
        windowDays: 90,
      });
    // 14 March 2027: 02:00–02:59 doesn't exist.
    expect(times(computeSlots(ny('2027-03-14', 0)), '2027-03-14')).toEqual(['06:00', '06:30', '07:00', '07:30']);
    expect(zonedTime('America/New_York', 2027, 3, 14, 2, 30)).toBeNull();
    // 7 November 2027: 01:00–01:59 happens twice; slots use the first (EDT, UTC−4).
    const fall = computeSlots({ ...ny('2027-11-07', 0), now: d('2027-10-20T00:00:00Z') });
    expect(times(fall, '2027-11-07')).toEqual(['05:00', '05:30']);
  });

  it('needs the notice and stops at the booking window', () => {
    const notice = computeSlots(base({ now: d('2027-01-04T07:00:00Z'), noticeHours: 2 }));
    expect(times(notice, '2027-01-04')).toEqual(['09:00', '09:30']);
    const past = computeSlots(base({ now: d('2027-01-04T12:00:00Z') }));
    expect(times(past, '2027-01-04')).toEqual([]);

    const week = computeSlots(base({ windowDays: 7, days: 14 }));
    expect(week.days).toHaveLength(14);
    expect(times(week, '2027-01-04')).toHaveLength(4);
    expect(times(week, '2027-01-11')).toEqual([]);
    expect(week.nextAvailable).toBeNull();

    const later = computeSlots(base({ from: '2027-01-05', days: 3 }));
    expect(later.days.every((x) => x.slots.length === 0)).toBe(true);
    expect(later.nextAvailable).toBe('2027-01-11');
  });

  it('keeps the buffer around the host’s bookings and avoids the viewer’s own', () => {
    const busy = [{ startsAt: d('2027-01-04T08:30:00Z'), endsAt: d('2027-01-04T09:00:00Z') }];
    expect(times(computeSlots(base({ hostBusy: busy })), '2027-01-04')).toEqual(['08:00', '09:00', '09:30']);
    expect(times(computeSlots(base({ hostBusy: busy, bufferMinutes: 15 })), '2027-01-04')).toEqual(['09:30']);
    const mine = [{ startsAt: d('2027-01-04T08:15:00Z'), endsAt: d('2027-01-04T08:45:00Z') }];
    expect(times(computeSlots(base({ viewerBusy: mine, bufferMinutes: 15 })), '2027-01-04')).toEqual(['09:00', '09:30']);
  });

  it('closes days that reached the daily limit, and days off', () => {
    const busy = [{ startsAt: d('2027-01-04T15:00:00Z'), endsAt: d('2027-01-04T15:30:00Z') }];
    const limited = computeSlots(base({ hostBusy: busy, maxPerDay: 1, days: 8 }));
    expect(times(limited, '2027-01-04')).toEqual([]);
    expect(times(limited, '2027-01-11')).toHaveLength(4);
    expect(times(computeSlots(base({ hostBusy: busy, maxPerDay: 2 })), '2027-01-04')).toHaveLength(4);

    const off = computeSlots(base({ daysOff: ['2027-01-04'], days: 8 }));
    expect(times(off, '2027-01-04')).toEqual([]);
    expect(times(off, '2027-01-11')).toHaveLength(4);
  });
});
