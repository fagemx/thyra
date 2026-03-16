# Product Vision v0

> 狀態：`working draft`
>
> 來源：MiroFish 分析 + GPT 概念討論 + 營運討論 1-2
>
> 目的：把目前已經收斂的產品方向、敘事策略、架構公式固定下來。
> 這不是 spec，是讓後續所有討論不再漂移的北極星。

---

## 1. 核心教訓：MiroFish 做對了什麼

MiroFish 不是靠技術爆的。它用的都是現成框架（CAMEL-AI OASIS、Zep Cloud、D3.js）。

它爆的原因是三件事：

### 1.1 它發明了一個新動詞

「先跑一下未來。」

好的產品讓人自然冒出一個以前不存在的動詞。ChatGPT 是「問一下 AI」。MiroFish 是「丟個事件進去跑跑看」。

### 1.2 它讓使用者產生新的幻覺

使用者暫時覺得自己是先知、上帝、社會工程師。不是因為產品真的給了這個能力，而是它讓人**感覺**站到了那個位置。

### 1.3 它先賣感覺，不是先賣真相

「預測未來」這個說法嚴格來說不成立。但它賣的不是準確度，是一種前所未有的互動感：「未來原來可以被玩一下、試一下、看一下。」

### 1.4 MiroFish 的硬限制

- 沒有 judge（變更沒有合法性判斷）
- 沒有 rollback（跑完就跑完，不能退回去）
- 沒有 continuity（每次重開新局）
- 沒有治理（agent 自由跑，沒有 constitution 約束）
- 本質是觀察工具，不是治理工具

---

## 2. Thyra 與 MiroFish 的根本差異

```
MiroFish: 文件 → 圖譜 → 生成 agents → 讓它們跑 → 看結果
Thyra:    founding → state → change → judge → rollback → continuity
```

| | MiroFish | Thyra |
|--|---------|-------|
| 核心對象 | Agent（模擬人） | World（狀態 + 變更） |
| 變更合法性 | 沒有 | 四層 judge |
| 可回滾 | 不行 | rollback + snapshot |
| 連續性 | 只有 memory append | continuity verification |
| 治理 | 沒有 | constitution + law |
| 本質 | 模擬（simulation） | 開服（operation） |

**一句話：MiroFish 是「讓 agent 跑跑看」，Thyra 是「開一個持續存在的世界」。**

---

## 3. 產品第一感

### 3.1 不要先賣的東西

- governance
- constitution
- law
- evaluator
- world runtime
- bounded autonomy

這些是內部語言。外部聽不懂，也不會有感覺。

### 3.2 要先賣的感覺

三個人類原始慾望：

| 慾望 | 對應敘事 |
|------|----------|
| 操控 | 「改一個設定，看整個世界怎麼回應」 |
| 擁有 | 「這是我的世界，AI 替我經營」 |
| 預見 | 「先試一次，再決定要不要真的改」 |

### 3.3 一句話候選

按優先順序：

1. **「不是模擬，是開服。」** — 最銳，一下跟 MiroFish 分開
2. **「開一個世界，讓 AI 替你營運它。」** — 最完整
3. **「改一條規則，看整個世界怎麼回應。」** — 最有互動感
4. **「Create a world. Let AI run it.」** — 英文版
5. **「先讓你的想法活一次。」** — 最感性

### 3.4 Thyra 的動詞

MiroFish 的動詞是「試未來」。

Thyra 的動詞應該是：**「開一個世界」**。

不是建立、不是配置、不是部署。是**開**。像開一家店、開一個伺服器、開一個國家。

---

## 4. 「活著」的表達

### 4.1 什麼讓人覺得活著

不是圖表、不是 log、不是文字。

活的東西就是：**它在動。**

- 一個數字在跳
- 一條線在呼吸
- 你不需要知道它代表什麼
- 你只知道：這個東西是活的

### 4.2 三層「活」

| 層 | 感覺 | 對應 |
|----|------|------|
| 脈搏 | 打開就看到它在動 | 世界健康度在呼吸 |
| 回應 | 碰一下，它會反應 | 改一個值，曲線跳了一下 |
| 記憶 | 它記得你做過什麼 | 上次你改了什麼、結果如何 |

### 4.3 第一眼畫面

不是 API response。不是 JSON。不是 terminal。

是打開瀏覽器那一秒：**一個數字在呼吸。**

你碰它 — 改一個值 — 那個數字跳了一下。

那一跳，就是整個產品感。

---

## 5. 產品公式：Template × Pack × Governance

### 5.1 三層架構

```
World Template  → 決定這個地方怎麼運作（治理幾何）
Domain Pack     → 決定這個地方為什麼值得人類進來（主題用途）
Governance Runtime → 決定 AI 怎麼長期營運它（Thyra 核心）
```

### 5.2 三個核心模板

#### Market

一個由交易、檔期、活動、人流驅動的世界。

天然張力：
- 價格 vs 體驗
- 熱門攤位 vs 公平分配
- 活動爆發 vs 秩序維持
- 商業化 vs 世界感

AI Chiefs：Market / Event / Safety / Lore / Growth

#### Town

一個由建設、居民、資源、秩序、擴張驅動的世界。

天然張力：
- 成長 vs 穩定
- 公共資源 vs 私人利益
- 新居民 vs 社區秩序
- 發展速度 vs 世界一致性

AI Chiefs：Mayor / Resource / Community / Safety / Culture

#### Port

一個由進出、流通、跨界、身份、規則邊界驅動的世界。

天然張力：
- 開放 vs 安全
- 低摩擦 vs 信任
- 交易自由 vs 秩序管制
- 本地居民 vs 外來流量

AI Chiefs：Port / Customs / Trade / Security / Diplomat

### 5.3 Domain Packs

| Pack | 最適合模板 | 說明 |
|------|-----------|------|
| Festival | Market, Port | 靠檔期、人流、活動高潮活著 |
| Creator | Market, Town, Port | 創作者市集 / 聚落 / 自由港 |
| Pet | Town, Market | 寵物社區 / 活動市集 |
| Farm | Town, Market | 耕作共同體 / 農產市集 |
| Brand | Market, Port | 品牌聯名 / 跨界 |
| Collectibles | Market, Port | 稀缺、流通、保真、拍賣 |

### 5.4 組合公式

```
Market + Festival = Midnight Market
Market + Creator = Creator Night Market
Town + Pet       = Pet Commons
Town + Farm      = Farm Commons
Port + Creator   = Creator Freeport
Port + Brand     = Brand Freeport
```

---

## 6. 自治世界的判準

一個題材要能變成 Thyra world，至少要有這 5 件事：

1. **常住角色** — 不是內容作者，而是世界內的 operator
2. **持續決策** — 每天要決定開什麼、關什麼、怎麼分配資源
3. **稀缺與衝突** — 沒有稀缺就沒有治理，沒有衝突就沒有 judge
4. **可觀察後果** — 改了規則後，真的會影響留存、收入、秩序
5. **真實入口** — 外部人不是只來看，而是會進來參與、消費、回訪

缺 2-3 個，通常就會變成資訊集合，不是自治世界。

關鍵問句：**「這個地方每天有沒有事情要被營運？」**

如果答案不夠多，它就不適合 Thyra。

---

## 7. 商業化三層

### 第一層：世界內收入

前台直接產生。
- 門票 / 會員
- 虛擬商品
- 攤位租金 / 交易抽成
- 活動票券
- 贊助與品牌聯名

本質：AI 在替你營運一個會賺錢的地方。

### 第二層：世界營運訂閱

賣給世界擁有者。
- Chief 數量 / world 規模
- Governance / rollback / precedent / analytics
- World hosting
- Safety / moderation / autonomy controls

本質：開服系統費。

### 第三層：企業 / IP 授權

賣給遊戲公司、IP 持有者、品牌、媒體公司。

他們買的不是「一個 AI」，而是：讓自己的世界能被 AI 長期經營的能力。

本質：世界營運系統授權。

---

## 8. 產品路徑

### Phase 1：Market

只做一個模板：Market
只做兩個 pack：Festival, Creator

第一個完整產品：Midnight Market

原因：
- 商業密度最高
- 最好 demo
- 人類一眼懂
- 活動與交易天然帶來治理壓力

### Phase 2：Town

加 Town 模板。
開：Pet Commons、Farm Commons

這時候「村莊感」回來，而且不是抽象村莊，是有生活主題的 town。

### Phase 3：Port

加 Port 模板。
開：Creator Freeport、Brand Freeport

這時候 territory / federation / 跨世界概念才開始成立。

---

## 9. 對應現有技術棧

| 概念層 | 對應程式碼 |
|--------|-----------|
| Template（治理幾何） | Village Pack founding layer — constitution, chiefs, evaluator |
| Pack（主題內容） | Village Pack 的 skills, laws, initial state |
| Governance Runtime | Thyra `src/` — WorldManager, judge, rollback, continuity |
| 世界執行 | Karvi — 執行 approved changes |
| 世界記憶 | Edda — precedent, outcomes, history |
| 人類入口 | Völva — conversation / settlement / authoring |
| 世界本體 | Sidecar — state model, change shape, rollback |

### 已完成

- ✅ Governance Runtime 核心（T1-T11, P0/P1）
- ✅ World 模組（state, change, judge, rollback, continuity, snapshot, diff）
- ✅ Village Pack compiler
- ✅ Bridge 整合（Karvi + Edda）
- ✅ Völva 骨架 + planning pack

### 進行中

- 🔄 WorldManager orchestrator (#178)
- 🔄 World API routes (#183)
- 🔄 Pack/apply endpoint (#182)

### 缺少

- ❌ Template 抽象（Market / Town / Port 模板概念）
- ❌ Domain Pack 可插拔機制
- ❌ 持續運行的 governance loop（AI chiefs 自主營運）
- ❌ 活著的感覺（可視化、脈搏、即時回饋）
- ❌ 真實入口（人類可參與的介面）

---

## 10. Invariants

以下可視為 Product Vision v0 的不可違反條件：

1. Thyra 不是模擬器，是開服系統。
2. 第一個 exemplar 必須是有真實鉤子的場所，不是純虛擬。
3. 產品先賣感覺（活著、操控、回應），不先賣架構。
4. Template 定義治理幾何，Pack 定義人類用途，兩者分離。
5. 活著的感覺 = 它在你沒操作的時候自己在變。
6. 自治世界必須有：常住角色、持續決策、稀缺與衝突、可觀察後果、真實入口。
7. Phase 1 只做 Market 模板，不提前做 Town 和 Port。
8. 商業化先從世界內收入開始，不先賣抽象平台。

---

## 11. 一句話版本

> **Thyra 不是 AI 工具，也不是社群媒體。**
> **它是用來開一個世界、讓 AI 替你經營的系統。**
>
> **不是模擬，是開服。**
