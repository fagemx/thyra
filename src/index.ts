import { Hono } from 'hono';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { villageRoutes } from './routes/villages';
import { SkillRegistry } from './skill-registry';
import { skillRoutes } from './routes/skills';
import { ConstitutionStore } from './constitution-store';
import { constitutionRoutes } from './routes/constitutions';
import { RiskAssessor } from './risk-assessor';
import { assessRoutes } from './routes/assess';
import { ChiefEngine } from './chief-engine';
import { chiefRoutes } from './routes/chiefs';
import { LawEngine } from './law-engine';
import { lawRoutes } from './routes/laws';
import { LoopRunner } from './loop-runner';
import { DecisionEngine } from './decision-engine';
import { loopRoutes } from './routes/loops';
import { KarviBridge } from './karvi-bridge';
import { EddaBridge } from './edda-bridge';
import { bridgeRoutes } from './routes/bridges';
import { TerritoryCoordinator } from './territory';
import { territoryRoutes } from './routes/territories';
import { AuditQuery } from './audit-query';
import { auditRoutes } from './routes/audit';
import { proposalRoutes } from './routes/proposals';
import { governanceRoutes } from './routes/governance';
import { packRoutes } from './routes/pack';
import { WorldManager } from './world-manager';
import { PipelineReactor } from './pipeline-reactor';
import { worldRoutes } from './routes/world';
import { GoalStore } from './goal-store';
import { goalRoutes } from './routes/goals';
import { ZoneManager } from './market/zones';
import { StallManager } from './market/stalls';
import { SlotManager } from './market/slots';
import { marketRoutes } from './routes/market';
import { telemetryRoutes } from './routes/telemetry';
import { AlertManager } from './alert-manager';
import { WebhookDispatcher } from './alert-webhook';
import { alertRoutes } from './routes/alerts';
import { schedulerRoutes } from './routes/scheduler';
import { promotionRoutes } from './promotion/routes/promotion';
import { rollbackRoutes } from './promotion/routes/rollback';
import { createInMemoryStore } from './promotion/rollback-engine';
import { cycleRoutes } from './routes/cycles';
import { observationRoutes } from './routes/observations';
import { canonicalProposalRoutes } from './routes/canonical-proposals';
import { outcomeRoutes } from './routes/outcomes';
import { precedentRoutes } from './routes/precedents';
import { pulseRoutes } from './routes/pulse';
import { governanceAdjustmentRoutes } from './routes/governance-adjustments';

const app = new Hono();

app.onError((err, c) => {
  return c.json(
    { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
    500,
  );
});

const db = createDb();
initSchema(db);
const villageMgr = new VillageManager(db);
const skillRegistry = new SkillRegistry(db);
const karviBridge = new KarviBridge(db, process.env.KARVI_URL ?? 'http://localhost:3461');
const eddaBridge = new EddaBridge(db, process.env.EDDA_URL ?? 'http://localhost:3463');
const constitutionStore = new ConstitutionStore(db, karviBridge);
const riskAssessor = new RiskAssessor(db);
const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
const lawEngine = new LawEngine(db, constitutionStore, chiefEngine, eddaBridge);
const decisionEngine = new DecisionEngine(db, constitutionStore, chiefEngine, lawEngine, skillRegistry, riskAssessor, eddaBridge);
const loopRunner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, riskAssessor, eddaBridge, skillRegistry, decisionEngine);
const territoryCoordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);
const worldManager = new WorldManager(db, eddaBridge, karviBridge);
const pipelineReactor = new PipelineReactor(worldManager, db);
const goalStore = new GoalStore(db);
const zoneManager = new ZoneManager(db);
const stallManager = new StallManager(db);
const slotManager = new SlotManager(db);
const alertManager = new AlertManager(db);
const webhookDispatcher = new WebhookDispatcher(db);
const auditQuery = new AuditQuery(db);

app.get('/api/health', (c) => {
  return c.json({ ok: true, version: '0.1.0' });
});

app.route('', villageRoutes(villageMgr, db));
app.route('', skillRoutes(skillRegistry));
app.route('', constitutionRoutes(constitutionStore));
app.route('', assessRoutes(riskAssessor, constitutionStore));
app.route('', chiefRoutes(chiefEngine, skillRegistry, { riskAssessor, karviBridge, db }));
app.route('', lawRoutes(lawEngine));
app.route('', loopRoutes(loopRunner));
app.route('', bridgeRoutes(karviBridge, eddaBridge, pipelineReactor));
app.route('', territoryRoutes(territoryCoordinator));
app.route('', auditRoutes(auditQuery));
app.route('', proposalRoutes(db));
app.route('', governanceRoutes({
  db,
  villageMgr,
  constitutionStore,
  chiefEngine,
  lawEngine,
  riskAssessor,
}));
app.route('', worldRoutes(worldManager, db));
app.route('', goalRoutes(goalStore));
app.route('', marketRoutes({ db, zoneManager, stallManager, slotManager }));
app.route('', telemetryRoutes(db));
app.route('', alertRoutes(alertManager, webhookDispatcher));
app.route('', schedulerRoutes({ db }));
app.route('', promotionRoutes());
app.route('', rollbackRoutes({ store: createInMemoryStore() }));
app.route('', cycleRoutes(db));
app.route('', observationRoutes(db));
app.route('', canonicalProposalRoutes(db));
app.route('', outcomeRoutes(db));
app.route('', precedentRoutes(db));
app.route('', pulseRoutes(db));
app.route('', governanceAdjustmentRoutes(db));
app.route('', packRoutes({
  db,
  villageMgr,
  constitutionStore,
  chiefEngine,
  lawEngine,
  skillRegistry,
}));

const PORT = Number(process.env.THYRA_PORT ?? 3462);

// Webhook URL: 從環境變數讀取或自動組裝
const THYRA_WEBHOOK_URL = process.env.THYRA_WEBHOOK_URL
  ?? `http://localhost:${PORT}/api/webhooks/karvi`;

// 啟動時註冊 webhook URL（async，不 block 啟動）
void karviBridge.registerWebhookUrl(THYRA_WEBHOOK_URL).then((ok) => {
  if (ok) console.log(`[thyra] webhook registered on karvi: ${THYRA_WEBHOOK_URL}`);
  else console.warn('[thyra] failed to register webhook on karvi (will retry via health monitor)');
});

// 啟動 health monitor（含自動 re-registration）
karviBridge.startMonitor();
eddaBridge.startMonitor();

console.log(`[thyra] starting on :${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
