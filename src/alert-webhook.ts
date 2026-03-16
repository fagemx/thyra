/**
 * alert-webhook.ts -- Webhook CRUD + fire-and-forget delivery (#236)
 *
 * Dispatches alerts to registered webhook URLs.
 * HMAC signing with X-Thyra-Signature header.
 * Phase 1: No retry on failure. Failure logged to audit_log.
 */

import type { Database } from 'bun:sqlite';
import type { Alert, AlertType } from './schemas/alert';
import type { AlertWebhook } from './schemas/alert';
import { appendAudit } from './db';

/** Internal type: AlertWebhook + secret for delivery */
interface WebhookWithSecret extends AlertWebhook {
  secret?: string;
}

// ---------------------------------------------------------------------------
// WebhookDispatcher
// ---------------------------------------------------------------------------

/** Webhook delivery timeout (ms) */
const WEBHOOK_TIMEOUT_MS = 5_000;

export class WebhookDispatcher {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Register a new webhook */
  register(
    villageId: string,
    url: string,
    events: AlertType[] = [],
    secret?: string,
  ): AlertWebhook {
    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO alert_webhooks (id, village_id, url, events, secret, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)
    `).run(id, villageId, url, JSON.stringify(events), secret ?? null, now, now);

    appendAudit(this.db, 'webhook', id, 'registered', { village_id: villageId, url, events }, 'system');

    return this.getById(id)!;
  }

  /** Remove a webhook */
  remove(webhookId: string): void {
    const wh = this.getById(webhookId);
    if (!wh) throw new Error(`Webhook not found: ${webhookId}`);

    this.db.prepare('DELETE FROM alert_webhooks WHERE id = ?').run(webhookId);
    appendAudit(this.db, 'webhook', webhookId, 'removed', { url: wh.url }, 'system');
  }

  /** List webhooks for a village (public: no secrets) */
  list(villageId: string): AlertWebhook[] {
    const rows = this.db.prepare(
      "SELECT * FROM alert_webhooks WHERE village_id = ? AND status = 'active' ORDER BY created_at DESC"
    ).all(villageId) as Record<string, unknown>[];
    return rows.map((r) => this.stripSecret(this.parseRow(r)));
  }

  /** Get single webhook by ID (public: no secrets) */
  getById(webhookId: string): AlertWebhook | null {
    const row = this.db.prepare('SELECT * FROM alert_webhooks WHERE id = ?')
      .get(webhookId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.stripSecret(this.parseRow(row));
  }

  /**
   * Dispatch alert to all matching webhooks for the alert's village.
   * Fire-and-forget: failures logged, never throws.
   */
  async dispatch(alert: Alert): Promise<void> {
    // Internal list with secrets for delivery
    const rows = this.db.prepare(
      "SELECT * FROM alert_webhooks WHERE village_id = ? AND status = 'active'"
    ).all(alert.village_id) as Record<string, unknown>[];
    const webhooks = rows.map((r) => this.parseRow(r));

    const promises = webhooks
      .filter((wh) => this.matchesEvents(wh, alert.type))
      .map((wh) => this.deliverToWebhook(wh, alert));

    await Promise.allSettled(promises);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Check if webhook is subscribed to alert type (empty events = all) */
  private matchesEvents(wh: AlertWebhook, type: AlertType): boolean {
    if (wh.events.length === 0) return true;
    return wh.events.includes(type);
  }

  /** Deliver to single webhook with timeout + HMAC signing */
  private async deliverToWebhook(wh: WebhookWithSecret, alert: Alert): Promise<void> {
    const payload = JSON.stringify({
      event: 'alert.created',
      timestamp: new Date().toISOString(),
      alert,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // HMAC signing if secret is configured
    if (wh.secret) {
      const signature = await this.computeHmac(wh.secret, payload);
      headers['X-Thyra-Signature'] = `sha256=${signature}`;
    }

    try {
      const response = await fetch(wh.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      const now = new Date().toISOString();
      const status = response.ok ? 'success' : `error:${response.status}`;
      this.db.prepare(
        'UPDATE alert_webhooks SET last_delivery_at = ?, last_delivery_status = ?, updated_at = ? WHERE id = ?'
      ).run(now, status, now, wh.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      const now = new Date().toISOString();
      this.db.prepare(
        'UPDATE alert_webhooks SET last_delivery_at = ?, last_delivery_status = ?, updated_at = ? WHERE id = ?'
      ).run(now, `failed:${message}`, now, wh.id);

      appendAudit(this.db, 'webhook', wh.id, 'delivery_failed', {
        alert_id: alert.id,
        url: wh.url,
        error: message,
      }, 'system');
    }
  }

  /** Compute HMAC-SHA256 signature */
  private async computeHmac(secret: string, payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Parse a DB row into WebhookWithSecret (internal) */
  private parseRow(row: Record<string, unknown>): WebhookWithSecret {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      url: row.url as string,
      events: typeof row.events === 'string' ? JSON.parse(row.events) as AlertType[] : [],
      status: row.status as 'active' | 'disabled',
      last_delivery_at: (row.last_delivery_at as string) ?? null,
      last_delivery_status: (row.last_delivery_status as string) ?? null,
      secret: (row.secret as string) ?? undefined,
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  /** Strip secret from webhook for public API responses */
  private stripSecret(wh: WebhookWithSecret): AlertWebhook {
    const { secret: _secret, ...rest } = wh;
    return rest;
  }
}
