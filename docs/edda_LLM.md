● 好，Edda 的全貌已經拿到。讓我先釐清邊界，再談 LLM 怎麼加。

  ---
  Thyra vs Edda 職責劃分（現狀）

  Thyra (治理大腦)                    Edda (決策記憶)
  ─────────────────                   ─────────────────
  做決策：「這輪該做什麼」              記決策：「上次做了什麼、結果如何」
  DecisionEngine 四層邏輯               hash-chained 事件帳本
  讀 constitution + law                 存 events + decisions（key=value）
  產出 ActionIntent                     提供 keyword/domain 查詢
  呼叫 Edda 查判例 ──────→             ←── 回傳 DecisionHit[]
  記錄 DecideSnapshot ──────→          ←── 存成 event

  核心區別：

  ┌──────────┬──────────────────────────────────┬─────────────────────────────┐
  │   維度   │              Thyra               │            Edda             │
  ├──────────┼──────────────────────────────────┼─────────────────────────────┤
  │ 動詞     │ decide（決定做什麼）             │ remember（記得做過什麼）    │
  ├──────────┼──────────────────────────────────┼─────────────────────────────┤
  │ 資料流向 │ 消費者（讀判例）                 │ 生產者（存判例）            │
  ├──────────┼──────────────────────────────────┼─────────────────────────────┤
  │ 狀態     │ 有 active constitution/law/chief │ 有 append-only event ledger │
  ├──────────┼──────────────────────────────────┼─────────────────────────────┤
  │ 可變性   │ 狀態機（supersede, revoke）      │ 不可變鏈（hash-chain）      │
  ├──────────┼──────────────────────────────────┼─────────────────────────────┤
  │ LLM 角色 │ Phase 2: 輔助排序 + 推理         │ 目前：零 LLM                │
  └──────────┴──────────────────────────────────┴─────────────────────────────┘

  ---
  現在的痛點：Edda 的查詢太笨

  Thyra DecisionEngine Phase 1 查 Edda：

  eddaBridge.queryDecisions({
    domain: villageId,
    keyword: lastAction?.type,  // e.g. "draft_content"
    limit: 10,
  });

  Edda 回的是 keyword match — 撈到 draft_content 出現過的所有 decision。但它不懂：

  1. 語義相似：draft_content 失敗 3 次後改策略 → 跟現在「又要 draft」的關聯性
  2. 因果鏈：decision A 導致 rollback B 導致 law change C → Edda 只能給你三個獨立 hit
  3. 時序模式：「每次 budget < 20% 時做 publish 都會被擋」→ Edda 看不出這個 pattern
  4. 跨 domain 關聯：blog-village 的經驗對 newsletter-village 有沒有參考價值

  ---
  LLM 加在哪？三個選項

  選項 A：LLM 在 Thyra（消費端語義化）

  Edda → raw hits → Thyra LLM Advisor → 語義理解 → 影響決策

  - Thyra Phase 2 已經規劃了這個（LlmAdvisor.advise() 讀 precedent）
  - Edda 不用改，保持 zero-LLM
  - 問題：Thyra 每次 decide 都要 LLM 重新理解 raw hits，重複工作

  選項 B：LLM 在 Edda（記憶端語義化）

  Edda 存時 → LLM 抽取結構 → 存 enriched metadata
  Edda 查時 → LLM 做語義排序 → 回傳 ranked hits

  - Edda 的設計哲學是 zero cloud, zero LLM cost
  - 加 LLM 會破壞 determinism 和 privacy
  - 但：如果是 optional enrichment layer，不影響核心帳本...

  選項 C：中間層（推薦）

  Edda (不變)  →  Thyra insight-builder (新)  →  DecisionEngine
     raw hits         LLM 語義整合                 消費 insights

  在 Thyra 加一個 insight cache 層：

  - 定期（不是每次 decide）用 LLM 分析 Edda 的 raw events
  - 產出結構化 insights（pattern, causal chain, recommendation）
  - 存在 Thyra 本地（不寫回 Edda）
  - DecisionEngine 讀 insights 而不是 raw hits
  - Edda 保持 zero-LLM，Thyra 控制 LLM 成本

  ---
  我的建議：選項 C + Edda 小幅增強

  Edda 需要做的（不涉及 LLM）

  ┌────────────────────┬───────────────────────────────┬──────────────────────────────────────────┬───────────────────┐    
  │        增強        │             現狀              │                   目標                   │      為什麼       │    
  ├────────────────────┼───────────────────────────────┼──────────────────────────────────────────┼───────────────────┤    
  │ DecideSnapshot     │ 沒有 snapshot endpoint        │ POST /api/snapshot                       │ Thyra #83 需要    │    
  │ 存儲               │                               │                                          │                   │    
  ├────────────────────┼───────────────────────────────┼──────────────────────────────────────────┼───────────────────┤    
  │ 時序查詢增強       │ keyword search only           │ GET                                      │ 支援 pattern 分析 │    
  │                    │                               │ /api/decisions?after=&before=&domain=    │                   │    
  ├────────────────────┼───────────────────────────────┼──────────────────────────────────────────┼───────────────────┤    
  │ 因果鏈查詢         │ decision_deps                 │ GET /api/decisions/{id}/chain            │ 追蹤 A→B→C 關係   │    
  │                    │ 表存在但未充分利用            │                                          │                   │    
  ├────────────────────┼───────────────────────────────┼──────────────────────────────────────────┼───────────────────┤    
  │ 批量查詢           │ 一次一個 keyword              │ POST /api/decisions/batch                │ 減少 HTTP         │    
  │                    │                               │                                          │ roundtrip         │    
  └────────────────────┴───────────────────────────────┴──────────────────────────────────────────┴───────────────────┘    

  這些都是 deterministic 增強，不需要 LLM，但讓 Thyra 的 LLM 層拿到更好的原料。

  Thyra 負責的（LLM 部分）

  // 新模組：src/insight-builder.ts
  interface InsightBuilder {
    // 定期分析（不是每次 decide）
    async buildInsights(villageId: string): Promise<VillageInsight[]>;

    // 結構化輸出
    interface VillageInsight {
      pattern: string;        // "publish after budget < 20% always blocked"
      confidence: number;     // 0-1
      evidence_refs: string[];// edda event_ids
      recommendation: string; // "avoid publish when budget_ratio < 0.2"
      category: string;       // "budget_pattern" | "failure_chain" | "strategy_drift"
    }
  }

  - 跑在 Thyra 裡，不在 Edda
  - LLM 只做 分析和摘要，不做決策
  - Insights 有 TTL，過期重新生成
  - DecisionEngine Phase 2 的 LlmAdvisor 讀 insights 而不是 raw Edda hits

  ---
  為什麼不直接在 Edda 加 LLM

  1. Edda 的價值就是 deterministic — 同一 query 永遠同一結果，可 audit
  2. Edda 是多 agent 共享的 — 一個 agent 的 LLM 解讀不該影響另一個的查詢結果
  3. 成本控制 — Edda 是被動查詢，加 LLM 後每次查詢都有 API cost
  4. 責任歸屬 — LLM 誤判應該是 Thyra 的問題（可 fallback），不應該污染 Edda 的原始紀錄

  類比：Edda = 法院檔案庫（原始紀錄，不可篡改）。Thyra = 法官的幕僚（用 LLM 分析檔案、整理 brief，但原始檔案不動）。       

  ---
  下一步建議

  Phase 1.5（現在就能做）:
    Edda: snapshot endpoint + 時序/因果查詢增強（4 個小 issue）
    Thyra: #83 evaluation harness 用這些 endpoint

  Phase 2（等 Phase 1.5 穩定後）:
    Thyra: InsightBuilder + LlmAdvisor 消費 insights
    Edda: 不用改

  要我幫 Edda 開那 4 個增強 issue 嗎？還是你覺得 LLM 應該直接在 Edda 裡做？