// src/routes/bookings.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  createBooking,
  cancelBooking,
  getBooking,
} from '../services/booking.service.js';
import { requireAuth } from '../lib/middleware.js';

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

const CreateBookingSchema = z.object({
  businessId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  customerNotes: z.string().max(1000).optional(),
  // NOTE: no customerId — comes from req.user.sub
});

const BookingIdParam = z.object({ id: z.string().uuid() });

const CancelBody = z.object({
  reason: z.string().max(500).optional(),
});

const ListQuery = z.object({
  businessId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  status: z
    .enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show'])
    .optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

export async function bookingRoutes(app: FastifyInstance) {

  // ── LIST ─────────────────────────────────────────────────
  app.get('/bookings', { preHandler: requireAuth }, async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const me = req.user!;

    let query = db.selectFrom('bookings').selectAll();

    // ── Role-based scoping ───────────────────────────────
    if (me.role === 'customer') {
      // Customers see only their own bookings
      query = query.where('customer_id', '=', me.sub);

    } else if (me.role === 'business_owner') {
      if (q.businessId) {
        // Owner requested a specific business — verify ownership first
        const owns = await db
          .selectFrom('businesses')
          .select('id')
          .where('id', '=', q.businessId)
          .where('owner_id', '=', me.sub)
          .executeTakeFirst();

        if (!owns) {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'Not your business',
          });
        }
        query = query.where('business_id', '=', q.businessId);

      } else {
        // Aggregate across every business this owner owns
        const owned = await db
          .selectFrom('businesses')
          .select('id')
          .where('owner_id', '=', me.sub)
          .execute();

        if (!owned.length) {
          // Owner hasn't created any business yet — return empty, not an error
          return reply.send({
            bookings: [],
            pagination: { limit: q.limit, offset: q.offset, returned: 0 },
          });
        }

        query = query.where('business_id', 'in', owned.map(b => b.id));
      }

    } else if (me.role === 'staff') {
      // Staff see bookings assigned to them
      query = query.where('staff_id', '=', me.sub);

    } else if (me.role === 'admin') {
      if (q.businessId) query = query.where('business_id', '=', q.businessId);
    }

    // ── Additional filters ───────────────────────────────
    if (q.staffId) query = query.where('staff_id', '=', q.staffId);
    if (q.status)  query = query.where('status', '=', q.status);
    if (q.from)    query = query.where('start_time', '>=', new Date(q.from));
    if (q.to)      query = query.where('start_time', '<=', new Date(q.to));

    const bookings = await query
      .orderBy('start_time', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();

    return reply.send({
      bookings,
      pagination: {
        limit: q.limit,
        offset: q.offset,
        returned: bookings.length,
      },
    });
  });

  // ── CREATE ───────────────────────────────────────────────
  app.post('/bookings', { preHandler: requireAuth }, async (req, reply) => {
    const input = CreateBookingSchema.parse(req.body);

    const booking = await createBooking({
      ...input,
      customerId: req.user!.sub,   // authoritative — prevents impersonation
    });

    return reply.code(201).send(booking);
  });

  // ── GET ONE ──────────────────────────────────────────────
  app.get('/bookings/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = BookingIdParam.parse(req.params);
    const booking = await getBooking(id);
    const me = req.user!;

    if (me.role === 'customer' && booking.customer_id !== me.sub) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your booking' });
    }

    if (me.role === 'business_owner') {
      const owns = await db
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', booking.business_id)
        .where('owner_id', '=', me.sub)
        .executeTakeFirst();

      if (!owns) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }
    }

    return reply.send(booking);
  });

  // ── CANCEL ───────────────────────────────────────────────
  app.post('/bookings/:id/cancel', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = BookingIdParam.parse(req.params);
    const { reason } = CancelBody.parse(req.body ?? {});
    const booking = await getBooking(id);
    const me = req.user!;

    if (me.role === 'customer' && booking.customer_id !== me.sub) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your booking' });
    }

    return reply.send(await cancelBooking(id, reason));
  });
}