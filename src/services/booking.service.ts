import { db } from '../db/client.js';
import type { NewBooking, Booking } from '../db/types.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { getAvailableSlots } from './slot-generator.js';
import { newId } from '../lib/id.js';

export interface CreateBookingInput {
  businessId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  startTime: string;
  customerNotes?: string;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const [service, business] = await Promise.all([
    db.selectFrom('services').selectAll().where('id', '=', input.serviceId).executeTakeFirst(),
    db.selectFrom('businesses').selectAll().where('id', '=', input.businessId).executeTakeFirst(),
  ]);
  if (!service)  throw new NotFoundError('Service not found');
  if (!business) throw new NotFoundError('Business not found');

  const start = new Date(input.startTime);
  const end = new Date(start.getTime() + service.duration_minutes * 60_000);
  const bufferStart = new Date(start.getTime() - service.buffer_before * 60_000);
  const bufferEnd   = new Date(end.getTime()   + service.buffer_after  * 60_000);

  const totalAmount = parseFloat(service.price);
  const platformFee = +(totalAmount * Number(business.commission_rate ?? 0.05)).toFixed(2);

  // Cheap pre-check — avoids holding a lock on obvious conflicts
  const slotDate = start.toISOString().slice(0, 10);
  const available = await getAvailableSlots({
    businessId: input.businessId,
    serviceId: input.serviceId,
    dateFrom: slotDate,
    dateTo: slotDate,
    staffId: input.staffId,
  });
  if (!available.some((s) => s.start === start.toISOString())) {
    throw new ConflictError('Slot no longer available');
  }

  // ── THE CRITICAL SECTION ──────────────────────────────────
  // MySQL has no EXCLUDE constraint, so we serialize per-staff
  // by locking the staff row for the duration of the check + insert.
  // Any two concurrent createBooking calls for the same staff will
  // queue here — the second sees the first's row and fails fast.
  return await db.transaction().execute(async (trx) => {
    // 1. Row-level lock — serializes all bookings for this staff member
    const locked = await trx
      .selectFrom('staff')
      .select('id')
      .where('id', '=', input.staffId)
      .forUpdate()
      .executeTakeFirst();
    if (!locked) throw new NotFoundError('Staff not found');

    // 2. Re-check overlap INSIDE the lock — this is now authoritative
    const conflict = await trx
      .selectFrom('bookings')
      .select('id')
      .where('staff_id', '=', input.staffId)
      .where('status', 'in', ['pending', 'confirmed'])
      .where('buffer_start', '<', bufferEnd)
      .where('buffer_end', '>', bufferStart)
      .executeTakeFirst();

    if (conflict) throw new ConflictError('Slot just got taken');

    // 3. Insert — trigger will also fire, but our lock already guarantees safety
    const row: NewBooking = {
      id: newId(),                                    // ← generate UUID in app
      business_id: input.businessId,
      staff_id: input.staffId,
      service_id: input.serviceId,
      customer_id: input.customerId,
      start_time: start,
      end_time: end,
      buffer_start: bufferStart,
      buffer_end: bufferEnd,
      status: 'pending',
      payment_status: 'unpaid',
      total_amount: totalAmount.toFixed(2),
      platform_fee: platformFee.toFixed(2),
      customer_notes: input.customerNotes ?? null,
    };

    return await trx.insertInto('bookings').values(row).returningAll().executeTakeFirstOrThrow();
  });
}

export async function cancelBooking(bookingId: string, reason?: string): Promise<Booking> {
  return await db.transaction().execute(async (trx) => {
    const booking = await trx
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', bookingId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (booking.status === 'cancelled') return booking;

    return await trx
      .updateTable('bookings')
      .set({ status: 'cancelled', cancellation_reason: reason ?? null })
      .where('id', '=', bookingId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function getBooking(id: string): Promise<Booking> {
  const b = await db.selectFrom('bookings').selectAll().where('id', '=', id).executeTakeFirst();
  if (!b) throw new NotFoundError('Booking not found');
  return b;
}