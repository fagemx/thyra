/**
 * E2E Smoke Test — Three-Repo Governance Cycle
 *
 * 前提：三個 server 必須先手動啟動
 *   - Thyra  :3462  (bun run src/index.ts)
 *   - Karvi  :3461  (node server/server.js)
 *   - Edda   :3463  (edda serve --port 3463)
 *
 * 執行：bun run tests/e2e/smoke.ts
 */

const THYRA = 'http://localhost:3462';
const KARVI = 'http://localhost:3461';
const EDDA = 'http://localhost:3463';

let passed = 0;
let failed = 0;
const results: Array<{ step: string; ok: boolean; detail?: string }> = [];

function log(step: string, ok: boolean, detail?: string) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} Step: ${step}${detail ? ` — ${detail}` : ''}`);
  results.push({ step, ok, detail });
  if (ok) passed++;
  else failed++;
}

async function json(url: string, opts?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: { code: 'NOT_JSON', message: text.slice(0, 200) }, _status: res.status };
  }
}

// ────────── Main ──────────

async function main() {
  console.log('\n🔬 Thyra E2E Smoke Test — Three-Repo Governance Cycle\n');
  console.log(`  Thyra: ${THYRA}`);
  console.log(`  Karvi: ${KARVI}`);
  console.log(`  Edda:  ${EDDA}`);
  console.log('');

  // ── Step 1: Health checks ──
  try {
    const thyra = await json(`${THYRA}/api/health`);
    log('1a. Thyra health', thyra.ok === true);
  } catch {
    log('1a. Thyra health', false, 'Thyra unreachable — is it running on :3462?');
    console.log('\n⛔ Cannot proceed without Thyra. Exiting.\n');
    process.exit(1);
  }

  try {
    const karvi = await json(`${KARVI}/api/health/preflight`);
    log('1b. Karvi health', karvi.ready === true);
  } catch {
    log('1b. Karvi health', false, 'Karvi unreachable — is it running on :3461?');
  }

  try {
    const edda = await json(`${EDDA}/api/health`);
    log('1c. Edda health', edda.ok === true);
  } catch {
    log('1c. Edda health', false, 'Edda unreachable — is it running on :3463?');
  }

  // ── Step 2: Create Village ──
  const village = await json(`${THYRA}/api/villages`, {
    method: 'POST',
    body: JSON.stringify({
      name: `e2e-smoke-${Date.now()}`,
      target_repo: 'fagemx/thyra',
      description: 'E2E smoke test village',
    }),
  });
  const villageOk = village.ok === true;
  const villageData = village.data as Record<string, unknown> | undefined;
  const villageId = villageData?.id as string | undefined;
  log('2. Create Village', villageOk && !!villageId, `id=${villageId}`);

  if (!villageId) {
    console.log('\n⛔ Cannot proceed without Village. Exiting.\n');
    process.exit(1);
  }

  // ── Step 3: Create Constitution ──
  const constitution = await json(`${THYRA}/api/villages/${villageId}/constitutions`, {
    method: 'POST',
    body: JSON.stringify({
      created_by: 'e2e-test',
      rules: [
        {
          id: 'rule-review',
          description: 'PR must have at least one review',
          enforcement: 'hard',
          scope: ['*'],
        },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'query_edda'],
      budget_limits: {
        max_cost_per_action: 10,
        max_cost_per_day: 100,
        max_cost_per_loop: 50,
      },
    }),
  });
  const constOk = constitution.ok === true;
  const constData = constitution.data as Record<string, unknown> | undefined;
  const constId = constData?.id as string | undefined;
  log('3. Create Constitution', constOk && !!constId, `id=${constId}`);

  // ── Step 4: Create Chief ──
  let chiefId: string | undefined;
  if (constId) {
    const chief = await json(`${THYRA}/api/villages/${villageId}/chiefs`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Reviewer',
        role: 'reviewer',
        permissions: ['query_edda'],
        personality: {
          risk_tolerance: 'conservative',
          communication_style: 'concise',
          decision_speed: 'deliberate',
        },
        constraints: [
          { type: 'must', description: 'Review all PRs before merge' },
        ],
        skills: [],
      }),
    });
    const chiefOk = chief.ok === true;
    const chiefData = chief.data as Record<string, unknown> | undefined;
    chiefId = chiefData?.id as string | undefined;
    log('4. Create Chief', chiefOk && !!chiefId, `id=${chiefId}`);
  } else {
    log('4. Create Chief', false, 'Skipped — no Constitution');
  }

  // ── Step 5: Check Karvi bridge status ──
  const karviStatus = await json(`${THYRA}/api/bridges/karvi/status`);
  const karviHealthy = (karviStatus.data as Record<string, unknown>)?.ok === true;
  log('5. Karvi bridge status', karviHealthy);

  // ── Step 6: Dispatch task to Karvi ──
  let dispatchOk = false;
  let taskId: string | undefined;
  if (karviHealthy) {
    const dispatch = await json(`${THYRA}/api/bridges/karvi/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        title: `E2E-smoke-${Date.now()}`,
        tasks: [
          {
            id: `THYRA-${villageId}-001`,
            title: 'E2E smoke test task',
            description: 'Automated smoke test — no real work needed',
          },
        ],
      }),
    });
    dispatchOk = dispatch.ok === true;
    const dispatchData = dispatch.data as Record<string, unknown> | undefined;
    const project = dispatchData?.project as Record<string, unknown> | undefined;
    const taskIds = project?.taskIds as string[] | undefined;
    taskId = taskIds?.[0];
    log('6. Dispatch task to Karvi', dispatchOk, `taskId=${taskId}`);
  } else {
    log('6. Dispatch task to Karvi', false, 'Skipped — Karvi offline');
  }

  // ── Step 7: Simulate Karvi webhook event ──
  // Karvi 的真實 step 可能不會立刻完成，所以我們直接模擬一個 webhook POST
  const eventId = `evt_e2e_${Date.now()}`;
  const webhookPayload = {
    version: 'karvi.event.v1',
    event_id: eventId,
    event_type: 'step_completed',
    occurred_at: new Date().toISOString(),
    taskId: taskId ?? `THYRA-${villageId}-001`,
    stepId: 'step-e2e-001',
    stepType: 'review',
    state: 'succeeded',
  };
  const webhook = await json(`${THYRA}/api/webhooks/karvi`, {
    method: 'POST',
    body: JSON.stringify(webhookPayload),
  });
  const webhookOk = webhook.ok === true;
  const webhookData = webhook.data as Record<string, unknown> | undefined;
  log('7. Webhook event ingested', webhookOk && webhookData?.event_id === eventId);

  // ── Step 7b: Duplicate webhook (idempotency check) ──
  const webhookDup = await json(`${THYRA}/api/webhooks/karvi`, {
    method: 'POST',
    body: JSON.stringify(webhookPayload),
  });
  const dupData = webhookDup.data as Record<string, unknown> | undefined;
  log('7b. Webhook idempotency', dupData?.duplicate === true);

  // ── Step 8: Record decision to Edda ──
  const decide = await json(`${THYRA}/api/bridges/edda/decide`, {
    method: 'POST',
    body: JSON.stringify({
      domain: villageId,
      aspect: 'review_policy',
      value: '1 reviewer required',
      reason: 'E2E smoke test decision',
    }),
  });
  const decideOk = decide.ok === true;
  const decideData = decide.data as Record<string, unknown> | undefined;
  const eddaEventId = decideData?.event_id as string | undefined;
  log('8. Record decision to Edda', decideOk && !!eddaEventId, `event_id=${eddaEventId}`);

  // ── Step 9: Query Edda for the decision ──
  const eddaQuery = await json(`${THYRA}/api/bridges/edda/query`, {
    method: 'POST',
    body: JSON.stringify({ domain: villageId }),
  });
  const queryOk = eddaQuery.ok === true;
  const queryData = eddaQuery.data as Record<string, unknown> | undefined;
  const decisions = queryData?.decisions as Array<Record<string, unknown>> | undefined;
  const found = decisions?.some((d) => d.key === `${villageId}.review_policy`);
  log('9. Query Edda decision', queryOk && !!found, `found=${found}, count=${decisions?.length}`);

  // ── Step 10: Query audit_log for complete trail ──
  // 注意：audit route 可能尚未部署（需要 PR #21 合併），此步驟允許 graceful skip
  const audit = await json(`${THYRA}/api/villages/${villageId}/audit`);
  const auditOk = audit.ok === true;
  if (auditOk) {
    const auditData = audit.data as Record<string, unknown> | undefined;
    const auditTotal = auditData?.total as number | undefined;
    log('10. Audit trail', (auditTotal ?? 0) > 0, `total=${auditTotal}`);
  } else {
    const status = (audit as Record<string, unknown>)._status;
    log('10. Audit trail', false, status === 404 ? 'Route not deployed yet (PR #21 pending)' : 'Query failed');
  }

  // ── Step 11: Check Karvi events in audit ──
  const karviEvents = await json(`${THYRA}/api/bridges/karvi/events?limit=5`);
  const karviEventsData = karviEvents.data as Array<Record<string, unknown>> | undefined;
  const hasWebhookEvent = karviEventsData?.some((e) => e.event_id === eventId);
  log('11. Karvi events in audit', !!hasWebhookEvent);

  // ── Step 12: Graceful degradation — Edda query with bad domain ──
  const eddaBadQuery = await json(`${THYRA}/api/bridges/edda/query`, {
    method: 'POST',
    body: JSON.stringify({ domain: 'nonexistent-village-xyz' }),
  });
  const badQueryOk = eddaBadQuery.ok === true;
  const badQueryData = eddaBadQuery.data as Record<string, unknown> | undefined;
  const badDecisions = badQueryData?.decisions as unknown[] | undefined;
  log('12. Edda query (empty domain)', badQueryOk && (badDecisions?.length ?? 0) === 0);

  // ── Summary ──
  console.log('\n' + '═'.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));

  if (failed > 0) {
    console.log('\n❌ Failed steps:');
    for (const r of results) {
      if (!r.ok) console.log(`   - ${r.step}${r.detail ? `: ${r.detail}` : ''}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('💥 Unexpected error:', e);
  process.exit(2);
});
