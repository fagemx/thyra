以下是我幫你收斂後的版本。

---

# 《Thyra × Karvi × Edda → Bigger IDE 實作路線圖 v0.1》

## 0. 先講結論

這條路線**不是做一個新 IDE**，而是分三層逐步長出來：

**Thyra = 治理核心**
**Karvi = 執行核心**
**Edda = 決策記憶核心**
**Bigger IDE = 最後長出來的 command center 外殼**

而且順序應該是：

**三服 E2E 跑通 → terminal-first 控制面 → 最小 host awareness → 薄型 Web Command Center → 更完整的 Bigger IDE shell**

這樣才符合你目前 codebase 的真實成熟度。現在 Thyra 已經有完整 Hono app、domain engine、bridge、audit route 與 loop 骨架，但 loop 的 `decide()` 還是 Phase 0，Karvi/Edda 的價值也更適合先被你自己 dogfood，而不是直接跳成大型 UI 專案。  

---

## 1. 產品北極星

### 對內定義

建立一個 **agent team control plane**，讓你可以管理多個 chief / loop / policy / execution / decision memory，而不是只管理單一 coding session。

### 對外定義

不是「新的編輯器」，而是：

**A command center for governed coding agents across tools, runs, and machines.**

### 核心差異化

差異化不在 Web UI，而在這個三角：

* **Thyra**：constitution / chief / law / loop / audit
* **Karvi**：dispatch、budget control 同步、webhook event ingestion
* **Edda**：decision precedent、notes、log、治理記憶

這個三層分離在現有市場上比單純 dashboard 更稀有。Thyra 啟動時就已經把這幾個元件接起來，並暴露 villages、constitutions、chiefs、laws、loops、bridges、territories、audit 等 route。

---

## 2. 目前真實起點

你現在不是從零開始，而是已經有一個能稱作「治理核心 backend」的底座：

* `ConstitutionStore` 已經支援 active / superseded / revoked 版本流轉，且建立或 supersede 時會同步 budget controls 給 Karvi。
* `ChiefEngine` 已經檢查 permission 不可超出 constitution，skill 必須 verified 才能綁定。
* `LoopRunner` 已經有 startCycle、observe、risk gating、cost record、finish/abort 的主骨架。 
* `RiskAssessor` 已經有 7 個不可覆蓋的 safety invariants，並做 per-action / per-day / per-loop budget 檢查。
* `KarviBridge` 已經有 webhook register、health 檢查、budget sync、event ingestion with idempotency。
* `AuditQuery` 已經能查通用 audit 與 village-scoped audit trail，而且明確是 append-only read model。

但同時你也很清楚還沒到產品完成態：

* `LoopRunner.decide()` 目前仍是 rule-based Phase 0，測試裡預期可回 `null` 結束 cycle。
* 觀測面目前主要來自 internal audit + Karvi events 的合併，而不是完整的 cross-machine runtime fabric。

這正是為什麼順序必須保守。

---

## 3. 總體設計原則

### 原則 A：不做完整 IDE

不碰 file tree、diff editor、extension ecosystem、完整 terminal workspace 這些重型區域。

### 原則 B：先驗證 control plane，不先驗證 UI

先確認：

* loop 真的能跑
* governance 真的會擋
* Karvi 真的接到 dispatch / webhook
* Edda 真的能成為 precedent memory

### 原則 C：CLI 不是終點，是 UI 探針

CLI / TUI 的任務是幫你找到：

* 最常看的資料
* 最常做的操作
* 最常被卡住的地方

之後 Web UI 只把「被證明高頻」的部分搬上去。

### 原則 D：Machine fabric 提前做最小版，不做完整版

Karpathy 的 multi-machine 是對的，但你這階段只做：

* host inventory
* chief/loop/task 在哪個 host
* basic health
* attach target metadata

先不要做完整 remote IDE。

---

## 4. 分階段路線圖

---

## Stage 0 — 真三服 E2E Smoke Test

### 目標

不是 test pass，而是證明：

**Thyra + Karvi + Edda 三個 server 同時運作時，核心鏈路真的通。**

### 要跑通的主線

1. 起 Thyra
2. 起 Karvi
3. 起 Edda
4. Thyra health 正常
5. Karvi health 正常
6. Edda health 正常
7. Thyra 成功註冊 Karvi webhook URL
8. 建立 village
9. 建立 constitution
10. 建立 chief
11. 手動 start loop
12. loop 進 observe / decide / assess / act
13. 若有 dispatch，Karvi 接到
14. Karvi webhook event 回到 Thyra audit
15. Edda decision query / note / log 至少通一條

Thyra 啟動碼已經明確建立 KarviBridge、EddaBridge、LoopRunner、AuditQuery 並掛 route，這使它非常適合先做三服 smoke test。Karvi webhook register 與 event ingestion 也已經有對應測試骨架。

### 交付物

* `scripts/dev-up.sh` 或等價啟動腳本
* `scripts/smoke-e2e.ts`
* 一份 smoke checklist
* 一份失敗分類表

### Definition of Done

* 不靠 mock，三服實際啟動
* 至少 1 條從 constitution → chief → loop → bridge → audit 的主線成功
* 任一步失敗可定位到 Thyra / Karvi / Edda 哪一層

---

## Stage 1 — Terminal-first 控制面

### 目標

讓你自己每天真的會用，而不是先畫 dashboard。

### 產品形態

先做 `thyra` CLI，必要時再補 TUI。

### 第一批指令

我建議直接做這組：

* `thyra health`
* `thyra village list`
* `thyra constitution active --village <id>`
* `thyra chief list --village <id>`
* `thyra loop list --village <id>`
* `thyra loop start --village <id> --chief <id>`
* `thyra loop get <cycle-id>`
* `thyra audit village <id>`
* `thyra bridge health`
* `thyra karvi events`
* `thyra law list --village <id>`

### 為什麼這組最先

因為它正好對應你現在 repo 已有的能力：

* chief list / status：已有 `ChiefEngine.list()`。
* constitution active：已有 `ConstitutionStore.getActive()`。
* loop state：已有 `LoopRunner.startCycle/get/abort/record` 骨架。
* audit trail：已有 `AuditQuery.query()` 與 `queryByVillage()`。
* bridge health / Karvi events：已有 `KarviBridge.getHealth()`、`getRecentEvents()`。

### 這階段不要做的事

* 不做 React dashboard
* 不做 aggregate mega-API
* 不做 org template UI
* 不做多人權限系統

### Definition of Done

* 你可以只靠 CLI 完成一次「建立 → 觀測 → 啟動 → 查 audit → 查 bridge health」
* 你會自然重複使用這些命令，而不是只 demo 一次

---

## Stage 1.5 — 最小 Host Inventory

### 目標

提早把 multi-machine 納入架構，但先做到「知道誰在哪裡」。

### 新增資料模型

建議新增最小 host schema：

* `host_id`
* `host_label`
* `host_type`（local / gpu / cloud / remote）
* `status`（online / degraded / offline）
* `last_seen_at`
* `attach_target`
* `capabilities`（gpu / docker / ssh / repo mounts）

再加兩個關聯資訊：

* chief 現在綁在哪個 host
* loop / karvi task 現在在哪個 host 跑

### 先做的功能

* `thyra host list`
* `thyra host get <id>`
* `thyra chief where <id>`
* `thyra loop where <id>`

### 這階段不要做

* 不做完整 SSH multiplexing
* 不做 remote shell relay
* 不做 host orchestration scheduler

### 為什麼這時做

你代理講得對，多機器不是未來需求，是你現在工作流的一部分；但還不需要一口氣做成 IDE 級 remote fabric。

### Definition of Done

* 你可以回答「哪個 chief / loop / task 在哪台機器」
* host health 能進 audit / status view
* 斷線時至少能在控制面顯示 degraded/offline

---

## Stage 2 — Thin Web Command Center

### 目標

把 CLI 已證明高頻的資訊，搬成薄型 Web 介面。

### UI 原則

* read-mostly
* 輕操作
* 高可見性
* 不模仿 IDE layout

### 第一版只做四個面板

#### 1. Chief / Agent Board

顯示：

* chief name / role
* status
* current village
* current host
* last activity
* current loop / task
* risk posture / permission badge

這裡的資料主要來自 chief、constitution、loop、Karvi event 的組合。chief 本身已有 role、permissions、personality、constraints、skills。

#### 2. Loop / Run Board

顯示：

* running / completed / timeout / aborted
* budget remaining
* cost incurred
* actions
* abort reason
* max iterations / timeout

這些欄位在 `LoopCycle` 裡已經很完整。

#### 3. Policy Drawer

顯示：

* active constitution
* rules
* allowed permissions
* budget limits
* chief 是否越權
* laws active / proposed

這是 Thyra 最有辨識度的一塊。constitution 與 chief 之間的權限約束，以及 budget → Karvi sync 都已經存在。

#### 4. Activity Timeline

顯示：

* audit events
* karvi webhook events
* law proposed / enacted
* constitution supersede / revoke
* chief update / deactivate
* loop action executed / blocked

`AuditQuery` 已經是很好的 read model，而 `KarviBridge.ingestEvent()` 已能把 event 以 idempotent 方式落到 audit_log。

### API 策略

不要一開始做 fat BFF。
只在高痛點處做薄聚合 endpoint，例如：

* `GET /api/control/chiefs`
* `GET /api/control/loops`
* `GET /api/control/timeline`

其餘先吃既有 route。因為 Thyra 已經有 villages、constitutions、chiefs、laws、loops、bridges、audit 等 route。

### Definition of Done

* 不靠 CLI，也能看懂當前 chief、loop、policy、timeline
* UI 中 80% 的資訊都來自你已經每天在 CLI 看過的資料
* 沒有為了 UI 去重寫 core 名詞或 core engine

---

## Stage 3 — Bigger IDE Shell

### 目標

到這一步，才真正開始接近 Karpathy 所說的 Bigger IDE 外殼。

### 這時候要長出的能力

* agent-first 主畫面
* org / workspace 視圖
* host / machine fabric 視圖
* zoom in / zoom out legibility
* richer real-time metrics
* 一鍵 attach 到對應 terminal / host
* template/fork of governed agent teams

### 這時候才值得做的東西

* 更完整的 SSE / WebSocket 狀態流
* richer host session registry
* command center actions
* org templates / fork manager

### 但仍然不做

* 不做完整 editor replacement
* 不和 VS Code / Cursor 正面競爭 file editing
* 不把所有控制都綁死在瀏覽器 UI

### Definition of Done

* 你能把「多 chief、多 loop、多 host」看成一個操作中的 agent team
* 你可以從全局下鑽到單 chief / 單 run / 單 audit thread
* Karpathy 的五點裡，你至少真正吃到 1、2、4、5 四條

---

## 5. 技術模組拆分建議

### Repo / module role

#### Thyra

保持為：

* governance kernel
* policy runtime
* loop runtime
* audit read/write hub

#### Karvi

保持為：

* execution plane
* dispatch target
* control sync receiver
* event source

#### Edda

保持為：

* precedent memory
* notes / decisions / rationale backend

#### 新增薄層：Control Surface

可以是一個新 repo，也可以先放 Thyra 旁邊：

* CLI
* TUI（可選）
* thin Web UI
* tiny aggregate endpoints

重點是：**不要讓這層反過來污染 Thyra core。**

---

## 6. 命名策略

### 內核語言保留

* village
* constitution
* chief
* law
* loop
* territory

### UI / 對外語言轉譯

* village → workspace
* constitution → policy
* chief → agent
* law → automation rule
* loop → run
* territory → federation

這樣你可以同時保留世界觀與降低外部理解門檻。

---

## 7. 每階段最重要的風險

### Stage 0 風險

unit test 很漂亮，但三服實際連起來後卡在：

* webhook
* timeout
* URL 健康檢查
* event schema mismatch

### Stage 1 風險

CLI 做成內部 debug 工具，沒有產品視角。

### Stage 1.5 風險

host inventory 長成另一套 orchestration system，戰線失控。

### Stage 2 風險

Web UI 直接變成大雜燴，把所有 domain 強行聚合。

### Stage 3 風險

誤以為要做完整 editor，結果掉進大平台競爭。

---

## 8. 建議的 30 / 60 / 90 路線

### Day 1–30

主攻：

* 三服 smoke test
* CLI health / status / audit / loop commands
* 失敗定位與 observability

### Day 31–60

主攻：

* host inventory 最小版
* chief / loop / host 對映
* thin control endpoints
* timeline model 收斂

### Day 61–90

主攻：

* Web command center v0
* 4 個主面板
* SSE / polling 更新
* dogfood 一個真實工作流

---

## 9. 你每週該問自己的問題

1. 這週是否真的用這套系統做過工作，而不是只是測試？
2. 我最常看的資訊是哪三項？
3. 我最常下的控制操作是哪兩個？
4. 哪一層最常壞？Thyra、Karvi、還是 Edda？
5. 如果明天做 UI，首頁最值得出現的是什麼，而不是我想像的什麼？

---

## 10. 最後的判斷句

這份路線圖的核心立場是：

**你不是放棄 Thyra 去追 Karpathy。**
**你是讓 Thyra × Karvi × Edda 先長成真的可用 control plane，再把它包進 Karpathy 所描述的 Bigger IDE 外殼。**

所以你的戰略不是：

* 做不做 Bigger IDE

而是：

* **先把 Bigger IDE 的「核心後台」做活**
* **再把真正高頻的控制需求長成 command center 前台**

如果你要，我下一則我可以直接接著寫：

**《Stage 0 Smoke Test 規格 + CLI 指令面 v0.1》**
