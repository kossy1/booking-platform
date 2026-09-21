import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { overlap, zonedTimeToUtc, alignToGrid } from '../lib/time.js';

interface SlotQuery {
  businessId: string;
  serviceId: string;
  dateFrom: string;
  dateTo: string;
  staffId?: string;
  stepMinutes?: number;
}

export interface Slot {
  start: string;
  end: string;
  staffId: string;
  staffName: string;
  price: number;
}

export async function getAvailableSlots(q: SlotQuery): Promise<Slot[]> {
  const step = q.stepMinutes ?? 15;

  const [business, service, staffList] = await Promise.all([
    db.selectFrom('businesses')
      .selectAll()
      .where('id', '=', q.businessId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow(),
    db.selectFrom('services')
      .selectAll()
      .where('id', '=', q.serviceId)
      .where('is_active', '=', 1)                       // ← TINYINT
      .executeTakeFirstOrThrow(),
    db.selectFrom('staff')
      .selectAll()
      .where('business_id', '=', q.businessId)
      .where('is_active', '=', 1)                       // ← TINYINT
      .$if(!!q.staffId, (qb) => qb.where('id', '=', q.staffId!))
      .execute(),
  ]);

  if (!staffList.length) return [];

  const rangeStart = DateTime.fromISO(q.dateFrom, { zone: business.timezone }).startOf('day').toUTC().toJSDate();
  const rangeEnd   = DateTime.fromISO(q.dateTo,   { zone: business.timezone }).endOf('day').toUTC().toJSDate();

  const staffIds = staffList.map((s) => s.id);

  const [rules, bookings, timeOff] = await Promise.all([
    db.selectFrom('availability_rules').selectAll().where('staff_id', 'in', staffIds).execute(),
    db.selectFrom('bookings')
      .select(['staff_id', 'buffer_start', 'buffer_end'])
      .where('staff_id', 'in', staffIds)
      .where('status', 'in', ['pending', 'confirmed'])
      .where('buffer_start', '<', rangeEnd)
      .where('buffer_end', '>', rangeStart)
      .execute(),
    db.selectFrom('time_off')
      .selectAll()
      .where('staff_id', 'in', staffIds)
      .where('start_time', '<', rangeEnd)
      .where('end_time', '>', rangeStart)
      .execute(),
  ]);

  const totalBlock = service.duration_minutes + service.buffer_before + service.buffer_after;
  const now = DateTime.utc();

  const results: Slot[] = [];

  for (const staff of staffList) {
    const staffRules = rules.filter((r) => r.staff_id === staff.id);
    const busy: Array<[Date, Date]> = [
      ...bookings.filter((b) => b.staff_id === staff.id)
        .map((b) => [b.buffer_start, b.buffer_end] as [Date, Date]),
      ...timeOff.filter((t) => t.staff_id === staff.id)
        .map((t) => [t.start_time, t.end_time] as [Date, Date]),
    ];

    let day = DateTime.fromISO(q.dateFrom, { zone: business.timezone });
    const lastDay = DateTime.fromISO(q.dateTo, { zone: business.timezone });

    while (day <= lastDay) {
      const dow = day.weekday % 7;                       // Luxon: Mon=1..Sun=7 → Sun=0
      const dayRules = staffRules.filter((r) => r.day_of_week === dow);

      for (const rule of dayRules) {
        const winStart = zonedTimeToUtc(day.toJSDate(), rule.start_time, business.timezone);
        const winEnd   = zonedTimeToUtc(day.toJSDate(), rule.end_time, business.timezone);

        const earliest = DateTime.max(
          DateTime.fromJSDate(winStart),
          now.plus({ minutes: business.min_lead_minutes }),
        );
        const latest = DateTime.min(
          DateTime.fromJSDate(winEnd),
          now.plus({ days: business.max_advance_days }),
        );

        let cursor = alignToGrid(earliest, step);
        const latestStart = latest.minus({ minutes: totalBlock });

        while (cursor <= latestStart) {
          const slotStart = cursor.toUTC();
          const slotBlockEnd = cursor.plus({ minutes: totalBlock }).toUTC();
          const slotDisplayEnd = cursor.plus({ minutes: service.duration_minutes }).toUTC();

          const conflict = busy.some(([s, e]) =>
            overlap(slotStart.toJSDate(), slotBlockEnd.toJSDate(), s, e));

          if (!conflict) {
            results.push({
              start: slotStart.toISO()!,
              end: slotDisplayEnd.toISO()!,
              staffId: staff.id,
              staffName: staff.name,
              price: parseFloat(service.price),
            });
          }
          cursor = cursor.plus({ minutes: step });
        }
      }
      day = day.plus({ days: 1 });
    }
  }

  if (!q.staffId) {
    const map = new Map<string, Slot>();
    for (const s of results.sort((a, b) => a.start.localeCompare(b.start))) {
      if (!map.has(s.start)) map.set(s.start, s);
    }
    return [...map.values()];
  }
  return results.sort((a, b) => a.start.localeCompare(b.start));
}