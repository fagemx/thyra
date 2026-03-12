  ---                                                                                                                      
  decide() 深度分析：三 repo 架構的核心樞紐                                                                                
                                                                                                                             現狀：一個回傳 null 的函數                                                                                               
                                                                                                                           
  // loop-runner.ts:224-258
  async decide(chief, activeLaws, observations, villageId): Promise<Decision | null> {
    // Phase 0: 不管什麼情況，最終都 return null
    // 唯一做的事：查 Edda precedent，然後丟掉結果
  }

  這不是一個 gap。這是三個 repo 的交會點完全空白。

  ---
  decide() 在三 repo 架構中的真正角色

          ┌─────────────┐
          │  Constitution│  ← 不可逾越的邊界（人類定）
          │  + Laws      │  ← 可調整的策略（AI 可提案）
          └──────┬───────┘
                 │ 約束
          ┌──────▼───────┐
     ──→  │   decide()   │  ──→  Decision
    觀察   │              │      (action_type, cost, reason,
    判例   │  Chief 人格   │       rollback_plan, edda_refs)
    法律   │  + 約束      │
          └──────────────┘
                 │ 產出
         ┌───────┼───────┐
         ▼       ▼       ▼
      RiskAssess  Act   LawPropose
         │        │       │
         ▼        ▼       ▼
       Gate    Karvi    LawEngine
                ↓         ↓
              Events    Edda

  decide() 不只是「選下一步做什麼」。它是：

  1. 立法者的策略腦 — 讀 Law，決定要不要提案修改
  2. 執法者的指揮官 — 產出具體 action 給 Karvi dispatch
  3. 判例法的學習者 — 讀 Edda precedent，避免重複失敗
  4. Chief 人格的載體 — conservative Chief 和 aggressive Chief 的 decide 應該不同

  ---
  六個具體能力需求

  能力 1：觀察理解（Observe → Context）

  目前 observe() 回傳的是 raw audit_log rows。decide() 拿到一堆 Record<string, unknown>[]，但完全不理解它們代表什麼。      

  需要的不是 raw data，而是結構化的 situation awareness：

  - 最近 3 輪 loop 結果如何？（連續失敗？成功？timeout？）
  - 有沒有 pending_approval 的 action 在等？
  - 有沒有 law 剛被 rollback？
  - 最近 Karvi 有沒有 step_failed 事件？
  - 預算還剩多少比例？
  - 上次 decide 產出了什麼，結果如何？

  這是 observe() → decide() 之間缺少的 comprehension layer。

  能力 2：策略選擇（Law × Context → Candidate Actions）

  decide() 拿到 activeLaws[] 但完全沒用它們。

  Laws 應該是 decide 的操作指南。比如 Blog Village 的 Law 說「每週二四發文」，decide
  就要知道今天星期幾、本週發了幾篇、該不該啟動 draft task。

  需要的能力：

  - 讀 activeLaws，理解當前策略要求
  - 比對 observations，判斷哪些策略需要被執行
  - 產出候選 actions（可能有多個），排優先級
  - 判斷是否有 law 該被提案修改（基於效果回饋）

  能力 3：判例參考（Edda → Decision Confidence）

  目前查了 Edda 但結果被丟掉。Edda 的真正價值是：

  - 上次做同類決策，結果好不好？
  - 有沒有「這種情況下不要做 X」的判例？
  - 有沒有「這種策略被 rollback 過」的記錄？
  - 相似 village 的經驗可以借鏡嗎？

  Edda 應該影響 decide 的兩個面向：
  - 信心度：有正面判例 → 更敢做；有負面判例 → 更保守或改策略
  - edda_refs：附在 Decision 上，讓 Risk Assessor 和 audit trail 知道決策依據

  能力 4：Chief 人格投射

  Chief 有 personality（risk_tolerance, decision_speed）和 constraints（must/must_not/prefer/avoid），但 decide()
  完全沒讀它們。

  conservative + cautious Chief:
    → 偏好低風險 action
    → 有負面判例就不做
    → 傾向提案 law 修改而不是直接行動

  aggressive + fast Chief:
    → 願意嘗試新策略
    → 負面判例只是參考
    → 傾向直接行動而不是等審批

  這不是裝飾。Chief 人格是讓同一個 village 在不同管理風格下產出不同行為的關鍵。

  能力 5：法律提案能力

  目前 decide() 只能產出 Decision（代表一個 action）。但 Blog Village 文件明確要求 Chief 能在 loop 中提案修改 law。        

  場景：連續 3 篇 evergreen 文章表現不佳
  Chief observe → 「evergreen 50% 配比可能太高」
  Chief decide → 產出兩件事：
    1. Decision: 這輪改寫 trending 主題
    2. LawProposal: 建議把 evergreen 從 50% 降到 35%

  decide() 的回傳不應只是 Decision | null，應該是：

  interface DecideResult {
    action: Decision | null;           // 這輪要做什麼
    law_proposals: LawProposalDraft[]; // 順便提案改什麼策略
    observations_summary: string;      // 給 audit 的觀察摘要
    edda_refs: string[];               // 參考了哪些判例
    confidence: number;                // 決策信心度 0-1
    reasoning: string;                 // 完整推理鏈（SI-2 要求）
  }

  能力 6：多輪持續性

  目前每次 iteration 的 decide() 是無狀態的。但真正的自治循環需要跨 iteration 的意圖連續性：

  iteration 1: decide → dispatch research_topic
  iteration 2: observe research 完成 → decide → dispatch draft_content
  iteration 3: observe draft 完成 → decide → dispatch review_content
  iteration 4: observe review 通過 → decide → dispatch publish
  iteration 5: observe 已發布 → decide → null（這輪結束）

  這不是每次從零開始的決策，而是一個 plan 的逐步執行。需要 cycle 層級的 intent/plan 狀態。

  ---
  架構影響：不只是改一個函數

  對 Edda 的新需求

  目前 Edda bridge 只有 queryDecisions()（用 domain/keyword 搜）。但 decide 需要的是更精準的查詢：

  - 查同 village 的歷史 loop 結果
  - 查同 category law 的 effectiveness 記錄
  - 查特定 action_type 的成敗統計
  - 查「被 rollback 的 law」以避免重蹈覆轍

  這意味 Edda 的 API 或 Thyra 本地的 audit query 需要更有結構的查詢能力。

  對 Karvi 的新需求

  目前 Decision.action_type 是 free string。但真正要 dispatch 給 Karvi 時，需要知道：

  - 這個 action_type 對應 Karvi 的哪個 task spec？
  - 需要什麼 skill？
  - 要 dispatch 給哪個 runtime？
  - 輸入參數是什麼？

  decide() 產出的 Decision 和 Karvi dispatch 之間需要一個 task spec resolution layer（現有的 SkillRegistry
  可以扮演這角色）。

  對 LawEngine 的新需求

  目前 LawEngine 的 propose() 需要外部呼叫。但如果 decide 要在 loop 中自動提案，它需要：

  - 從 decide 內部呼叫 lawEngine.propose()
  - 但不能讓 decide 直接 import LawEngine（層級依賴問題）
  - 解法：decide 回傳 LawProposalDraft，由 runLoop 負責呼叫 LawEngine

  Phase 0 → Phase 1 的分界線

  ┌──────────┬─────────────────┬──────────────────────────────┬───────────────────────┐
  │          │ Phase 0（現在） │ Phase 1（rule-based decide） │ Phase 2（LLM decide） │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 觀察     │ raw audit rows  │ 結構化 situation             │ 同 Phase 1            │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 策略     │ 不讀 law        │ 讀 law + 規則匹配            │ LLM 理解 law 語義     │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 判例     │ 查但丟掉        │ 查 + 影響信心度              │ LLM 綜合判例推理      │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 人格     │ 不用            │ 人格 → 風險偏好權重          │ LLM prompt 內嵌人格   │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 產出     │ null            │ rule-matched Decision        │ LLM 生成 Decision     │
  ├──────────┼─────────────────┼──────────────────────────────┼───────────────────────┤
  │ 法律提案 │ 無              │ 基於效果指標觸發             │ LLM 推理是否該調整    │
  └──────────┴─────────────────┴──────────────────────────────┴───────────────────────┘

  Phase 1 是值得先做的，因為它不需要 LLM，用規則引擎就能讓 loop 真正轉起來。Phase 2 是在 Phase 1
  驗證流程正確後，把規則引擎換成 LLM。

  ---
  總結：decide 是什麼

  decide() 不是 loop 的一個步驟。它是 Thyra 整個治理系統的大腦。

  - 它是唯一同時讀取 Constitution、Law、Edda、Karvi events、Chief personality 的地方
  - 它是唯一能產出 action（給 Karvi）和 law proposal（給 LawEngine）的地方
  - 它是 bounded autonomy 的「autonomy」所在 — Constitution/RiskAssessor 負責 bounded，decide 負責 autonomy

  如果 decide 不活，整個三 repo 系統就只是一組漂亮的 CRUD API。decide 活了，它才真的是「AI 治理 AI」。