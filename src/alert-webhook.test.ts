import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WebhookDispatcher } from './alert-webhook';
import { VillageManager } from './village-manager';
import type { Alert } from './schemas/alert';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const wd = new WebhookDispatcher(db);
  const village = vm.create({ name: 'Webhook Test Village', target_repo: 'test/repo' }, 'test');
  return { db, wd, village };
}

function makeAlert(villageId: string, overrides?: Partial<Alert>): Alert {
  return {
    id: 'alert_test_1',
    village_id: villageId,
    type: 'budget_warning',
    severity: 'warning',
    status: 'active',
    title: 'Test Alert',
    message: 'Test message',
    details: {},
    occurrence_count: 1,
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_at: null,
    auto_action_taken: null,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WebhookDispatcher Tests
// ---------------------------------------------------------------------------

describe('WebhookDispatcher', () => {
  let wd: WebhookDispatcher;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    wd = s.wd;
    villageId = s.village.id;
  });

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe('register / list / remove', () => {
    it('should register a webhook', () => {
      const wh = wd.register(villageId, 'https://example.com/webhook');
      expect(wh.id).toMatch(/^wh_/);
      expect(wh.village_id).toBe(villageId);
      expect(wh.url).toBe('https://example.com/webhook');
      expect(wh.events).toEqual([]);
      expect(wh.status).toBe('active');
    });

    it('should register with event filters', () => {
      const wh = wd.register(villageId, 'https://example.com/wh', ['budget_warning', 'chief_timeout']);
      expect(wh.events).toEqual(['budget_warning', 'chief_timeout']);
    });

    it('should list webhooks for a village', () => {
      wd.register(villageId, 'https://a.com/wh');
      wd.register(villageId, 'https://b.com/wh');
      const list = wd.list(villageId);
      expect(list).toHaveLength(2);
    });

    it('should not expose secret in list/getById', () => {
      const wh = wd.register(villageId, 'https://a.com/wh', [], 'my-secret');
      // secret should not be in the returned object
      expect((wh as Record<string, unknown>).secret).toBeUndefined();

      const fetched = wd.getById(wh.id);
      expect((fetched as Record<string, unknown> | null)?.secret).toBeUndefined();
    });

    it('should remove a webhook', () => {
      const wh = wd.register(villageId, 'https://a.com/wh');
      wd.remove(wh.id);
      const list = wd.list(villageId);
      expect(list).toHaveLength(0);
    });

    it('should throw on remove nonexistent webhook', () => {
      expect(() => wd.remove('wh_nonexistent')).toThrow('Webhook not found');
    });
  });

  // -----------------------------------------------------------------------
  // Dispatch (no real HTTP — exercises matching logic)
  // -----------------------------------------------------------------------

  describe('dispatch', () => {
    it('should attempt delivery (fails gracefully with invalid URL)', async () => {
      wd.register(villageId, 'http://localhost:19999/nonexistent');
      const alert = makeAlert(villageId);

      // Should not throw — fire-and-forget
      await wd.dispatch(alert);

      // Webhook should have updated delivery status
      const webhooks = wd.list(villageId);
      expect(webhooks[0].last_delivery_status).toMatch(/failed:/);
    });

    it('should filter by event type', async () => {
      // Only subscribed to chief_timeout
      wd.register(villageId, 'http://localhost:19999/wh', ['chief_timeout']);
      const alert = makeAlert(villageId, { type: 'budget_warning' });

      // Should not attempt delivery (type mismatch)
      await wd.dispatch(alert);

      const webhooks = wd.list(villageId);
      // last_delivery_at should remain null (no delivery attempted)
      expect(webhooks[0].last_delivery_at).toBeNull();
    });

    it('should deliver to all-events webhook', async () => {
      wd.register(villageId, 'http://localhost:19999/wh', []); // empty = all
      const alert = makeAlert(villageId, { type: 'anomaly' });

      await wd.dispatch(alert);

      const webhooks = wd.list(villageId);
      // Delivery was attempted (will fail due to no server)
      expect(webhooks[0].last_delivery_at).toBeTruthy();
    });
  });
});
