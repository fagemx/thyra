# T1_01: Project Init

> **Layer**: L0
> **Dependencies**: none（第一個 step）
> **Blocks**: T1_02, T1_03, T1_04, 以及所有後續 Track
> **Output**: 專案骨架可 `bun run build` 通過

---

## 給 Agent 的起始指令

```bash
# 1. 讀規格
cat docs/THYRA/00_OVERVIEW.md          # 全景
cat docs/THYRA/CONTRACT.md             # 架構契約
cat docs/THYRA/TRACKS.md               # Track 拆解 + module path

# 2. 確認目錄狀態
ls -la
cat package.json 2>/dev/null || echo "no package.json yet"

# 3. 讀本文件，按 Step 執行
```

---

## 最終結果

```
thyra/
  package.json               # name: @fagemx/thyra, type: module
  tsconfig.json              # strict, ES2022, bundler resolution
  src/
    index.ts                 # Hono app 骨架，listen :3462
  tests/
    setup.ts                 # vitest global setup（:memory: DB）
  vitest.config.ts
```

`bun run build` 和 `bun test` 皆通過（空測試）。

---

## Step 1: package.json

```json
{
  "name": "@fagemx/thyra",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "hono": "^4",
    "zod": "^3",
    "better-sqlite3": "^11"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/better-sqlite3": "^7",
    "vitest": "^2"
  },
  "engines": {
    "node": ">=22"
  }
}
```

```bash
bun install
```

## Step 2: tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

## Step 3: src/index.ts（骨架）

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server'; // 或 Bun.serve

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ ok: true, version: '0.1.0' });
});

const PORT = Number(process.env.THYRA_PORT ?? 3462);

console.log(`[thyra] starting on :${PORT}`);
serve({ fetch: app.fetch, port: PORT });

export default app;
```

## Step 4: vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
```

## Step 5: tests/setup.ts

```typescript
// Global test setup — 每個測試用 :memory: DB
// 具體在 T1_02 實作
export {};
```

---

## 驗收

```bash
bun run build              # tsc --noEmit 通過
bun test                   # 0 tests, 0 failures
bun run dev &
curl -s http://localhost:3462/api/health | jq '.ok'  # true
kill %1
```
