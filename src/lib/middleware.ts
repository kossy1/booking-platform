// src/lib/middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type JwtPayload } from './auth.js';

// ─────────────────────────────────────────────────────────────
// Type augmentation: attach `user` to FastifyRequest
// ─────────────────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

// ─────────────────────────────────────────────────────────────
// requireAuth — customer audience
// ─────────────────────────────────────────────────────────────
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Missing or invalid Authorization header',
    });
  }

  try {
    req.user = verifyAccessToken(header.slice(7).trim(), 'customer');
  } catch {
    return reply.code(401).send({
      error: 'INVALID_TOKEN',
      message: 'Access token is invalid or expired',
    });
  }
}

// ─────────────────────────────────────────────────────────────
// requireAdminAuth — admin audience (separate from customer)
// ─────────────────────────────────────────────────────────────
export async function requireAdminAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Missing or invalid Authorization header',
    });
  }

  try {
    req.user = verifyAccessToken(header.slice(7).trim(), 'admin');
  } catch {
    return reply.code(401).send({
      error: 'INVALID_ADMIN_TOKEN',
      message: 'Admin token is invalid or expired',
    });
  }
}

// ─────────────────────────────────────────────────────────────
// requireRole — role check (must be used after requireAuth)
// ─────────────────────────────────────────────────────────────
export function requireRole(...roles: JwtPayload['role'][]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      return reply.code(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Not logged in',
      });
    }
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message:
          roles.length === 1
            ? `${roles[0]} access required`
            : `One of [${roles.join(', ')}] access required`,
      });
    }
  };
}

// ─────────────────────────────────────────────────────────────
// optionalAuth — attach user if token present, but never reject
// ─────────────────────────────────────────────────────────────
export async function optionalAuth(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;

  try {
    req.user = verifyAccessToken(header.slice(7).trim(), 'customer');
  } catch {
    req.user = undefined;
  }
}