import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { GoalStore } from './goal-store';
import type { Goal } from './goal-store';

function setupDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

function createVillage(db: Database, id = 'v1'): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'Test Village', '', 'repo', 'active', '{}', 1, now, now);
}

function createConstitution(db: Database, villageId = 'v1'): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO constitutions (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('const-1', villageId, 1, 'active', now, 'human', '[]', '["dispatch_task"]', '{}');
}

function createChief(db: Database, villageId = 'v1', chiefId = 'chief-1'): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO chiefs (id, village_id, name, role, version, status, skills, pipelines, permissions, personality, constraints, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(chiefId, villageId, 'Test Chief', 'economy', 1, 'active', '[]', '[]', '["dispatch_task"]', '{}', '[]', now, now);
}

describe('GoalStore', () => {
  let db: Database;
  let store: GoalStore;

  beforeEach(() => {
    db = setupDb();
    store = new GoalStore(db);
    createVillage(db);
  });

  describe('create', () => {
    it('creates a goal with minimal input', () => {
      const goal = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'Become the best market',
      }, 'human');

      expect(goal.id).toMatch(/^goal-/);
      expect(goal.village_id).toBe('v1');
      expect(goal.level).toBe('world');
      expect(goal.title).toBe('Become the best market');
      expect(goal.status).toBe('planned');
      expect(goal.metrics).toEqual([]);
      expect(goal.version).toBe(1);
    });

    it('creates a goal with metrics', () => {
      const goal = store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Achieve 80% occupancy',
        metrics: [{ name: 'occupancy_rate', target: 80, unit: '%' }],
      }, 'human');

      expect(goal.metrics).toHaveLength(1);
      expect(goal.metrics[0].name).toBe('occupancy_rate');
      expect(goal.metrics[0].target).toBe(80);
    });

    it('creates a goal with owner_chief_id', () => {
      createConstitution(db);
      createChief(db);

      const goal = store.create('v1', {
        village_id: 'v1',
        level: 'chief',
        title: 'Maintain fair prices',
        owner_chief_id: 'chief-1',
      }, 'human');

      expect(goal.owner_chief_id).toBe('chief-1');
    });

    it('rejects owner_chief_id for world level', () => {
      createConstitution(db);
      createChief(db);

      expect(() => store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'Bad goal',
        owner_chief_id: 'chief-1',
      }, 'human')).toThrow('VALIDATION: owner_chief_id only valid for level "chief" or "task"');
    });

    it('rejects village_id mismatch', () => {
      expect(() => store.create('v1', {
        village_id: 'v2',
        level: 'world',
        title: 'Bad goal',
      }, 'human')).toThrow('VALIDATION: village_id in body must match route parameter');
    });
  });

  describe('parent validation', () => {
    it('creates child with valid parent', () => {
      const parent = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'World goal',
      }, 'human');

      const child = store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Team goal',
        parent_id: parent.id,
      }, 'human');

      expect(child.parent_id).toBe(parent.id);
    });

    it('rejects non-existent parent', () => {
      expect(() => store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Bad child',
        parent_id: 'goal-nonexistent',
      }, 'human')).toThrow('PARENT_NOT_FOUND');
    });

    it('rejects cross-village parent', () => {
      createVillage(db, 'v2');
      const parentInV2 = store.create('v2', {
        village_id: 'v2',
        level: 'world',
        title: 'Other village goal',
      }, 'human');

      expect(() => store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Bad child',
        parent_id: parentInV2.id,
      }, 'human')).toThrow('CROSS_VILLAGE');
    });

    it('rejects wrong level order (parent must be higher)', () => {
      const teamGoal = store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Team goal',
      }, 'human');

      expect(() => store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'World under team?',
        parent_id: teamGoal.id,
      }, 'human')).toThrow('LEVEL_ORDER');
    });

    it('rejects same-level parent', () => {
      const peer = store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Team A',
      }, 'human');

      expect(() => store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Team B under Team A?',
        parent_id: peer.id,
      }, 'human')).toThrow('LEVEL_ORDER');
    });
  });

  describe('get / update', () => {
    it('gets a goal by id', () => {
      const created = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'My goal',
      }, 'human');

      const got = store.get(created.id);
      expect(got).toBeTruthy();
      expect(got?.title).toBe('My goal');
    });

    it('returns null for non-existent goal', () => {
      expect(store.get('goal-nope')).toBeNull();
    });

    it('updates a goal', () => {
      const goal = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'Original',
      }, 'human');

      const updated = store.update(goal.id, {
        title: 'Updated',
        status: 'active',
        metrics: [{ name: 'visitors', target: 1000, current: 500, unit: 'people' }],
      }, 'human');

      expect(updated.title).toBe('Updated');
      expect(updated.status).toBe('active');
      expect(updated.metrics).toHaveLength(1);
      expect(updated.version).toBe(2);
    });

    it('rejects update on non-existent goal', () => {
      expect(() => store.update('goal-nope', { title: 'Nope' }, 'human')).toThrow('Goal not found');
    });

    it('increments version on update', () => {
      const goal = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'Goal',
      }, 'human');

      const v2 = store.update(goal.id, { title: 'V2' }, 'human');
      expect(v2.version).toBe(2);

      const v3 = store.update(goal.id, { title: 'V3' }, 'human');
      expect(v3.version).toBe(3);
    });
  });

  describe('list', () => {
    it('lists goals for a village', () => {
      store.create('v1', { village_id: 'v1', level: 'world', title: 'G1' }, 'human');
      store.create('v1', { village_id: 'v1', level: 'team', title: 'G2' }, 'human');

      const goals = store.list('v1');
      expect(goals).toHaveLength(2);
    });

    it('filters by status', () => {
      const g = store.create('v1', { village_id: 'v1', level: 'world', title: 'G1' }, 'human');
      store.update(g.id, { status: 'active' }, 'human');
      store.create('v1', { village_id: 'v1', level: 'team', title: 'G2' }, 'human');

      const active = store.list('v1', { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('G1');
    });

    it('filters by level', () => {
      store.create('v1', { village_id: 'v1', level: 'world', title: 'G1' }, 'human');
      store.create('v1', { village_id: 'v1', level: 'team', title: 'G2' }, 'human');

      const worldGoals = store.list('v1', { level: 'world' });
      expect(worldGoals).toHaveLength(1);
    });
  });

  describe('ancestry', () => {
    let worldGoal: Goal;
    let teamGoal: Goal;
    let chiefGoal: Goal;

    beforeEach(() => {
      createConstitution(db);
      createChief(db);

      worldGoal = store.create('v1', {
        village_id: 'v1',
        level: 'world',
        title: 'World Goal',
      }, 'human');

      teamGoal = store.create('v1', {
        village_id: 'v1',
        level: 'team',
        title: 'Team Goal',
        parent_id: worldGoal.id,
      }, 'human');

      chiefGoal = store.create('v1', {
        village_id: 'v1',
        level: 'chief',
        title: 'Chief Goal',
        parent_id: teamGoal.id,
        owner_chief_id: 'chief-1',
      }, 'human');
    });

    it('returns ancestry chain from leaf to root', () => {
      const ancestry = store.getAncestry(chiefGoal.id);
      expect(ancestry).toHaveLength(3);
      expect(ancestry[0].id).toBe(chiefGoal.id);
      expect(ancestry[1].id).toBe(teamGoal.id);
      expect(ancestry[2].id).toBe(worldGoal.id);
    });

    it('returns single-element ancestry for root goal', () => {
      const ancestry = store.getAncestry(worldGoal.id);
      expect(ancestry).toHaveLength(1);
      expect(ancestry[0].id).toBe(worldGoal.id);
    });

    it('returns chief goals with ancestry', () => {
      const result = store.getChiefGoalAncestry('chief-1');
      expect(result).toHaveLength(1);
      expect(result[0].goal.id).toBe(chiefGoal.id);
      expect(result[0].ancestry).toHaveLength(3);
    });

    it('returns empty for chief with no goals', () => {
      expect(store.getChiefGoalAncestry('chief-none')).toEqual([]);
    });
  });

  describe('getTree', () => {
    it('returns only planned/active goals', () => {
      const g1 = store.create('v1', { village_id: 'v1', level: 'world', title: 'Active' }, 'human');
      store.update(g1.id, { status: 'active' }, 'human');
      const g2 = store.create('v1', { village_id: 'v1', level: 'team', title: 'Planned' }, 'human');
      const g3 = store.create('v1', { village_id: 'v1', level: 'team', title: 'Cancelled' }, 'human');
      store.update(g3.id, { status: 'cancelled' }, 'human');

      const tree = store.getTree('v1');
      expect(tree).toHaveLength(2);
      const ids = tree.map(g => g.id);
      expect(ids).toContain(g1.id);
      expect(ids).toContain(g2.id);
    });
  });
});
