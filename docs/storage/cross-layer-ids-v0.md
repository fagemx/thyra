# cross-layer-ids-v0.md

> 狀態：`working draft`
>
> 目的：定義不同 storage layer 的 object 如何共享、映射穩定 ID，避免同一個決策物件在 Völva DB、spec docs、Edda 裡有三個互不相認的 identity。
>
> 這份文件不處理：
> - 單一 layer 內的 ID generation（那是各 layer 自己的事）
> - 資料庫 schema 設計（那是 `volva-working-state-schema-v0.md`（Völva repo））
>
> 它只回答：
>
> > **同一個 decision object 跨 L1→L2→L3→L4→L5 時，ID 怎麼對齊？怎麼互相追？**

---

## 1. 一句話

> **跨層 ID 的核心不是全域統一命名空間，而是可追蹤的 source linking chain。**
>
> 每一層可以有自己的 ID scheme，但必須能回指上游 object。

---

## 2. 它不是什麼

### 不是全域 UUID 統一管理
不要試圖讓所有 layer 共用一個 ID registry。
每層有自己的 ID 前綴和格式，這是健康的。

### 不是 ID 映射資料庫
不需要一張巨表把所有 ID 關係都存起來。
靠的是每個 object 自帶 `sourceRef` 欄位。

### 不是版本管理系統
ID 追蹤的是「這個東西從哪來」，不是「這個東西的第 N 版」。
版本是各層自己的責任。

---

## 3. ID Prefix Convention

每一層的 object 都用固定前綴，一看就知道它屬於哪層：

### L1 — Völva Working State
```
ds_...       decision session
card_...     card snapshot
cand_...     candidate record
probe_...    probe record
sig_...      signal packet
commit_...   commit memo draft
promo_...    promotion check draft
evt_...      decision event
```

### L2 — Spec Docs
```
spec://volva/world-design-v0/intent-router.md
spec://thyra/world-design-v0/canonical-cycle.md
```
Spec 不用 random ID，用 `spec://<repo>/<stack>/<file>` 格式。

### L3 — Planning Pack
```
plan_...     planning pack
track_...    track
task_...     task
```

### L4 — Runtime
```
world_...    world instance
cycle_...    cycle run
cp_...       change proposal
jr_...       judgment report
ac_...       applied change
pulse_...    pulse frame
ow_...       outcome window
```

### L5 — Edda Precedent
```
prec_...     precedent record
dec_...      decision trace
```

---

## 4. Source Linking — 跨層追蹤機制

### 核心型別

```ts
type SourceRef = {
  layer: "L1" | "L2" | "L3" | "L4" | "L5";
  kind: string;        // e.g. "decision-session", "spec-file", "world", "precedent"
  id: string;          // e.g. "ds_abc123", "spec://thyra/world-design-v0/canonical-cycle.md"
  note?: string;       // optional: why this link exists
};
```

### 規則

**Rule 1: 每次升格必須帶 sourceRef**

當 object 從一層升到另一層時，新 object 必須記住它的來源：

```ts
// L1 candidate → L2 spec
specFile.sourceRefs = [
  { layer: "L1", kind: "candidate", id: "cand_001" },
  { layer: "L1", kind: "session", id: "ds_abc" }
];

// L2 spec → L3 planning
planTrack.sourceRefs = [
  { layer: "L2", kind: "spec-file", id: "spec://thyra/world-design-v0/canonical-cycle.md" }
];

// L2 spec → L4 runtime
world.sourceRefs = [
  { layer: "L2", kind: "spec-file", id: "spec://thyra/world-design-v0/midnight-market-canonical-slice.md" },
  { layer: "L1", kind: "promotion-check", id: "promo_xyz" }
];
```

**Rule 2: Edda precedent 必須回指觸發來源**

```ts
precedentRecord.sourceRefs = [
  { layer: "L4", kind: "outcome-window", id: "ow_123" },
  { layer: "L4", kind: "change-proposal", id: "cp_456" },
  { layer: "L1", kind: "session", id: "ds_abc" }
];
```

**Rule 3: 不要求雙向映射**

只要求 downstream 記住 upstream source。
不要求 upstream 也記住所有 downstream consumer。
（如果需要反查，Edda 或 event log 可以做。）

---

## 5. Promotion Handoff 中的 ID 對齊

`promotion-handoff-schema-v0.md` 的 `StableObjectRef` 和 `SourceLink` 就是這套機制的體現：

```ts
// 已定義在 promotion-handoff-schema-v0.md
type StableObjectRef = {
  kind: "decision-session" | "card" | "spec-file" | "shared-types" | "commit-memo" | "promotion-check" | "canonical-slice";
  id: string;        // 使用本文件定義的 ID 格式
  path?: string;
  note?: string;
};

type SourceLink = {
  kind: "session" | "spec" | "event" | "precedent";
  ref: string;       // 使用本文件定義的 ID 格式
  whyRelevant?: string;
};
```

---

## 6. Canonical Example

一個 economic candidate 從聊天到 precedent 的完整 ID 鏈：

```text
L0  user says "我想賺錢"
    ↓
L1  ds_session_001 → route → cand_econ_001 → probe_dm_001 → sig_reply_001 → commit_econ_001
    ↓ crystallize
L2  spec://volva/world-design-v0/economic-regime-v0.md
    sourceRefs: [{ layer: "L1", kind: "session", id: "ds_session_001" }]
    ↓ promote
L3  track_econ_service → task_intake_001
    sourceRefs: [{ layer: "L2", kind: "spec-file", id: "spec://volva/.../economic-regime-v0.md" }]
    ↓ build + deploy
L4  (if it evolves into operator model)
    world_econ_ops_001
    sourceRefs: [{ layer: "L3", kind: "track", id: "track_econ_service" }]
    ↓ outcome
L5  prec_econ_service_worked_001
    sourceRefs: [
      { layer: "L4", kind: "world", id: "world_econ_ops_001" },
      { layer: "L1", kind: "commit-memo", id: "commit_econ_001" }
    ]
```

---

## 7. Conflict Resolution

### 同一 object 在兩層有不同版本怎麼辦？

不用 ID 解這個問題。ID 只負責「追蹤」，不負責「同步」。

版本衝突用 `persistence-policy-v0.md` 的 conflict resolution policy 處理：
- L2 spec 是 design truth
- L4 runtime 是 live fact truth
- L5 precedent 是 historical truth
- 衝突時觸發 review，不是自動覆蓋

---

## 8. v0 不做什麼

- 不做全域 ID registry / lookup service
- 不做雙向 ID mapping table
- 不做跨 repo ID federation
- 不做 ID 自動重命名 / migration

---

## 9. 最後一句

> **跨層 ID 的重點不是讓所有系統共用一個命名空間，而是讓每個決策物件知道自己從哪來、被誰用。**
>
> `SourceRef` 是一條從下游回指上游的線。有這條線，Edda 才能把整條 decision spine 串起來；沒有它，每一層都是孤島。
