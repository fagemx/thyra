# promotion-rollback-v0.md

> 狀態：`working draft`
>
> 目的：定義當 promotion 太早或結果不如預期時，如何安全地把狀態降回上一層。
>
> 這份文件不處理：
> - 正常 promotion 流程（那是 `promotion-handoff-schema-v0.md`）
> - runtime rollback（change apply 後的 rollback，那是 Thyra 的 `judgment-rules-v0.md`）
>
> 它只回答：
>
> > **如果 spec 升格成 project-plan 後發現概念沒穩，或者 world form 升格成 Thyra runtime 後發現 closure 跑不通，怎麼退回來？**

---

## 1. 一句話

> **Promotion rollback 不是 undo，是「承認這層還不成熟，退回上一層繼續 spec」。**
>
> 它不會消除已經做過的工作，而是改變 source of truth 的位置。

---

## 2. 它不是什麼

### 不是 Git revert
不是把已 commit 的 spec 或 planning 文件刪掉。
而是把 truth 的位置從下一層退回上一層。

### 不是 runtime rollback
Thyra 的 change rollback（`applied_change → rolled_back`）是 runtime 層面的。
Promotion rollback 是 design/planning 層面的。

### 不是「重來一遍」
已經做過的 spec、planning、甚至部分 build，都不需要丟掉。
它們變成 evidence / precedent，不是垃圾。

---

## 3. 兩種 Promotion Rollback

### Type A: project-plan → arch-spec

**觸發條件**：
- Planning 開始拆 track 後發現 canonical form 其實還沒穩
- Task 開始做後發現 shared-types 有根本衝突
- Track 依賴的 spec 被發現回答了錯的核心問題
- 名詞在 implementation 過程中又開始飄

**動作**：
1. 標記 planning pack 為 `suspended`
2. 回到 arch-spec stack，標註哪些 spec 需要 re-review
3. 產生 rollback memo（記錄為什麼退回）
4. 退回的原因寫入 Edda 作為 precedent

### Type B: thyra-runtime → arch-spec

**觸發條件**：
- World instantiate 後發現 minimum closure 跑不通
- 第一個 cycle 跑完後發現 change kinds 不夠覆蓋真實場景
- Pulse / outcome 語義和 spec 預期差太遠
- Chiefs / laws 的實際行為和 spec 定義脫節

**動作**：
1. 標記 world 為 `suspended`（不是 `closed`，保留 state）
2. 回到 arch-spec stack，標註哪些 spec 需要 patch
3. 產生 rollback memo
4. Runtime 觀察到的問題寫入 Edda

---

## 4. Rollback Memo

每次 rollback 都要產出一份：

```ts
type PromotionRollbackMemo = {
  id: string;                       // rollback_...
  originalHandoffId: string;        // 回指原本的 promotion handoff
  fromLayer: "project-plan" | "thyra-runtime";
  toLayer: "arch-spec";

  reason: string;                   // 一句話：為什麼要退回
  discoveredProblems: string[];     // 具體發現的問題
  specsNeedingReview: string[];     // 哪些 spec 需要 re-review
  whatStillValid: string[];         // 哪些已做的工作仍然有效
  whatInvalidated: string[];        // 哪些假設被推翻

  eddaRecordId?: string;            // 如果已寫入 Edda
  createdAt: string;
};
```

---

## 5. Rollback 後的狀態

### Source of truth 回到上一層

| Before rollback | After rollback |
|-----------------|----------------|
| L3 planning pack 是 execution truth | L3 marked `suspended`，L2 spec 重新成為 design truth |
| L4 runtime 是 live truth | L4 marked `suspended`，L2 spec 重新成為 design truth |

### 已做的東西不刪除

- Planning pack 保留但標記 `suspended`
- Runtime world 保留但標記 `suspended`
- 已寫的 code / tests 保留在 branch，不 merge
- 這些變成下一輪 spec review 的 evidence

### ID 鏈保持完整

Rollback 不斷開 source linking chain。
Rollback memo 本身也帶 sourceRef 回指 original handoff。

---

## 6. Rollback 後回到 arch-spec 的流程

```text
rollback triggered
→ produce rollback memo
→ record to Edda (precedent: "promotion X was too early because Y")
→ mark downstream as suspended
→ re-enter arch-spec review mode
→ /arch-spec review <path> with focus on discovered problems
→ patch affected specs
→ re-run promotion check
→ if passes: re-promote with updated handoff
```

---

## 7. 防止過早 promotion 的最佳方式

Rollback 是 safety net，不是常態。

最好的方式是在 promotion 前就攔住：

### Promotion Checklist（from `promotion-handoff-schema-v0.md`）
- 名詞穩定？
- Canonical form 存在？
- Canonical slice 存在？
- 至少一條 closure 可示範？
- shared-types 收斂？

### 額外的 rollback-prevention signals
- 最近 2 次討論有沒有改名？→ 如果有，不要 promote
- Demo path 能不能跑完？→ 如果不能，不要 promote
- 有沒有跨 spec 的 type conflict？→ 如果有，先修再 promote

---

## 8. Canonical Example

### Scenario: Thyra runtime rollback

```text
promotion: arch-spec → thyra-runtime (Midnight Market)
handoff_id: handoff_mm_001

Phase 1: world instantiate → OK
Phase 2: first cycle → observe/propose/judge OK
Phase 3: apply change → congestion metric 沒下降
Phase 4: outcome window → closure 跑不通，pulse 語義和 spec 不一致

→ rollback triggered

rollback_memo:
  id: rollback_mm_001
  originalHandoffId: handoff_mm_001
  fromLayer: thyra-runtime
  toLayer: arch-spec
  reason: "pulse metric semantics don't match spec definition; closure can't complete"
  discoveredProblems:
    - "congestion_score doesn't respond to throttle_entry as expected"
    - "pulse mode compound strings still in runtime despite spec saying discrete enum"
  specsNeedingReview:
    - "pulse-and-outcome-metrics-v0.md"
    - "shared-types.md §6.1 WorldMode"
  whatStillValid:
    - "world state structure"
    - "change proposal schema"
    - "judgment 4-layer stack"
  whatInvalidated:
    - "pulse metric → governance adjustment feedback loop"

→ Edda records: prec_promotion_too_early_mm_001
→ world_midnight_market_001 marked suspended
→ arch-spec review re-enters on pulse-and-outcome-metrics-v0.md
```

---

## 9. 與其他文件的關係

| 文件 | 關係 |
|------|------|
| `promotion-handoff-schema-v0.md` | 正向：定義正常 promotion 的 handoff 包 |
| `persistence-policy-v0.md` | 定義 suspended 狀態的 write policy |
| `cross-layer-ids-v0.md` | rollback memo 使用 sourceRef 回指 original handoff |
| `edda-ingestion-triggers-v0.md` | rollback 是 Edda auto-ingest trigger 之一 |

---

## 10. v0 不做什麼

- 不做 multi-hop rollback（A→B→C 直接退回 A）。v0 只退一層。
- 不做 partial rollback（某些 track suspend 但其他繼續）。v0 先整包 suspend。
- 不做 auto-rollback trigger。v0 先靠人工判斷。

---

## 11. 最後一句

> **Promotion rollback 不是失敗，是 decision engineering 的常態安全機制。**
>
> 它讓你可以大膽 promote（因為退回是安全的），而不是永遠停在 spec 裡不敢往前走。
>
> 關鍵是：退回時不丟工作、不斷 ID 鏈、不忘記教訓。
