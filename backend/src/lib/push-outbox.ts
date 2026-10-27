/**
 * push-outbox.ts — W1101: send the owner's one-off pushes (migration 0070).
 *
 * A row in push_outbox, written with `wrangler d1 execute` (the app never writes it), is sent
 * by the 2-minute cron. Each row is claimed (sent_at stamped) BEFORE its send, so a slow APNs
 * call on one tick can never send it a second time on the next.
 */
import type { Env } from '../env';
import { notifyUser } from './apns';

interface OutboxRow {
  id: number;
  user_id: string;
  title: string;
  body: string;
  type: string | null;
}

/** Sends up to 20 unsent outbox rows. Returns how many were claimed and sent. */
export async function sweepPushOutbox(env: Env): Promise<number> {
  let sent = 0;
  try {
    const rows = await env.DB.prepare(
      'SELECT id, user_id, title, body, type FROM push_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20',
    ).all<OutboxRow>();
    for (const r of rows.results || []) {
      const claim = await env.DB.prepare(
        'UPDATE push_outbox SET sent_at = ? WHERE id = ? AND sent_at IS NULL',
      ).bind(new Date().toISOString(), r.id).run();
      if (!claim.meta || Number(claim.meta.changes) < 1) continue;
      await notifyUser(env, r.user_id, { title: r.title, body: r.body, type: r.type || 'notice' });
      sent++;
    }
  } catch (err) {
    console.error('push outbox sweep failed:', err instanceof Error ? err.message : err);
  }
  return sent;
}
