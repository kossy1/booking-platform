import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { businessRoutes } from './routes/businesses.js';
import { availabilityRoutes } from './routes/availability.js';
import { bookingRoutes } from './routes/bookings.js';
import { uploadRoutes } from './routes/uploads.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import { AppError } from './lib/errors.js';
import { db } from './db/client.js';
import { startNotificationWorker } from './lib/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = Fastify({
  logger: { level: config.LOG_LEVEL },
  trustProxy: true,
  bodyLimit: 1_048_576,
});

// ─── Plugins ──────────────────────────────────────────
await app.register(helmet, { contentSecurityPolicy: false });

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Static files — serves everything under /public including /uploads/*
await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/',
  index: ['index.html'],
});

app.log.info({ publicDir: PUBLIC_DIR }, 'static root registered');

// ─── Routes ───────────────────────────────────────────
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(businessRoutes);
await app.register(availabilityRoutes);
await app.register(bookingRoutes);
await app.register(uploadRoutes);
await app.register(adminRoutes);

// ─── 404 ──────────────────────────────────────────────
app.setNotFoundHandler((req, reply) => {
  if (req.url === '/favicon.ico') {
    return reply.code(204).send();
  }
  // Static file paths → plain text
  if (/\.\w{2,5}$/.test(req.url)) {
    return reply.code(404).send('Not found');
  }
  // API paths → JSON
  return reply.code(404).send({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// ─── Error handler ────────────────────────────────────
app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request parameters',
      issues: err.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: i.code,
      })),
    });
  }

  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
      error: err.code ?? 'APP_ERROR',
      message: err.message,
    });
  }

  if ((err as any).validation) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: err.message,
      issues: (err as any).validation,
    });
  }

  const statusCode = (err as any).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({
      error: (err as any).code ?? 'REQUEST_ERROR',
      message: err.message,
    });
  }

  req.log.error({ err }, 'Unhandled error');
  return reply.code(500).send({
    error: 'INTERNAL',
    message: 'Something went wrong',
  });
});

// ─── Graceful shutdown ────────────────────────────────
let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info(`Received ${signal}, shutting down...`);
  try { await app.close(); } catch (err) { app.log.error({ err }, 'Error closing Fastify'); }
  try { await db.destroy(); } catch (err) { app.log.error({ err }, 'Error closing DB'); }
  app.log.info('Shutdown complete');
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'Unhandled promise rejection');
});

// ─── Start ────────────────────────────────────────────
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`Booking service ready on port ${config.PORT}`);

  // Start background workers after the server is up
  startNotificationWorker();
} catch (err) {
  app.log.error({ err }, 'Failed to start server');
  process.exit(1);
}