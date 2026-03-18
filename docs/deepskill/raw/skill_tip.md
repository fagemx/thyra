對，這段故意挑的就是**最有說服力的難例子**，不是隨便挑輕量 workflow。

我先直接下判斷：

# 這段真正厲害的地方，不是在說「LLM 很強」
而是在說：

> **很多垂直軟體的價值，其實不是 code 本身，  
> 而是那套被 code 凍結住的專家判斷流程。**

而 LLM + skill/markdown 做的事是：

> **把原本只有工程師能改的「判斷流程」，解凍成領域專家自己也能改的文字層。**

這才是他那句「商業邏輯從 code 遷移到 markdown」的真正意思。

---

# 為什麼他舉的例子很強？

因為他不是拿什麼「寫 email」「整理報告」這種簡單例子。  
他拿的是兩種傳統上非常像護城河的東西：

## 1. Doctrine：法律研究 workflow
這種系統過去的護城河是：

- 法律領域知識
- 查詢拆解
- court database mapping
- citation / authority ranking
- 法律助手怎麼真的工作

也就是：
> **不是資料庫本身，而是怎麼把法律工作流程編成系統。**

這非常像 vertical SaaS 最愛說的 moat。

---

## 2. Fintool：DCF 技能
這個更狠。

因為它不是「做個財務模型 UI」，  
而是直接說：

> 一個做過 500 次 DCF 的投資經理，
> 可以把自己那套估值方法，
> 直接寫成一個 markdown skill。

也就是：
- 要抓哪些數據
- WACC 怎麼算
- 哪些假設要驗
- sensitivity 怎麼跑
- SBC 何時加回

這些以前可能散在：
- code
- analyst training
- 內部 playbook
- senior judgment

現在被壓成一個可直接給 agent 跑的 skill。

這個例子特別有殺傷力，因為它不是 low-skill domain。  
它是高判斷密度 domain。

---

# 所以這段話最狠的觀察是什麼？

我覺得是這句：

> **工作流護城河正在從「工程封裝能力」變成「判斷外部化能力」。**

以前 moat 來自：
- 你有懂 domain 的工程師
- 你把 domain knowledge 寫進 code
- 別人很難重建那一層

現在如果 LLM 足夠強，  
很多這種 moat 會被拆成兩層：

## 上層：專家方法論
可以寫成 markdown / skill / checklist / policy

## 下層：runtime / data / integration / control
還是要 code

也就是：

> 以前這兩層黏在一起。  
> 現在它們被拆開了。

這就是為什麼他說「最具毀滅性」。

---

# 但我會補一個很重要的修正
## 不是「商業邏輯都變成 markdown」
而是：

# **可被文字化、可被審閱、可被 LLM 執行的那部分商業邏輯，正在從 code 中脫層。**

這差很多。

因為不是所有商業邏輯都能這樣搬。

---

# 哪些邏輯最容易從 code 脫到 markdown？

我覺得有四個條件：

## 1. 高判斷密度
重點在：
- 怎麼判斷
- 怎麼拆問題
- 怎麼評估
- 怎麼選擇

而不是重點在 deterministic transaction。

像：
- 法律研究
- 投資分析
- 醫療前分流
- 審查流程
- 顧問式 workflow
都很容易中。

---

## 2. 能被語言表述
如果專家真的能說出來：
- 先看什麼
- 再比什麼
- 什麼情況例外
- 哪些 gotcha 最重要

那就能變 skill。

---

## 3. 可容忍 probabilistic execution
也就是：
- 不是每一步都得 100% deterministic
- 容許模型在框架內做判斷

法律研究和 DCF 就很適合這種。  
因為它們本來就不是純機械流程。

---

## 4. 回答品質主要取決於方法，不是系統狀態轉換
如果核心價值來自：
- 搜尋框架
- 問題拆解
- 方法步驟
- judgment checklist

那 markdown 很強。

---

# 那哪些東西沒那麼容易被 markdown 取代？

這裡才是我覺得很多人會講過頭的地方。

## 1. stateful systems
例如：
- 訂單
- 結算
- approval chain
- inventory
- entitlement
- permissions

這些不是「說明你該怎麼做」就夠。  
它們需要：
- state
- invariants
- transactions
- concurrency control
- rollback

這些還是 runtime / code 世界。

---

## 2. 強驗證 / 強責任 / 強審計
例如：
- 財務入帳
- 合規審批
- 醫療決策責任
- 交易撮合
- ledger

你可以用 markdown 定 policy，
但最後還是要有 deterministic enforcement layer。

---

## 3. integration-heavy systems
很多垂直軟體值錢的地方不是 workflow 語言本身，  
而是：
- 你能接哪些資料源
- 你資料清不乾淨
- 你的 API 髒活做了多少
- 你的 edge cases 補了多少

這層不會因為 skill 出現就消失。

---

## 4. institutional trust
有些買家買的不是「這套方法」，  
而是：
- 出錯誰負責
- 有沒有 support
- 可不可以 audit
- 是不是能接現有流程
- 能不能讓 junior 也穩定使用

這層也不會自動被 markdown 吃掉。

---

# 所以我會把這段話修成一個更準的版本：

> **不是垂直軟體的商業邏輯全部變成 markdown；  
> 而是其中那層“可語言化的專家判斷與 workflow 方法論”，正在從 code 中脫層，變成 skill/policy layer。**

這句比較準。

---

# 這對你現在在想的東西，其實超 relevant

因為你今天早上一直在拆的，就是這幾層：

- pre-DAG decision layer
- spec stack
- runtime governance layer
- skill layer
- world/runtime layer

這篇其實剛好在支持一個你今天越講越清楚的觀點：

# **很多系統正在變成兩層：**
## 上層是可快速改寫的 skill / decision / policy / spec
## 下層是 stateful runtime / enforcement / orchestration / memory

這個對你很重要。

---

# 對應到你現在的架構，可以直接這樣翻：

## Völva / skills / arch-spec / intent-router
屬於：
> **上層可快速改寫的 decision / policy / realization layer**

---

## Thyra / world runtime / judgment / pulse / outcomes
屬於：
> **下層 stateful runtime / governance layer**

---

## Edda
屬於：
> **把上層 decision 與下層後果接起來的 precedent spine**

---

# 所以這篇貼文最值得你拿走的，不是「markdown 很強」
而是這個更深的結構：

# **Vertical software 正在分裂成：**
## 1. expert method layer  
## 2. runtime enforcement layer

以前這兩層都包在 application code 裡。  
現在它們可以分離。

---

# 這也是為什麼他選那麼難的例子
因為他在證明：

> 連法律研究、DCF 這種高判斷密度領域，  
> 都可以把很大一塊 value 從 code 挪到 skill/prompt/policy layer。

如果這成立，  
那一大票「其實靠 workflow 與 judgment 賺錢」的 vertical software 都會被重估。

---

# 但最後我還是會補一句保留

## 這段話最容易被誤讀成：
> 「那以後不用軟體了，只要 markdown」

這是錯的。

更準的是：

> **code 不再壟斷 workflow logic。**
> **但 runtime、state、audit、integration、responsibility 這些東西仍然需要硬系統。**

所以未來不是：
- code 消失

而是：
- **code 的重心下沉**
- **skill/policy/spec 的重心上浮**

---

# 如果把這篇壓成一句最值得記的話

> **垂直軟體最脆弱的部分，不是資料庫，也不是 UI，而是那層原本被 hardcode 的專家 workflow；LLM 讓這層第一次可以被快速外部化、審閱、複製與客製。**

我覺得這句最有力。

---

如果你要，我下一步可以直接幫你做兩種其中一個：

1. **把這篇觀點翻成你現在系統語言**
   - skill layer / spec layer / runtime layer / precedent layer

2. **分析這對 Thyra / Völva / Edda 意味著什麼產品機會**
   - 哪層最值得做
   - 哪層最容易被 commoditize
   - 你的護城河應該放哪

我覺得 **2 更有用**。

#####

有，這篇我看完了。它跟 Nicolas 那篇剛好是一組很好的對照：**Nicolas 在講「商業邏輯從 code 脫層」；Thariq 在講「脫出來之後，實際上長成什麼樣子」**。

我先直接下結論：

# 這篇最重要的修正是：
## **skill 不是 markdown 檔，而是小型可執行工作包。**

這很重要，因為它把我們剛剛那個理解往前推了一步。

Nicolas 那篇容易讓人停在：

- 專家方法 → markdown
- markdown → agent 執行

但 Thariq 這篇其實在說，真正在內部高頻使用的 skill，長得更像：

- instructions
- gotchas
- references
- scripts
- templates/assets
- config
- data / memory
- dynamic hooks
- usage logging

也就是：

> **不是把 workflow 寫成一段文字而已，**
> **而是把 workflow 打包成 agent 可探索、可操作、可累積經驗的 execution package。**

---

# 這篇最值得抓的五個點

## 1. 他直接反駁了「skills are just markdown」
這句基本上就是在回應你前面貼的 Nicolas 那種說法的簡化版。

Thariq 的意思不是說 markdown 不重要，而是說：

> markdown 只是入口；
> 真正有威力的是 skill folder 這個結構。

所以 skill 的本體其實是：
- 一個 triggerable unit
- 一個有 progressive disclosure 的檔案系統
- 一個可以帶 code / data / hooks 的可組合包

這就不是純 prompt engineering 了。
這比較像 **micro-runtime package**。

---

## 2. 最值錢的 skill 類型，不是文案型，而是 verification / debugging / ops / deploy
這點我覺得超關鍵。

他列了很多類型，但裡面最有力的不是「教 Claude 某個 library 怎麼用」而已，
而是那些會碰到：

- 測試
- 驗證
- 監控
- deploy
- debugging
- oncall
- maintenance

也就是說，內部最常用、最有價值的 skill，
其實已經不是「知識補丁」，
而是 **把一個多工具、半結構化、可重複的工作程序封裝起來。**

這點其實很支持你一直在想的方向：
不是單純 instruction layer，
而是 **decision + tooling + verification** 一起打包。

---

## 3. Gotchas 是 skill 的最高訊號
這句非常狠，而且很真。

因為這代表：

> skill 最值錢的部分，不是教模型它本來就知道的東西，
> 而是把它常犯錯的地方外顯化。

也就是：
- 哪裡會踩坑
- 哪些 edge case 常漏
- 哪些預設直覺是錯的
- 哪些做法在你們組織內不成立

這其實已經很接近你今天早上講的 decision engineering 了。

因為 gotcha 本質上就是：
> **把失敗經驗壓成可重用的判斷補丁。**

如果再往前走一步，
gotcha 累積久了，其實就會變成：
- policy
- review criteria
- promotion gate
- precedent

這裡已經摸到 Edda 了。

---

## 4. skill description 不是摘要，而是 trigger logic
這點也很重要，而且很 architectural。

他說 session 開始時模型會先掃所有 skill 的 description，
所以 description 寫的不是「這個 skill 是什麼」，
而是：

> **什麼情況下應該觸發這個 skill。**

這等於把 description 變成一種 **routing surface**。

也就是說，skill 不只是內容包，
它還有一層：
- discoverability
- invocation semantics
- routing hint

這跟你今天的 intent-router / path-check 其實很有共鳴。
只是 Anthropic 這裡還停在較扁平的技能觸發層，
你在想的是更上游的 regime / realization routing。

---

## 5. skill 也可以有 memory、telemetry、marketplace、curation
這一段是我覺得最容易被忽略，但其實最重要的。

因為這代表 Anthropic 內部已經默認 skill 不是靜態 instruction，而是有生命週期的東西：

- 可以記錄歷史
- 可以保留狀態
- 可以觀察使用率
- 可以看 undertrigger / overtrigger
- 可以上架 marketplace
- 可以先 sandbox 再 promotion
- 需要 curatio

這一句翻成你的語言就是：

> **skill 不是檔案，是一個可演化單位。**

而一旦它是可演化單位，就會自然長出：
- review
- governance
- promotion
- precedent
- versioning
- adoption metrics

也就是我們前面一直補的第三層。

---

# 所以這篇跟 Nicolas 放在一起看，會出現一個更完整的結構

## Nicolas 在說：
> 專家方法正在從 hardcoded business logic 脫出，變成可編寫的文字層。

## Thariq 在說：
> 這個文字層在真實高頻使用下，不會停在文字；它會長成帶 scripts/data/hooks/memory/telemetry 的 skill package。

所以再往前推一步，我會把整件事改寫成：

# **workflow logic 並不是從 code 變成 markdown。**
# **它是在從 monolithic application code，重組成 agent-native skill packages。**

這句比「商業邏輯變 markdown」準很多。

---

# 套回你現在的 Völva / Thyra / Edda

我現在會這樣翻：

## Völva
更像是：
> **skill / spec / decision package 的 crystallizer**

不是只產一段說明文，
而是把模糊 intent 壓成可操作的 package 草案：
- instructions
- gotchas
- references
- templates
- config needs
- maybe scripts to be promoted later

## Thyra
更像是：
> **skill package 被升格後的 governed runtime**

因為 Thariq 這篇雖然已經很強，
但它的 skill 還主要停在 agent session 內的工作包。
你在想的 Thyra 是再往下走一層：
- stateful world
- judgment
- outcomes
- accountability
- stable runtime loops

## Edda
最自然的角色變成：
> **skill 演化與 promotion 的 precedent spine**

因為 skill 真正會變好的來源，不是初版 instruction，
而是：
- gotchas 怎麼長出來
- 哪些驗證有效
- 哪些 hook 太煩
- 哪些 skill undertrigger
- 哪些 workflow 真正帶來 outcome

這些如果沒有 Edda 類的東西，最後就只是散在 skill folder 裡的經驗碎片。

---

# 這篇對你最有價值的，不只是它講得對
而是它剛好補上了你前面那個框架的缺口：

你前面那個說法比較像：
- method layer
- runtime layer

Thariq 這篇讓中間那層更具體了：

# **中間不是抽象 promotion layer 而已，**
# **而是 skill package layer。**

這層的元件已經很清楚：

- description / trigger
- instructions
- gotchas
- references
- scripts
- assets/templates
- config
- local memory
- hooks
- telemetry
- sharing / marketplace
- curation

這超像你可以直接拿來做 architecture boundary 的材料。

---

# 如果我把今天兩篇壓成一句你自己的版本，會是：

> **垂直軟體不是在被 markdown 取代，而是在被拆解：專家方法從 application code 脫出，先變成可演化的 skill package，再被升格進更穩定的 runtime 與 governance 層。**

這句就已經不是 Nicolas，也不是 Thariq。
這句比較像你自己的框架了。

如果你要，我下一步我建議直接做這個，不再停在聊天判讀：

## **把 Nicolas + Thariq 兩篇一起翻成你的三層架構圖**
- 哪些東西屬於 Völva
- 哪些東西屬於 skill package layer
- 哪些東西必須進 Thyra
- Edda 應該記錄哪一種 precedent

這一步會比繼續摘要文章更有產值。
####
