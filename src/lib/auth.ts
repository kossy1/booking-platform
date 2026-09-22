// src/lib/auth.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'customer' | 'business_owner' | 'staff' | 'admin' | 'support';
  aud: 'customer' | 'admin';
}

// ─── Passwords ──────────────────────────────────────
export const hashPassword = (plain: string) =>
  bcrypt.hash(plain, config.BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, hash: string) =>
  bcrypt.compare(plain, hash);

// ─── Access tokens ──────────────────────────────────
export function signAccessToken(
  payload: Omit<JwtPayload, 'aud'>,
  audience: 'customer' | 'admin',
): string {
  const ttl = audience === 'admin'
    ? config.ADMIN_JWT_ACCESS_TTL
    : config.JWT_ACCESS_TTL;

  // jsonwebtoken adds `aud` to the token from options.audience.
  // Do NOT also include `aud` in the payload — it will error.
  return jwt.sign(
    payload,
    config.JWT_SECRET,
    {
      expiresIn: ttl as any,
      issuer: 'bookeasy',
      audience,
    },
  );
}

export function verifyAccessToken(
  token: string,
  expectedAudience: 'customer' | 'admin' = 'customer',
): JwtPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    issuer: 'bookeasy',
    audience: expectedAudience,
  }) as any;

  return {
    sub: decoded.sub,
    email: decoded.email,
    role: decoded.role,
    aud: decoded.aud,
  };
}

// ─── Refresh tokens ─────────────────────────────────
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}