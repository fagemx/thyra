# Product Language And UI For A World-Governance Product

## 一、前提

如果承認這條路是在做 `governable world runtime`，
那產品不應該繼續沿用傳統 agent dashboard 的直覺。

也就是說：

- 不該先用「誰在做事」來定義首頁
- 不該把 agent card 當成主角
- 不該讓 UI 自然滑回 workforce management

否則再深的 world model，最後都會被表面 UI 語言削平。

這份文件的目的，就是固定：

> 如果產品中心是 world，而不是 agent，畫面、命名、操作與賣點應該怎麼變。

---

## 二、兩種首頁的差別

### 1. Agent-first 首頁

典型會長這樣：

- 哪些 agent 在線
- 哪些 agent 正在跑
- 哪些 task 卡住
- 哪個 session 成本高
- 哪個 host 壞了

這很適合 agent ops 產品。

### 2. World-first 首頁

首頁應該先回答：

1. 世界現在健康嗎？
2. 哪些區域正在變更？
3. 哪些變更等待審批？
4. 哪些規則正在生效？
5. 世界最近是在變好還是變壞？

也就是說，首頁更應該長成：

- `World Health`
- `Pending Changes`
- `Active Laws`
- `Recent Transactions`
- `Validation Summary`
- `Simulation / Forecast`
- `Precedent Alerts`

這裡 agent 可以存在，但應該只是 secondary panel。

---

## 三、主畫面應該圍繞哪些物件

如果是 world-governance 產品，最常被點開的物件不應該是：

- agent
- worker
- session
- queue item

而應該是：

- world
- state node
- patch
- law
- constitution
- transaction
- validation report
- simulation result
- precedent

這些物件才是第一公民的外顯形式。

---

## 四、主操作應該是什麼

如果產品是治理世界，主操作也會改變。

### 不該是主操作的

- dispatch task
- retry worker
- handoff session
- reassign agent

這些動作仍然存在，但更像執行層或診斷層操作。

### 應該是主操作的

- inspect state
- review patch
- validate
- simulate
- approve / reject
- apply change
- rollback
- supersede rule

也就是說，使用者更像是在經營世界變更，而不是派工。

---

## 五、產品的四個主屏建議

這裡不是最終 UI spec，而是世界路線下的骨架判斷。

### 1. World Overview

這是首頁。

應該包含：

- 世界整體健康度
- 最近重要變更
- 異常 / 風險區域
- 生效中的 laws
- validation / simulation 摘要
- pending approvals

使用者應該在 10 秒內知道：

- 世界是否穩定
- 哪裡需要注意
- 最近是否有重大變更

### 2. Change Review

這是產品的治理核心。

應該包含：

- patch diff
- 影響範圍
- validation 結果
- simulation 結果
- risk level
- approval / reject / rollback

如果這個畫面做得好，產品會非常有辨識度。
因為這不是一般 agent board，而是「世界變更審核面板」。

### 3. Law & Constitution

這個畫面回答：

- 哪些是硬邊界
- 哪些是可調 law
- 最近哪些 law 被提案、撤銷、取代
- 哪些 safety invariants 不可覆寫

這是把治理從抽象概念變成可見物件的地方。

### 4. History & Precedent

這個畫面回答：

- 過去類似變更怎麼做
- 結果如何
- 哪些路徑曾經失敗
- 哪些 law 曾經被 rollback

如果沒有這層，產品就只有管理面，而沒有真正的世界記憶。

---

## 六、agent 在 UI 裡該放哪裡

agent 並沒有消失。
只是地位要重新安排。

### agent 比較適合出現在：

- secondary diagnostics panel
- execution detail
- runtime status
- failure investigation
- host / session drill-down

也就是：

- 誰在執行這個 patch
- 哪個 executor 卡住
- 哪個 runtime 失敗
- 哪個 step 沒過

這類資訊對世界很重要，但它們不是產品主語言。

---

## 七、命名語言應該怎麼收斂

如果這條路要長期成立，命名語言必須一致。

### 應優先保留的語言

- world
- state
- patch
- law
- constitution
- validation
- simulation
- precedent
- transaction
- rollback

### 應謹慎使用的語言

- worker
- employee
- org chart
- assignment
- supervisor

這些詞一多，產品感受會被拖回 workforce tooling。

---

## 八、價值主張會怎麼改寫

### Agent-first 產品常講的價值

- 更快
- 更省
- 更多 agent
- 更高吞吐
- 更少人工

### World-first 產品更適合講的價值

- 更穩
- 更清楚
- 更可回滾
- 更可追溯
- 更可持續演化
- 更不容易把複雜系統弄壞

這代表：

這套產品真正賣的，不只是效率，而是 `order under autonomy`。

---

## 九、這會影響商業語言

### 如果用 agent management 的語言

你會更像：

- AI workforce platform
- agent ops console
- digital employee control center

### 如果用 world governance 的語言

你會更像：

- governable runtime
- world operating system
- bounded autonomy infrastructure
- control plane for structured domains

後者更難懂，但也更接近你真正的差異化。

---

## 十、MVP 的定義也會變

如果走 agent 路線，MVP 常常是：

- 派工
- 追蹤
- 成本監控
- session continuity

如果走 world 路線，MVP 更應該是：

1. 一個明確 world surface
2. 一套合法 patch 模型
3. 一個 validation / simulation loop
4. 一個 transaction / rollback system
5. 一個 governance review panel

也就是：

> 先證明「世界可以被安全演化」，再證明「很多 agent 可以在裡面工作」。

這個順序不能顛倒。

---

## 十一、產品體驗的核心感受

如果這條路走對，使用者的主觀感受不該是：

- 「哇，這裡好多 agent」
- 「哇，這個排程器很強」

而應該是：

- 「我終於看得懂這個世界現在怎麼了」
- 「我知道最近改了什麼、為什麼改、能不能退」
- 「我可以讓 AI 持續經營這個世界，但不會失控」

這種感受，比單純 agent 效率更稀有。

---

## 十二、暫定結論

如果後續真要沿著 `治理 AI 世界` 這條路走：

1. 首頁必須 world-first
2. 核心物件必須 world-state-first
3. 主操作必須是 patch / validate / simulate / rollback / govern
4. agent 必須退到 secondary layer
5. 商業語言要從 productivity 轉向 order / continuity / safe evolution

這份文件的作用，是避免未來一做 UI 就不自覺滑回 agent dashboard。
