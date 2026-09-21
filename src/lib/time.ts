import { DateTime } from 'luxon';

export function zonedTimeToUtc(date: Date, time: string, zone: string): Date {
  // time is 'HH:MM:SS' from MySQL TIME column
  const hhmm = time.slice(0, 5);
  return DateTime
    .fromISO(`${DateTime.fromJSDate(date).toISODate()}T${hhmm}`, { zone })
    .toUTC()
    .toJSDate();
}

export function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function alignToGrid(dt: DateTime, stepMinutes: number): DateTime {
  const aligned = Math.ceil(dt.minute / stepMinutes) * stepMinutes;
  return dt.startOf('hour').plus({ minutes: aligned });
}

// mysql2 returns DATETIME as JS Date in local tz unless `timezone: 'Z'` is set.
// Force UTC comparison helpers:
export const asUtc = (d: Date) => new Date(d.getTime());