import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { sql } from 'kysely';
import { db } from '../db/client.js';

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — no dependencies checked
  app.get('/health', async () => ({
    ok: true,
    nowUtc: DateTime.utc().toISO(),
    nowLocal: DateTime.local().toISO(),
    uptimeSec: Math.floor(process.uptime()),
  }));

  // Readiness — checks DB connectivity
  app.get('/ready', async (_req, reply) => {
    try {
      await sql`SELECT 1`.execute(db);
      return reply.send({ ok: true, db: 'up' });
    } catch (err) {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });
}