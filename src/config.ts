import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url().default('mysql://root:@localhost:3306/booking'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_LEVEL: z.string().default('info'),

  // ─── Auth ──────────────────────────────────────────
  JWT_SECRET: z.string().min(32).default('dev-secret-change-me-please-32chars-min!!'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  // ─── Admin hardening ──────────────────────────────
  ADMIN_JWT_ACCESS_TTL: z.string().default('30m'),
  MAX_FAILED_ATTEMPTS: z.coerce.number().int().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().default(15),
  ADMIN_IP_ALLOWLIST: z.string().default(''),
});

export const config = Env.parse(process.env);