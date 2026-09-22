// src/lib/notifications.ts
import { db } from '../db/client.js';
import { newId } from './id.js';
import { sendEmail, type EmailTemplate } from './email.js';

interface QueueInput {
  userId: string | null;
  bookingId?: string | null;
  channel?: 'email' | 'sms' | 'push';
  template: EmailTemplate;
  to: string;
  data: Record<string, unknown>;
}

export async function queueEmail(input: QueueInput) {
  await db.insertInto('notifications').values({
    id: newId(),
    user_id: input.userId,
    booking_id: input.bookingId ?? null,
    channel: input.channel ?? 'email',
    template: input.template,
    payload: JSON.stringify({ to: input.to, data: input.data }),
    status: 'queued',
  }).execute();
}

export async function startNotificationWorker() {
  let running = true;
  const INTERVAL_MS = 10_000;

  process.on('SIGINT',  () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  const tick = async () => {
    if (!running) return;

    try {
      const pending = await db
        .selectFrom('notifications')
        .selectAll()
        .where('status', '=', 'queued')
        .where('channel', '=', 'email')
        .orderBy('created_at', 'asc')
        .limit(20)
        .execute();

      for (const n of pending) {
        try {
          const updated = await db.updateTable('notifications')
            .set({ status: 'sending', attempts: n.attempts + 1 })
            .where('id', '=', n.id)
            .where('status', '=', 'queued')
            .executeTakeFirst();

          if (!Number((updated as any).numUpdatedRows ?? 0)) continue;

          const payload = JSON.parse(n.payload as string) as {
            to: string;
            data: Record<string, unknown>;
          };

          await sendEmail(payload.to, n.template as EmailTemplate, payload.data);

          await db.updateTable('notifications')
            .set({ status: 'sent', sent_at: new Date(), processed_at: new Date() })
            .where('id', '=', n.id)
            .execute();

        } catch (err: any) {
          const shouldRetry = n.attempts < 3;
          await db.updateTable('notifications')
            .set({
              status: shouldRetry ? 'queued' : 'failed',
              last_error: String(err?.message ?? err).slice(0, 500),
              processed_at: new Date(),
            })
            .where('id', '=', n.id)
            .execute();
        }
      }
    } catch (err) {
      console.error('[notifications] worker tick failed:', err);
    }

    if (running) setTimeout(tick, INTERVAL_MS);
  };

  console.log('[notifications] worker started');
  tick();
}