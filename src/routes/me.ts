// src/routes/me.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireAuth } from '../lib/middleware.js';
import { newId } from '../lib/id.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Turn "Downtown Barbershop!" into "downtown-barbershop".
 * Falls back to "business" if the input has no usable characters.
 */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')       // strip diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'business'
  );
}

/**
 * Find an unused slug by appending -2, -3, ... on collision.
 * Optionally exclude a specific business (for updates).
 */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.selectFrom('businesses').select('id').where('slug', '=', slug);
    if (excludeId) q = q.where('id', '!=', excludeId);
    const clash = await q.executeTakeFirst();
    if (!clash) return slug;
    slug = `${base}-${++n}`;
  }
}

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

/** Accept `/uploads/xyz.webp`, `https://…`, or `http://…` */
const ImageRef = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (v) => v.startsWith('/uploads/') || /^https?:\/\/\S+$/i.test(v),
    { message: 'Must be an uploaded path (/uploads/...) or a valid http(s) URL' },
  );

/** Loose phone — Nigerian and international formats */
const Phone = z
  .string()
  .min(6)
  .max(25)
  .regex(/^[+0-9 ()\-]+$/, 'Phone can only contain digits, +, spaces, parens, dashes');

const CreateBusinessBody = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum([
    'salon',
    'barber',
    'clinic',
    'photographer',
    'consultant',
    'other',
  ]),
  description: z.string().trim().max(2000).optional(),
  phone: Phone.optional(),
  email: z.string().email().max(255).optional(),

  address_line1: z.string().trim().max(255).optional(),
  address_line2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postal_code: z.string().trim().max(20).optional(),
  country: z
    .string()
    .trim()
    .length(2, 'Use 2-letter country code (e.g. NG)')
    .transform((v) => v.toUpperCase())
    .optional(),

  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),

  timezone: z.string().max(50).default('Africa/Lagos'),
  currency: z.string().length(3).default('NGN'),

  cover_url: ImageRef.optional(),
  logo_url: ImageRef.optional(),

  // Optional scheduling preferences
  min_lead_minutes: z.coerce.number().int().min(0).max(20160).default(60),
  max_advance_days: z.coerce.number().int().min(1).max(3650).default(90),
});

const UpdateBusinessBody = CreateBusinessBody.partial();

const BusinessIdParam = z.object({ id: z.string().uuid() });

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

export async function meRoutes(app: FastifyInstance) {
  // ── GET /me/businesses ────────────────────────────────
  // Every business owned by the logged-in user
  app.get('/me/businesses', { preHandler: requireAuth }, async (req, reply) => {
    const me = req.user!;

    const businesses = await db
      .selectFrom('businesses')
      .selectAll()
      .where('owner_id', '=', me.sub)
      .where('status', '!=', 'closed')
      .orderBy('created_at', 'desc')
      .execute();

    return reply.send({ businesses });
  });

  // ── GET /me/businesses/:id ────────────────────────────
  app.get(
    '/me/businesses/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = BusinessIdParam.parse(req.params);

      const business = await db
        .selectFrom('businesses')
        .selectAll()
        .where('id', '=', id)
        .where('owner_id', '=', me.sub)
        .executeTakeFirst();

      if (!business) {
        return reply
          .code(404)
          .send({ error: 'NOT_FOUND', message: 'Business not found' });
      }
      return reply.send(business);
    },
  );

  // ── POST /me/businesses ───────────────────────────────
  app.post('/me/businesses', { preHandler: requireAuth }, async (req, reply) => {
    const me = req.user!;

    if (me.role !== 'business_owner' && me.role !== 'admin') {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Only business accounts can create businesses',
      });
    }

    const input = CreateBusinessBody.parse(req.body);

    // Business owners start with status 'active' in the demo so they show up
    // immediately on /browse. Flip to 'pending' for real moderation flows.
    const slug = await uniqueSlug(slugify(input.name));
    const id = newId();

    await db
      .insertInto('businesses')
      .values({
        id,
        owner_id: me.sub,
        name: input.name,
        slug,
        category: input.category,
        description: input.description ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,

        address_line1: input.address_line1 ?? null,
        address_line2: input.address_line2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postal_code ?? null,
        country: input.country ?? null,

        latitude:
          input.latitude !== undefined ? String(input.latitude) : null,
        longitude:
          input.longitude !== undefined ? String(input.longitude) : null,

        timezone: input.timezone,
        currency: input.currency,

        cover_url: input.cover_url ?? null,
        logo_url: input.logo_url ?? null,

        min_lead_minutes: input.min_lead_minutes,
        max_advance_days: input.max_advance_days,

        cancellation_policy: JSON.stringify({ hours: 24, refund_pct: 100 }),
        subscription_plan: 'free',
        commission_rate: '0.0500',
        status: 'active',
      })
      .execute();

    const business = await db
      .selectFrom('businesses')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return reply.code(201).send(business);
  });

  // ── PATCH /me/businesses/:id ──────────────────────────
  // Partial update. Only fields provided in the body are changed.
  app.patch(
    '/me/businesses/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = BusinessIdParam.parse(req.params);

      // Ownership check first (fail fast, avoid leaking existence)
      const existing = await db
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', id)
        .where('owner_id', '=', me.sub)
        .executeTakeFirst();

      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'NOT_FOUND', message: 'Business not found' });
      }

      const input = UpdateBusinessBody.parse(req.body);

      // If name changed, regenerate a unique slug
      let slug: string | undefined;
      if (input.name) {
        slug = await uniqueSlug(slugify(input.name), id);
      }

      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (key === 'latitude' || key === 'longitude') {
          updates[key] = value === null ? null : String(value);
          continue;
        }
        updates[key] = value;
      }
      if (slug) updates.slug = slug;
      if (Object.keys(updates).length === 0) {
        return reply
          .code(400)
          .send({ error: 'NO_CHANGES', message: 'No updatable fields provided' });
      }

      await db
        .updateTable('businesses')
        .set(updates as any)
        .where('id', '=', id)
        .execute();

      const updated = await db
        .selectFrom('businesses')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      return reply.send(updated);
    },
  );

  // ── DELETE /me/businesses/:id ─────────────────────────
  // Soft-delete: sets status = 'closed'. Hard delete cascades FKs.
  app.delete(
    '/me/businesses/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const me = req.user!;
      const { id } = BusinessIdParam.parse(req.params);

      const existing = await db
        .selectFrom('businesses')
        .select('id', 'status')
        .where('id', '=', id)
        .where('owner_id', '=', me.sub)
        .executeTakeFirst();

      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'NOT_FOUND', message: 'Business not found' });
      }

      // Check for future confirmed bookings before closing
      const upcoming = await db
        .selectFrom('bookings')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('business_id', '=', id)
        .where('status', 'in', ['pending', 'confirmed'])
        .where('start_time', '>', new Date())
        .executeTakeFirst();

      if (Number(upcoming?.count ?? 0) > 0) {
        return reply.code(409).send({
          error: 'HAS_UPCOMING_BOOKINGS',
          message: `Cannot close: ${upcoming!.count} upcoming booking(s). Cancel them first.`,
        });
      }

      await db
        .updateTable('businesses')
        .set({ status: 'closed' })
        .where('id', '=', id)
        .execute();

      return reply.code(204).send();
    },
  );
}