# Portable Self and Local Rights

> 目的：把「同一個人可以穿越多世界，但不能把整包人格與整包財產直接帶過去」這件事，落成一個可實作的分層模型。

---

## 這份文件回答什麼

這份文件主要回答四個問題：

1. 多世界系統裡，什麼東西應該連續？
2. 什麼東西不應該直接跨世界搬運？
3. 人格連續性應該落在哪一層？
4. 財產權與權利應該怎麼做，才不會把多世界做成單一共享資料庫？

---

## 核心原則

同一個人可以穿越多個世界，但不能把：

- 完整人格 dump
- 完整世界狀態
- 完整 local social graph
- 完整 inventory

直接搬到另一個 world。

真正應該成立的是：

- `portable self`
- `local world sovereignty`
- `attestation-based portability`

也就是：

- 人帶著可攜的自我模型
- 每個 world 保有在地語義與主權
- 真正跨世界移動的通常不是原物，而是經目標 world 承認的憑證、聲譽、資格或 claim

---

## 四層模型

### 1. Root Self

這是真正的人。

它承載：

- 最終價值
- 最終授權
- 最終否決權
- 哪些事情永遠不能代理

它不應該直接暴露給每個 world。

### 2. Portable Steward

這是人與多世界之間的可攜代理層。

它承載：

- 高層偏好
- 風險容忍度
- 風格傾向
- 跨世界記憶摘要
- 已授權的代理範圍

這裡才是人格連續性比較合理的落點。

### 3. World Incarnation

這是人在某個特定 world 裡的在地化身。

它承載：

- 本地身份
- 本地角色
- 本地可見 traits
- 本地語義下的社會位置

同一個 `Root Self` 進不同 world，應該長出不同 incarnation。

### 4. Local Rights Envelope

這是該 world 願意承認給這個 incarnation 的權利包。

它承載：

- 可做的操作
- 可進入的區域
- 可提案與不可直接執行的範圍
- 可被承認的外部 attestation

這一層一定要 `local-first`。

---

## 人格連續性該怎麼做

不要做：

- full persona portability
- raw memory dump
- 同一個角色物件硬搬到所有 world

應該做：

- high-level preference continuity
- summarized cross-world memory
- local reinterpretation in each target world

比較精準地說：

- 可攜的是 `self-pattern`
- 不可攜的是 `full persona state`

所以人格連續性真正的實作方式應該是：

1. `Root Self` 保存核心價值與不可代理事項
2. `Portable Steward` 保存高層偏好與摘要式連續性
3. 每次進入 target world 時，生成新的 `World Incarnation`
4. 由 target world 根據在地規則授予 `Local Rights Envelope`

---

## 財產權該怎麼做

不要做：

- 原物直接跨世界攜帶
- source world 的所有權直接在 target world 自動生效

應該做：

- local asset ownership
- portable attestation
- claim-check export
- target world recognition

可以把財產分成三類：

### 1. Pure Local Assets

例如：

- 裝備
- 土地
- 本地貨幣
- 本地 NPC 關係
- 本地職位

這些通常只能留在 source world。

### 2. Portable Attestations

例如：

- 試煉完成證明
- 會員資格
- reputation summary
- 入場資格
- access grant

這些可以跨世界攜帶，但不代表目標 world 一定承認。

### 3. Transferable Claims

例如：

- 可兌換權利
- claim-check
- 經目標 world 接受的外部 ownership reference

這些不是原物本身，而是可被轉譯與結算的權利憑證。

---

## Prototype 假設：先用 `<=10 worlds`

設計階段先不要直接想整個宇宙。

先假設系統只支援 `10` 個以內的小世界，這樣比較容易驗證：

- 可攜自我是否真的成立
- local sovereignty 是否真的保住
- claim-check 模型是否真的比 raw transfer 合理
- 同一個 steward 是否能在多世界形成不同 incarnation

這個假設目前先作為設計階段的邊界條件。

如果之後要落成 prototype，第一輪最值得驗證的是：

- 世界上限控制
- 同一 steward 在不同 world 生成不同 incarnation
- target world 只承認自己接受的 attestation type
- local-only asset 不可直接 export
- claim-check asset 可以轉成 portable attestation，但不會自動在 target world 變成原物

---

## 這份模型保護什麼

這個模型主要保護三件事：

### 1. 多世界不會被做成單一共享資料庫

每個 world 仍然有自己的 state、law、rights 與 local history。

### 2. 人格連續性不會污染世界主權

同一個人雖然可以穿越，但每個 world 都仍有自己的在地轉譯權。

### 3. 財產權不會因為 portability 而失控

跨世界通常是攜帶 claim 與 attestation，而不是原物與原始 state。

---

## 一句話收斂

多世界系統裡，真正合理的不是：

`one persona + one inventory + one permission set`

而是：

`Root Self -> Portable Steward -> World Incarnation -> Local Rights Envelope`

這樣才能同時保住：

- 同一個我穿越多世界的感覺
- 每個 world 的地方性與主權
- 權利、資產與治理邊界的清晰分層
