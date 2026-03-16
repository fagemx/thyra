# Midnight Market Night Engine — Architecture Constraints

> These rules cannot be violated during development.
> 繼承 `docs/THYRA/CONTRACT.md` 全部規則。

## Rules

| Rule ID | Description | Verification | Affected Tracks |
|---------|------------|--------------|-----------------|
| THY-ALL | 繼承 THYRA CONTRACT.md 14 規則 + 7 SI | `bun run build && bun run lint` | All |
| TYPE-01 | TypeScript strict, no `any`, no `!` | `bun run build` | All |
| LINT-01 | ESLint zero warnings/errors | `bun run lint` | All |
| API-01 | `{ ok, data }` / `{ ok, false, error: { code, message } }` | Route tests | A, B, G |
| STATE-01 | World state DB 是唯一 truth source；平台只是 surface | Code review | All |
| STATE-02 | Market state（zones/stalls/slots）必須持久化在 SQLite | DB tests | B |
| WORLD-01 | WorldManager 是 world 操作唯一入口 | `grep` verification | A, D |
| WORLD-02 | apply() 必須先 judge | WorldManager tests | A, D |
| CHIEF-01 | Chief 自主決策必須經過 judge pipeline | Chief tests | D |
| CHIEF-02 | Chief 提案頻率可配置 | Scheduler config test | D |
| ADAPTER-01 | Adapter 失敗不影響 governance loop | Tests with failing adapter | F |
| ADAPTER-02 | Adapter 只讀 world state，不直接修改 | Code review | F |
| SURFACE-01 | Tonight page 只透過 HTTP API + SSE 與後端溝通 | `grep` verification | E |
| TEMPLATE-01 | Template YAML 能被 VillagePackCompiler 完整處理 | Pack test | C |
| BRIDGE-01 | Edda/Karvi bridge 斷線不影響主流程 | Tests with null bridge | G |

---

## Detailed Rules

### STATE-01: World State DB 是唯一 Truth Source

**Description**: zones、stalls、event_slots、orders、metrics、laws、proposals 全部存在自己的 SQLite。X / Reddit / Discord 只是 surface，不是 truth source。

**Rationale**: 如果 truth 在平台上，你只是在追平台反應，不是在營運一個場。

**Verification**: Code review — 所有 state mutation 都透過 DB transaction，不透過平台 API callback。

**Consequence of violation**: 平台 API 異動 → 世界狀態不一致 → 無法 rollback。

---

### ADAPTER-01: Adapter 失敗不影響 Governance

**Description**: X API 掛了、Discord 斷線，governance loop 照跑。Adapter 是 fire-and-forget 的執行層。

**Rationale**: 場務引擎的判斷不能被外部平台綁架。judge + apply 是內部行為，posting 是外部行為。

**Verification**:
```bash
bun test src/adapters/
# 包含 adapter-throws test → governance loop 仍完成
```

**Consequence of violation**: X API 限速 → 整個 Night Engine 停擺。

---

### ADAPTER-02: Adapter 只讀不寫 State

**Description**: Adapter 可以讀 world state（知道要 post 什麼），但不能修改 state。State mutation 只能經過 WorldManager.apply()。

**Rationale**: Adapter 是執行者，不是決策者。決策權在 chiefs + judge。

**Verification**: Code review — adapter 函數簽名只接收 readonly state。

**Consequence of violation**: Adapter 直接改 state → 繞過 judge → 世界狀態不可信。
