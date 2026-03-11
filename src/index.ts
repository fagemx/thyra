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
import { loopRoutes } from './routes/loops';
import { KarviBridge } from './karvi-bridge';
import { EddaBridge } from './edda-bridge';
import { bridgeRoutes } from './routes/bridges';
import { TerritoryCoordinator } from './territory';
import { territoryRoutes } from './routes/territories';

const app = new Hono();

const db = createDb();
initSchema(db);
const villageMgr = new VillageManager(db);
const skillRegistry = new SkillRegistry(db);
const constitutionStore = new ConstitutionStore(db);
const riskAssessor = new RiskAssessor(db);
const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
const loopRunner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, riskAssessor);
const karviBridge = new KarviBridge(db, process.env.KARVI_URL ?? 'http://localhost:3461');
const eddaBridge = new EddaBridge(db, process.env.EDDA_URL ?? 'http://localhost:3463');
const territoryCoordinator = new TerritoryCoordinator(db, constitutionStore, skillRegistry);

app.get('/api/health', (c) => {
  return c.json({ ok: true, version: '0.1.0' });
});

app.route('', villageRoutes(villageMgr));
app.route('', skillRoutes(skillRegistry));
app.route('', constitutionRoutes(constitutionStore));
app.route('', assessRoutes(riskAssessor, constitutionStore));
app.route('', chiefRoutes(chiefEngine, skillRegistry));
app.route('', lawRoutes(lawEngine));
app.route('', loopRoutes(loopRunner));
app.route('', bridgeRoutes(karviBridge, eddaBridge));
app.route('', territoryRoutes(territoryCoordinator));

const PORT = Number(process.env.THYRA_PORT ?? 3462);

console.log(`[thyra] starting on :${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
