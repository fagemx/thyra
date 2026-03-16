# World Track Index

> 目的：固定這一輪對話形成的核心脈絡，避免後續討論在「agent 管理」與「world governance」之間漂移。
>
> 這組文件不是最終產品 spec，也不是直接可實作的 API 契約。
> 它們的角色是：把目前已經形成的高階方向、語言、判準與推論鏈完整留下來。

---

## 這組文件回答什麼

這裡主要回答五個問題：

1. `Thyra` 到底是在治理什麼？
2. 為什麼這條路不是「治理 AI 員工」，而是「治理 AI 世界」？
3. 什麼樣的領域，才值得被視為一個 `world`？
4. 如果用 `world-state` 思維來做產品，UI / 核心物件 / 操作語言要怎麼改？
5. `Sidecar / Karvi / Edda / Thyra / Village Pack` 在這條路線裡各自扮演什麼角色？

---

## 文件結構

### 1. 核心定義

- `01_WORLD_FIRST_PRINCIPLE.md`
  - 第一公民是誰？
  - 「治理 AI 員工」與「治理 AI 世界」的根本差異是什麼？
  - 為什麼這不是字面上的命名問題，而是會影響後續所有設計決策的分水嶺？

### 2. World 的判準

- `02_WHAT_COUNTS_AS_A_WORLD.md`
  - 什麼東西才配被升格成 `world`？
  - 有哪些條件不滿足時，應該只被視為 workflow / automation / prompt chain？
  - 遊戲、內容系統、設計系統等案例怎麼看？

### 3. 產品與體驗

- `03_PRODUCT_LANGUAGE_AND_UI.md`
  - 如果承認自己在治理世界，首頁、主畫面、主操作應該長什麼樣？
  - 為什麼 agent panel 只能是 secondary view，而不是產品主視圖？
  - 產品價值主張與商業語言如何改寫？

### 4. 元件映射

- `04_STACK_ROLE_MAPPING.md`
  - `Sidecar / IR / Patch / Validation / Blackboard / Karvi / Edda / Thyra / Village Pack`
    在世界路線中的角色是什麼？
  - 這些元件如何互相扣合成一個 stack？

### 5. 開放問題

- `05_OPEN_QUESTIONS.md`
  - 目前仍未定案、但後續一定會影響架構與產品方向的問題。
  - 用來承接未來討論，而不是讓它們散落在聊天上下文裡。

### 6. 最小世界

- `06_MINIMUM_WORLD.md`
  - 不是先做宇宙，而是先做第一個真正具備世界性的「最小世界」。
  - 討論為什麼遊戲 / sidecar 類型的高密度世界很適合作為第一個 exemplar。
  - 補充 AI 與區塊鏈在 world stack 裡更合理的位置。
  - 提出一個重要假設：第一個必須被制度化的核心對象，很可能不是 asset，也不是 agent，而是 `change`。

### 7. 可攜自我與在地權利

- `07_PORTABLE_SELF_AND_LOCAL_RIGHTS.md`
  - 將 `Root Self / Portable Steward / World Incarnation / Local Rights Envelope` 固定成可實作的分層模型。
  - 討論人格連續性應該如何被摘要化，而不是整包跨世界搬運。
  - 討論局部財產權為何應該以 attestation / claim-check 為主，而不是原物直接跨世界移轉。
  - 對應一個 `<=10 worlds` 的 prototype runtime，幫助設計階段先把邊界說清楚。

### 8. Working Contract v0

- `08_WORKING_CONTRACT_V0.md`
  - 固定 world 路線的主合約：最小世界、分層、proof、invariants。
  - 10 條 invariants + 16 個 section。

### 11. UI 視覺方向

- `11_UI_VISION.md`
  - 三種 UI 形式：傳統 dashboard / 場景式（Star-Office 啟發）/ 混合式。
  - Star-Office-UI 的「用角色動作表達狀態」啟發。
  - 四個設計原則：API-first、先功能後美學、「活著」不靠花俏、營運者 ≠ 觀眾。
  - Phase 1-4 UI 路線。

### 10. 距離評估

- `10_DISTANCE_ASSESSMENT.md`
  - 2026-03-15 snapshot：離 Product Vision v0 的誠實距離。
  - 已完成 vs 未完成的完整盤點。
  - 最短 demo 路徑（6 步，2-3 週）。
  - 所有 open issues 追蹤表。

### 9. 產品方向 v0

- `09_PRODUCT_VISION_V0.md`
  - 從 MiroFish 分析得到的產品教訓。
  - 產品公式：`Template × Pack × Governance`。
  - 三個世界模板（Market / Town / Port）+ Domain Pack 機制。
  - 「活著的感覺」怎麼表達。
  - 商業化三層 + 產品路徑（Phase 1-3）。
  - 自治世界的 5 個判準。
  - **一句話：不是模擬，是開服。**

---

## 使用方式

### 當要討論定位時

先讀：

- `01_WORLD_FIRST_PRINCIPLE.md`
- `02_WHAT_COUNTS_AS_A_WORLD.md`

### 當要討論產品方向、敘事、exemplar 時

先讀：

- `09_PRODUCT_VISION_V0.md`
- `03_PRODUCT_LANGUAGE_AND_UI.md`

### 當要討論系統分層與元件責任時

先讀：

- `04_STACK_ROLE_MAPPING.md`

### 當討論卡住或開始漂移時

先讀：

- `05_OPEN_QUESTIONS.md`

---

## 目前主結論

截至這一輪對話，最重要的結論不是：

- `Thyra` 是不是 agent 產品
- 要不要做 IDE
- 要不要先做 UI

而是：

> **我們真正保護與優化的對象，不是 agent，而是 world。**

更精準地說：

> **Thyra 正在長成一個 governable world runtime 的治理層。**

這句話會是後續所有討論的北極星。
