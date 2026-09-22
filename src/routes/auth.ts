// src/routes/auth.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { newId } from '../lib/id.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../lib/auth.js';
import { requireAuth, requireAdminAuth } from '../lib/middleware.js';
import { config } from '../config.js';
import { queueEmail } from '../lib/notifications.js';
import { audit } from '../lib/audit.js';

const RegisterBody = z.object({
  fullName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  phone: z.string().max(25).nullable().optional(),
  password: z.string().min(8).max(100),
  role: z.enum(['customer', 'business_owner']),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshBody = z.object({ refreshToken: z.string().min(10) });
const LogoutBody  = z.object({ refreshToken: z.string().optional() });

const DUMMY_HASH = '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';

async function issueTokens(
  user: { id: string; email: string; role: 'customer' | 'business_owner' | 'staff' | 'admin' | 'support' },
  audience: 'customer' | 'admin',
  meta: { ip?: string; userAgent?: string },
) {
  const accessToken = signAccessToken(
    { sub: user.id, email: user.email, role: user.role },
    audience,
  );

  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86_400_000);

  await db.insertInto('refresh_tokens').values({
    id: newId(),
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt,
    user_agent: (meta.userAgent ?? '').slice(0, 255),
    ip_address: meta.ip ?? null,
  }).execute();

  return { accessToken, refreshToken: raw, expiresAt };
}

function isIpAllowed(ip: string | undefined): boolean {
  const list = config.ADMIN_IP_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return true;
  if (!ip) return false;
  const normalized = ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;
  return list.some(entry => {
    const e = entry === '::1' ? '127.0.0.1' : entry;
    return e === normalized || e === ip;
  });
}

async function recordAttempt(opts: {
  email: string; ip?: string; userAgent?: string; success: boolean; reason?: string;
}) {
  try {
    await db.insertInto('login_attempts').values({
      email: opts.email.toLowerCase(),
      ip_address: opts.ip ?? null,
      user_agent: (opts.userAgent ?? '').slice(0, 255),
      success: opts.success ? 1 : 0,
      reason: opts.reason ?? null,
    }).execute();
  } catch { /* ignore */ }
}

export async function authRoutes(app: FastifyInstance) {

  // ── REGISTER ────────────────────────────────────────
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const input = RegisterBody.parse(req.body);
      const email = input.email.toLowerCase();

      const existing = await db.selectFrom('users').select('id')
        .where('email', '=', email).executeTakeFirst();
      if (existing) {
        return reply.code(409).send({
          error: 'EMAIL_TAKEN',
          message: 'An account with this email already exists',
        });
      }

      const userId = newId();
      const passwordHash = await hashPassword(input.password);

      await db.insertInto('users').values({
        id: userId,
        email,
        phone: input.phone ?? null,
        password_hash: passwordHash,
        full_name: input.fullName,
        role: input.role,
        email_verified: 0,
        timezone: 'Africa/Lagos',
        locale: 'en',
      }).execute();

      const tokens = await issueTokens(
        { id: userId, email, role: input.role },
        'customer',
        { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') },
      );

      queueEmail({
        userId,
        template: 'welcome',
        to: email,
        data: { recipientName: input.fullName },
      }).catch((err) => req.log.warn({ err }, 'welcome email queue failed'));

      return reply.code(201).send({
        user: { id: userId, email, fullName: input.fullName, role: input.role },
        ...tokens,
        audience: 'customer',
      });
    },
  );

  // ── LOGIN (customer) ────────────────────────────────
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const input = LoginBody.parse(req.body);
      const email = input.email.toLowerCase();

      const user = await db.selectFrom('users').selectAll()
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      const ok = user
        ? await verifyPassword(input.password, user.password_hash ?? DUMMY_HASH)
        : await verifyPassword(input.password, DUMMY_HASH);

      if (!user || !ok) {
        return reply.code(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect',
        });
      }

      const tokens = await issueTokens(
        { id: user.id, email: user.email, role: user.role as any },
        'customer',
        { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') },
      );

      return reply.send({
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
        ...tokens,
        audience: 'customer',
      });
    },
  );

  // ── ADMIN LOGIN ─────────────────────────────────────
  app.post(
    '/auth/admin/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const ip = req.ip;
      const ua = String(req.headers['user-agent'] ?? '');

      if (!isIpAllowed(ip)) {
        req.log.warn({ ip }, 'admin login from disallowed IP');
        return reply.code(403).send({
          error: 'IP_NOT_ALLOWED',
          message: 'Admin login is not permitted from this network',
        });
      }

      const input = LoginBody.parse(req.body);
      const email = input.email.toLowerCase();

      const user = await db.selectFrom('users').selectAll()
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (!user || (user.role !== 'admin' && user.role !== 'support')) {
        await verifyPassword(input.password, DUMMY_HASH);
        await recordAttempt({ email, ip, userAgent: ua, success: false, reason: 'not_admin' });
        return reply.code(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect',
        });
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        await recordAttempt({ email, ip, userAgent: ua, success: false, reason: 'locked' });
        const seconds = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000);
        return reply.code(423).send({
          error: 'ACCOUNT_LOCKED',
          message: `Account is locked. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
          retryAfterSeconds: seconds,
        });
      }

      const ok = await verifyPassword(input.password, user.password_hash ?? DUMMY_HASH);

      if (!ok) {
        const newAttempts = (user.failed_attempts ?? 0) + 1;
        const shouldLock = newAttempts >= config.MAX_FAILED_ATTEMPTS;

        await db.updateTable('users').set({
          failed_attempts: newAttempts,
          locked_until: shouldLock
            ? new Date(Date.now() + config.LOCKOUT_MINUTES * 60_000)
            : user.locked_until,
        }).where('id', '=', user.id).execute();

        await recordAttempt({ email, ip, userAgent: ua, success: false, reason: 'bad_password' });

        audit({
          actorId: user.id, entityType: 'system', entityId: user.id,
          action: 'admin.login',
          changes: { success: false, reason: 'bad_password', attempt: newAttempts, locked: shouldLock },
          req,
        }).catch(() => {});

        if (shouldLock) {
          return reply.code(423).send({
            error: 'ACCOUNT_LOCKED',
            message: `Too many failed attempts. Locked for ${config.LOCKOUT_MINUTES} minutes.`,
          });
        }

        return reply.code(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect',
          attemptsRemaining: Math.max(0, config.MAX_FAILED_ATTEMPTS - newAttempts),
        });
      }

      await db.updateTable('users').set({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
        last_login_ip: ip ?? null,
      }).where('id', '=', user.id).execute();

      await recordAttempt({ email, ip, userAgent: ua, success: true });

      const tokens = await issueTokens(
        { id: user.id, email: user.email, role: user.role as any },
        'admin',
        { ip, userAgent: ua },
      );

      audit({
        actorId: user.id, entityType: 'system', entityId: user.id,
        action: 'admin.login',
        changes: { success: true, ip },
        req,
      }).catch(() => {});

      return reply.send({
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
        ...tokens,
        audience: 'admin',
      });
    },
  );

  // ── REFRESH (customer) ──────────────────────────────
  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    const hash = hashRefreshToken(refreshToken);

    const row = await db
      .selectFrom('refresh_tokens')
      .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
      .select([
        'refresh_tokens.id as token_id',
        'refresh_tokens.expires_at',
        'refresh_tokens.revoked_at',
        'users.id as user_id',
        'users.email',
        'users.role',
        'users.deleted_at',
      ])
      .where('refresh_tokens.token_hash', '=', hash)
      .executeTakeFirst();

    if (!row || row.revoked_at || row.deleted_at || new Date(row.expires_at) < new Date()) {
      return reply.code(401).send({
        error: 'INVALID_REFRESH',
        message: 'Refresh token is invalid or expired',
      });
    }

    await db.updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('id', '=', row.token_id).execute();

    const tokens = await issueTokens(
      { id: row.user_id, email: row.email, role: row.role as any },
      'customer',
      { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') },
    );

    return reply.send({ ...tokens, audience: 'customer' });
  });

  // ── REFRESH (admin) ─────────────────────────────────
  app.post('/auth/admin/refresh', async (req, reply) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    const hash = hashRefreshToken(refreshToken);

    const row = await db
      .selectFrom('refresh_tokens')
      .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
      .select([
        'refresh_tokens.id as token_id',
        'refresh_tokens.expires_at',
        'refresh_tokens.revoked_at',
        'users.id as user_id',
        'users.email',
        'users.role',
        'users.deleted_at',
      ])
      .where('refresh_tokens.token_hash', '=', hash)
      .executeTakeFirst();

    if (
      !row || row.revoked_at || row.deleted_at ||
      new Date(row.expires_at) < new Date() ||
      (row.role !== 'admin' && row.role !== 'support')
    ) {
      return reply.code(401).send({
        error: 'INVALID_ADMIN_REFRESH',
        message: 'Admin refresh token is invalid or expired',
      });
    }

    await db.updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('id', '=', row.token_id).execute();

    const tokens = await issueTokens(
      { id: row.user_id, email: row.email, role: row.role as any },
      'admin',
      { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') },
    );

    return reply.send({ ...tokens, audience: 'admin' });
  });

  // ── LOGOUT (customer) ───────────────────────────────
  app.post('/auth/logout', async (req, reply) => {
    const body = LogoutBody.parse(req.body ?? {});
    if (body.refreshToken) {
      const hash = hashRefreshToken(body.refreshToken);
      await db.updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('token_hash', '=', hash).execute();
    }
    return reply.send({ ok: true });
  });

  // ── LOGOUT (admin) ──────────────────────────────────
  app.post('/auth/admin/logout', async (req, reply) => {
    const body = LogoutBody.parse(req.body ?? {});
    if (body.refreshToken) {
      const hash = hashRefreshToken(body.refreshToken);
      await db.updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('token_hash', '=', hash).execute();
    }
    return reply.send({ ok: true });
  });

  // ── ME (customer) ───────────────────────────────────
  app.get('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'phone', 'timezone'])
      .where('id', '=', req.user!.sub)
      .executeTakeFirst();

    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });

    return reply.send({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      phone: user.phone,
      timezone: user.timezone,
    });
  });

  // ── ME (admin) ──────────────────────────────────────
  app.get('/auth/admin/me', { preHandler: requireAdminAuth }, async (req, reply) => {
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'last_login_at'])
      .where('id', '=', req.user!.sub)
      .executeTakeFirst();

    if (!user || (user.role !== 'admin' && user.role !== 'support')) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not an admin account' });
    }

    return reply.send({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      lastLoginAt: user.last_login_at,
    });
  });
}