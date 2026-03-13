# World First Principle

## 一、這份文件在定義什麼

這份文件要固定一個根本問題：

> 在這個產品世界裡，誰才是第一公民？

這不是命名問題，不是品牌包裝問題，也不是單純的 UX 文案問題。
它會直接決定：

- 核心資料模型怎麼長
- 主 UI 該看什麼
- 風險模型怎麼定
- 記憶系統要記什麼
- 哪些東西叫「成功」
- 哪些東西算「弄壞了系統」

如果這件事沒有先定清楚，後續的討論很容易在兩條路線之間搖擺：

1. `治理 AI 員工`
2. `治理 AI 世界`

---

## 二、兩條路真正差在哪

表面上，兩條路都會出現：

- agent
- task
- loop
- approval
- audit
- memory
- dashboard

所以如果只看表層功能，它們很容易被誤認成同一件事。

但底層完全不同。

### 1. 治理 AI 員工

這條路的核心對象是：

- agent
- worker
- session
- assignment
- role

它真正關心的是：

- 誰在做事
- 誰卡住
- 誰效率差
- 誰花太多錢
- 誰該被替換

這是一條以 `行動者` 為中心的路線。

### 2. 治理 AI 世界

這條路的核心對象是：

- state
- patch
- rule
- transaction
- validation
- law
- precedent
- world model

它真正關心的是：

- 世界現在長什麼樣
- 哪些變更合法
- 哪些變更違法
- 哪些 patch 可回滾
- 哪些規則正在生效
- 世界有沒有朝目標穩定演化

這是一條以 `被操作的現實空間` 為中心的路線。

---

## 三、第一公民的差別

這裡是最關鍵的定義。

### 如果第一公民是 agent

產品最後自然會長成：

- agent list
- org chart
- session timeline
- dispatch queue
- worker performance
- cost per agent

在這條路裡，world 多半只是工作背景。
真正被管理的是執行者。

### 如果第一公民是 world state

產品最後自然會長成：

- world overview
- active laws
- pending patches
- recent changes
- validation reports
- rollback history
- precedent alerts

在這條路裡，agent 依然重要，但它只是作用於世界的執行者。
真正被保護、被優化、被評估的是世界本身。

---

## 四、目前這個版圖實際長成哪一邊

如果只從 repo 自然長出的概念來看，目前非常明顯偏向 `治理 AI 世界`。

因為目前自然長出來的核心語言，不是：

- worker assignment
- agent utilization
- session ownership
- org hierarchy

而是：

- constitution
- law
- patch
- diff
- rollback
- validation
- ledger
- blackboard
- IR
- sidecar

這些詞都不是在描述「誰在工作」。
它們在描述的是：

> 世界怎麼表示、怎麼合法改變、怎麼被持久治理。

---

## 五、這不是否定 agent，而是重排 agent 的地位

必須強調：

`治理 AI 世界` 並不代表 agent 不重要。

差別是：

- 在 `治理 AI 員工` 的路線裡，agent 是產品本體
- 在 `治理 AI 世界` 的路線裡，agent 是世界中的操作執行者

也就是說，兩邊都有 agent。
差別不在於有沒有 agent，而在於：

> **被真正保護與優化的對象，到底是 agent，還是 world。**

---

## 六、為什麼這個判斷重要

因為它會連鎖影響很多東西。

### 1. UI 中心會變

如果走 agent 路線，首頁會是：

- agent cards
- active sessions
- work queues
- dispatch controls

如果走 world 路線，首頁應該是：

- world health
- active laws
- pending changes
- recent transactions
- validation / simulation summary

### 2. 風險模型會變

如果走 agent 路線，風險通常是：

- agent 亂花資源
- agent 誤用工具
- agent 誤發消息

如果走 world 路線，風險通常是：

- 世界不一致
- 非法 patch 生效
- 規則被越過
- 無法回滾
- 演化失控

### 3. 記憶系統會變

如果走 agent 路線，記憶重點是：

- 某個 agent 以前做得好不好
- 某種 task 以前怎麼完成

如果走 world 路線，記憶重點是：

- 某種變更以前成功還是失敗
- 某條 law 曾經造成什麼效果
- 某種 patch pattern 會不會導致世界變壞

### 4. 產品價值會變

如果走 agent 路線，價值主張通常是：

- 更多 agent
- 更快 throughput
- 更省人工

如果走 world 路線，價值主張會變成：

- 更穩
- 更安全
- 更可回滾
- 更可追溯
- 更可持續演化

---

## 七、目前最接近的總結句

截至這一輪討論，最接近核心的表述是：

> **Thyra 不是在做 AI workforce management，而是在長成 governable world runtime 的治理層。**

再白話一點：

> **不是管理一群 AI 員工，而是管理一個 AI 能夠長期住進去、操作、學習、但不被弄壞的制度化世界。**

---

## 八、三層推進

目前看起來，整個方向可以被拆成三層：

### 1. 世界可表示

也就是：

- 世界有穩定的概念模型
- 世界可以被結構化表示
- 世界不是一團只有人類懂的隱性知識

這一層對應：

- IR
- schema
- world model
- domain concepts

### 2. 世界可操作

也就是：

- 變更不是魔法，而是 patch
- 操作必須是合法 transition
- 變更要能被 validate / diff / rollback

這一層對應：

- patch / diff
- transaction
- validation
- simulation
- rollback

### 3. 世界可治理

也就是：

- 不是所有合法操作都應該直接執行
- 世界還需要目標、法律、風險、審批、記憶與裁判

這一層對應：

- constitution
- law
- risk
- precedent
- audit
- governance loop

很多系統最多做到第二層。
你現在的路線有意思的地方，在於你想把三層一起做起來。

---

## 九、這條路的真正難點

如果承認自己在做 `治理 AI 世界`，最大的難點就不是：

- agent 不夠聰明
- 模型不夠強
- 任務拆解不夠漂亮

而是：

- 世界有沒有足夠穩定的表示法
- 世界的合法操作集合能不能被明確定義
- 世界的驗證機制是否真的可信
- 世界的歷史是否足夠形成 precedent
- 世界的治理規則是否真的能保護連續性

這些難點更深，但也更有護城河。

---

## 十、目前的暫定判決

目前可以先把這件事定下來：

1. 這套系統的第一公民不是 agent，而是 `world state`
2. agent 是世界中的執行者，不是產品主角
3. 核心價值不在「讓 agent 更忙」，而在「讓世界更穩、更清楚、更可治理」
4. 後續所有 UI / 命名 / 商業語言，都應該優先服務這個判斷

這份文件的角色，就是防止後續討論又滑回「agent management」的直覺慣性。
