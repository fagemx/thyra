/**
 * Village Pack Compiler — 5-phase execution engine
 *
 * 執行順序：Village → Constitution → Skills → Chief → Laws
 * 每個 phase 計算 diff 再決定 create/update/supersede/skip。
 * DI pattern：所有 store/engine 由外部注入。
 */
import { randomUUID, createHash } from 'crypto';
import type { VillageManager, Village } from '../village-manager';
import type { ConstitutionStore, Constitution, BudgetLimits } from '../constitution-store';
import type { ChiefEngine, Chief } from '../chief-engine';
import type { LawEngine, Law } from '../law-engine';
import type { SkillRegistry, Skill } from '../skill-registry';
import type { Permission } from '../schemas/constitution';
import type { EvaluatorRule } from '../schemas/evaluator';
import type { SkillBinding } from '../schemas/skill';

// ── Types ────────────────────────────────────────────────────

export interface CompileOptions {
  dry_run: boolean;
  source_path: string;
  compiled_by: string; // 'village-pack:human' | 'village-pack:ci'
}

export interface CompileSession {
  session_id: string;
  pack_fingerprint: string;
  pack_version: string;
  source_path: string;
  compiled_at: string;
  compiled_by: string;
  dry_run: boolean;
}

export type PhaseAction = 'create' | 'update' | 'supersede' | 'skip' | 'resolve' | 'propose' | 'revoke' | 'replace';

export interface PhaseResult {
  action: PhaseAction;
  entity_id?: string;
  detail?: string;
}

export interface LawPhaseEntry {
  category: string;
  action: 'propose' | 'revoke' | 'replace' | 'skip';
  law_id?: string;
  detail?: string;
  error?: string;
}

export interface CompileResult {
  session: CompileSession;
  village: PhaseResult;
  constitution: PhaseResult;
  skills: PhaseResult & { resolved: Array<{ name: string; skill_id: string }> };
  chief: PhaseResult;
  laws: { entries: LawPhaseEntry[] };
  errors: string[];
  warnings: string[];
  completed_phases: number;
}

// ── Internal context ─────────────────────────────────────────

interface CompileContext {
  session: CompileSession;
  errors: string[];
  warnings: string[];
  completed_phases: number;
  aborted: boolean;
  // Accumulated state across phases
  village_id: string;
  constitution: Constitution | null;
  chief: Chief | null;
  resolved_skills: Array<{ name: string; skill: Skill }>;
  // Phase results
  village_result: PhaseResult;
  constitution_result: PhaseResult;
  skills_result: PhaseResult & { resolved: Array<{ name: string; skill_id: string }> };
  chief_result: PhaseResult;
  law_entries: LawPhaseEntry[];
}

// ── Pack shape (input) ───────────────────────────────────────
// VillagePack mirrors the YAML structure. Since #77 (YAML parser) produces
// this shape, we define it inline to avoid depending on a not-yet-landed schema.

export interface PackVillage {
  name: string;
  description: string;
  target_repo: string;
  metadata?: Record<string, unknown>;
}

export interface PackConstitutionRule {
  description: string;
  enforcement: 'hard' | 'soft';
  scope?: string[];
}

export interface PackConstitution {
  allowed_permissions: Permission[];
  budget: {
    max_cost_per_action: number;
    max_cost_per_day: number;
    max_cost_per_loop: number;
    max_cost_per_month?: number;
  };
  rules: PackConstitutionRule[];
  evaluators?: EvaluatorRule[];
}

export interface PackChief {
  name: string;
  role: string;
  permissions: Permission[];
  pipelines?: string[];
  personality?: {
    risk_tolerance?: 'conservative' | 'moderate' | 'aggressive';
    communication_style?: 'concise' | 'detailed' | 'minimal';
    decision_speed?: 'fast' | 'deliberate' | 'cautious';
  };
  constraints?: Array<{
    type: 'must' | 'must_not' | 'prefer' | 'avoid';
    description: string;
  }>;
  skills: string[]; // skill names — resolved in Phase 3
}

export interface PackLaw {
  category: string;
  description: string;
  strategy: Record<string, unknown>;
  evidence: {
    source: string;
    reasoning: string;
  };
}

export interface VillagePack {
  version: string;
  village: PackVillage;
  constitution: PackConstitution;
  chief: PackChief;
  laws: PackLaw[];
}

// ── Diff helpers ─────────────────────────────────────────────

function canonicalConstitutionFingerprint(c: {
  rules: Array<{ description: string; enforcement: string; scope?: string[] }>;
  allowed_permissions: string[];
  budget_limits: BudgetLimits;
}): string {
  const canonical = {
    rules: [...c.rules]
      .sort((a, b) => a.description.localeCompare(b.description))
      .map((r) => ({
        description: r.description,
        enforcement: r.enforcement,
        scope: [...(r.scope ?? ['*'])].sort(),
      })),
    allowed_permissions: [...c.allowed_permissions].sort(),
    budget_limits: c.budget_limits,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

function diffVillage(
  pack: PackVillage,
  current: Village | null,
): 'create' | 'update' | 'skip' {
  if (!current) return 'create';
  if (
    current.name === pack.name &&
    current.description === pack.description &&
    current.target_repo === pack.target_repo
  ) {
    return 'skip';
  }
  return 'update';
}

function diffConstitution(
  pack: PackConstitution,
  current: Constitution | null,
): 'create' | 'supersede' | 'skip' {
  if (!current) return 'create';
  const packFp = canonicalConstitutionFingerprint({
    rules: pack.rules.map((r) => ({
      description: r.description,
      enforcement: r.enforcement,
      scope: r.scope,
    })),
    allowed_permissions: pack.allowed_permissions,
    budget_limits: { ...pack.budget, max_cost_per_month: pack.budget.max_cost_per_month ?? 0 },
  });
  const currentFp = canonicalConstitutionFingerprint({
    rules: current.rules,
    allowed_permissions: current.allowed_permissions,
    budget_limits: current.budget_limits,
  });
  return packFp === currentFp ? 'skip' : 'supersede';
}

function diffChief(
  pack: PackChief,
  current: Chief | null,
  resolvedBindings: SkillBinding[],
): 'create' | 'update' | 'skip' {
  if (!current) return 'create';
  const permsSame =
    JSON.stringify([...pack.permissions].sort()) ===
    JSON.stringify([...current.permissions].sort());
  const nameSame = current.name === pack.name;
  const roleSame = current.role === pack.role;
  const skillsSame =
    JSON.stringify(resolvedBindings.map((b) => b.skill_id).sort()) ===
    JSON.stringify(current.skills.map((b) => b.skill_id).sort());
  const pipelinesSame =
    JSON.stringify([...(pack.pipelines ?? [])].sort()) ===
    JSON.stringify([...current.pipelines].sort());
  if (permsSame && nameSame && roleSame && skillsSame && pipelinesSame) return 'skip';
  return 'update';
}

interface LawDiffResult {
  toPropose: PackLaw[];
  toRevoke: Law[];
  toReplace: Array<{ old: Law; updated: PackLaw }>;
  toSkip: string[];
}

function diffLaws(packLaws: PackLaw[], activeLaws: Law[]): LawDiffResult {
  const activeByCat = new Map<string, Law>();
  for (const law of activeLaws) {
    activeByCat.set(law.category, law);
  }
  const packCats = new Set(packLaws.map((l) => l.category));

  const toPropose: PackLaw[] = [];
  const toRevoke: Law[] = [];
  const toReplace: Array<{ old: Law; updated: PackLaw }> = [];
  const toSkip: string[] = [];

  for (const pl of packLaws) {
    const existing = activeByCat.get(pl.category);
    if (!existing) {
      toPropose.push(pl);
    } else {
      // Compare content
      const contentSame =
        existing.content.description === pl.description &&
        JSON.stringify(existing.content.strategy) === JSON.stringify(pl.strategy);
      if (contentSame) {
        toSkip.push(pl.category);
      } else {
        toReplace.push({ old: existing, updated: pl });
      }
    }
  }

  // Laws in DB but not in YAML → revoke
  for (const [cat, law] of activeByCat) {
    if (!packCats.has(cat)) {
      toRevoke.push(law);
    }
  }

  return { toPropose, toRevoke, toReplace, toSkip };
}

// ── Compiler ─────────────────────────────────────────────────

export class VillagePackCompiler {
  constructor(
    private villageMgr: VillageManager,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
    private lawEngine: LawEngine,
    private skillRegistry: SkillRegistry,
  ) {}

  compile(pack: VillagePack, opts: CompileOptions): CompileResult {
    const ctx = this.initContext(pack, opts);
    const actor = `village-pack:human:${ctx.session.session_id}`;

    // Phase 1: Village
    this.compileVillage(ctx, pack.village, actor, opts.dry_run);

    // Phase 2: Constitution
    if (!ctx.aborted) {
      this.compileConstitution(ctx, pack.constitution, actor, opts.dry_run);
    }

    // Phase 3: Skills
    if (!ctx.aborted) {
      this.compileSkills(ctx, pack.chief.skills);
    }

    // Phase 4: Chief
    if (!ctx.aborted) {
      this.compileChief(ctx, pack.chief, actor, opts.dry_run);
    }

    // Phase 5: Laws
    if (!ctx.aborted) {
      this.compileLaws(ctx, pack.laws, actor, opts.dry_run);
    }

    return this.buildResult(ctx);
  }

  // ── Phase 1: Village ───────────────────────────────────────

  private compileVillage(
    ctx: CompileContext,
    pack: PackVillage,
    actor: string,
    dryRun: boolean,
  ): void {
    // Find existing village by name
    const all = this.villageMgr.list();
    const existing = all.find((v) => v.name === pack.name && v.status !== 'archived') ?? null;
    const action = diffVillage(pack, existing);

    if (action === 'create') {
      if (dryRun) {
        ctx.village_result = { action: 'create', detail: `would create village "${pack.name}"` };
      } else {
        const v = this.villageMgr.create(
          { name: pack.name, description: pack.description, target_repo: pack.target_repo, metadata: pack.metadata ?? {} },
          actor,
        );
        ctx.village_id = v.id;
        ctx.village_result = { action: 'create', entity_id: v.id };
      }
    } else if (action === 'update') {
      if (!existing) throw new Error('Expected existing village for update');
      if (dryRun) {
        ctx.village_result = { action: 'update', entity_id: existing.id, detail: `would update village "${pack.name}"` };
      } else {
        const v = this.villageMgr.update(
          existing.id,
          { description: pack.description, target_repo: pack.target_repo, metadata: pack.metadata },
          actor,
        );
        ctx.village_id = v.id;
        ctx.village_result = { action: 'update', entity_id: v.id };
      }
    } else {
      if (!existing) throw new Error('Expected existing village for skip');
      ctx.village_id = existing.id;
      ctx.village_result = { action: 'skip', entity_id: existing.id };
    }

    ctx.completed_phases = 1;
  }

  // ── Phase 2: Constitution ──────────────────────────────────

  private compileConstitution(
    ctx: CompileContext,
    pack: PackConstitution,
    actor: string,
    dryRun: boolean,
  ): void {
    // In dry-run with no village_id, we can still diff
    const villageId = ctx.village_id;
    const current = dryRun && !villageId ? null : this.constitutionStore.getActive(villageId);
    const action = diffConstitution(pack, current);

    const inputRaw = {
      rules: pack.rules.map((r) => ({
        description: r.description,
        enforcement: r.enforcement,
        scope: r.scope ?? ['*'],
      })),
      allowed_permissions: pack.allowed_permissions,
      budget_limits: { ...pack.budget, max_cost_per_month: pack.budget.max_cost_per_month ?? 0 },
    };

    if (action === 'create') {
      if (dryRun) {
        ctx.constitution_result = { action: 'create', detail: 'would create constitution' };
      } else {
        const c = this.constitutionStore.create(villageId, inputRaw, actor);
        ctx.constitution = c;
        ctx.constitution_result = { action: 'create', entity_id: c.id };
      }
    } else if (action === 'supersede') {
      if (!current) throw new Error('Expected current constitution for supersede');
      if (dryRun) {
        ctx.constitution_result = { action: 'supersede', entity_id: current.id, detail: 'would supersede constitution' };
      } else {
        const c = this.constitutionStore.supersede(current.id, inputRaw, actor);
        ctx.constitution = c;
        ctx.constitution_result = { action: 'supersede', entity_id: c.id };
      }
    } else {
      if (!current) throw new Error('Expected current constitution for skip');
      ctx.constitution = current;
      ctx.constitution_result = { action: 'skip', entity_id: current.id };
    }

    ctx.completed_phases = 2;
  }

  // ── Phase 3: Skills ────────────────────────────────────────

  private compileSkills(ctx: CompileContext, skillNames: string[]): void {
    const resolved: Array<{ name: string; skill: Skill }> = [];

    for (const name of skillNames) {
      const skill = this.skillRegistry.resolveForIntent(name, ctx.village_id);
      if (!skill) {
        ctx.errors.push(`Skill "${name}" not found or not verified — aborting`);
        ctx.aborted = true;
        ctx.skills_result = {
          action: 'resolve',
          resolved: resolved.map((r) => ({ name: r.name, skill_id: r.skill.id })),
          detail: `failed to resolve skill "${name}"`,
        };
        return;
      }
      resolved.push({ name, skill });
    }

    ctx.resolved_skills = resolved;
    ctx.skills_result = {
      action: 'resolve',
      resolved: resolved.map((r) => ({ name: r.name, skill_id: r.skill.id })),
      detail: `resolved ${resolved.length} skill(s)`,
    };
    ctx.completed_phases = 3;
  }

  // ── Phase 4: Chief ─────────────────────────────────────────

  private validateChiefPermissions(ctx: CompileContext, pack: PackChief, dryRun: boolean): boolean {
    const constitution = ctx.constitution ?? this.constitutionStore.getActive(ctx.village_id);
    if (!constitution && !dryRun) {
      ctx.errors.push('No active constitution for chief validation — aborting');
      ctx.aborted = true;
      return false;
    }
    if (constitution) {
      for (const perm of pack.permissions) {
        if (!constitution.allowed_permissions.includes(perm)) {
          ctx.errors.push(
            `PERMISSION_EXCEEDS_CONSTITUTION: "${perm}" not in constitution's allowed_permissions — aborting`,
          );
          ctx.aborted = true;
          ctx.chief_result = { action: 'skip', detail: `permission violation: ${perm}` };
          return false;
        }
      }
    }
    return true;
  }

  private compileChief(
    ctx: CompileContext,
    pack: PackChief,
    actor: string,
    dryRun: boolean,
  ): void {
    if (!this.validateChiefPermissions(ctx, pack, dryRun)) return;

    // Build skill bindings from resolved skills
    const bindings: SkillBinding[] = ctx.resolved_skills.map((r) => ({
      skill_id: r.skill.id,
      skill_version: r.skill.version,
    }));

    const chiefs = dryRun && !ctx.village_id
      ? []
      : this.chiefEngine.list(ctx.village_id, { status: 'active' });
    const current = (chiefs[0] as Chief | undefined) ?? null;
    const action = diffChief(pack, current, bindings);

    if (action === 'create') {
      const input = {
        name: pack.name,
        role: pack.role,
        permissions: pack.permissions,
        pipelines: pack.pipelines ?? [],
        personality: pack.personality ?? {},
        constraints: pack.constraints ?? [],
        skills: bindings,
      };
      if (dryRun) {
        ctx.chief_result = { action: 'create', detail: `would create chief "${pack.name}"` };
      } else {
        const c = this.chiefEngine.create(ctx.village_id, input, actor);
        ctx.chief = c;
        ctx.chief_result = { action: 'create', entity_id: c.id };
      }
    } else if (action === 'update') {
      if (!current) throw new Error('Expected current chief for update');
      const input = {
        name: pack.name,
        role: pack.role,
        permissions: pack.permissions,
        pipelines: pack.pipelines ?? [],
        personality: pack.personality ? {
          risk_tolerance: pack.personality.risk_tolerance ?? 'moderate',
          communication_style: pack.personality.communication_style ?? 'concise',
          decision_speed: pack.personality.decision_speed ?? 'deliberate',
        } : undefined,
        constraints: pack.constraints,
        skills: bindings,
      };
      if (dryRun) {
        ctx.chief_result = { action: 'update', entity_id: current.id, detail: `would update chief "${pack.name}"` };
      } else {
        const c = this.chiefEngine.update(current.id, input, actor);
        ctx.chief = c;
        ctx.chief_result = { action: 'update', entity_id: c.id };
      }
    } else {
      if (!current) throw new Error('Expected current chief for skip');
      ctx.chief = current;
      ctx.chief_result = { action: 'skip', entity_id: current.id };
    }

    ctx.completed_phases = 4;
  }

  // ── Phase 5: Laws ──────────────────────────────────────────

  private compileLaws(
    ctx: CompileContext,
    packLaws: PackLaw[],
    actor: string,
    dryRun: boolean,
  ): void {
    const chiefId: string | undefined = ctx.chief?.id;
    if (!dryRun && !chiefId) {
      ctx.errors.push('No chief available for law proposals — aborting');
      ctx.aborted = true;
      return;
    }

    const activeLaws = dryRun && !ctx.village_id
      ? []
      : this.lawEngine.getActiveLaws(ctx.village_id);
    const diff = diffLaws(packLaws, activeLaws);
    const entries: LawPhaseEntry[] = [];

    // Skip entries
    for (const cat of diff.toSkip) {
      entries.push({ category: cat, action: 'skip' });
    }

    const resolvedChiefId = chiefId ?? 'dry-run-chief';

    // Propose new
    this.compileLawsPropose(ctx, diff.toPropose, resolvedChiefId, dryRun, entries);

    // Revoke removed
    this.compileLawsRevoke(ctx, diff.toRevoke, actor, dryRun, entries);

    // Replace changed
    this.compileLawsReplace(ctx, diff.toReplace, resolvedChiefId, actor, dryRun, entries);

    ctx.law_entries = entries;
    ctx.completed_phases = 5;
  }

  /** 處理 law propose 操作 */
  private compileLawsPropose(
    ctx: CompileContext,
    toPropose: PackLaw[],
    chiefId: string,
    dryRun: boolean,
    entries: LawPhaseEntry[],
  ): void {
    for (const pl of toPropose) {
      if (dryRun) {
        entries.push({ category: pl.category, action: 'propose', detail: `would propose law "${pl.category}"` });
        continue;
      }
      try {
        const law = this.lawEngine.propose(ctx.village_id, chiefId, {
          category: pl.category,
          content: { description: pl.description, strategy: pl.strategy },
          evidence: pl.evidence,
        });
        entries.push({ category: pl.category, action: 'propose', law_id: law.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entries.push({ category: pl.category, action: 'propose', error: msg });
        ctx.errors.push(`Law propose failed (${pl.category}): ${msg}`);
      }
    }
  }

  /** 處理 law revoke 操作 */
  private compileLawsRevoke(
    ctx: CompileContext,
    toRevoke: Law[],
    actor: string,
    dryRun: boolean,
    entries: LawPhaseEntry[],
  ): void {
    for (const law of toRevoke) {
      if (dryRun) {
        entries.push({ category: law.category, action: 'revoke', law_id: law.id, detail: `would revoke law "${law.category}"` });
        continue;
      }
      try {
        this.lawEngine.revoke(law.id, actor);
        entries.push({ category: law.category, action: 'revoke', law_id: law.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entries.push({ category: law.category, action: 'revoke', error: msg });
        ctx.warnings.push(`Law revoke warning (${law.category}): ${msg}`);
      }
    }
  }

  /** 處理 law replace 操作（revoke old + propose new） */
  private compileLawsReplace(
    ctx: CompileContext,
    toReplace: Array<{ old: Law; updated: PackLaw }>,
    chiefId: string,
    actor: string,
    dryRun: boolean,
    entries: LawPhaseEntry[],
  ): void {
    for (const { old: oldLaw, updated: pl } of toReplace) {
      if (dryRun) {
        entries.push({ category: pl.category, action: 'replace', law_id: oldLaw.id, detail: `would replace law "${pl.category}"` });
        continue;
      }
      try {
        this.lawEngine.revoke(oldLaw.id, actor);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entries.push({ category: pl.category, action: 'replace', error: `revoke failed: ${msg}` });
        ctx.errors.push(`Law replace revoke failed (${pl.category}): ${msg}`);
        continue;
      }
      try {
        const law = this.lawEngine.propose(ctx.village_id, chiefId, {
          category: pl.category,
          content: { description: pl.description, strategy: pl.strategy },
          evidence: pl.evidence,
        });
        entries.push({ category: pl.category, action: 'replace', law_id: law.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entries.push({ category: pl.category, action: 'replace', error: `propose failed: ${msg}` });
        ctx.errors.push(`Law replace propose failed (${pl.category}): ${msg}`);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private initContext(pack: VillagePack, opts: CompileOptions): CompileContext {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(pack))
      .digest('hex')
      .slice(0, 16);

    return {
      session: {
        session_id: `pack-${randomUUID()}`,
        pack_fingerprint: fingerprint,
        pack_version: pack.version,
        source_path: opts.source_path,
        compiled_at: new Date().toISOString(),
        compiled_by: opts.compiled_by,
        dry_run: opts.dry_run,
      },
      errors: [],
      warnings: [],
      completed_phases: 0,
      aborted: false,
      village_id: '',
      constitution: null,
      chief: null,
      resolved_skills: [],
      village_result: { action: 'skip' },
      constitution_result: { action: 'skip' },
      skills_result: { action: 'resolve', resolved: [] },
      chief_result: { action: 'skip' },
      law_entries: [],
    };
  }

  private buildResult(ctx: CompileContext): CompileResult {
    return {
      session: ctx.session,
      village: ctx.village_result,
      constitution: ctx.constitution_result,
      skills: ctx.skills_result,
      chief: ctx.chief_result,
      laws: { entries: ctx.law_entries },
      errors: ctx.errors,
      warnings: ctx.warnings,
      completed_phases: ctx.completed_phases,
    };
  }
}
