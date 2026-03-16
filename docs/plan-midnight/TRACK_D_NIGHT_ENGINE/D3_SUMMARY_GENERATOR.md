# D3: Summary Generator — Morning Digest

> **Layer**: L2
> **Dependencies**: D1, D2
> **Blocks**: 無
> **Output**: `src/summary-generator.ts`

---

## 給 Agent 的起始指令

```bash
cat src/governance-scheduler.ts             # D2 output
cat src/world/snapshot.ts                   # snapshot/diff for comparison
cat src/edda-bridge.ts                      # recordNote for precedent
bun run build
```

---

## 實作

### generateNightSummary()

```typescript
export interface NightSummary {
  village_id: string;
  date: string;
  cycles_run: number;
  proposals_total: number;
  proposals_applied: number;
  proposals_rejected: number;
  key_events: SummaryEvent[];
  market_delta: {
    stalls_added: number;
    stalls_removed: number;
    revenue_total: number;
    incidents: number;
    satisfaction_change: number;
  };
  rollbacks: number;
  precedents_recorded: number;
  generated_at: string;
}

export function generateNightSummary(
  db: Database,
  villageId: string,
  cycleResults: GovernanceCycleResult[],
): NightSummary
```

### Morning digest 儲存

- 存入 `summaries` table（或 audit_log with entity_type='summary'）
- 可選：fire-and-forget 到 Edda 作為 precedent

### Tests

- 0 cycles → empty summary
- 3 cycles with mixed results → correct counts
- key_events picks top 5 most significant
- market_delta computed from start/end metrics

---

## 驗收
```bash
bun run build && bun run lint && bun test src/summary-generator.test.ts
```

## Git Commit
```
feat(market): add night summary generator
```
