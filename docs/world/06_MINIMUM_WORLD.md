# The Minimum World

## 一、這份文件要固定什麼

前面的文件已經相對清楚地把方向收斂成：

> `Thyra` 更像是在做 `governable world runtime`，而不是單純的 agent management。

但一旦開始往「世界」這個方向思考，很自然會遇到另一個風險：

> 一下把格局拉到太大，結果只剩下抽象宇宙論，卻沒有第一個真正可落地的世界。

所以這份文件要固定的是：

1. 什麼叫 `最小世界`
2. 為什麼它不是 demo，也不是 toy
3. 為什麼第一個世界不該追求最通用，而應該追求最高密度
4. AI 與區塊鏈在 world stack 裡的合理位置
5. 為什麼在最小世界裡，第一個真正必須被制度化的核心對象，可能是 `change`

---

## 二、不是先做宇宙，而是先做最小世界

這裡最重要的一句話是：

> **不是先做宇宙，而是先做最小世界。**

因為如果真的在想 world infrastructure，最大的風險不是技術做不到，而是概念太大、對象太散、第一步沒有邊界。

最小世界不是「縮小版元宇宙」，也不是「一個可愛的 demo sandbox」。
它應該是一個已經具備世界性，但規模仍然可控的制度空間。

也就是說，它已經必須有：

- state
- change
- legality
- validation
- history
- continuity
- goal
- governance pressure

只是它的邊界還小到足以：

- 被完整看懂
- 被完整表示
- 被完整驗證
- 被完整回滾
- 被完整治理

---

## 三、最小世界的定義

### 1. 它不是一次性任務空間

最小世界不是：

- 單次 prompt 的輸出
- 一條 workflow 的中繼狀態
- 一個只跑一次的 pipeline

它必須是一個會持續存在的狀態空間。

### 2. 它不是純抽象模型

它不能只有哲學上像世界。
它必須真的有：

- 物件
- 狀態
- 關係
- 變更
- 邊界
- 錯誤

### 3. 它不是「什麼都能做」的白板

世界之所以需要治理，就是因為：

- 某些變更合法
- 某些變更不合法
- 某些變更雖合法但風險高
- 某些變更應先模擬再套用

如果缺少這種操作層次，它比較像 canvas，不像 world。

### 4. 它不是只有資料，還有命運

世界不是靜態資料集。
它必須會「因為變更而變成別的樣子」。

也就是說：

- 過去變更會影響現在
- 現在變更會影響未來
- 演化路徑是重要的

這就是為什麼 history / precedent / ledger 會自然變重要。

---

## 四、最小世界的必要條件

這裡可以把前面的 `world` 五條件再收成更實作向的最小世界標準。

一個領域若要成為第一個最小世界，至少需要：

### 1. 穩定 state

能清楚回答：

> 世界現在是什麼樣子？

### 2. 穩定 change model

能清楚回答：

> 世界如何改變？

這裡不是只要有 action，而是要有：

- patch
- diff
- transaction
- apply
- rollback

### 3. 穩定 validation

能清楚回答：

> 這個改變有沒有把世界弄壞？

### 4. 穩定 continuity

能清楚回答：

> 過去改過什麼？為什麼改？結果怎樣？

### 5. 穩定 governance pressure

能清楚回答：

> 這個世界不是放著自由演化，而是需要被邊界、法律、目標、審批所約束。

如果一個領域同時具備這五點，它就很適合成為最小世界。

---

## 五、最小世界不是最通用，而是最高密度

這裡有一個很重要的反直覺：

第一個最值得做的世界，不是最通用的世界，而是最密度高的世界。

### 為什麼不是最通用

因為越通用的 world，通常越容易：

- 邊界模糊
- 驗證薄弱
- state 不穩
- legality 不清
- precedent 價值不足

這會讓第一個 exemplar 變得又大又鬆。

### 為什麼要高密度

高密度 world 意味著：

- state 很清楚
- 變更很清楚
- 驗證很清楚
- 錯誤很清楚
- 回滾很重要
- precedent 很值錢

這種世界更適合用來驗證：

- 表示法是否真的成立
- change model 是否真的可治理
- memory 是否真的有作用
- governance 是否真的不只是抽象口號

---

## 六、為什麼遊戲 world 很像第一個 canonical minimum world

目前看來，遊戲 / `sidecar` 這條線之所以特別強，不只是因為它酷，而是因為它滿足最小世界的條件，而且密度很高。

### 1. state 很明確

- scene
- node tree
- systems
- assets
- content
- progression

### 2. change 很明確

- patch scene
- modify system params
- add dialogue
- rebalance level
- import / replace asset

### 3. validation 很明確

- compile
- lint
- schema checks
- consistency rules
- simulation

### 4. continuity 很明確

- 每次改動都會留下長期影響
- 角色一致性會被破壞
- 平衡性會漂移
- 系統之間會產生連鎖反應

### 5. governance pressure 很明確

- 不是所有變更都應該立刻做
- 某些變更要 review
- 某些變更要 rollback
- 某些變更可能破壞整體世界感

這使遊戲 world 很像第一個真正可以完整走通的 world exemplar。

---

## 七、為什麼這不是舊式元宇宙

這裡需要明確切開。

### 舊式元宇宙的主要問題

它通常先做的是表面：

- avatar
- 3D 空間
- 虛擬場景
- 沉浸感
- 在線互動

但沒有先做好：

- 世界表示法
- 合法操作
- 可驗證 change
- 可持續歷史
- 可治理演化

所以很多元宇宙產品看起來像世界，其實更像一個大型場景容器。

### 這條路不一樣

這條路是在說：

> 先做世界的制度與結構，之後 AI、資產、權利、交易、協作才有地方住。

也就是說：

- 世界不是畫面，而是制度化狀態空間
- 交易不是支付按鈕，而是合法變更的結算方式
- AI 不是聊天插件，而是能長期住在世界裡的自治者之一

這更接近：

- world infrastructure
- civilization substrate

而不是 2021 式的「3D 元宇宙敘事」。

---

## 八、AI 與區塊鏈在 world stack 裡的位置

這裡也需要明確切開，避免技術先行。

### 1. 沒有 world 層時

- AI 比較像外掛的智能
- 區塊鏈比較像外掛的記帳

也就是：

- AI 能說很多話，但沒有穩定世界可住
- 區塊鏈能記很多帳，但沒有真正值得被制度化的世界狀態

### 2. 有了 world 層之後

- AI 才可能變成世界中的居民、執行者、治理者之一
- 區塊鏈才可能變成世界中的權利、所有權、結算、跨域信任層

這時候兩者才不是漂浮技術，而是住進同一個制度世界中的元件。

### 3. AI 幾乎一定需要 world 層

如果要讓 AI 長期存在、持續行動、累積 precedent、被治理，
它幾乎一定需要一個 world layer。

### 4. 區塊鏈不一定是第一層

區塊鏈只有在某些條件下才自然長出來：

- 多方共同維護
- 跨組織信任
- 權利與所有權真的重要
- 需要不可竄改歷史
- 需要可驗證結算與跨域一致性

如果只是單一公司、單一 runtime、單一產品，
很多時候先用：

- ledger
- audit
- versioned DB

就足夠了。

所以更精準的說法是：

> AI 幾乎一定需要 world 層；區塊鏈是在某些 world 條件成熟後，才自然浮現的權利與信任層。

---

## 九、最小世界裡第一個真正要被制度化的是什麼

這裡有一個很重要的推測：

> 在最小世界裡，第一個真正必須被制度化的核心對象，可能不是 asset，也不是 agent，而是 `change`。

為什麼？

因為世界真正的難題不是它靜態長什麼樣，而是：

> 它怎麼變。

### 如果 change 沒有被制度化

那麼：

- state 只是快照
- history 只是日誌
- law 只是建議
- rollback 只是願望
- governance 只是觀察，不是控制

### 如果 change 被制度化

那麼：

- patch 有穩定表示法
- diff 可審核
- apply 有 legality
- validation 可判定
- rollback 有範圍
- precedent 有對象
- law 可以針對 change pattern 生效

這時世界才真正進入可治理狀態。

也就是說，最先成為第一級公民的，不只是 `state`，而是：

- `state`
- `change`

而更偏向治理核心的，可能是 `change over state`。

---

## 十、這會怎麼影響產品設計

如果 `change` 是第一個被制度化的核心對象，那產品中心就更不應該是 agent panel。

產品的中心更可能是：

- change review
- change simulation
- change legality
- change history
- change rollback
- change precedent

這代表：

### 首頁要能看變更流

而不只是 agent activity feed。

### 產品要有強 patch / transaction 語言

而不只是 task / run / worker 語言。

### 記憶系統要記變更結果

而不只是 agent 對話。

這也讓 `Edda` 的位置變得更清楚：
它最有價值的地方不是記錄某個 agent 說了什麼，
而是記錄某種 change pattern 曾導致什麼世界結果。

---

## 十一、目前的暫定判決

截至這一輪討論，可以先把下面幾點固定下來：

1. 第一個要做的不是宇宙，而是 `minimum world`
2. `minimum world` 必須已經具備 state、change、validation、continuity、governance pressure
3. 第一個 exemplar 不該追求最通用，而該追求最高密度
4. `sidecar` / 遊戲 world 很像目前最強的高密度 minimum world 候選
5. AI 幾乎一定需要 world 層；區塊鏈則是在部分 world 條件成熟後才自然長出來
6. 在最小世界裡，第一個真正必須被制度化的核心對象，很可能是 `change`

---

## 十二、接下來值得繼續追問的問題

這份文件之後，最值得繼續追問的幾個問題是：

1. 對於第一個 canonical world，最小可閉環的 change model 是什麼？
2. 哪些 change 屬於 low / medium / high risk？
3. 哪些 change 可以先 simulate 再 apply？
4. 哪些 change 必須永遠保留 precedent？
5. 第一個最能體現這個模型的 UI，是不是 `Change Review` 而不是 `Agent Board`？

這些問題會直接影響後續架構與產品設計。
