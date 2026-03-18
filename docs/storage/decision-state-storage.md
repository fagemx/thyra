# decision-state-storage.md

> 狀態：`working draft`
>
> 目的：定義 decision engineering 裡各種狀態應該放在哪裡、何時持久化、如何同步、如何升格成 spec、哪些進 Edda、哪些只留在 working memory。
>
> 這份文件不處理：
> - 某個單一資料表設計（那是 Völva 的 `volva-working-state-schema-v0.md`）
> - 某個 repo 的局部實作
>
> 它只回答：
>
> > **當聊天、routing、space building、probe、commit、spec、planning、runtime 一路串起來時，狀態到底怎麼落地？**
> > **哪些是暫態？哪些要持久化？哪些要版本化？哪些要進 precedent？**

---

## 1. 一句話

> **Decision state 不應只存在記憶體裡。**
>
> 它必須依成熟度與用途，被分層存放到：
>
> 1. **working state store**（Völva / active session state）
> 2. **reviewable design store**（spec / cards / planning docs）
> 3. **precedent store**（Edda / decision spine）
>
> 三者不是重複，而是不同責任層。

---

## 2. 核心問題

我們現在其實已經有三條東西在跑，但還沒被工程化統整：

### A. 對話中的活狀態
例如：
- router 判成什麼 regime
- path certainty 是多少
- candidate space 現在有哪些
- active probe plan 是什麼
- 現在卡在哪個未知欄位

這些如果只在聊天裡，就會飄。

---

### B. 可 review / 可 patch 的設計狀態
例如：
- `intent-router.md`
- `path-check.md`
- `canonical-cycle.md`
- `midnight-market-canonical-slice.md`

這些已經不是 session 狀態，
而是跨 session 的設計物。

---

### C. 有長期價值的決策與結果
例如：
- 為什麼這次 route 判成 economic
- 哪個 candidate 被 kill
- 哪種 probe 產生假陽性
- 哪種 world form closure 最清楚
- 哪次 promotion 太早 / 太晚

這些不是當前 UI state，
而是 precedent。

---

## 3. 這份文件的主張

### 主張 1
**不要試圖用單一 store 裝全部。**

把所有東西都塞進：
- 一個 SQLite
- 一個 JSON
- 一堆 markdown
- 或 Edda

都會出事。

---

### 主張 2
**Decision state 要依“時間尺度 + 可修改性 + 是否需要 precedent”分層。**

這三個軸比單純問「放 DB 還是放檔案」更重要。

---

### 主張 3
**持久化不是目的，狀態轉換可追蹤才是目的。**

不是每一個瞬間都值得保存，
但每一個重要 transition 都應該有歸宿。

---

## 4. 三層 storage topology

> ⚠️ 本文件使用簡化的三層模型（Working / Reviewable / Precedent）。
> 完整六層模型（L0-L5）見 `storage-topology-v0.md`。
> 對應關係：本文 L1 = topology L1, 本文 L2 = topology L2, 本文 L3 = topology L5。
> topology 的 L0（conversation）、L3（planning）、L4（runtime）在本文不展開。

```text
L1 Working Decision State
Völva / active DB / session state / cards
└─ 短期、可頻繁更新、對話驅動

L2 Reviewable Design State
spec files / planning docs / promotion memos
└─ 可讀、可 patch、可 review、可交接

L3 Precedent / Decision Spine
Edda ledger / decision records / outcome-linked memory
└─ 長期、可查詢、可比較、可回溯
```

---

## 5. Layer 1 — Working Decision State

### 5.1 它是什麼
這是當前 still-in-motion 的 decision state。
它會頻繁更新，還不適合直接當最終 spec。

例如：

- primary regime
- secondary regimes
- path certainty
- missing fields
- candidate list
- probe readiness
- current working hypothesis
- last follow-up asked
- promotion readiness draft

---

### 5.2 它放哪裡
### 首選：Völva 的 DB / card state
不是 memory-only。

我建議這層至少要持久化在 Völva 自己的 store 裡，
而不是只靠 session memory。

### 可以是：
- SQLite table
- JSON blob in DB
- normalized card tables
- append-only card updates + current snapshot

---

### 5.3 它不應該放哪裡
- 不應只放 agent 記憶體
- 不應直接放 Edda
- 不應一開始就寫成正式 spec

---

### 5.4 為什麼
因為這一層的特性是：

- 高頻修改
- 還不夠穩
- 需要對話回合間續接
- 需要局部 patch
- 但不一定值得進 long-term precedent

---

## 6. Layer 1 的建議資料形狀

> ⚠️ 以下為早期草稿版本，欄位與 enum 值可能與正式版不一致。**請勿以此為準。** 正式定義見 `volva-working-state-schema-v0.md`（Völva repo）。

### DecisionSession
```ts
type DecisionSession = {
sessionId: string;
userId?: string;
primaryRegime?: Regime;
secondaryRegimes?: Regime[];
pathCertainty?: "low" | "medium" | "high";
currentStage:
| "routing"
| "path-check"
| "space-building"
| "probing"
| "commit-review"
| "spec-review"
| "promotion-check";

keyUnknowns: string[];
updatedAt: string;
};
```

### CandidateRecord
```ts
type CandidateRecord = {
id: string;
sessionId: string;
regime: Regime;
description: string;
status: "generated" | "pruned" | "probe-ready" | "probing" | "committed" | "discarded";
whyThisExists: string[];
notes?: string[];
};
```

### ProbeRecord
```ts
type ProbeRecord = {
id: string;
candidateId: string;
hypothesis: string;
judge: string;
probeForm: string;
status: "draft" | "running" | "completed";
signalSummary?: string;
};
```

---

## 7. Layer 2 — Reviewable Design State

### 7.1 它是什麼
一旦某個 decision state 穩到值得：
- 被人看
- 被 patch
- 被交接
- 被納入架構討論

它就應該升格成文件。

這一層就是你現在的：

- `world-design-v0`
- `intent-router.md`
- `path-check.md`
- `probe-commit.md`
- `canonical-cycle.md`
- `world-cycle-api.md`

---

### 7.2 它放哪裡
### 首選：repo 內文件 + Git
例如：
- `docs/world-design-v0/`
- `docs/plan/`
- `docs/...`

這層本質就是：
> **reviewable source of design truth**

---

### 7.3 它的特性
- 不應高頻每回合改
- 一次改一個核心問題
- 要可 diff
- 要可 patch
- 要可 review
- 要能連到 shared-types / neighboring specs

---

### 7.4 這層不是 working DB 的 dump
很重要。

文件不是 working state export。
而是**被收斂後的 decision state crystallization**。

也就是：

- working state 是活的、亂流的
- spec state 是凝固後可檢視的

兩者不能混。

---

## 8. Layer 2 的產物類型

至少有這幾種：

### A. Core spec
- overview
- canonical form
- schema
- rules
- APIs

### B. Grounding spec
- canonical slice
- demo path

### C. Bridging spec
- handoff contract
- promotion handoff
- shared-types

### D. Planning spec
- 之後升格成 `project-plan`

---

## 9. Layer 3 — Precedent / Decision Spine

### 9.1 它是什麼
不是現在的工作狀態。
而是那些值得跨 session / 跨專案 / 跨世界重用的 decision traces。

例如：

- 某種 routing 常常誤判
- 某種 probe 在 economic regime 裡是假陽性
- 某種 world form 在 v0 很難 closure
- 某次 promotion 太早，導致後面返工
- 某個 naming drift pattern 很常出現

---

### 9.2 它放哪裡
### 首選：Edda
因為它最適合做：
- append-only decision memory
- precedent retrieval
- why this worked / failed
- cross-session recall

---

### 9.3 它不應該承擔什麼
- 不應當 current working store
- 不應當 spec authoring store
- 不應當 UI live state

Edda 是 spine，不是全部器官。

---

## 10. 什麼該進 Edda？

這很重要，因為不是所有狀態都值得寫進 precedent。

### 應該進 Edda 的
#### 1. 重要 routing decisions
- 為什麼判 economic 而不是 expression
- 哪類語句常造成混淆

#### 2. 重要 path-check decisions
- 為什麼這次沒有 direct Forge
- 哪些 unresolved elements 是 blockers

#### 3. candidate kill / commit reasons
- 哪條路為什麼被砍
- 哪條路為什麼被 commit

#### 4. probe outcomes
- 哪種 probe 產生真 signal
- 哪種 probe 產生假陽性

#### 5. promotion results
- 哪次升格成功
- 哪次升格過早

#### 6. runtime consequences
- 哪種 change / world form / law 調整帶來什麼後果

---

### 不應該進 Edda 的
- 每輪 follow-up 問題草稿
- 每次暫時性 candidate 排序
- 尚未穩定的命名試驗
- 細碎的 UI state

這些應該留在 Völva working state。

---

## 11. 狀態生命週期

這裡是整份最重要的一段之一。

### Stage A — Volatile
剛在聊天中長出來，還在飄。

存：
- in-memory + Völva DB

### Stage B — Working
已經有形狀，但還在 patch。

存：
- Völva DB / cards / working documents

### Stage C — Reviewable
足夠穩，值得進 spec。

存：
- docs / git

### Stage D — Promoted
足夠穩，變成 planning input 或 runtime input。

存：
- docs/plan or runtime config/state

### Stage E — Precedented
經過實際使用或結果驗證，有長期價值。

存：
- Edda

---

## 12. 更新策略

### 12.1 Working state
可以頻繁更新
例如每輪對話都 patch：

- primary regime
- missing fields
- candidate set
- probe state

### 12.2 Spec state
應該批次更新
不是每輪都改文檔。

建議：
- 一輪對焦後更新一次
- 一次只 patch 1–2 份 spec

### 12.3 Precedent state
只在重要 transition 或 outcome 出現時寫入
不要把每個小變動都寫進 Edda。

---

## 13. 同步問題：我們現在真的還沒統整好的地方

> 以下問題在 v0 已大部分被處理，見各子項標注的對應文件。

這就是你最後那句點到的核心。

目前真正缺的是：

# **storage lifecycle and sync policy**

我會直接列出還沒定的工程問題。

---

### 13.1 Völva working state 和 spec 之間怎麼同步？

> ✅ 已被處理：見 `volva-working-state-schema-v0.md`。

現在還沒明確定：
- 何時把 card state 升成 spec
- 是人工觸發還是半自動
- spec 改了之後，要不要回寫 card summary

---

### 13.2 spec 和 planning 之間怎麼 handoff？

> ⚠️ 部分處理：見 `persistence-policy-v0.md` §9（Crystallization policy）。

雖然有 promotion 概念，
但還沒完全定：
- promotion package 格式
- 哪些欄位必填
- 哪些 gaps 可以帶著進 planning
- 哪些 gaps 必須先補完

---

### 13.3 Edda 寫入時機還沒制度化

> ✅ 已被處理：見 `edda-ingestion-triggers-v0.md`。

現在只是概念上說它是 decision spine，
但還沒定：
- 哪些 transition 自動寫
- 哪些 outcome 才值得記
- 怎麼避免噪音 precedent

---

### 13.4 同一 decision object 的多重表示怎麼對齊？

> ✅ 已被處理：見 `promotion-handoff-schema-v0.md`。

例如一個 candidate 可能同時存在於：
- Völva working DB
- spec doc
- Edda precedent

這三者之間：
- ID 怎麼共用？
- version 怎麼對？
- source of truth 是哪個？

這現在還沒完全定。

---

### 13.5 Git / DB / Edda 的角色分工還沒被工程化

> ⚠️ 部分處理：見 `persistence-policy-v0.md` §12（Conflict resolution policy）。

目前只是概念分工，還沒形成明確 write policy。

---

## 14. 建議的 source-of-truth 原則

這裡要先定，不然之後會亂。

### A. Working active truth
當前對話與決策進度
→ **Völva DB**

### B. Reviewable design truth
當前已收斂的系統定義
→ **spec files in Git**

### C. Historical decision truth
為什麼這樣收斂、哪些曾被證明有效 / 無效
→ **Edda**

這三者不要搶同一層 truth。

---

## 15. ID / versioning 建議

> ⚠️ 以下 ID prefix 為早期建議。正式 prefix convention 見 `cross-layer-ids-v0.md` §3。
> 例：`candidate_` → `cand_`，`promotion_` → `promo_`。

這一塊很工程，但非常重要。

### 每個 decision object 應該有 stable id
例如：

- `intent_...`
- `candidate_...`
- `probe_...`
- `commit_...`
- `promotion_...`

### 每次重要 transition 應該有 event id
例如：
- `evt_route_...`
- `evt_probe_complete_...`
- `evt_commit_...`

### spec 文件應該記來源 object ids
例如在文件頭或 metadata 寫：
- linked candidate ids
- linked promotion id
- linked handoff ids

這樣 Völva / spec / Edda 才能互相對齊。

---

## 16. 建議的 persistence policy

### Policy 1
所有 router/path-check/commit 的**結果**都要持久化
不要只存 prompt / reply。

### Policy 2
所有 promotion decisions 都要有 record
因為這是最關鍵的升格點。

### Policy 3
所有 spec stack 變更都走 Git
不要只靠 DB 版本。

### Policy 4
所有 precedent-worthy outcomes 都寫進 Edda
但不要把 working chatter 寫進去。

### Policy 5
working state 可以 overwrite snapshot，但重大 transition 要 append log

---

## 17. 建議的技術分工

### Völva
- SQLite / DB
- card snapshots
- active decision sessions
- candidate/probe state

### Git-backed docs
- architecture spec stack
- project-plan
- review outputs
- promotion package

### Edda
- append-only decision events
- precedent summaries
- outcome-linked decision traces

這樣比較健康。

---

## 18. 相關文件

這份文件提出的三層分工，已在以下文件中被工程化：

- `storage-topology-v0.md` — 六層 storage 拓樸圖（L0-L5）
- `volva-working-state-schema-v0.md` — L1 working state 的具體型別與 DB schema
- `persistence-policy-v0.md` — 各層寫入規則（ephemeral / snapshot / append-only / versioned）
- `promotion-handoff-schema-v0.md` — 升格時的 handoff package schema
- `cross-layer-ids-v0.md` — 跨層 ID 對齊與 SourceRef 機制
- `promotion-rollback-v0.md` — 升格退回的安全機制
- `edda-ingestion-triggers-v0.md` — Edda 寫入觸發條件（auto / suggest / never）

---

## 19. 最後一句

> **Decision state transition 不是一坨該放在哪裡的資料；它是一個”狀態如何改變”的事件。**
>
> **當前工作狀態應放在 Völva，穩定後的設計狀態應放在 Git-backed spec，具有長期價值的轉換與結果應沉澱到 Edda。**
>
> 三層之間的持久化、同步、升格、版本與 ID 對齊規則，見上方相關文件。