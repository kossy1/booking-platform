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
import { serviceRoutes } from './routes/services.js';
import { healthRoutes } from './routes/health.js';
import { AppError } from './lib/errors.js';
import { db } from './db/client.js';
import { startNotificationWorker } from './lib/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ─────────────────────────────────────────────────────────────
// CORS origins — dev + production
// ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS: string[] = [
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3001',
  'https://booking-platform-blond-beta.vercel.app',
  'https://booking-platform.onrender.com',
];

// Allow extra origins via env (comma-separated)
if (process.env.CORS_ORIGINS) {
  ALLOWED_ORIGINS.push(
    ...process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  );
}

const app = Fastify({
  logger: { level: config.LOG_LEVEL },
  trustProxy: true,                 // needed behind Render/Vercel proxies
  bodyLimit: 1_048_576,
});

// ─── Plugins ──────────────────────────────────────────
await app.register(helmet, {
  contentSecurityPolicy: false,     // API-only responses
  crossOriginResourcePolicy: false, // allow images fetched cross-origin
});

await app.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no Origin header (curl, Postman, same-origin)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Allow ngrok/dev tunnels
    if (/^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/.test(origin)) return cb(null, true);
    if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length'],
  maxAge: 86400,
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Static files
await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/',
  index: ['index.html'],
  // Serves /uploads/... dynamically too
});

app.log.info({ publicDir: PUBLIC_DIR }, 'static root registered');
app.log.info({ corsOrigins: ALLOWED_ORIGINS }, 'cors origins registered');

// ─── Routes ───────────────────────────────────────────
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(businessRoutes);
await app.register(availabilityRoutes);
await app.register(bookingRoutes);
await app.register(uploadRoutes);
await app.register(adminRoutes);
await app.register(serviceRoutes);

// ─── 404 ──────────────────────────────────────────────
app.setNotFoundHandler((req, reply) => {
  if (req.url === '/favicon.ico') {
    return reply.code(204).send();
  }
  if (/\.\w{2,5}$/.test(req.url)) {
    return reply.code(404).send('Not found');
  }
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
  const port = config.PORT;                 // Render sets PORT automatically
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Booking service ready on port ${port}`);

  // Start background worker after the server is up
  startNotificationWorker();
} catch (err) {
  app.log.error({ err }, 'Failed to start server');
  process.exit(1);
}