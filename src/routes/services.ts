// src/routes/services.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireAuth } from '../lib/middleware.js';
import { newId } from '../lib/id.js';

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────
const ServiceBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  duration_minutes: z.coerce.number().int().min(5).max(600),
  buffer_before: z.coerce.number().int().min(0).max(120).default(0),
  buffer_after:  z.coerce.number().int().min(0).max(120).default(0),
  price: z.coerce.number().min(0).max(1_000_000),
  deposit_required: z.coerce.boolean().default(false),
  deposit_amount: z.coerce.number().min(0).optional(),
  is_active: z.coerce.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
  staff_ids: z.array(z.string().uuid()).default([]),
});

const IdParam = z.object({ id: z.string().uuid() });

const ServiceParam = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
});

const StaffParam = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
});

const StaffBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(25).optional(),
  bio: z.string().max(1000).optional(),
  is_active: z.coerce.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
});

const AvailabilityBody = z.object({
  rules: z.array(z.object({
    day_of_week: z.coerce.number().int().min(0).max(6),
    start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    end_time:   z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  })),
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function assertOwnsBusiness(userId: string, businessId: string): Promise<boolean> {
  const b = await db
    .selectFrom('businesses')
    .select('id')
    .where('id', '=', businessId)
    .where('owner_id', '=', userId)
    .executeTakeFirst();
  return !!b;
}

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
export async function serviceRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════
  // SERVICES
  // ═══════════════════════════════════════════════════════════

  // ── LIST ────────────────────────────────────────────────
  app.get(
    '/me/businesses/:id/services',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = IdParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const services = await db
        .selectFrom('services')
        .selectAll()
        .where('business_id', '=', id)
        .orderBy('display_order')
        .execute();

      // Attach linked staff
      const links = await db
        .selectFrom('staff_services')
        .innerJoin('staff', 'staff.id', 'staff_services.staff_id')
        .select(['staff_services.service_id', 'staff.id as staff_id', 'staff.name'])
        .where('staff.business_id', '=', id)
        .execute();

      const byService: Record<string, Array<{ id: string; name: string }>> = {};
      for (const l of links) {
        (byService[l.service_id] ||= []).push({ id: l.staff_id, name: l.name });
      }

      return reply.send({
        services: services.map(s => ({
          ...s,
          staff: byService[s.id] ?? [],
        })),
      });
    },
  );

  // ── CREATE ──────────────────────────────────────────────
  app.post(
    '/me/businesses/:id/services',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = IdParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const input = ServiceBody.parse(req.body);
      const serviceId = newId();

      await db.insertInto('services').values({
        id: serviceId,
        business_id: id,
        name: input.name,
        description: input.description ?? null,
        duration_minutes: input.duration_minutes,
        buffer_before: input.buffer_before,
        buffer_after: input.buffer_after,
        price: input.price.toFixed(2),
        deposit_required: input.deposit_required ? 1 : 0,
        deposit_amount: input.deposit_amount != null ? input.deposit_amount.toFixed(2) : null,
        is_active: input.is_active ? 1 : 0,
        display_order: input.display_order,
      }).execute();

      if (input.staff_ids.length) {
        await db.insertInto('staff_services')
          .values(input.staff_ids.map(staffId => ({
            staff_id: staffId,
            service_id: serviceId,
          })))
          .execute();
      }

      const service = await db.selectFrom('services').selectAll()
        .where('id', '=', serviceId).executeTakeFirstOrThrow();

      return reply.code(201).send(service);
    },
  );

  // ── UPDATE ──────────────────────────────────────────────
  app.patch(
    '/me/businesses/:id/services/:serviceId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, serviceId } = ServiceParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const input = ServiceBody.partial().parse(req.body);

      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        if (k === 'price' || k === 'deposit_amount') {
          updates[k] = v == null ? null : Number(v).toFixed(2);
        } else if (k === 'deposit_required' || k === 'is_active') {
          updates[k] = v ? 1 : 0;
        } else if (k !== 'staff_ids') {
          updates[k] = v;
        }
      }

      if (Object.keys(updates).length) {
        await db.updateTable('services').set(updates as any)
          .where('id', '=', serviceId)
          .where('business_id', '=', id)
          .execute();
      }

      if (input.staff_ids) {
        await db.deleteFrom('staff_services').where('service_id', '=', serviceId).execute();
        if (input.staff_ids.length) {
          await db.insertInto('staff_services')
            .values(input.staff_ids.map(staffId => ({
              staff_id: staffId,
              service_id: serviceId,
            })))
            .execute();
        }
      }

      const service = await db.selectFrom('services').selectAll()
        .where('id', '=', serviceId).executeTakeFirstOrThrow();
      return reply.send(service);
    },
  );

  // ── DELETE (soft) ───────────────────────────────────────
  app.delete(
    '/me/businesses/:id/services/:serviceId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, serviceId } = ServiceParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      await db.updateTable('services')
        .set({ is_active: 0 })
        .where('id', '=', serviceId)
        .where('business_id', '=', id)
        .execute();

      return reply.code(204).send();
    },
  );

  // ═══════════════════════════════════════════════════════════
  // STAFF
  // ═══════════════════════════════════════════════════════════

  // ── LIST ────────────────────────────────────────────────
  app.get(
    '/me/businesses/:id/staff',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = IdParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const staff = await db
        .selectFrom('staff')
        .selectAll()
        .where('business_id', '=', id)
        .orderBy('display_order')
        .execute();

      return reply.send({ staff });
    },
  );

  // ── CREATE ──────────────────────────────────────────────
  app.post(
    '/me/businesses/:id/staff',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = IdParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const input = StaffBody.parse(req.body);
      const staffId = newId();

      await db.insertInto('staff').values({
        id: staffId,
        business_id: id,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        bio: input.bio ?? null,
        is_active: input.is_active ? 1 : 0,
        display_order: input.display_order,
      }).execute();

      const staff = await db.selectFrom('staff').selectAll()
        .where('id', '=', staffId).executeTakeFirstOrThrow();
      return reply.code(201).send(staff);
    },
  );

  // ── UPDATE ──────────────────────────────────────────────
  app.patch(
    '/me/businesses/:id/staff/:staffId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, staffId } = StaffParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const input = StaffBody.partial().parse(req.body);

      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        if (k === 'is_active') updates[k] = v ? 1 : 0;
        else updates[k] = v;
      }

      if (Object.keys(updates).length) {
        await db.updateTable('staff').set(updates as any)
          .where('id', '=', staffId)
          .where('business_id', '=', id)
          .execute();
      }

      const staff = await db.selectFrom('staff').selectAll()
        .where('id', '=', staffId).executeTakeFirstOrThrow();
      return reply.send(staff);
    },
  );

  // ── DELETE (soft) ───────────────────────────────────────
  app.delete(
    '/me/businesses/:id/staff/:staffId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, staffId } = StaffParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      await db.updateTable('staff')
        .set({ is_active: 0 })
        .where('id', '=', staffId)
        .where('business_id', '=', id)
        .execute();

      return reply.code(204).send();
    },
  );

  // ═══════════════════════════════════════════════════════════
  // AVAILABILITY
  // ═══════════════════════════════════════════════════════════

  // ── GET availability for a staff member ─────────────────
  app.get(
    '/me/businesses/:id/staff/:staffId/availability',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, staffId } = StaffParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const rules = await db
        .selectFrom('availability_rules')
        .selectAll()
        .where('staff_id', '=', staffId)
        .orderBy('day_of_week')
        .orderBy('start_time')
        .execute();

      return reply.send({ rules });
    },
  );

  // ── REPLACE availability (bulk) ─────────────────────────
  app.put(
    '/me/businesses/:id/staff/:staffId/availability',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id, staffId } = StaffParam.parse(req.params);

      if (!(await assertOwnsBusiness(me.sub, id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your business' });
      }

      const input = AvailabilityBody.parse(req.body);

      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('availability_rules').where('staff_id', '=', staffId).execute();

        if (input.rules.length) {
          await trx.insertInto('availability_rules')
            .values(input.rules.map(r => ({
              id: newId(),
              staff_id: staffId,
              day_of_week: r.day_of_week,
              start_time: normalizeTime(r.start_time),
              end_time: normalizeTime(r.end_time),
            })))
            .execute();
        }
      });

      const rules = await db.selectFrom('availability_rules').selectAll()
        .where('staff_id', '=', staffId)
        .orderBy('day_of_week')
        .orderBy('start_time')
        .execute();

      return reply.send({ rules });
    },
  );
}