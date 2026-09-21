// src/routes/admin.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../db/client.js';
import { requireAuth, requireRole } from '../lib/middleware.js';
import { audit } from '../lib/audit.js';
import { queueEmail } from '../lib/notifications.js';

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────
const ListUsersQuery = z.object({
  q: z.string().trim().optional(),
  role: z.enum(['customer', 'business_owner', 'staff', 'admin', 'support']).optional(),
  status: z.enum(['active', 'deleted']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ListBusinessesQuery = z.object({
  q: z.string().trim().optional(),
  category: z.enum(['salon','barber','clinic','photographer','consultant','other']).optional(),
  status: z.enum(['pending','active','suspended','closed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ListBookingsQuery = z.object({
  status: z.enum(['pending','confirmed','cancelled','completed','no_show']).optional(),
  businessId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const AuditQuery = z.object({
  actorId: z.string().uuid().optional(),
  entityType: z.enum(['user', 'business', 'booking', 'system']).optional(),
  entityId: z.string().uuid().optional(),
  actionGroup: z.string().max(50).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const IdParam = z.object({ id: z.string().uuid() });

const UpdateUserBody = z.object({
  role: z.enum(['customer', 'business_owner', 'staff', 'admin', 'support']).optional(),
  email_verified: z.coerce.boolean().optional(),
});

const UpdateBusinessStatusBody = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'closed']),
  reason: z.string().max(500).optional(),
});

const BulkUserBody = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['suspend', 'restore', 'set_role']),
  role: z.enum(['customer', 'business_owner', 'staff', 'admin', 'support']).optional(),
});

const BulkBusinessBody = z.object({
  businessIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['activate', 'suspend', 'close', 'delete']),
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function safeJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

const READ_ROLES: Array<'admin' | 'support'> = ['admin', 'support'];
const WRITE_ROLES: Array<'admin'> = ['admin'];

export async function adminRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════
  // STATS / OVERVIEW
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/stats',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (_req, reply) => {
      const [
        usersTotal, usersByRole,
        businessesTotal, businessesByStatus,
        bookingsTotal, bookingsByStatus,
        revenue30d, recentSignups, recentBookings,
      ] = await Promise.all([
        db.selectFrom('users')
          .select(({ fn }) => fn.countAll<number>().as('n'))
          .where('deleted_at', 'is', null).executeTakeFirst(),

        db.selectFrom('users')
          .select(['role', ({ fn }) => fn.countAll<number>().as('n')])
          .where('deleted_at', 'is', null).groupBy('role').execute(),

        db.selectFrom('businesses')
          .select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirst(),

        db.selectFrom('businesses')
          .select(['status', ({ fn }) => fn.countAll<number>().as('n')])
          .groupBy('status').execute(),

        db.selectFrom('bookings')
          .select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirst(),

        db.selectFrom('bookings')
          .select(['status', ({ fn }) => fn.countAll<number>().as('n')])
          .groupBy('status').execute(),

        db.selectFrom('bookings')
          .select(({ fn }) => fn.sum<number>('total_amount').as('sum'))
          .where('status', 'in', ['confirmed', 'completed'])
          .where('created_at', '>=', sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`)
          .executeTakeFirst(),

        db.selectFrom('users')
          .select(['id', 'email', 'full_name', 'role', 'created_at'])
          .where('deleted_at', 'is', null)
          .orderBy('created_at', 'desc').limit(5).execute(),

        db.selectFrom('bookings')
          .select(['id', 'business_id', 'customer_id', 'status', 'total_amount', 'start_time', 'created_at'])
          .orderBy('created_at', 'desc').limit(5).execute(),
      ]);

      const roleMap = Object.fromEntries(usersByRole.map(r => [r.role, Number(r.n)]));
      const bizStatusMap = Object.fromEntries(businessesByStatus.map(r => [r.status, Number(r.n)]));
      const bookingStatusMap = Object.fromEntries(bookingsByStatus.map(r => [r.status, Number(r.n)]));

      return reply.send({
        users: {
          total: Number(usersTotal?.n ?? 0),
          customers: roleMap.customer ?? 0,
          businessOwners: roleMap.business_owner ?? 0,
          staff: roleMap.staff ?? 0,
          admins: roleMap.admin ?? 0,
          support: roleMap.support ?? 0,
        },
        businesses: {
          total: Number(businessesTotal?.n ?? 0),
          active: bizStatusMap.active ?? 0,
          pending: bizStatusMap.pending ?? 0,
          suspended: bizStatusMap.suspended ?? 0,
          closed: bizStatusMap.closed ?? 0,
        },
        bookings: {
          total: Number(bookingsTotal?.n ?? 0),
          confirmed: bookingStatusMap.confirmed ?? 0,
          pending: bookingStatusMap.pending ?? 0,
          cancelled: bookingStatusMap.cancelled ?? 0,
          completed: bookingStatusMap.completed ?? 0,
          revenue30d: Number(revenue30d?.sum ?? 0),
        },
        recent: {
          signups: recentSignups,
          bookings: recentBookings,
        },
      });
    },
  );

  // ═══════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/users',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const q = ListUsersQuery.parse(req.query);

      let query = db.selectFrom('users').select([
        'id', 'email', 'full_name', 'phone', 'role',
        'email_verified', 'created_at', 'deleted_at',
      ]);
      let countQuery = db.selectFrom('users')
        .select(({ fn }) => fn.countAll<number>().as('n'));

      const applyFilters = (qb: any) => {
        if (q.q) qb = qb.where((eb: any) => eb.or([
          eb('email', 'like', `%${q.q}%`),
          eb('full_name', 'like', `%${q.q}%`),
        ]));
        if (q.role) qb = qb.where('role', '=', q.role);
        if (q.status === 'active')  qb = qb.where('deleted_at', 'is', null);
        if (q.status === 'deleted') qb = qb.where('deleted_at', 'is not', null);
        return qb;
      };

      query = applyFilters(query);
      countQuery = applyFilters(countQuery);

      const [users, totalRow] = await Promise.all([
        query.orderBy('created_at', 'desc').limit(q.limit).offset(q.offset).execute(),
        countQuery.executeTakeFirst(),
      ]);

      // Business count for owners
      const ownerIds = users.filter(u => u.role === 'business_owner').map(u => u.id);
      let bizCounts: Record<string, number> = {};
      if (ownerIds.length) {
        const rows = await db.selectFrom('businesses')
          .select(['owner_id', ({ fn }) => fn.countAll<number>().as('n')])
          .where('owner_id', 'in', ownerIds)
          .groupBy('owner_id').execute();
        bizCounts = Object.fromEntries(rows.map(r => [r.owner_id, Number(r.n)]));
      }

      return reply.send({
        users: users.map(u => ({
          ...u,
          email_verified: Boolean(u.email_verified),
          business_count: bizCounts[u.id] ?? 0,
        })),
        pagination: {
          total: Number(totalRow?.n ?? 0),
          limit: q.limit,
          offset: q.offset,
        },
      });
    },
  );

  app.get(
    '/admin/users/:id',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);

      const user = await db.selectFrom('users')
        .select(['id', 'email', 'full_name', 'phone', 'role', 'email_verified',
                 'timezone', 'locale', 'created_at', 'updated_at', 'deleted_at'])
        .where('id', '=', id).executeTakeFirst();

      if (!user) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });
      }

      const [businesses, bookings] = await Promise.all([
        db.selectFrom('businesses').selectAll().where('owner_id', '=', id).execute(),
        db.selectFrom('bookings').selectAll()
          .where('customer_id', '=', id)
          .orderBy('created_at', 'desc').limit(10).execute(),
      ]);

      return reply.send({ ...user, businesses, recentBookings: bookings });
    },
  );

  app.patch(
    '/admin/users/:id',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const input = UpdateUserBody.parse(req.body);
      const me = req.user!;

      if (id === me.sub && input.role && input.role !== 'admin') {
        return reply.code(400).send({
          error: 'SELF_DEMOTE',
          message: 'You cannot remove your own admin role',
        });
      }

      const updates: Record<string, unknown> = {};
      if (input.role !== undefined)           updates.role = input.role;
      if (input.email_verified !== undefined) updates.email_verified = input.email_verified ? 1 : 0;

      if (!Object.keys(updates).length) {
        return reply.code(400).send({ error: 'NO_CHANGES', message: 'No updatable fields' });
      }

      await db.updateTable('users').set(updates).where('id', '=', id).execute();

      await audit({
        actorId: me.sub,
        entityType: 'user',
        entityId: id,
        action: 'user.role_changed',
        changes: updates,
        req,
      });

      const user = await db.selectFrom('users').select([
        'id', 'email', 'full_name', 'role', 'email_verified', 'created_at',
      ]).where('id', '=', id).executeTakeFirstOrThrow();

      return reply.send({ ...user, email_verified: Boolean(user.email_verified) });
    },
  );

  app.delete(
    '/admin/users/:id',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const me = req.user!;

      if (id === me.sub) {
        return reply.code(400).send({ error: 'SELF_DELETE', message: 'You cannot delete yourself' });
      }

      await db.updateTable('users')
        .set({ deleted_at: new Date() })
        .where('id', '=', id).execute();

      await db.updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', id).execute();

      await audit({
        actorId: me.sub,
        entityType: 'user',
        entityId: id,
        action: 'user.deleted',
        req,
      });

      return reply.code(204).send();
    },
  );

  app.post(
    '/admin/users/:id/restore',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const me = req.user!;

      await db.updateTable('users').set({ deleted_at: null }).where('id', '=', id).execute();

      await audit({
        actorId: me.sub,
        entityType: 'user',
        entityId: id,
        action: 'user.restored',
        req,
      });

      return reply.send({ ok: true });
    },
  );

  // ── Bulk user action ─────────────────────────────────────
  app.post(
    '/admin/users/bulk',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const me = req.user!;
      const { userIds, action, role } = BulkUserBody.parse(req.body);

      const targetIds = userIds.filter(id => id !== me.sub);
      if (!targetIds.length) {
        return reply.code(400).send({ error: 'NO_TARGETS', message: 'No valid target users' });
      }

      let updated = 0;
      if (action === 'suspend') {
        await db.updateTable('users')
          .set({ deleted_at: new Date() })
          .where('id', 'in', targetIds).execute();
        await db.updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', 'in', targetIds).execute();
        updated = targetIds.length;
      } else if (action === 'restore') {
        await db.updateTable('users')
          .set({ deleted_at: null })
          .where('id', 'in', targetIds).execute();
        updated = targetIds.length;
      } else if (action === 'set_role' && role) {
        await db.updateTable('users')
          .set({ role })
          .where('id', 'in', targetIds).execute();
        updated = targetIds.length;
      }

      await audit({
        actorId: me.sub,
        entityType: 'system',
        entityId: null,
        action: 'admin.bulk_action',
        changes: { action, role, userIds: targetIds, count: updated },
        req,
      });

      return reply.send({ ok: true, updated });
    },
  );

  // ═══════════════════════════════════════════════════════════
  // BUSINESSES
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/businesses',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const q = ListBusinessesQuery.parse(req.query);

      let query = db
        .selectFrom('businesses')
        .leftJoin('users as owner', 'owner.id', 'businesses.owner_id')
        .select([
          'businesses.id', 'businesses.name', 'businesses.slug',
          'businesses.category', 'businesses.city', 'businesses.status',
          'businesses.rating_avg', 'businesses.rating_count',
          'businesses.cover_url', 'businesses.created_at',
          'businesses.owner_id',
          'owner.email as owner_email',
          'owner.full_name as owner_name',
        ]);

      if (q.q) query = query.where((eb) => eb.or([
        eb('businesses.name', 'like', `%${q.q}%`),
        eb('businesses.slug', 'like', `%${q.q}%`),
      ]));
      if (q.category) query = query.where('businesses.category', '=', q.category);
      if (q.status)   query = query.where('businesses.status', '=', q.status);

      const businesses = await query
        .orderBy('businesses.created_at', 'desc')
        .limit(q.limit).offset(q.offset).execute();

      const ids = businesses.map(b => b.id);
      let bookingCounts: Record<string, number> = {};
      if (ids.length) {
        const rows = await db.selectFrom('bookings')
          .select(['business_id', ({ fn }) => fn.countAll<number>().as('n')])
          .where('business_id', 'in', ids)
          .groupBy('business_id').execute();
        bookingCounts = Object.fromEntries(rows.map(r => [r.business_id, Number(r.n)]));
      }

      return reply.send({
        businesses: businesses.map(b => ({
          ...b,
          booking_count: bookingCounts[b.id] ?? 0,
        })),
        pagination: { limit: q.limit, offset: q.offset },
      });
    },
  );

  app.get(
    '/admin/businesses/:id',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);

      const business = await db
        .selectFrom('businesses')
        .leftJoin('users as owner', 'owner.id', 'businesses.owner_id')
        .selectAll('businesses')
        .select([
          'owner.email as owner_email',
          'owner.full_name as owner_name',
          'owner.role as owner_role',
        ])
        .where('businesses.id', '=', id)
        .executeTakeFirst();

      if (!business) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Business not found' });
      }

      const [services, staff, recentBookings, stats] = await Promise.all([
        db.selectFrom('services').selectAll().where('business_id', '=', id).execute(),
        db.selectFrom('staff').selectAll().where('business_id', '=', id).execute(),
        db.selectFrom('bookings').selectAll()
          .where('business_id', '=', id)
          .orderBy('created_at', 'desc').limit(20).execute(),
        db.selectFrom('bookings')
          .select([
            ({ fn }) => fn.countAll<number>().as('total'),
            ({ fn }) => fn.sum<number>('total_amount').as('revenue'),
          ])
          .where('business_id', '=', id)
          .where('status', 'in', ['confirmed', 'completed'])
          .executeTakeFirst(),
      ]);

      return reply.send({
        ...business,
        services,
        staff,
        recentBookings,
        stats: {
          totalBookings: Number(stats?.total ?? 0),
          totalRevenue: Number(stats?.revenue ?? 0),
        },
      });
    },
  );

  app.patch(
    '/admin/businesses/:id/status',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const { status, reason } = UpdateBusinessStatusBody.parse(req.body);
      const me = req.user!;

      await db.updateTable('businesses').set({ status }).where('id', '=', id).execute();

      const actionMap: Record<string, any> = {
        active:    'business.approved',
        suspended: 'business.suspended',
        closed:    'business.closed',
        pending:   'business.updated',
      };

      await audit({
        actorId: me.sub,
        entityType: 'business',
        entityId: id,
        action: actionMap[status],
        changes: { status, reason },
        req,
      });

      // Queue owner email for status changes
      if (status === 'active' || status === 'suspended' || status === 'closed') {
        const owner = await db
          .selectFrom('businesses')
          .innerJoin('users', 'users.id', 'businesses.owner_id')
          .select([
            'users.id as user_id',
            'users.email',
            'users.full_name',
            'businesses.name as business_name',
          ])
          .where('businesses.id', '=', id)
          .executeTakeFirst();

        if (owner) {
          const templateMap = {
            active:    'business_approved',
            suspended: 'business_suspended',
            closed:    'business_closed',
          } as const;

          queueEmail({
            userId: owner.user_id,
            template: templateMap[status as keyof typeof templateMap],
            to: owner.email,
            data: {
              recipientName: owner.full_name,
              businessName: owner.business_name,
              reason,
            },
          }).catch((err) => req.log.warn({ err }, 'status email queue failed'));
        }
      }

      const business = await db.selectFrom('businesses').selectAll()
        .where('id', '=', id).executeTakeFirstOrThrow();

      return reply.send(business);
    },
  );

  app.delete(
    '/admin/businesses/:id',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const me = req.user!;

      const activeCount = await db.selectFrom('bookings')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .where('business_id', '=', id)
        .where('status', 'in', ['pending', 'confirmed'])
        .where('start_time', '>', new Date())
        .executeTakeFirst();

      if (Number(activeCount?.n ?? 0) > 0) {
        return reply.code(409).send({
          error: 'HAS_UPCOMING_BOOKINGS',
          message: `Cannot delete: ${activeCount!.n} upcoming bookings. Cancel them first.`,
        });
      }

      await db.deleteFrom('businesses').where('id', '=', id).execute();

      await audit({
        actorId: me.sub,
        entityType: 'business',
        entityId: id,
        action: 'business.deleted',
        req,
      });

      return reply.code(204).send();
    },
  );

  // ── Bulk business action ─────────────────────────────────
  app.post(
    '/admin/businesses/bulk',
    { preHandler: [requireAuth, requireRole(...WRITE_ROLES)] },
    async (req, reply) => {
      const me = req.user!;
      const { businessIds, action } = BulkBusinessBody.parse(req.body);

      if (action === 'delete') {
        const blocking = await db.selectFrom('bookings')
          .select('business_id')
          .where('business_id', 'in', businessIds)
          .where('status', 'in', ['pending', 'confirmed'])
          .where('start_time', '>', new Date())
          .groupBy('business_id')
          .execute();

        if (blocking.length) {
          return reply.code(409).send({
            error: 'HAS_UPCOMING_BOOKINGS',
            message: `${blocking.length} business(es) have upcoming bookings`,
            businessIds: blocking.map(b => b.business_id),
          });
        }
        await db.deleteFrom('businesses').where('id', 'in', businessIds).execute();
      } else {
        const statusMap = { activate: 'active', suspend: 'suspended', close: 'closed' } as const;
        const status = statusMap[action as keyof typeof statusMap];
        await db.updateTable('businesses').set({ status })
          .where('id', 'in', businessIds).execute();
      }

      await audit({
        actorId: me.sub,
        entityType: 'system',
        entityId: null,
        action: 'admin.bulk_action',
        changes: { action, businessIds, count: businessIds.length },
        req,
      });

      return reply.send({ ok: true, updated: businessIds.length });
    },
  );

  // ═══════════════════════════════════════════════════════════
  // BOOKINGS
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/bookings',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const q = ListBookingsQuery.parse(req.query);

      let query = db
        .selectFrom('bookings')
        .leftJoin('businesses', 'businesses.id', 'bookings.business_id')
        .leftJoin('users as customer', 'customer.id', 'bookings.customer_id')
        .leftJoin('users as owner', 'owner.id', 'businesses.owner_id')
        .select([
          'bookings.id', 'bookings.start_time', 'bookings.end_time',
          'bookings.status', 'bookings.payment_status',
          'bookings.total_amount', 'bookings.platform_fee',
          'bookings.created_at', 'bookings.business_id',
          'businesses.name as business_name',
          'bookings.customer_id',
          'customer.email as customer_email',
          'customer.full_name as customer_name',
          'owner.id as owner_id',
          'owner.email as owner_email',
        ]);

      if (q.status)     query = query.where('bookings.status', '=', q.status);
      if (q.businessId) query = query.where('bookings.business_id', '=', q.businessId);
      if (q.customerId) query = query.where('bookings.customer_id', '=', q.customerId);
      if (q.from)       query = query.where('bookings.start_time', '>=', new Date(q.from));
      if (q.to)         query = query.where('bookings.start_time', '<=', new Date(q.to));

      const bookings = await query
        .orderBy('bookings.created_at', 'desc')
        .limit(q.limit).offset(q.offset).execute();

      return reply.send({
        bookings,
        pagination: { limit: q.limit, offset: q.offset },
      });
    },
  );

  // ═══════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/audit',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const q = AuditQuery.parse(req.query);

      let query = db
        .selectFrom('audit_log')
        .leftJoin('users as actor', 'actor.id', 'audit_log.actor_id')
        .select([
          'audit_log.id', 'audit_log.actor_id',
          'audit_log.entity_type', 'audit_log.entity_id',
          'audit_log.action', 'audit_log.action_group',
          'audit_log.changes', 'audit_log.ip_address',
          'audit_log.created_at',
          'actor.email as actor_email',
          'actor.full_name as actor_name',
        ]);

      if (q.actorId)     query = query.where('audit_log.actor_id', '=', q.actorId);
      if (q.entityType)  query = query.where('audit_log.entity_type', '=', q.entityType);
      if (q.entityId)    query = query.where('audit_log.entity_id', '=', q.entityId);
      if (q.actionGroup) query = query.where('audit_log.action_group', '=', q.actionGroup);
      if (q.from)        query = query.where('audit_log.created_at', '>=', new Date(q.from));
      if (q.to)          query = query.where('audit_log.created_at', '<=', new Date(q.to));

      const rows = await query
        .orderBy('audit_log.created_at', 'desc')
        .limit(q.limit).offset(q.offset).execute();

      return reply.send({
        entries: rows.map(r => ({ ...r, changes: safeJson(r.changes) })),
        pagination: { limit: q.limit, offset: q.offset },
      });
    },
  );

  // ═══════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════
  app.get(
    '/admin/analytics',
    { preHandler: [requireAuth, requireRole(...READ_ROLES)] },
    async (req, reply) => {
      const days = Math.min(Math.max(Number((req.query as any)?.days ?? 30), 7), 180);

      const daily = await db
        .selectFrom('bookings')
        .select([
          sql<string>`DATE(created_at)`.as('day'),
          sql<number>`COUNT(*)`.as('bookings'),
          sql<number>`COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN total_amount ELSE 0 END), 0)`.as('revenue'),
          sql<number>`COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN platform_fee ELSE 0 END), 0)`.as('fees'),
        ])
        .where('created_at', '>=', sql`DATE_SUB(NOW(), INTERVAL ${days} DAY)`)
        .groupBy(sql`DATE(created_at)`)
        .orderBy('day', 'asc')
        .execute();

      const byCategory = await db
        .selectFrom('bookings')
        .innerJoin('businesses', 'businesses.id', 'bookings.business_id')
        .select([
          'businesses.category',
          sql<number>`COUNT(*)`.as('bookings'),
          sql<number>`COALESCE(SUM(bookings.total_amount), 0)`.as('revenue'),
        ])
        .where('bookings.status', 'in', ['confirmed', 'completed'])
        .where('bookings.created_at', '>=', sql`DATE_SUB(NOW(), INTERVAL ${days} DAY)`)
        .groupBy('businesses.category')
        .execute();

      const topBusinesses = await db
        .selectFrom('bookings')
        .innerJoin('businesses', 'businesses.id', 'bookings.business_id')
        .select([
          'businesses.id', 'businesses.name', 'businesses.category',
          sql<number>`COUNT(*)`.as('bookings'),
          sql<number>`COALESCE(SUM(bookings.total_amount), 0)`.as('revenue'),
        ])
        .where('bookings.status', 'in', ['confirmed', 'completed'])
        .where('bookings.created_at', '>=', sql`DATE_SUB(NOW(), INTERVAL ${days} DAY)`)
        .groupBy(['businesses.id', 'businesses.name', 'businesses.category'])
        .orderBy('revenue', 'desc')
        .limit(10)
        .execute();

      return reply.send({
        rangeDays: days,
        daily: daily.map(d => ({
          day: String(d.day).slice(0, 10),
          bookings: Number(d.bookings),
          revenue: Number(d.revenue),
          fees: Number(d.fees),
        })),
        byCategory: byCategory.map(c => ({
          category: c.category,
          bookings: Number(c.bookings),
          revenue: Number(c.revenue),
        })),
        topBusinesses: topBusinesses.map(b => ({
          id: b.id,
          name: b.name,
          category: b.category,
          bookings: Number(b.bookings),
          revenue: Number(b.revenue),
        })),
      });
    },
  );
}