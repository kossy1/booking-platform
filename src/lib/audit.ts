// src/lib/audit.ts
import { db } from '../db/client.js';
import type { FastifyRequest } from 'fastify';

export type AuditAction =
  | 'user.role_changed'
  | 'user.suspended'
  | 'user.restored'
  | 'user.deleted'
  | 'business.approved'
  | 'business.suspended'
  | 'business.closed'
  | 'business.deleted'
  | 'business.updated'
  | 'booking.cancelled'
  | 'admin.login'
  | 'admin.bulk_action';

interface AuditEntry {
  actorId: string | null;
  entityType: 'user' | 'business' | 'booking' | 'system';
  entityId: string | null;
  action: AuditAction;
  changes?: Record<string, unknown>;
  req?: FastifyRequest;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insertInto('audit_log').values({
      actor_id: entry.actorId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      action_group: entry.action.split('.')[0] ?? null,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
      ip_address: entry.req?.ip ?? null,
    }).execute();
  } catch (err) {
    // Never let audit failure break the main request
    // (log to stderr; a real system would queue + retry)
    console.error('[audit] write failed:', err);
  }
}