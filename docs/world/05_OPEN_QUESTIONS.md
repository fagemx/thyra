# Open Questions For The World Route

## 一、這份文件的角色

前面幾份文件固定的是：

- 已經形成的主結論
- 已經相對穩定的判準
- 已經相對清楚的產品語法
- 各元件在世界路線中的角色

但這條路還有很多尚未定案的問題。

這些問題不能丟掉，因為它們都會在未來某個節點變成結構性分歧。

這份文件的目的，是把未解問題集中收攏，讓未來討論有地方接續，而不是散落在聊天上下文裡。

---

## 二、核心未決問題

### Q1. 第一個真正要做深的 world，到底是哪一個？

目前看起來至少有幾個候選：

- 遊戲世界（透過 `sidecar`）
- 內容 / media world（透過 `village`）
- 設計 / asset world
- 更抽象的 structured runtime

這不是單純市場排序問題，而是會影響：

- 哪個 domain 先成為 canonical exemplar
- 哪個 world model 最先被打磨完整
- 哪些治理機制會被優先驗證

### Q2. Thyra 的主產品入口，最終是 world 還是 org？

雖然核心方向偏 world governance，但產品對外入口仍有兩種可能：

- `org / workspace / village` 作為主入口
- `world / runtime / environment` 作為主入口

兩者會影響：

- 命名
- 首頁資訊架構
- BFF 設計
- 商業語言

### Q3. agent 在最終產品裡應該露出多少？

目前判斷 agent 應該是 secondary layer。
但 secondary 到什麼程度，還沒定。

可能性包括：

- 只在診斷頁露出
- 在每個 patch / transaction detail 裡露出 executor
- 做成可開合的 execution pane
- 保留完整 agent board，但不當首頁

這會影響產品感受是否又滑回 agent-ops。

### Q4. Blackboard / Grith 的關係如何命名才不混淆？

目前可見的判斷是：

- `Grith` 更像協作 pattern
- `blackboard` 更像共享狀態面 / concrete implementation

但未來如果這部分繼續長大，可能需要更精確的層次切分，避免：

- pattern、implementation、product surface 混在一起

### Q5. `world` 的最小治理單位是什麼？

目前有很多概念：

- village
- territory
- nation
- project
- world
- runtime

這些概念未來要如何精確對位，仍未完全固定。

可能要回答：

- `village` 是世界本體，還是世界治理單位？
- 一個 `world` 是否可以包含多個 villages？
- territory / nation 到底是 governance scaling，還是 world composition？

---

## 三、產品層未決問題

### Q6. 首頁第一屏到底呈現什麼？

候選可能有：

- world health
- recent changes
- pending approvals
- active laws
- simulation forecast
- precedent alerts

這裡的排序極重要。
它會決定產品第一眼到底是：

- governance tool
- runtime monitor
- world dashboard
- 還是 agent console

### Q7. Change Review 是否應該成為產品中心？

目前直覺上，`Change Review` 很可能比 `Agent Board` 更適合作為產品心臟。

但這仍需要確認：

- 使用者是否真的會以 patch / transaction 為中心工作？
- 還是要先透過更高階的 world summary 才能理解？

### Q8. Policy / Constitution / Law 的語言要保留多少原名？

目前內部語言很強：

- constitution
- law
- village
- territory

但對外產品未必都適合原樣暴露。

這裡有一個持續 tension：

- 保留原語言，辨識度更高
- 翻譯成 UI 語言，理解成本更低

哪一層該保留原名，哪一層該翻譯，還沒有完全定案。

---

## 四、架構層未決問題

### Q9. World governance stack 的最小閉環是什麼？

目前推測一個最小閉環應包含：

1. world representation
2. legal operations
3. validation
4. transaction / rollback
5. precedent memory
6. governance boundary

但還需要再收斂：

- 哪些是不能缺的
- 哪些可以是 phase 2 才補

### Q10. Simulation 在 stack 裡是不是 first-class citizen？

在 world route 裡，simulation 似乎比一般 agent product 重要得多。

因為：

- 它是世界變更前的預演
- 它提供治理判斷的中介
- 它影響 risk 與 approval

但是否所有 vertical 都需要 simulation-first，還有待判斷。

### Q11. Edda 記的是 agent decision，還是 world precedent？

目前傾向是後者更重要。

但在實作與 schema 上還需要繼續釐清：

- decision 的基本單位是「agent 做了什麼」
- 還是「世界被怎麼改了，結果如何」

這會影響 Edda 在整個 stack 裡的資料重心。

### Q12. `Village Pack` 未來是治理入口，還是世界 authoring 入口？

現在比較明確的是治理入口。
但如果 world route 走深，未來可能需要區分：

- 人類在定治理
- 人類在定世界本身

兩者未必永遠是同一個入口。

---

## 五、策略層未決問題

### Q13. 這條路更接近 developer product，還是 domain product？

有兩條可能：

#### A. 先做通用 world-governance stack

優點：

- 抽象高
- 長期平台感強

風險：

- 早期太抽象
- 難以被外界理解

#### B. 先做一個超強 vertical world

例如：

- game world
- content world

優點：

- 容易被看懂
- 較容易驗證真需求

風險：

- 太早被視為單一垂直工具

目前看起來更合理的是：

- 先用 vertical 驗證
- 再抽成 stack

但這件事仍值得持續確認。

### Q14. 商業敘事要先講 governance，還是先講 wedge？

世界路線的最深價值是 governance。
但市場入口未必能直接吃抽象敘事。

所以需要持續平衡：

- 對內知道自己在做什麼
- 對外先從痛點 wedge 切入

例如：

- 遊戲場景先講：不把世界弄壞、可回滾、可驗證
- 而不是一開始就講宏大的 AI civilization infrastructure

---

## 六、暫時性的原則

在上述問題未完全定案前，可以先用下面這些暫時原則維持一致：

1. 任何新討論都先問：這件事是在服務 agent，還是在服務 world？
2. 如果某個新功能只能強化 agent ops，卻不強化 world governance，要謹慎評估
3. 如果某個新 vertical 不符合 world 的五個條件，不要硬塞進 world route
4. UI 討論一律先從 world-first 開始，再決定 agent 要露出多少
5. 記憶與審批一律優先綁定世界變更，而不是只綁定 agent 行為

---

## 七、後續討論建議順序

如果要繼續往下聊，建議順序是：

1. 先定第一個要做深的 canonical world
2. 再定這個 world 的首頁與主畫面
3. 再定 patch / transaction / precedent 的主語言
4. 最後才討論 agent 如何在產品裡露出

這樣比較不會在還沒定義世界之前，就先把 UI 做成 agent console。
