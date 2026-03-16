/**
 * JSON templates for each WorldChange type.
 * Pre-filled with example values to reduce friction in the JSON textarea.
 */

import type { WorldChangeType } from '../api/types'

export interface ChangeTemplate {
  label: string
  group: string
  template: Record<string, unknown>
}

export const CHANGE_TEMPLATES: Record<WorldChangeType, ChangeTemplate> = {
  'village.update': {
    label: 'Village Update',
    group: 'Village',
    template: {
      type: 'village.update',
      name: 'My Village',
      description: 'Updated description',
    },
  },
  'constitution.supersede': {
    label: 'Constitution Supersede',
    group: 'Constitution',
    template: {
      type: 'constitution.supersede',
      rules: [
        {
          description: 'All actions must be logged',
          enforcement: 'hard',
          scope: ['*'],
        },
      ],
      allowed_permissions: ['read_repo', 'write_repo', 'propose_law_low', 'enact_law_low'],
      budget_limits: {
        max_cost_per_action: 100,
        max_cost_per_day: 1000,
        max_cost_per_loop: 500,
        max_cost_per_month: 10000,
      },
      evaluator_rules: [],
      actor: 'human',
    },
  },
  'chief.appoint': {
    label: 'Chief Appoint',
    group: 'Chief',
    template: {
      type: 'chief.appoint',
      name: 'New Chief',
      role: 'developer',
      permissions: ['read_repo', 'write_repo'],
      skills: [],
    },
  },
  'chief.dismiss': {
    label: 'Chief Dismiss',
    group: 'Chief',
    template: {
      type: 'chief.dismiss',
      chief_id: 'chief-xxx',
      actor: 'human',
    },
  },
  'chief.update_permissions': {
    label: 'Chief Update Permissions',
    group: 'Chief',
    template: {
      type: 'chief.update_permissions',
      chief_id: 'chief-xxx',
      permissions: ['read_repo'],
    },
  },
  'law.propose': {
    label: 'Law Propose',
    group: 'Law',
    template: {
      type: 'law.propose',
      proposed_by: 'chief-xxx',
      category: 'trade',
      content: { rule: 'example rule content' },
      risk_level: 'low',
    },
  },
  'law.enact': {
    label: 'Law Enact',
    group: 'Law',
    template: {
      type: 'law.enact',
      law_id: 'law-xxx',
      approved_by: 'human',
    },
  },
  'law.repeal': {
    label: 'Law Repeal',
    group: 'Law',
    template: {
      type: 'law.repeal',
      law_id: 'law-xxx',
      actor: 'human',
    },
  },
  'skill.register': {
    label: 'Skill Register',
    group: 'Skill',
    template: {
      type: 'skill.register',
      name: 'new-skill',
      definition: {
        description: 'Skill description',
        prompt_template: 'Do {{task}}',
        tools_required: [],
        constraints: [],
        examples: [],
      },
    },
  },
  'skill.revoke': {
    label: 'Skill Revoke',
    group: 'Skill',
    template: {
      type: 'skill.revoke',
      skill_id: 'skill-xxx',
      actor: 'human',
    },
  },
  'budget.adjust': {
    label: 'Budget Adjust',
    group: 'Budget',
    template: {
      type: 'budget.adjust',
      max_cost_per_action: 100,
      max_cost_per_day: 1000,
      max_cost_per_loop: 500,
    },
  },
  'cycle.start': {
    label: 'Cycle Start',
    group: 'Cycle',
    template: {
      type: 'cycle.start',
      chief_id: 'chief-xxx',
      trigger: 'manual',
      max_iterations: 10,
      timeout_ms: 30000,
    },
  },
  'cycle.end': {
    label: 'Cycle End',
    group: 'Cycle',
    template: {
      type: 'cycle.end',
      cycle_id: 'cycle-xxx',
      reason: 'Manual stop',
    },
  },
}

/** Groups for the type selector dropdown */
export const CHANGE_GROUPS: string[] = [
  'Village',
  'Constitution',
  'Chief',
  'Law',
  'Skill',
  'Budget',
  'Cycle',
]
