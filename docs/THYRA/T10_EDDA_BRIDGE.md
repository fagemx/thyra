# T10: Edda Bridge

> Phase 1（可與 T8, T9 並行）
> 新建：`src/edda-bridge.ts`
> 依賴：T6
> 預估：3-4 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/loop-runner.test.ts
# 確認 Edda 在跑
curl http://localhost:3462/api/health
```

---

## 最終結果

- Thyra → Edda：查判例（輔助 Chief 決策）
- Thyra → Edda：記錄治理決策（跨 repo 決策記憶）
- 降級：Edda 不可用時不影響主流程
- 測試通過

---

## 核心設計

### Edda 是顧問，不是依賴

Thyra 沒有 Edda 也能跑。Edda 提供兩個增值：
1. **判例查詢**：Chief 決策時參考歷史（「上次改 review policy 效果如何？」）
2. **決策記錄**：Thyra 的治理決策寫回 Edda，形成跨 repo 的決策記憶

```
Thyra ──query decisions──→ Edda    （我想改 review policy，之前類似的決策結果如何？）
Thyra ──record decision──→ Edda    （我剛頒布了這條 law，記錄一下）
```

### 整合點

1. **Loop Runner decide 階段**：查 Edda 判例注入 Chief context
2. **Law enact 後**：記錄到 Edda
3. **Law rollback 後**：記錄失敗案例到 Edda

### 降級

- queryDecisions → Edda 離線回空陣列
- recordDecision → Edda 離線只 log warning

---

## 實作步驟

### Step 1: Query Client

```typescript
export class EddaBridge {
  constructor(private eddaUrl: string) {}

  /** 查詢相關判例 — 輔助 Chief 決策 */
  async queryDecisions(opts: {
    domain: string;       // village name
    topic: string;        // law category
    limit?: number;
  }): Promise<EddaDecision[]> {
    const params = new URLSearchParams({
      domain: opts.domain,
      topic: opts.topic,
      limit: String(opts.limit ?? 10),
    });
    const res = await fetch(`${this.eddaUrl}/api/decisions?${params}`);
    if (!res.ok) return [];  // 降級：查不到就不用
    return (await res.json()).data ?? [];
  }

  /** 記錄治理決策 — 讓 Edda 追蹤 */
  async recordDecision(decision: {
    domain: string;
    aspect: string;
    value: string;
    reason: string;
    source: 'thyra';
    refs?: { law_id?: string; chief_id?: string; village_id?: string };
  }): Promise<void> {
    await fetch(`${this.eddaUrl}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    }).catch(() => {
      // 降級：記不了就 log warning，不影響主流程
      console.warn('[edda-bridge] failed to record decision');
    });
  }

  async getHealth(): Promise<{ ok: boolean }> {
    try {
      const res = await fetch(`${this.eddaUrl}/api/health`);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }
}
```

### Step 2: 與 Loop Runner 整合

```typescript
// Loop Runner 的 decide 階段用 Edda 判例
async function decideWithEdda(
  chief: Chief,
  laws: Law[],
  observations: Observation[],
  eddaBridge: EddaBridge
): Promise<Decision> {
  const precedents = await eddaBridge.queryDecisions({
    domain: village.name,
    topic: observations[0]?.category ?? 'general',
  });

  // 把判例注入 Chief 的決策 context
  const context = { laws, observations, precedents };
  return decide(chief, context);
}
```

### Step 3: Law Enact 時記錄到 Edda

```typescript
// Law Engine enact 後呼叫
async function recordLawToEdda(law: Law, village: Village, eddaBridge: EddaBridge) {
  await eddaBridge.recordDecision({
    domain: village.name,
    aspect: law.category,
    value: JSON.stringify(law.content.strategy),
    reason: law.evidence.reasoning,
    source: 'thyra',
    refs: { law_id: law.id, village_id: village.id },
  });
}
```

---

## API

```
GET  /api/bridges/edda/status           # 連線狀態
POST /api/bridges/edda/query            # 手動查判例
GET  /api/bridges/edda/recent           # 最近記錄的決策
```

## Edda 需要的配合（#188）

依賴 Edda #188 的 event consumer 功能。在 #188 完成前：
- queryDecisions 可以先用 Edda 的現有 `edda query` CLI
- recordDecision 可以先用 `edda decide` CLI

---

## 驗收

```bash
bun test src/edda-bridge.test.ts

# 降級測試
EDDA_URL=http://localhost:99999 bun test src/edda-bridge.test.ts
# 預期：EDDA_URL 指向不存在的 port → 所有測試仍通過（降級）
```
