# What Counts As A World

## 一、為什麼要先回答這個問題

一旦開始用 `world` 來思考，很容易什麼都被叫成 world。

這很危險。

如果任何東西都算世界，那麼：

- 所有 workflow 都會被誤包裝成 world runtime
- 所有 prompt chain 都會被高估成治理問題
- 所有 automation 都會被誤認成制度空間

所以需要一個更硬的判準：

> 什麼樣的領域，才值得被升格成 world？

這個問題不是純理論。
它直接決定：

- 哪些方向值得投入 world infrastructure
- 哪些方向應該只做普通工具或 workflow
- 哪些場景配得上 `Thyra + Sidecar + Karvi + Edda` 這種重型結構

---

## 二、五個基本條件

一個領域若要被當成 `world`，至少應該盡量滿足下面五個條件。

### 1. 有穩定 state

必須能回答：

> 現在這個世界長什麼樣？

這不是單次回應、不是 transient output，而是可以被持續描述與保存的狀態。

例如：

- 遊戲世界目前有哪些場景、角色、系統、數值、內容
- 內容世界目前有哪些主題配置、法律、節奏、素材、已發布內容
- 設計系統目前有哪些元件、變體、規則、可用資產

如果一個領域無法穩定回答「現在長什麼樣」，它通常比較像任務流，不像世界。

### 2. 有合法操作與非法操作

必須能回答：

> 哪些變更是合法的？哪些變更是不應該發生的？

這代表該領域不能只是「做任何事都可以，只是有些比較好」。

world 必須存在操作邊界：

- 某些 patch 合法
- 某些 patch 危險
- 某些 patch 根本不應該生效

如果缺少這一點，系統比較像探索空間，不像治理空間。

### 3. 有驗證機制

必須能回答：

> 改完之後，我怎麼知道它沒有被弄壞？

這裡的驗證可以是：

- compile / lint
- schema validation
- simulation
- consistency checks
- domain-specific rules

沒有驗證，世界只能被改，不能被治理。

### 4. 有歷史與連續性

必須能回答：

> 過去的變更，會不會影響現在與未來？

世界不是一次性結果，而是持續演化的空間。

這意味著：

- 變更要留下歷史
- 歷史要可查
- 某些舊決策會影響當下判斷
- precedent 不是附屬品，而是演化基礎

如果每輪都是重開新局，就比較像單次代理任務，不像 world evolution。

### 5. 有可評估目標

必須能回答：

> 世界有沒有朝目標變好？

如果沒有某種相對穩定的裁判，系統就只能不停變化，卻無法知道自己是否演化得更好。

可評估不代表完全客觀，但至少要存在：

- 衡量標準
- 失敗訊號
- 改善方向
- 可比較的結果

沒有這一點，就很難形成治理閉環。

---

## 三、如果缺少其中一項，會退化成什麼

下面這張表說明：缺什麼，就會往哪種比較弱的型態退化。

| 缺少什麼 | 會退化成什麼 |
|---|---|
| 穩定 state | prompt chain / 一次性 task |
| 合法操作 | 亂試的自動化空間 |
| 驗證機制 | 無法治理的生成系統 |
| 歷史與連續性 | 每輪重開新局的 agent demo |
| 可評估目標 | 無裁判的探索 playground |

這也是為什麼很多 agent 系統雖然看起來很厲害，但不一定是 world system。

---

## 四、哪些領域很像 world

### 1. 遊戲引擎 / 遊戲內容世界

這是目前最明確的 `yes`。

原因：

- 有非常穩定的 state
- 有明確合法操作與非法操作
- 有 compile / validation / simulation
- 有長期歷史與內容連續性
- 有清楚可評估目標（可玩性、穩定性、難度、內容完整性）

這也是為什麼 `sidecar` 這麼重要。
它不是只是遊戲工具，而是第一個足夠完整的 world exemplar。

### 2. 結構化內容宇宙

例如：

- 長期經營的 blog village
- 多角色、多主題、多法律的 media system
- 長期內容節奏、主題配比、風格一致性系統

這類領域不如遊戲那麼強結構，但已經開始具備：

- state
- policies
- precedents
- evolution
- measurable outcome

因此它很可能也是 world，而不是單純 content workflow。

### 3. 設計系統 / 資產系統

如果有：

- 元件樹
- 設計規則
- 變體
- token
- 一致性驗證
- version / rollback

那它也很像一個 world。

### 4. 模擬驅動的結構化工作流

像某些：

- build pipeline
- content balance pipeline
- structured operations systems

只要同時有：

- state continuity
- legal transitions
- validation
- measurable target

它們也能接近 world。

---

## 五、哪些領域不像 world

### 1. 一次性問答 bot

沒有持續 state，沒有長期演化，沒有世界歷史。

### 2. 純 prompt chaining

如果只是：

- prompt A → prompt B → prompt C

而沒有穩定 state / rollback / legality / precedent，
那比較像流水線，不像世界。

### 3. 沒有驗證與回滾的腳本自動化

就算能執行很多操作，只要無法明確判定合法性與恢復能力，它仍然比較像 risky automation。

### 4. 每輪都重開的 agent demo

如果每次 session 開始時，世界都沒有 continuity，
那它比較像表演，不像可治理的運行空間。

---

## 六、以目前版圖來看，為什麼遊戲特別適合

遊戲之所以是很好的起點，不只是因為它酷。

而是因為它幾乎完美符合 world 的五個條件：

### 1. 有強 state

- scene
- node tree
- systems
- content
- balance data

### 2. 有強 legality

- 格式是否合法
- 引用是否完整
- 系統是否衝突
- patch 是否合理

### 3. 有強 validation

- compile
- lint
- simulation
- rules

### 4. 有強 continuity

- 內容版本
- 場景變更
- 系統調整
- 角色演化

### 5. 有強 evaluation

- 可玩性
- 平衡性
- 一致性
- 內容覆蓋率

這使得遊戲世界不是一個 metaphorical world，而是真正可以被制度化的 world。

---

## 七、這會怎麼影響產品優先順序

一旦把「什麼算 world」定清楚，產品優先順序會更乾淨。

### 優先

應該優先投入那些：

- 有穩定 state
- 有合法操作集合
- 有強驗證機制
- 有長期 continuity
- 有固定裁判

的領域。

### 不優先

不應該把大量精力花在那些：

- 只有單輪任務
- 缺少持續 state
- 沒有 rollback
- 沒有明確 validation
- 缺少 precedent 價值

的場景上。

否則只會把產品拉回 generic agent platform 的泥沼。

---

## 八、進一步的判準：world 的密度

不是所有符合條件的領域都一樣強。

可以把它們想成有不同的 `world density`。

### 高密度 world

具有：

- 高結構
- 高驗證
- 高連續性
- 高 rollback 需求
- 高 precedent 價值

例子：

- 遊戲引擎
- 複雜設計系統
- 結構化 asset pipeline

### 中密度 world

具有：

- 一定程度的 state 與 rules
- 一定程度的評估與歷史

例子：

- 長期內容經營系統
- 某些營運型 village

### 低密度 world

看似有流程，但其實更接近：

- workflow
- automation
- task chain

這類場景不一定不值得做，但不一定值得用 world governance stack 去做。

---

## 九、目前的暫定結論

截至目前，這個 stack 最適合優先對準的是：

1. `高密度 world`
2. `結構明確、驗證明確、可回滾、可累積 precedent 的 domain`

這也是為什麼：

- `sidecar` 很關鍵
- 遊戲是一個非常好的 exemplar
- 某些長期內容世界可能是第二個合理方向

---

## 十、保守原則

未來如果討論某個新場景，要不要納入 world 路線，可以先問這五個問題：

1. 這個領域能不能清楚回答「現在世界長什麼樣」？
2. 這個領域能不能明確區分合法與非法變更？
3. 這個領域有沒有可信的 validation / simulation / checking？
4. 這個領域的歷史與 precedent 是否真的重要？
5. 這個領域是否有可持續優化的目標，而不是只求一次性產出？

如果大多數答案是否定，就不要硬叫它 world。

這個保守原則，是為了避免概念膨脹。
