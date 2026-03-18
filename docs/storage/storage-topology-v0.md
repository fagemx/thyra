# storage-topology-v0.md

> 狀態：`working draft`
>
> 目的：把 decision engineering 裡各種狀態真正放到一張工程拓樸圖上，避免之後又變成：
>
> - 聊天在這裡
> - spec 在那裡
> - Edda 也記一份
> - DB 又有另一份
> - 但沒人知道哪個才是 source of truth
>
> 這份文件回答的是：
>
> > **Völva、spec docs、project-plan、Thyra runtime、Edda 之間，到底各自存什麼？**
> > **狀態如何流動？**
> > **哪一層是 working truth，哪一層是 reviewable truth，哪一層是 precedent truth？**

---

## 1. 一句話

> **Storage topology 的核心，不是把所有東西集中放一個地方，而是讓不同成熟度、不同用途、不同時間尺度的狀態，落在對的層。**

如果這一層不清楚，後面一定會出現：

- 重複存
- source of truth 混亂
- patch 不知道該改哪裡
- runtime state 和 design state 混在一起
- Edda 變成垃圾桶

---

## 2. 核心原則

### 原則 1：不同層存不同 truth
不要幻想 single store 解全部。

### 原則 2：working state、design state、runtime state、precedent state 必須切開
它們不是同一種資料。

### 原則 3：升格比同步更重要
很多時候不是「自動雙向同步」，而是：
- 從 working state 升格成 spec
- 從 spec 升格成 planning
- 從 runtime outcome 升格成 precedent

### 原則 4：Edda 記「重要 transition」，不是記所有狀態
這點一定要守住。

---

## 3. Topology Overview

```text
┌──────────────────────────────┐
│ User / Chat UI │
│ 生活語言、模糊意圖、修改意見 │
└──────────────┬───────────────┘
│
▼
┌──────────────────────────────┐
│ Völva │
│ Working Decision State │
│ cards / routing / probes │
└──────────────┬───────────────┘
│ crystallize / patch
▼
┌──────────────────────────────┐
│ Git-backed Spec Docs │
│ arch-spec / world-design │
│ reviewable design state │
└──────────────┬───────────────┘
│ promote / decompose
▼
┌──────────────────────────────┐
│ Planning Pack │
│ project-plan / tracks │
│ execution state design │
└──────────────┬───────────────┘
│ build / deploy
▼
┌──────────────────────────────┐
│ Runtime Systems │
│ Thyra / Karvi / services │
│ live state + outcomes │
└──────────────┬───────────────┘
│ record important decisions/outcomes
▼
┌──────────────────────────────┐
│ Edda │
│ Decision Spine / Memory │
│ precedents / traces │
└──────────────────────────────┘
```

---

## 4. 六層 storage

我會把整套系統切成六層。
因為 planning 和 runtime 應該從 design state 再切出來。

### L0 — Conversation Surface
- 人的輸入
- 原始聊天
- 還沒結構化的意圖

### L1 — Working Decision State
- Völva card state
- intent routing
- path check
- candidate generation
- probe drafts
- current unknowns

### L2 — Reviewable Design State
- architecture spec stack
- shared-types
- handoff docs
- review outputs

### L3 — Execution Design State
- project-plan
- tracks / tasks / DoD / validation
- dispatchable work structure

### L4 — Live Runtime State
- Thyra worlds
- Karvi tasks/runs
- pulse / outcomes / applied changes
- live operational data

### L5 — Precedent State
- Edda decision log
- why this worked / failed
- promotion precedents
- runtime outcome precedents

---

## 5. L0 — Conversation Surface

### 它存什麼
- 原始訊息
- 模糊描述
- 使用者修正語句
- 未結構化背景

### 放哪裡
- chat transcript
- session history
- provider log

### 它不是 source of truth 的原因
因為它太原始、太冗、太容易歧義。

### 但它的重要性
它是所有 decision state 的原始材料。
不能丟，但也不能拿它直接當 spec。

---

## 6. L1 — Working Decision State（Völva）

### 它存什麼
這一層是 still-in-motion 的決策狀態。

例如：

- primary/secondary regime
- path certainty
- key unknowns
- active candidate space
- active probe plan
- interim commit reasoning
- settlement target
- current stage

### 建議資料結構

> ⚠️ 以下為早期草稿版本。正式定義見 `volva-working-state-schema-v0.md`（Völva repo）。
> ⚠️ 以下為早期草稿版本，欄位與 enum 值可能與正式版不一致。**請勿以此為準。** 正式定義見 `volva-working-state-schema-v0.md`（Völva repo）。

#### DecisionSession
```ts
type DecisionSession = {
sessionId: string;
primaryRegime?: Regime;
secondaryRegimes?: Regime[];
stage:
| "routing"
| "path-check"
| "space-building"
| "probe-design"
| "probe-review"
| "spec-crystallization"
| "promotion-check";
keyUnknowns: string[];
updatedAt: string;
};
```

#### CardSnapshot
```ts
type CardSnapshot = {
cardId: string;
sessionId: string;
kind: "world" | "workflow" | "task" | "decision";
version: number;
summary: string;
payload: Record<string, unknown>;
updatedAt: string;
};
```

#### CandidateRecord
```ts
type CandidateRecord = {
id: string;
sessionId: string;
regime: Regime;
status: "generated" | "pruned" | "probe-ready" | "probing" | "hold" | "committed" | "discarded";
description: string;
whyThisExists: string[];
};
```

### 存放位置
- `Völva DB`（首選）
- SQLite / Postgres / JSON blobs 都可
- 但一定要是持久化，不要只靠 session memory

### 為什麼這層不能只在記憶體
因為它需要：
- 對話續接
- review
- patch
- 再生成 spec
- promotion 判斷

---

## 7. L2 — Reviewable Design State（Git-backed Docs）

### 它存什麼
一旦 decision state 穩到值得被看、被 patch、被 review，就升到這層。

例如：

- `intent-router.md`
- `path-check.md`
- `probe-commit.md`
- `canonical-cycle.md`
- `world-cycle-api.md`
- `midnight-market-canonical-slice.md`
- `shared-types.md`

### 它的本質
這不是 runtime state dump。
是經過收斂後的：
> **design truth**

### 為什麼要用 Git-backed docs
因為這層最需要：
- diff
- patch
- branch
- review
- history

DB 很適合 working state，
但不適合 architecture debate 的可視 diff。

### source of truth 原則
對於：
- 系統定義
- 邊界
- canonical forms
- shared types
- promotion package

這層才是 source of truth。

---

## 8. L3 — Execution Design State（Planning Pack）

### 它存什麼
這層不是 runtime，也不是 architecture definition。
它是「可施工化狀態」。

例如：
- `00_OVERVIEW.md`
- `CONTRACT.md`
- `TRACKS.md`
- `VALIDATION.md`
- 各 task files

### 它的角色
把已經被 architecture 層穩定化的東西拆成：
- 可平行
- 可驗收
- 可派工

### 為什麼要獨立一層
因為 planning 不是 design 本身。
如果把 planning 直接混進 L2，spec 會失去純度。

### source of truth 原則
對於：
- task ordering
- implementation scope
- DoD
- verification commands

這層才是 truth。

---

## 9. L4 — Live Runtime State（Thyra / Karvi / Services）

### 它存什麼
這層才是系統真的在跑時的狀態。

#### Thyra 可能有：
- worlds
- snapshots
- change proposals
- judgment reports
- pulse frames
- outcome windows
- precedents-in-use

#### Karvi 可能有：
- dispatched tasks
- run progress
- execution logs
- artifacts

### 它和 L2/L3 的差別
- L2/L3 是「定義如何該跑」
- L4 是「它現在真的怎麼在跑」

### source of truth 原則
對 live system 的事實狀態，L4 才是 truth。

---

## 10. L5 — Precedent State（Edda）

### 它存什麼
這層不是 current state。
它存的是「有長期價值的 transition 與 outcome」。

例如：

- 為什麼某次 route 判 economic
- 為什麼某次 path-check 沒 direct forge
- 哪種 probe 是假陽性
- 哪種 candidate 被 commit 後成功
- 哪種 promotion 太早
- 哪個 change 在某種 world 中結果 harmful

### 這層的本質
> **decision spine / precedent memory**

### 不要把它當什麼
- 不是 UI session state
- 不是 architecture doc store
- 不是 runtime DB

---

## 11. 跨層資料流

這整套真正重要的是「怎麼流」，不是只是「放哪裡」。

---

### Flow A — Chat → Working State
```text
user message
→ Völva parses
→ update DecisionSession / CardSnapshot / CandidateRecord
```

這裡是高頻流。

---

### Flow B — Working State → Spec
```text
working state stabilizes
→ crystallize into spec file
→ commit to Git
```

這不是同步，是升格。

---

### Flow C — Spec → Planning
```text
promotion check passes
→ derive project-plan
→ create tracks/tasks
```

這也不是同步，是轉換。

---

### Flow D — Planning → Runtime
```text
tasks built / deployed
→ runtime state begins
```

---

### Flow E — Runtime / Decision → Edda
```text
important transition or outcome
→ summarize
→ record as precedent
```

這是一種抽樣式 append，不是全量同步。

---

## 12. Source-of-truth matrix

| 資料類型 | 首選 truth 層 |
|---|---|
| 使用者原話 | L0 conversation history |
| 當前 route / unknowns / candidate 狀態 | L1 Völva working DB |
| 系統定義 / canonical form / schema | L2 Git-backed spec docs |
| task 分解 / DoD / validation | L3 planning pack |
| live world / task / outcome 狀態 | L4 runtime stores |
| 長期 decision precedent | L5 Edda |

這張表非常重要，因為它能防止：
- 重複編輯不同 truth
- 改 spec 卻以為改了 runtime
- 改 working state 卻沒 crystallize
- 把 Edda 當 operational DB

---

## 13. 版本與 ID 對齊

這一層如果不先定，之後一定亂。

### 建議：每種 object 都要有 stable id

#### Working layer
- `ds_...` decision session
- `card_...`
- `cand_...`
- `probe_...`

#### Spec layer
- `spec://volva/world-design-v0/intent-router.md`
- `spec://thyra/world-design-v0/canonical-cycle.md`

#### Planning layer
- `plan_...`
- `track_...`
- `task_...`

#### Runtime layer
- `world_...`
- `cycle_...`
- `change_...`
- `outcome_...`

#### Precedent layer
- `prec_...`
- `dec_...`

### 關鍵原則
spec 和 precedent 不是重新命名一切，
而應保留對上游 objects 的引用。

---

## 14. 同步 vs 升格

這裡很容易被誤解。

### 不應該做的想像
- working DB 和 spec docs 雙向自動同步
- Edda 自動鏡像全部 DB
- spec 改了 runtime 就自動跟著變

這會非常亂。

### 應該做的模型
- **sync** 用在同層內部
- **promotion / crystallization** 用在跨層

也就是：

#### working patch
L1 內部更新

#### spec crystallization
L1 → L2

#### planning promotion
L2 → L3

#### runtime instantiation
L2/L3 → L4

#### precedent recording
L1/L2/L4 → L5

這樣比較健康。

---

## 15. 目前還沒被統整好的工程問題

> 以下問題在 v0 已大部分被處理，見各子項標注的對應文件。

你剛剛點得很準，這裡直接列出來。

### 15.1 Völva DB schema 還沒定

> ✅ 已被處理：見 `volva-working-state-schema-v0.md`。

現在知道要有 working decision state，
但還沒把：
- sessions
- cards
- candidates
- probes
- promotion drafts
定成 schema。

---

### 15.2 L1→L2 的 crystallization 還沒制度化

> ⚠️ 部分處理：見 `persistence-policy-v0.md` §9（Crystallization policy）。

現在靠對話與手動感覺，
還沒有明確：
- 何時升格
- 由誰觸發
- 升哪些 object
- 是否要保留 source links

---

### 15.3 promotion package 還沒 schema 化

> ✅ 已被處理：見 `promotion-handoff-schema-v0.md`。

從 spec → project-plan / Thyra 的 handoff，
還沒有固定欄位。

---

### 15.4 Edda ingestion 還沒定 trigger

> ✅ 已被處理：見 `edda-ingestion-triggers-v0.md`。

哪些 decision / outcome 值得寫進 precedent，
現在還沒工程化。

---

### 15.5 Git / DB / Edda 的 conflict policy 還沒定

> ⚠️ 部分處理：見 `persistence-policy-v0.md` §12（Conflict resolution policy）。

例如：
- spec 改了，但 working state 還舊
- runtime 結果和 spec 預期衝突
- Edda precedent 說某路常失敗，spec 卻還保留舊假設

這些誰優先，還沒定。

---

## 16. v0 建議的 write policy

### 對 Völva working state
- 每輪對話更新
- 可 overwrite current snapshot
- 重大變更 append event

### 對 spec docs
- 只在概念穩到可 review 時寫
- 一次改一個核心問題
- 全部走 Git

### 對 planning pack
- promotion 後生成
- 除非 spec 變，否則不頻繁重生

### 對 runtime
- 正常 operational persistence

### 對 Edda
- 只記重要 transition / outcome
- append-only
- 不追求 current snapshot

---

## 17. 最小工程落地建議

如果現在要真做，我會這樣落地：

### 第一波
先把 L1 / L2 / L5 切出來：

#### Völva
- `decision_sessions`
- `card_snapshots`
- `candidate_records`
- `probe_records`

#### Spec docs
- `docs/world-design-v0/`
- `docs/plan/`

#### Edda
- decision precedent ingestion

### 第二波
再定：
- promotion handoff schema
- spec/source linking
- runtime feedback → Edda

---

## 18. 相關文件

| 文件 | 角色 |
|------|------|
| `persistence-policy-v0.md` | 各層寫入規則 |
| `volva-working-state-schema-v0.md` | L1 具體型別與 DB schema |
| `promotion-handoff-schema-v0.md` | 升格 handoff package |
| `cross-layer-ids-v0.md` | 跨層 ID 對齊 |
| `promotion-rollback-v0.md` | 升格退回機制 |
| `edda-ingestion-triggers-v0.md` | L5 寫入觸發條件 |

---

## 19. 最後一句

> **Storage topology 的重點，不是決定”資料放檔案還是放資料庫”；**
> **而是決定：哪種成熟度的決策狀態，該待在 working store、design store、runtime store、還是 precedent store。**
>
> 一旦這條拓樸清楚，聊天、spec、planning、runtime、memory 才不會互相踩位。