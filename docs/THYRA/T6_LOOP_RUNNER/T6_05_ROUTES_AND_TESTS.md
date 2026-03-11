# T6_05: Routes + Tests

> **Layer**: L3
> **Dependencies**: T6_04
> **Blocks**: 無（T6 完成）
> **Output**: `src/routes/loops.ts`, `src/loop-runner.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T6_LOOP_RUNNER.md       # Step 3 routes, Step 4 tests
cat src/loop-runner.ts                 # 確認 core 完成
```

---

## Routes

```
POST   /api/villages/:vid/loops/start      # 啟動迴圈
GET    /api/villages/:vid/loops             # 列表
GET    /api/loops/:id                       # 單筆
POST   /api/loops/:id/stop                  # 人類中斷（SI-1）
GET    /api/loops/:id/actions               # 動作列表
```

完整 route 程式碼見 `T6_LOOP_RUNNER.md` Step 3。

## Tests

覆蓋：
- start cycle → running → completed
- timeout → status timeout
- abort（AbortSignal）→ status aborted
- POST /loops/:id/stop → status aborted
- budget exhausted → auto stop
- low risk action → executed
- medium risk action → pending_approval
- blocked action → recorded as blocked
- cycle records all actions
- listCycles returns history
- cost_incurred accumulates correctly

完整測試見 `T6_LOOP_RUNNER.md` Step 4。

---

## Phase 0 vs Phase 1

| 功能 | Phase 0 | Phase 1 |
|------|---------|---------|
| Observe | 本地 audit log | + Karvi events (T9) |
| Decide | 規則式（keyword match） | LLM（用 Chief prompt + Skill） |
| Execute | propose/revoke law | + dispatch task via Karvi |
| Evaluate | 比較前後 metrics | + Edda 判例對照 (T10) |

---

## T6 完成檢查

```
[x] T6_01: Schema + DB（loop_cycles table + types）
[x] T6_02: Observe + Decide（audit log + 規則式）
[x] T6_03: Act + Evaluate（risk gate + cost tracking）
[x] T6_04: Lifecycle（startCycle/abort/timeout/budget）
[x] T6_05: Routes + Tests
→ T6 完成，可開始 T8/T9/T10
```
