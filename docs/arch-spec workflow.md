# arch-spec workflow.md

> 狀態：`working draft`
>
> 目的：把 `arch-spec` skill 變成一套可重複的日常工作流，而不是一次性的「請 AI 幫我寫幾份 spec」。
>
> 這份文件回答的是：
>
> > **什麼時候開一個 architecture spec stack？**
> > **開了之後怎麼使用？**
> > **什麼時候該 review、patch、add、shared-types、promotion？**
> > **什麼時候該停手，轉去 `project-plan`？**

---

## 1. 一句話

> **arch-spec workflow = 用可檢視的 spec stack 取代腦內概念，先把系統是什麼講清楚，再決定怎麼拆工。**

它不是寫文件流程。
它是：

- 概念外部化流程
- 邊界對齊流程
- spec 修正流程
- 升級到 project-plan 的前置流程

---

## 2. 什麼時候啟動這個 workflow

當你發現目前討論處於以下任一種狀態時，就應該開 `arch-spec`：

### A. 問題還在「這到底是什麼」
例如：
- 這個東西到底是工具、runtime、world，還是 protocol？
- 它跟另一個 repo 的邊界在哪？
- 核心循環到底長什麼樣？

### B. 同一概念被不同人講成不同東西
例如：
- 有人把它當 dashboard
- 有人把它當 world
- 有人把它當 task runner

### C. 已經開始出現多份可能需要互相連接的 spec
例如：
- canonical cycle
- schema
- API
- slice
- demo path
- handoff contract

### D. 如果現在直接進 `project-plan`，高機率會拆錯工
這是很強的 signal。

---

## 3. 什麼時候**不要**啟動這個 workflow

### 不要用在
- 單一 bug fix
- 單一 feature
- 小型 refactor
- 只是要做一份 RFC
- 已經很明確的 build request
- 單次 task

### 如果其實只需要
- 一頁決策 → 寫 RFC / ADR
- 直接做功能 → 直接做
- 拆成 tasks → 用 `project-plan`

---

## 4. Workflow 的四個模式

`arch-spec` 不只是一個 generate 指令。
它有四種日常模式：

### 1. Generate
從模糊討論產出第一版 spec stack

### 2. Review
檢查現有 stack 的內部問題與跨文件衝突

### 3. Add / Patch
補一份缺失 spec，或修某一份 spec 的問題

### 4. Promote
判斷某一塊 spec 是否已成熟到能進 `project-plan`

---

## 5. 標準工作流總覽

```text
聊天 / 討論 / 模糊概念
→ Decide if arch-spec is needed
→ Generate minimal stack
→ Review stack
→ Add / Patch files
→ Extract shared-types if needed
→ Re-review
→ Promotion check
→ if stable: hand off to project-plan
→ if not stable: continue spec iteration
```

這就是完整閉環。

---

## 6. 第一輪：Generate，不要一開始就 full stack

第一輪最常見的錯，是一上來就想產整套 full dossier。

這通常太重。

### 正確做法
先決定這次是：

- **minimal stack**
- **standard stack**
- **full stack**

---

### 6.1 Minimal Stack
適用：
- 母題剛浮現
- 還不確定這東西值不值得深挖
- 需要先抓骨架

通常只產：
- `overview.md`
- `canonical-cycle.md` 或等價物
- `shared-types.md`（如果已出現跨文件型別）

---

### 6.2 Standard Stack
適用：
- 核心循環已相對清楚
- 開始需要 schema / API / slice

通常產：
- `overview.md`
- `canonical-cycle.md`
- `schema.md`
- `api.md`
- `canonical-slice.md`
- `demo-path.md`

---

### 6.3 Full Stack
適用：
- 已經確定要把這塊做成完整可交接 spec
- 要準備 promotion 到 `project-plan`

通常再加：
- `judgment-rules.md`
- `handoff-contract.md`
- `promotion-check.md`
- `shared-types.md`

---

## 7. Generate 的標準順序

不管 stack 大小，討論與產出都應該盡量照這個順序：

```text
1. 母題 / overview
2. canonical form
3. primitives / schemas
4. rules / judgment
5. APIs / interfaces
6. canonical slice
7. demo path
8. promotion check
```

### 為什麼不能亂跳
如果先做 API，再回頭改 canonical form，
後面幾乎一定會整包重寫。

所以順序不是形式主義，
而是為了降低返工。

---

## 8. 每輪討論時的提問順序

當你用 `arch-spec` 跟人討論時，不要一輪問太多。
建議每輪只推進一個層級。

### Stage 1：母題
問：
- 這東西到底在解什麼問題？
- 它不是什麼？

### Stage 2：canonical form
問：
- 它反覆運轉的一個單位長什麼樣？

### Stage 3：schema
問：
- 一級公民有哪些？
- 哪些型別一定要固定？

### Stage 4：rules / judgment
問：
- 什麼是硬邊界？
- 什麼 change 合法？
- 什麼情況要 rollback？

### Stage 5：slice / demo
問：
- 最小具體實例是什麼？
- 要怎麼跑一遍證明閉環？

---

## 9. Review 什麼時候做

### 一定要做 review 的時機

#### A. 產完第一版 stack 後
不要直接往下長。

#### B. 新增第三份 spec 後
這時 type drift 和 naming drift 很容易出現。

#### C. 每次加新大類 artifact 後
例如：
- 第一次加 API
- 第一次加 handoff
- 第一次加 demo path

#### D. promotion 之前
一定要做一次完整 review。

---

## 10. Review 看什麼

Review 不只是看文筆。
應該固定看這五類：

### 10.1 Per-file health
每份文件是否只回答一個核心問題？

### 10.2 Naming stability
同一概念有沒有在不同文件換名字？

### 10.3 Type alignment
同一型別有沒有不同 shape？

### 10.4 Boundary clarity
各文件有沒有越界回答別人的問題？

### 10.5 Closure integrity
canonical cycle / API / slice / demo path 是否互相對得上？

---

## 11. Add / Patch 模式怎麼用

這是這個 workflow 最值錢的部分之一。

當你在討論中發現問題，不要重做整套 stack。
應該問：

> **是缺一份 spec，還是某一份 spec 不夠清楚？**

---

### 11.1 缺一份 spec
例如：
- 一直在講邊界，卻沒有 handoff contract
- 一直在講類型，卻沒有 shared-types
- 一直在講 upgrade，卻沒有 promotion rules

這時就用 `add`

---

### 11.2 某一份 spec 不夠清楚
例如：
- canonical cycle 太空
- schema 不夠硬
- demo path 太像敘事，沒有 closure

這時就 patch 該檔，不要重跑 generate。

---

## 12. 什麼時候該抽 `shared-types.md`

不是看檔案數量，
而是看：

> **某個型別是否已經成為跨文件 contract。**

### 該抽的 signal
- 同一個型別在 2+ 文件反覆出現
- 不同文件開始引用同一概念
- 命名已相對穩定
- type drift 開始出現風險

### 不該太早抽的情況
- 型別還在快速改名
- 文件還不到 2–3 份
- 其實只有概念名，還不是 contract

---

## 13. 什麼時候停下來，不要再 spec

這很重要。

你們最容易掉進的坑之一就是：
> 一直追更好的命名、更完整的 spec，而不進入 build。

所以要設停手條件。

### 停手 signal
- 一級公民名字兩輪都沒變
- canonical form 已經能一口講清楚
- schema 已經是 TypeScript，不再只是散文
- canonical slice 已經存在
- demo path 能跑出閉環
- 再討論下去，主要是在微調 wording，不是在解核心問題

到這一步，就該進 promotion check。

---

## 14. Promotion Check 怎麼做

問這 6 題：

1. 核心名詞穩了嗎？
2. canonical form 明確嗎？
3. shared-types 足夠嗎？
4. 邊界清楚嗎？
5. canonical slice 存在嗎？
6. demo path 是否能證明 closure？

### 如果六題大致都過
→ 進 `project-plan`

### 如果還有一兩個關鍵洞
→ 回到 Add / Patch

### 如果整個母題還在飄
→ 不要 promotion，繼續 spec

---

## 15. 和 `project-plan` 的交接方式

`project-plan` 不是拿聊天紀錄當輸入。
它應該拿：

- `overview`
- `canonical form`
- `shared-types`
- `rules / invariants`
- `slice`
- `demo path`
- `open gaps`

也就是：

> **spec stack 是 planning pack 的上游，不是替代品。**

---

## 16. 日常使用的最短操作套路

如果你們之後真的日常使用，我會建議用這個超短套路：

### 情況 A：概念剛冒出來
- `generate minimal stack`

### 情況 B：討論到一半卡住
- `review current stack`
- 找出是缺檔還是衝突

### 情況 C：發現少一塊
- `add <missing-spec>`

### 情況 D：名字穩了
- `shared-types`

### 情況 E：開始覺得可以做了
- `promotion check`
- 通過後轉 `project-plan`

---

## 17. 最小責任分工

### arch-spec 負責
- 定義系統是什麼
- 定義邊界
- 定義一級公民
- 定義 canonical closure
- 定義 what must be true before build

### project-plan 負責
- 把已定義好的東西拆成可做工作
- 排依賴
- 設驗收與 batch

### Forge / code 負責
- 實作

這個邊界不能混。

---

## 18. 這個 workflow 最容易做錯的地方

### 錯 1：Generate 後不 review
結果第一版 stack 被默認成真理。

### 錯 2：有問題就重聊，不 patch spec
這會讓 stack 失去累積價值。

### 錯 3：過早 shared-types
結果把還在變動的概念過早凍住。

### 錯 4：無限 spec，不 promotion
這是最貴的錯。

### 錯 5：拿 spec stack 直接當 project-plan
中間少了 decomposition，那 build 會亂。

---

## 19. 最後一句

> **arch-spec workflow 的目的，不是產出更多文件。**
>
> **它的目的，是把聊天中的概念變成可檢視、可修補、可交接的 spec stack，讓你們能在 build 前就發現誤解，並在概念穩定時有紀律地升級到 project-plan。**

---

如果你要，我下一步可以直接幫你做其中一個：

1. `minimum-stack.md`
2. `review-checklist.md`
3. `promotion-handoff.md`

我建議先做 **2**，因為 workflow 一有，下一個最能提升日常可用性的就是 review。