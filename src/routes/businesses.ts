// src/routes/businesses.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';

const ListQuery = z.object({
  q: z.string().trim().optional(),
  category: z.enum(['salon','barber','clinic','photographer','consultant','other']).optional(),
  city: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

const IdParam = z.object({ id: z.string().uuid() });

export async function businessRoutes(app: FastifyInstance) {

  // GET /businesses ────────────────────────────────────
  app.get('/businesses', async (req, reply) => {
    const q = ListQuery.parse(req.query);

    let query = db
      .selectFrom('businesses')
      .select([
        'id', 'name', 'slug', 'category', 'city',
        'rating_avg', 'rating_count', 'logo_url', 'cover_url',
      ])
      .where('status', '=', 'active');

    if (q.q)        query = query.where('name', 'like', `%${q.q}%`);
    if (q.category) query = query.where('category', '=', q.category);
    if (q.city)     query = query.where('city', 'like', `%${q.city}%`);

    const businesses = await query
      .orderBy('rating_avg', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();

    return reply.send({ businesses });
  });

  // GET /businesses/:id ────────────────────────────────
  app.get('/businesses/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);

    const business = await db
      .selectFrom('businesses')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!business) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Business not found' });
    }

    const [services, staff] = await Promise.all([
      db.selectFrom('services')
        .selectAll()
        .where('business_id', '=', id)
        .where('is_active', '=', 1)
        .orderBy('display_order')
        .execute(),
      db.selectFrom('staff')
        .select(['id', 'name', 'avatar_url', 'bio'])
        .where('business_id', '=', id)
        .where('is_active', '=', 1)
        .execute(),
    ]);

    return reply.send({ ...business, services, staff });
  });

  // GET /services?businessId=... ──────────────────────
  app.get('/services', async (req, reply) => {
    const q = z.object({ businessId: z.string().uuid() }).parse(req.query);

    const services = await db
      .selectFrom('services')
      .selectAll()
      .where('business_id', '=', q.businessId)
      .where('is_active', '=', 1)
      .orderBy('display_order')
      .execute();

    return reply.send({ services });
  });
}