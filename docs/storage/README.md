# Storage Docs — README

> 狀態：`working draft`
>
> 目的：作為 `docs/storage/` 的索引，說清楚這組文件在回答什麼、彼此怎麼接、應該先讀哪份、什麼時候要補下一層。

---

## 一句話

`docs/storage/` 這組文件在處理的不是產品功能，
而是：

> **decision engineering / arch-spec / planning / runtime / precedent 這幾層之間，狀態到底怎麼存、怎麼升格、怎麼 handoff、怎麼避免 source of truth 混亂。**

這一組文件是 `world-design-v0` 與真正工程落地之間的橋。

---

## 這個資料夾解的核心問題

當前整體架構已經有幾條線：

- **Völva**：intent / path / space / probe / commit
- **Spec Stack**：可 review、可 patch 的設計狀態
- **project-plan**：tracks / tasks / DoD / validation
- **Thyra Runtime**：live world / change / judgment / pulse / outcome
- **Edda**：decision spine / precedent

但如果沒有 storage 層，這些線會出現幾個典型問題：

- working state 只留在聊天與記憶體
- spec 與 working state 互相覆蓋
- planning 不知道該吃哪份真相
- runtime outcome 回不到 decision layer
- Edda 變成什麼都塞的垃圾桶

`docs/storage/` 就是在處理這些問題。

---

## 文件索引

### 1. `decision-engineering.md`

**回答：我們現在到底在工程化什麼？**

這份是總綱。
它把 skill、spec、track、promotion、runtime、precedent 串成同一條 decision engineering 鏈。

如果你還在想：
- 為什麼需要這麼多中介層？
- skill / spec / track 有什麼本質差別？
- 什麼叫把決策修改工程化？

先讀這份。

---

### 2. `decision-state-storage.md`

**回答：decision state 到底是 state、data、還是 transition？應該放哪裡？**

這份是 storage thinking 的中樞。
它先把 decision state 拆成：

- working state
- reviewable design state
- precedent state

並說明：
- 哪些可以先留在 working memory / DB
- 哪些要升格成 spec
- 哪些值得進 Edda

如果你在問：
- 這些東西到底放記憶體、資料庫、文件、還是 Edda？

先讀這份。

---

### 3. `storage-topology-v0.md`

**回答：整張 storage 拓樸圖長什麼樣？**

這份把系統切成五層：

- L0 conversation
- L1 working decision state
- L2 reviewable design state
- L3 execution design state
- L4 live runtime state
- L5 precedent state

它的重點是：
不是決定「都放哪個 DB」，
而是定義不同 truth 應該待在哪一層。

如果你需要整張圖，讀這份。

---

### 4. `volva-working-state-schema-v0.md`（已遷移至 Völva repo）

**回答：Völva 的 working state 應該具體長什麼樣？**

> ⚠️ 此文件已遷移至 `C:\ai_agent\volva\docs\storage\volva-working-state-schema-v0.md`。
> Thyra 側保留指引文件。

這份開始從概念進入資料結構。
目前定了：

- `DecisionSession`
- `CardSnapshot`
- `CandidateRecord`
- `ProbeRecord`
- `SignalPacket`
- `CommitMemoDraft`
- `PromotionCheckDraft`
- `DecisionEvent`

如果你想真正開始設計：
- Völva DB
- session state
- cards / candidates / probes 的持久化

讀這份。

---

### 5. `promotion-handoff-schema-v0.md`

**回答：從某一層升格到下一層時，要交什麼資料包？**

目前先定兩種 promotion：

- `arch-spec -> project-plan`
- `arch-spec -> thyra-runtime`

這份很重要，因為它把 promotion 從「感覺差不多」變成真正的工程接口。

如果你在問：
- spec 要怎麼交給 planning？
- world form 要怎麼交給 Thyra runtime？

讀這份。

---

### 6. `persistence-policy-v0.md`

**回答：誰什麼時候可以寫哪一層？寫 snapshot 還是 append-only？**

這份在定 write policy。
目前把整套系統的寫入模式切成：

- ephemeral
- snapshot overwrite
- append-only event
- versioned document

並分別套到：
- Völva working state
- spec docs
- planning pack
- runtime
- Edda

如果你在問：
- 哪些能 overwrite？
- 哪些一定 append-only？
- 為什麼不做雙向同步？

讀這份。

---

## 建議閱讀順序

### 路線 A：先抓全貌
1. `decision-engineering.md`
2. `storage-topology-v0.md`
3. `persistence-policy-v0.md`

### 路線 B：先解「東西放哪裡」
1. `decision-state-storage.md`
2. `storage-topology-v0.md`
3. `volva-working-state-schema-v0.md`

### 路線 C：先做工程接口
1. `promotion-handoff-schema-v0.md`
2. `persistence-policy-v0.md`
3. `volva-working-state-schema-v0.md`

---

## 一句話版邊界

### Völva
保存 **working decision state**。Schema 見 Völva repo `docs/storage/volva-working-state-schema-v0.md`。

### Spec Docs / Git
保存 **reviewable design truth**。

### project-plan
保存 **execution design truth**。

### Thyra Runtime
保存 **live operational truth**。

### Edda
保存 **long-term precedent truth**。

---

## 這組文件和 `world-design-v0` 的關係

`world-design-v0` 比較像：
- 系統是什麼
- cycle 是什麼
- schema / API / slice 長什麼樣

`docs/storage/` 比較像：
- 這些狀態應該怎麼落地
- 什麼時候從 working state 升格成 spec
- 什麼時候 promotion 到 planning 或 runtime
- 哪些 transition 應該被 Edda 記住

換句話說：

> `world-design-v0` 在定義 **結構與語義**
> `docs/storage/` 在定義 **狀態與持久化拓樸**

---

### 7. `cross-layer-ids-v0.md`

**回答：同一個 decision object 跨 L1→L2→L3→L4→L5 時，ID 怎麼對齊？**

定義了：
- 每層的 ID prefix convention（`ds_`, `cand_`, `spec://`, `world_`, `prec_`...）
- `SourceRef` 型別 — 跨層追蹤的核心機制
- 規則：downstream 必須記住 upstream source，不要求雙向

如果你在問：
- 同一個 candidate 在 Völva DB 和 Edda 裡怎麼互相認？

讀這份。

---

### 8. `promotion-rollback-v0.md`

**回答：如果 promotion 太早，怎麼安全退回？**

定義了：
- 兩種 rollback：project-plan → arch-spec、thyra-runtime → arch-spec
- `PromotionRollbackMemo` schema
- Rollback 後的狀態處理（suspended，不是 deleted）
- ID 鏈不斷開的原則

如果你在問：
- promote 了但發現跑不通怎麼辦？

讀這份。

---

### 9. `edda-ingestion-triggers-v0.md`

**回答：什麼事件發生時自動寫 Edda？什麼需要人確認？什麼不該進？**

定義了三種模式：
- **auto-ingest**：commit memo, candidate discard, promotion, rollback, harmful outcome, safety violation
- **suggest-ingest**：route change, ambiguous probe, repeated change kind
- **never-ingest**：follow-up drafts, snapshot updates, ranking iterations, typo fixes

如果你在問：
- Edda 怎麼避免變垃圾桶？

讀這份。

---

## 還沒補完的缺口

### 1. conflict policy
當 working state、spec、runtime、precedent 互相衝突時，誰優先、怎麼觸發 review。
（`persistence-policy-v0.md` §12 有初步定義，但還沒獨立成文件。）

---

## 最後一句

> **`docs/storage/` 不是在補充一點資料庫細節。**
>
> **它在做的是：讓 decision engineering 裡不同成熟度、不同用途、不同時間尺度的狀態，開始有清楚的落點、升格路徑與寫入規則。**
>
> 沒有這組文件，前面的 spec stack 很容易停在概念；有了這組文件，整條鏈才開始有真正的工程地基。
