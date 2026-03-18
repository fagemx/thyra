# edda-ingestion-triggers-v0.md

> 狀態：`working draft`
>
> 目的：定義哪些 decision transition / outcome **自動**寫入 Edda，哪些**需要人工確認**，哪些**不應該進 Edda**。
>
> 這份文件不處理：
> - Edda 的內部資料結構（那是 Edda repo 的事）
> - 完整 precedent retrieval 語義（那是另一份 spec）
>
> 它只回答：
>
> > **什麼事情發生時，系統應該往 Edda 寫一筆？trigger 條件是什麼？哪些是自動的，哪些要人確認？**

---

## 1. 一句話

> **Edda 不是 log，不是 dump，不是全量鏡像。它是 decision spine 的長期記憶。**
>
> 只有「值得跨 session / 跨專案記住的 transition 與 outcome」才進 Edda。
> 其他的留在各自 layer 的 event log 裡。

---

## 2. 它不是什麼

### 不是 audit log
Audit log 記所有操作。Edda 只記有長期價值的 decision / outcome。

### 不是 working state mirror
Völva 的每輪 update 不應同步到 Edda。那會淹死 precedent。

### 不是 runtime event stream
Thyra 的每個 cycle event 不是都值得進 Edda。
只有那些改變了治理理解的 outcome 才值得。

---

## 3. Ingestion 三種模式

### 3.1 Auto-ingest
條件滿足即自動寫入，不需人工確認。

### 3.2 Suggest-ingest
系統建議寫入，但等人確認。

### 3.3 Never-ingest
明確不應進 Edda 的事件。

---

## 4. Auto-ingest Triggers

以下事件發生時，自動往 Edda 寫一筆：

### From L1 (Völva Working State)

| Trigger | Event Type | Why Auto |
|---------|-----------|----------|
| **Commit memo created** (verdict = commit) | `decision.commit` | A commit is a formal decision — always worth recording |
| **Candidate discarded with reason** | `decision.discard` | Why something was killed is high-value precedent |
| **Promotion check completed** | `decision.promotion` | Promotion decisions are structural — always record |
| **Promotion rollback triggered** | `decision.rollback` | "We promoted too early" is the most expensive precedent |

### From L4 (Thyra Runtime)

| Trigger | Event Type | Why Auto |
|---------|-----------|----------|
| **Outcome verdict = harmful** | `outcome.harmful` | Harmful outcomes must always be remembered |
| **Change rolled back** | `runtime.rollback` | Something was bad enough to undo — record why |
| **Governance adjustment applied** | `governance.patch.v1` | Law/chief/policy changes based on outcomes |
| **Safety invariant violation detected** | `safety.violation` | Non-negotiable — always record |

### From L2 (Spec Docs) — via Git hook or manual

| Trigger | Event Type | Why Auto |
|---------|-----------|----------|
| **shared-types.md major revision** (field renamed or type restructured) | `design.type_change` | Naming changes propagate everywhere — record the decision |

---

## 5. Suggest-ingest Triggers

System flags these for human review before writing to Edda:

### From L1

| Trigger | Suggested Because |
|---------|-------------------|
| **Route changed** (regime re-assigned mid-session) | May indicate a routing anti-pattern worth remembering |
| **Probe completed with ambiguous signal** | Might be a false positive pattern — but needs human judgment |
| **3+ candidates pruned in same session** | Could indicate space-builder generated low-quality candidates |

### From L4

| Trigger | Suggested Because |
|---------|-------------------|
| **Outcome verdict = inconclusive** after full window | May indicate metrics are wrong, not the change |
| **Same change kind applied 3+ times in short period** | Could indicate the change isn't actually solving the problem |
| **Chief permission escalation** | Worth recording if it reveals authority model gaps |

### From L2/L3

| Trigger | Suggested Because |
|---------|-------------------|
| **Spec patched 3+ times on same section** | Concept may not be stable — worth noting |
| **Planning track suspended** | Could be a promotion-too-early pattern |

---

## 6. Never-ingest List

These should NOT enter Edda:

| Event | Why Not |
|-------|---------|
| Each round of follow-up questions | Too granular, no long-term value |
| Working state snapshot updates | Ephemeral by nature |
| Candidate ranking within a session | Only the final commit/discard matters |
| Probe draft iterations | Only the completed probe result matters |
| Spec typo fixes | Not a decision |
| Planning task status changes | That's L3's concern, not precedent |
| Runtime pulse frames (individual) | Too frequent; only anomalies matter |
| Normal cycle completions | Only interesting when something goes wrong |

---

## 7. Edda Record Shape (minimal)

Each ingested record should at minimum have:

```ts
type EddaIngestionRecord = {
  id: string;                       // prec_... or dec_...
  triggerType: "auto" | "suggested" | "manual";
  eventType: string;                // from the trigger tables above
  sourceLayer: "L1" | "L2" | "L3" | "L4";

  sourceRefs: SourceRef[];          // from cross-layer-ids-v0.md
  summary: string;                  // one-sentence human-readable
  detail: Record<string, unknown>;  // structured payload

  tags: string[];                   // for retrieval: ["economic", "probe", "false-positive"]
  createdAt: string;
};
```

---

## 8. Ingestion Flow

```text
event occurs in L1 / L2 / L4
→ check against trigger tables
→ if auto-ingest: write to Edda immediately
→ if suggest-ingest: queue for human review
→ if never-ingest: skip
→ Edda record includes sourceRefs for traceability
```

### For suggest-ingest queue:

```ts
type EddaSuggestion = {
  id: string;                       // sug_...
  eventType: string;
  sourceRefs: SourceRef[];
  summary: string;
  suggestedBecause: string;
  status: "pending" | "accepted" | "rejected";
  reviewedAt?: string;
};
```

Rejected suggestions are discarded (not written to Edda).
Accepted suggestions become normal Edda records.

---

## 9. Canonical Example

### Auto-ingest: Economic candidate discarded

```text
Event: candidate cand_econ_003 discarded
Reason: "no buyer signal after 2 probes, acquisition friction too high"

→ auto-ingest triggered (candidate discarded with reason)

Edda record:
  id: prec_discard_econ_003
  triggerType: auto
  eventType: decision.discard
  sourceLayer: L1
  sourceRefs:
    - { layer: "L1", kind: "candidate", id: "cand_econ_003" }
    - { layer: "L1", kind: "session", id: "ds_session_001" }
    - { layer: "L1", kind: "probe", id: "probe_dm_001" }
    - { layer: "L1", kind: "probe", id: "probe_lp_002" }
  summary: "Economic candidate (workflow install service) discarded — no buyer signal after 2 probes"
  detail: { regime: "economic", form: "service", probeCount: 2, strongestSignal: "weak" }
  tags: ["economic", "discard", "no-buyer-signal", "service"]
```

### Suggest-ingest: Route changed mid-session

```text
Event: session ds_session_042 re-routed from "expression" to "economic"

→ suggest-ingest triggered (route changed mid-session)

Suggestion:
  id: sug_reroute_042
  summary: "Session re-routed from expression to economic after user clarified money intent"
  suggestedBecause: "Route changes may indicate router anti-patterns worth remembering"
  status: pending

→ Human reviews → accepts

Edda record:
  id: prec_reroute_042
  summary: "Router initially classified as expression due to 'video' keyword, corrected to economic after follow-up"
  tags: ["routing", "correction", "expression-vs-economic"]
```

---

## 10. Tuning Over Time

Trigger tables are not fixed forever. They should be tuned based on:

- **Noise level**: If auto-ingest produces too many low-value records → demote to suggest-ingest
- **Missed patterns**: If important decisions are being missed → promote from never to suggest or auto
- **Human review fatigue**: If suggest-ingest queue is always accepted → promote to auto

This tuning itself can be recorded in Edda as `meta.trigger_policy_change`.

---

## 11. 與其他文件的關係

| 文件 | 關係 |
|------|------|
| `persistence-policy-v0.md` | §8 L5 Edda policy — this file adds the trigger layer |
| `cross-layer-ids-v0.md` | Every Edda record uses `SourceRef` for traceability |
| `promotion-rollback-v0.md` | Rollback is an auto-ingest trigger |
| `storage-topology-v0.md` | This file defines what flows into L5 |
| `volva-working-state-schema-v0.md`（Völva repo） | L1 events are the primary source of triggers |

---

## 12. v0 不做什麼

- 不做 real-time streaming ingestion（v0 用 batch / event-driven）
- 不做 auto-summarization of ingested records（v0 人工寫 summary）
- 不做 cross-project precedent federation（v0 先 single-project）
- 不做 precedent expiry / garbage collection（v0 all precedents are permanent）

---

## 13. 最後一句

> **Edda 的價值不在於記得多，而在於記得對。**
>
> Auto-ingest 保證重大決策不遺漏。Suggest-ingest 讓邊緣案例有機會被記住。Never-ingest 防止噪音淹沒 precedent。
>
> 三者合起來，才讓 Edda 從「什麼都塞的垃圾桶」變成「有紀律的 decision spine」。
