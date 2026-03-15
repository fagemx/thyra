/**
 * Blog Village 種子資料
 *
 * 建立完整的 Blog Village：village、constitution、chief、skills。
 * 用於開發、測試、demo 環境的初始化。
 */
import type { Database } from 'bun:sqlite';
import { VillageManager, type Village } from '../village-manager';
import { ConstitutionStore, type Constitution } from '../constitution-store';
import { ChiefEngine, type Chief } from '../chief-engine';
import { SkillRegistry, type Skill } from '../skill-registry';

// ── 常數 ────────────────────────────────────────────────────

const ACTOR = 'seed:blog-village';

/** 四個 skill 名稱，對應 DecisionEngine stageMap 的 key */
export const SKILL_NAMES = ['research', 'draft', 'review', 'publish'] as const;

// ── Skill 定義 ──────────────────────────────────────────────

const SKILL_DEFINITIONS: Record<string, {
  description: string;
  prompt_template: string;
  tools_required: string[];
  constraints: string[];
}> = {
  research: {
    description: '研究主題並蒐集可驗證來源',
    prompt_template: [
      'You are a research assistant for a blog.',
      'Given a topic, find and summarize relevant sources.',
      'Each source must be verifiable and include a URL or citation.',
      'Output a structured research brief with key findings.',
    ].join('\n'),
    tools_required: ['web-search', 'url-reader'],
    constraints: [
      '至少引用一個可驗證來源',
      '不得使用過期超過一年的資料',
    ],
  },
  draft: {
    description: '根據研究結果撰寫文章草稿',
    prompt_template: [
      'You are a blog content writer.',
      'Using the provided research brief, write a well-structured article draft.',
      'The draft must be at least 500 words.',
      'Include clear headings, introduction, body, and conclusion.',
    ].join('\n'),
    tools_required: ['text-editor'],
    constraints: [
      '文章至少 500 字',
      '必須包含標題、引言、正文、結論',
    ],
  },
  review: {
    description: '審核文章品質與事實準確性',
    prompt_template: [
      'You are an editorial reviewer.',
      'Review the draft for factual accuracy, readability, and quality.',
      'Assign a quality score from 1-10.',
      'Provide specific feedback for improvement if score < 7.',
    ].join('\n'),
    tools_required: ['fact-checker'],
    constraints: [
      '品質分數低於 7 分不得通過',
      '必須進行事實查核',
    ],
  },
  publish: {
    description: '將審核通過的文章發佈到部落格',
    prompt_template: [
      'You are a blog publisher.',
      'Format and publish the reviewed article.',
      'Ensure proper SEO metadata, tags, and scheduling.',
      'Confirm publication and return the published URL.',
    ].join('\n'),
    tools_required: ['cms-api', 'seo-tool'],
    constraints: [
      '只能發佈審核通過的文章',
      '必須設定 SEO metadata',
    ],
  },
};

// ── 回傳型別 ────────────────────────────────────────────────

export interface SeedResult {
  village: Village;
  constitution: Constitution;
  chief: Chief;
  skills: Skill[];
}

// ── 主函數 ───────────────────────────────────────────────────

/**
 * 建立 Blog Village 的完整種子資料。
 *
 * 執行順序：Village → Constitution → Skills（create + verify）→ Chief
 * 與 VillagePackCompiler 的 5-phase 順序一致。
 */
export function seedBlogVillage(db: Database): SeedResult {
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);

  // Phase 1: Village
  const village = vm.create(
    {
      name: 'blog-village',
      description: 'AI 驅動的部落格內容產出村莊',
      target_repo: 'fagemx/blog',
    },
    ACTOR,
  );

  // Phase 2: Constitution
  const constitution = cs.create(
    village.id,
    {
      rules: [
        {
          description: '所有內容必須經過 review 階段才能發佈',
          enforcement: 'hard' as const,
          scope: ['publish'],
        },
        {
          description: '每篇文章至少包含 500 字',
          enforcement: 'soft' as const,
          scope: ['draft', 'publish'],
        },
        {
          description: '研究階段必須引用至少一個可驗證來源',
          enforcement: 'hard' as const,
          scope: ['research'],
        },
      ],
      allowed_permissions: [
        'dispatch_task',
        'propose_law',
        'enact_law_low',
        'query_edda',
        'spend_budget',
      ],
      budget_limits: {
        max_cost_per_action: 5,
        max_cost_per_day: 50,
        max_cost_per_loop: 25,
      },
    },
    ACTOR,
  );

  // Phase 3: Skills — 建立並驗證
  const skills: Skill[] = [];
  for (const name of SKILL_NAMES) {
    const def = SKILL_DEFINITIONS[name];
    const skill = sr.create(
      {
        name,
        village_id: village.id,
        definition: {
          description: def.description,
          prompt_template: def.prompt_template,
          tools_required: def.tools_required,
          constraints: def.constraints,
        },
      },
      ACTOR,
    );
    // THY-14: Chief 只能 bind verified skill
    const verified = sr.verify(skill.id, ACTOR);
    skills.push(verified);
  }

  // Phase 4: Chief
  const chief = ce.create(
    village.id,
    {
      name: 'editor-chief',
      role: '內容主編：負責規劃、審核、發佈部落格文章',
      permissions: [
        'dispatch_task',
        'propose_law',
        'enact_law_low',
        'query_edda',
        'spend_budget',
      ],
      personality: {
        risk_tolerance: 'conservative',
        communication_style: 'detailed',
        decision_speed: 'cautious',
      },
      constraints: [
        { type: 'must' as const, description: '每次發佈前必須完成品質檢查' },
        { type: 'must_not' as const, description: '不得發佈未經事實查核的內容' },
        { type: 'prefer' as const, description: '優先選擇有深度分析的主題' },
      ],
      skills: skills.map((s) => ({
        skill_id: s.id,
        skill_version: s.version,
      })),
    },
    ACTOR,
  );

  return { village, constitution, chief, skills };
}
