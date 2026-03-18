# persistence-policy-v0.md

> 狀態：`working draft`
>
> 目的：定義 decision engineering 各層的 **寫入規則、更新規則、版本規則、同步原則**。
>
> 如果 `storage-topology-v0.md` 解的是「東西放哪裡」，
> 那這份解的是：
>
> > **誰可以寫？什麼時候寫？寫成 snapshot 還是 append-only？什麼該 overwrite，什麼不該？**

---

## 1. 一句話

> **Persistence policy 的核心不是多存，而是有紀律地存。**
>
> 我們要避免兩種失敗：
> 1. 什麼都不存，結果全靠聊天與記憶體
> 2. 什麼都存，結果 source of truth 混亂、噪音淹沒 precedent

---

## 2. 它不是什麼

### 不是資料庫 schema
這份不定義表結構（那是 `volva-working-state-schema-v0.md`）。
它定義的是「誰什麼時候可以用什麼模式寫哪一層」。

### 不是全域同步協議
它明確反對跨層雙向自動同步（§11）。
大部分跨層動作是升格（crystallize / promote），不是同步。

### 不是 audit policy
audit log 記所有操作。
persistence policy 定義的是哪些狀態值得持久化、以什麼模式持久化。

---

## 3. 四種寫入模式

整套系統裡，只允許四種主要寫入模式：

### 3.1 Ephemeral
只在當前記憶體 / process 內，不保證跨回合。

### 3.2 Snapshot overwrite
保留最新版本，舊值可由事件或 Git 歷史追。

### 3.3 Append-only event
每次重要 transition 都記一筆，不改舊記錄。

### 3.4 Versioned document
用檔案 + Git 保留版本演化。

---

## 3. 各層對應的寫入模式

| 層 | 主要模式 | 補充模式 |
|---|---|---|
| L0 conversation | append-only transcript | — |
| L1 Völva working state | snapshot overwrite | append-only events |
| L2 spec docs | versioned document | — |
| L3 planning pack | versioned document | — |
| L4 runtime state | snapshot overwrite | append-only events |
| L5 Edda precedent | append-only event/record | derived summaries |

---

## 4. L1 — Völva working state policy

### 4.1 可以 overwrite 的
- current stage
- current summary
- key unknowns current list
- candidate current status
- active probe draft

### 4.2 必須 append 的
- route assigned / changed
- path certainty changed
- candidate pruned / committed / discarded
- probe completed
- commit memo created
- promotion check verdict changed

### 4.3 不能只留 ephemeral 的
- regime result
- path-check result
- candidate list
- probe result summary

因為這些都會影響後續對話與 promotion。

---

## 5. L2 — Spec docs policy

### 5.1 一律走 Git
不要把 spec 真相放在 DB。

### 5.2 一次 patch 一個核心問題
避免一個 commit 同時：
- 改 canonical form
- 改 API
- 改 naming
- 改 slice

這樣很難 review。

### 5.3 spec 不接受 silent sync
working DB 變了，不代表 spec 自動跟著改。
必須經過 crystallization / promotion 決策。

### 5.4 shared-types 是單一來源
一個跨文件型別，只能在 `shared-types.md` 有 canonical 定義。

---

## 6. L3 — Planning pack policy

### 6.1 只從 promotion package 生成
不要直接從聊天或散亂 spec 臨時生成。

### 6.2 planning 是 derivative truth
它對 execution ordering 是 truth，
但對 architecture semantics 不是上游 truth。

### 6.3 spec 大改時，planning 需重新檢查
如果 canonical form 或 shared-types 改了，
planning 不應假設仍然有效。

---

## 7. L4 — Runtime state policy

### 7.1 current live state 用 DB / runtime store 保存
例如：
- worlds
- snapshots
- proposals
- pulse frames
- outcomes

### 7.2 重要 runtime transitions append event
例如：
- change applied
- rollback executed
- outcome closed
- law adjustment proposed

### 7.3 runtime 不自動覆蓋 architecture truth
live system 的觀察可以挑戰 spec，
但不能直接靜默改 spec。
必須透過 review / patch / promotion 路徑回流。

---

## 8. L5 — Edda policy

### 8.1 Edda 只收「值得長期記住的 decision/outcome」
不是所有 working event。

### 8.2 append-only
precedent 不應被覆蓋，只能 supersede / add newer interpretation。

### 8.3 來源要可追
每筆 precedent 至少要能回指：
- session / spec / runtime object / outcome report

### 8.4 禁止把 Edda 當 current state DB
這點一定要守住。

---

## 9. Crystallization policy（L1 -> L2）

這是現在最需要被制度化的路徑之一。

### 何時從 working state 升成 spec
符合以下任兩到三項即可考慮：
- 名字穩定
- 可被 review
- 對後續有交接價值
- 不是下一輪對話就會推翻的小假設
- 已經跨 2+ decision events 重複出現

### 升格時應寫哪些 metadata
- source session ids
- source card ids
- source candidate / commit ids
- promoted_at
- promoted_by

---

## 10. Promotion policy（L2 -> L3 / L4）

### 規則
promotion 不是「覺得差不多」，而是：
- 有 checklist
- 有 handoff schema
- 有 known gaps
- 有 source links

### project-plan promotion
需要：
- canonical form
- stable nouns
- constraints
- canonical slice
- demo path

### thyra-runtime promotion
需要：
- world form
- minimum world
- closure target
- runtime constraints

---

## 11. Sync policy

### 原則：少同步，多升格
不要做全域雙向同步。這會非常脆弱。

### 允許的同步
#### 同層同步
- working snapshot 與 working event 間對齊
- runtime snapshot 與 runtime event 間對齊

### 不鼓勵的同步
- working DB ↔ spec docs 雙向自動同步
- spec docs ↔ Edda 自動全量同步
- runtime DB ↔ spec docs 靜默同步

### 推薦模型
- L1 -> L2：crystallize
- L2 -> L3/L4：promote
- L1/L2/L4 -> L5：record precedent

---

## 12. Conflict resolution policy

### 情況 A：working state 與 spec 不一致
預設：
- spec 是 reviewable design truth
- working state 是下一輪討論草稿

若 working state 想推翻 spec，必須：
- review
- patch spec
而不是私下 diverge。

### 情況 B：runtime outcome 與 spec 假設不一致
預設：
- runtime truth 對 live facts 優先
- 但 spec 不自動被覆蓋
- 需產生 patch / governance adjustment / new precedent

### 情況 C：Edda precedent 與現行 spec 衝突
預設：
- precedent 是 warning / evidence
- 不直接 override spec
- 需觸發 review

---

## 13. Minimal write rules

### Rule 1
所有 router / path-check 結果都必須落 L1。

### Rule 2
所有 candidate status 變化都必須寫 event。

### Rule 3
所有 commit / hold / discard verdict 都必須有 memo。

### Rule 4
所有 promotion 都必須有 handoff package。

### Rule 5
所有重大 runtime outcome 都必須決定：
- 只留 runtime
- 還是升格進 Edda

---

## 14. 建議的 ownership

| 層 | 主要 owner |
|---|---|
| L1 working state | Völva |
| L2 design state | repo docs + Git workflow |
| L3 planning state | project-plan / planning owner |
| L4 runtime state | Thyra / Karvi / service runtime |
| L5 precedent state | Edda |

Ownership 一定要清楚，不然會互相覆蓋。

---

## 15. v0 還沒解完的問題

> 以下問題在 v0 已大部分被處理，見各子項標注的對應文件。

### 15.1 event granularity

> ⚠️ 仍為開放問題，尚未有專門文件處理。

哪些 working events 算重要，還需校準。

### 15.2 cross-repo identity

> ✅ 已被處理：見 `cross-layer-ids-v0.md`。

同一 candidate / world / promotion 在不同 repo 如何共用 ids，還沒完全定。

### 15.3 automated precedent selection

> ✅ 已被處理：見 `edda-ingestion-triggers-v0.md`。

哪些東西自動送 Edda、哪些人工確認，還沒定。

### 15.4 promotion rollback

> ✅ 已被處理：見 `promotion-rollback-v0.md`。

如果升格後發現太早，如何降回上一層，還需定規則。

---

## 16. 最後一句

> **Persistence policy 的核心不是「都存下來」；而是讓不同層的 truth 各待其位：working state 能續接、spec state 能 review、planning state 能派工、runtime state 能運作、precedent state 能記住。**
>
> 沒有這套政策，storage topology 只是一張圖；有了它，decision engineering 才真正開始有工程地基。
