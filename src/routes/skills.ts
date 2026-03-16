import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import { Hono } from 'hono';
import { CreateSkillInput, UpdateSkillInput, ScopeTypeEnum, SourceTypeEnum } from '../schemas/skill';
import type { SkillRegistry } from '../skill-registry';

/** 解析 SKILL.md 的 frontmatter + body */
export interface ParsedSkill {
  name: string | null;
  description: string | null;
  body: string;
  meta: Record<string, string>;
}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  let body: string;

  if (match) {
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
    body = match[2].trim();
  } else {
    body = raw.trim();
  }

  // 推斷 name：frontmatter > 第一個 # heading (slugify)
  let name: string | null = meta.name ?? null;
  if (!name) {
    const headingMatch = body.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      name = headingMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  }

  // 推斷 description：frontmatter > 第一段非標題文字
  let description: string | null = meta.description ?? null;
  if (!description) {
    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        description = trimmed;
        break;
      }
    }
  }

  return { name, description, body, meta };
}

/** slugify 名稱到合法 skill name */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function skillRoutes(registry: SkillRegistry): Hono {
  const app = new Hono();

  app.get('/api/skills', (c) => {
    const status = c.req.query('status') || undefined;
    const name = c.req.query('name') || undefined;
    const scope_type = c.req.query('scope_type') || undefined;
    const source_type = c.req.query('source_type') || undefined;
    const village_id = c.req.query('village_id') || undefined;
    const tagsParam = c.req.query('tags') || undefined;
    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const search = c.req.query('search') || undefined;
    return c.json({ ok: true, data: registry.list({ status, name, scope_type, source_type, village_id, tags, search }) });
  });

  app.post('/api/skills', async (c) => {
    const parsed = CreateSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    return c.json({ ok: true, data: registry.create(parsed.data, 'human') }, 201);
  });

  // Upload SKILL.md — JSON body (must be before :id routes)
  app.post('/api/skills/upload', async (c) => {
    const jsonBody: Record<string, unknown> = await c.req.json();
    if (typeof jsonBody.content !== 'string' || jsonBody.content.length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'content is required' } }, 400);
    }
    const raw: string = jsonBody.content;
    const nameOverride = typeof jsonBody.name === 'string' && jsonBody.name.length > 0 ? jsonBody.name : null;

    // 大小限制 1MB
    if (raw.length > 1_048_576) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'File too large (max 1MB)' } }, 400);
    }

    const parsed = parseSkillMarkdown(raw);

    // 決定 name：表單覆寫 > frontmatter > heading
    const finalName = nameOverride ?? parsed.name;
    if (!finalName) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Cannot infer skill name. Provide name field or add frontmatter.' } }, 400);
    }
    if (!/^[a-z0-9-]+$/.test(finalName)) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: `Invalid name format: "${finalName}". Must match /^[a-z0-9-]+$/.` } }, 400);
    }

    const description = parsed.description ?? 'Uploaded skill';
    const skillBody = parsed.body;
    if (skillBody.length < 10) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Skill body too short (min 10 chars)' } }, 400);
    }

    const scopeType = typeof jsonBody.scope_type === 'string' ? jsonBody.scope_type : 'global';
    const villageId = typeof jsonBody.village_id === 'string' ? jsonBody.village_id : undefined;
    const tags = Array.isArray(jsonBody.tags) ? jsonBody.tags.filter((t): t is string => typeof t === 'string') : [];

    // 驗證 scope_type
    const scopeParsed = ScopeTypeEnum.safeParse(scopeType);
    if (!scopeParsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid scope_type' } }, 400);
    }

    // 檢查重複
    const existing = registry.list({ name: finalName, scope_type: scopeParsed.data });
    if (existing.length > 0) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: `Skill "${finalName}" already exists` } }, 409);
    }

    const skill = registry.create({
      name: finalName,
      definition: {
        description,
        prompt_template: skillBody,
      },
      content: raw,
      source_type: 'upload',
      source_origin: nameOverride ?? undefined,
      scope_type: scopeParsed.data,
      village_id: villageId,
      tags,
    }, 'human');

    return c.json({ ok: true, data: skill }, 201);
  });

  // 批次匯入 .claude/skills/ 目錄 (must be before :id routes)
  app.post('/api/skills/import-directory', async (c) => {
    const reqBody: Record<string, unknown> = await c.req.json();
    const directory = reqBody.directory;
    if (typeof directory !== 'string' || directory.length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'directory is required' } }, 400);
    }

    // 安全：禁止路徑穿越
    if (directory.includes('..')) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Path traversal not allowed' } }, 400);
    }

    const scopeType = typeof reqBody.scope_type === 'string' ? reqBody.scope_type : 'global';
    const sourceType = typeof reqBody.source_type === 'string' ? reqBody.source_type : 'system';
    const villageId = typeof reqBody.village_id === 'string' ? reqBody.village_id : undefined;
    const dryRun = reqBody.dry_run === true;

    const scopeParsed = ScopeTypeEnum.safeParse(scopeType);
    if (!scopeParsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid scope_type' } }, 400);
    }
    const sourceParsed = SourceTypeEnum.safeParse(sourceType);
    if (!sourceParsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid source_type' } }, 400);
    }

    const absDir = resolve(process.cwd(), directory);
    if (!existsSync(absDir)) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: `Directory not found: ${directory}` } }, 400);
    }

    const results: Array<{
      path: string;
      status: 'imported' | 'skipped' | 'error';
      skill_id?: string;
      reason?: string;
    }> = [];

    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: `Cannot read directory: ${directory}` } }, 400);
    }

    // 限制掃描量
    const MAX_FILES = 100;
    let scanned = 0;

    for (const entry of entries) {
      if (scanned >= MAX_FILES) break;

      const entryPath = resolve(absDir, entry);
      let stat;
      try { stat = statSync(entryPath); } catch { continue; }

      if (stat.isDirectory()) {
        // 檢查子目錄中的 SKILL.md
        const skillFile = resolve(entryPath, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        scanned++;
        const relativePath = `${entry}/SKILL.md`;

        try {
          const raw = readFileSync(skillFile, 'utf-8');
          const parsedMd = parseSkillMarkdown(raw);
          const name = parsedMd.name ?? slugify(basename(entryPath));

          if (!name || !/^[a-z0-9-]+$/.test(name)) {
            results.push({ path: relativePath, status: 'error', reason: `Invalid name: "${name}"` });
            continue;
          }

          // 檢查重複
          const existingSkill = registry.list({ name, scope_type: scopeParsed.data });
          if (existingSkill.length > 0) {
            results.push({ path: relativePath, status: 'skipped', reason: `Skill "${name}" already exists` });
            continue;
          }

          if (dryRun) {
            results.push({ path: relativePath, status: 'imported', reason: `Would create skill "${name}"` });
            continue;
          }

          const desc = parsedMd.description ?? `Imported from ${relativePath}`;
          const skill = registry.create({
            name,
            definition: {
              description: desc,
              prompt_template: parsedMd.body || desc,
            },
            content: raw,
            source_type: sourceParsed.data,
            source_origin: relativePath,
            scope_type: scopeParsed.data,
            village_id: villageId,
          }, 'human');

          results.push({ path: relativePath, status: 'imported', skill_id: skill.id });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          results.push({ path: relativePath, status: 'error', reason: msg });
        }
      } else if (entry.endsWith('.md')) {
        // 頂層 .md 檔案
        scanned++;

        try {
          const raw = readFileSync(entryPath, 'utf-8');
          const parsedMd = parseSkillMarkdown(raw);
          const name = parsedMd.name ?? slugify(entry.replace(/\.md$/i, ''));

          if (!name || !/^[a-z0-9-]+$/.test(name)) {
            results.push({ path: entry, status: 'error', reason: `Invalid name: "${name}"` });
            continue;
          }

          const existingSkill = registry.list({ name, scope_type: scopeParsed.data });
          if (existingSkill.length > 0) {
            results.push({ path: entry, status: 'skipped', reason: `Skill "${name}" already exists` });
            continue;
          }

          if (dryRun) {
            results.push({ path: entry, status: 'imported', reason: `Would create skill "${name}"` });
            continue;
          }

          const desc = parsedMd.description ?? `Imported from ${entry}`;
          const skill = registry.create({
            name,
            definition: {
              description: desc,
              prompt_template: parsedMd.body || desc,
            },
            content: raw,
            source_type: sourceParsed.data,
            source_origin: entry,
            scope_type: scopeParsed.data,
            village_id: villageId,
          }, 'human');

          results.push({ path: entry, status: 'imported', skill_id: skill.id });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          results.push({ path: entry, status: 'error', reason: msg });
        }
      }
    }

    const imported = results.filter((r) => r.status === 'imported').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return c.json({
      ok: true,
      data: { imported, skipped: skippedCount, errors: errorCount, results, dry_run: dryRun },
    });
  });

  // Content API — by name with scope cascade (must be before :id routes)
  app.get('/api/skills/by-name/:name/content', (c) => {
    const name = c.req.param('name');
    const villageId = c.req.query('village_id') || undefined;
    const format = c.req.query('format') || 'json';
    const skill = registry.getByNameWithScope(name, villageId);
    if (!skill) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
    if (skill.content === null) return c.json({ ok: false, error: { code: 'NO_CONTENT', message: 'Skill has no content' } }, 404);
    if (format === 'raw') {
      return c.text(skill.content);
    }
    return c.json({ ok: true, data: { content: skill.content, name: skill.name, version: skill.version, scope_type: skill.scope_type } });
  });

  app.get('/api/skills/:id', (c) => {
    const skill = registry.get(c.req.param('id'));
    if (!skill) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
    return c.json({ ok: true, data: skill });
  });

  app.patch('/api/skills/:id', async (c) => {
    const parsed = UpdateSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: registry.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.post('/api/skills/:id/verify', (c) => {
    try {
      return c.json({ ok: true, data: registry.verify(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/skills/:id/deprecate', (c) => {
    try {
      return c.json({ ok: true, data: registry.deprecate(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Content update — in-place, no version bump
  app.patch('/api/skills/:id/content', async (c) => {
    const body: Record<string, unknown> = await c.req.json();
    if (typeof body.content !== 'string' || body.content.length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'content must be a non-empty string' } }, 400);
    }
    try {
      const skill = registry.updateContent(c.req.param('id'), body.content, 'human');
      return c.json({ ok: true, data: skill });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.get('/api/villages/:vid/skills', (c) => {
    return c.json({ ok: true, data: registry.getAvailable(c.req.param('vid')) });
  });

  return app;
}
