# Stack Role Mapping In The World Route

## 一、為什麼需要這份文件

當方向被定成 `governable world runtime` 之後，接下來最容易混亂的不是產品定位，而是元件角色。

因為現在的版圖已經有很多強概念：

- Sidecar
- IR
- Patch / Diff / Transaction
- Validation
- Blackboard / Grith
- Karvi
- Edda
- Thyra
- Village Pack

如果這些東西沒有在同一條敘事線上被固定，各自都會看起來像產品中心。

這份文件的目的，就是把它們在世界路線中的角色一次攤平。

---

## 二、總體圖

這條路可以先粗分成五層：

1. `World Surface`
2. `World Mechanics`
3. `Execution`
4. `Memory`
5. `Governance`

不是每個 repo 各佔一層。
有些元件是某一層的支柱，有些是跨層機制。

---

## 三、各元件角色

### 1. Sidecar

**角色：把某個具體領域翻譯成 machine-operable world surface**

Sidecar 的重要性不只是遊戲工具或引擎插件。
它真正提供的是：

- 世界可表示
- 世界可操作
- 世界可驗證
- 世界可回滾

它做的事情包括：

- 建立 domain 的表示法
- 抽象合法操作
- 提供 adapter 與 blackboard
- 讓一個原本只存在於人類隱性知識中的領域，變成 AI 可以真正進入的空間

如果沒有 `sidecar` 這種東西，Thyra 很容易只剩抽象治理哲學。

### 2. IR / Schema

**角色：世界的表示法**

IR / schema 決定：

- 世界如何被看見
- 世界如何被比較
- 世界如何被儲存
- 世界如何被改寫

這一層是整個 stack 的地基。

如果表示法不穩定：

- patch 沒有穩定對象
- validation 難以定義
- precedent 很難建立
- governance 只能停留在抽象口號

### 3. Patch / Diff / Transaction

**角色：世界的合法操作與變更單位**

這一層回答：

- 世界的變更如何表達？
- 變更能否比較？
- 變更能否被審核？
- 變更能否回滾？

這裡的核心概念是：

- patch
- diff
- transaction
- rollback scope

如果沒有這一層，世界操作仍然是魔法，不是制度化 transition。

### 4. Validation

**角色：世界不被弄壞的檢查機制**

validation 是 world route 裡最重要的安全層之一。

它負責：

- 檢查 patch 套用後是否合法
- 檢查系統一致性是否被破壞
- 檢查輸出是否仍符合世界契約

在這條路裡，validation 不是 QA 附件，而是世界治理的前置條件。

### 5. Blackboard / Grith

**角色：世界的共享可見表面**

這一層讓：

- 多個智能體看到同一個世界狀態
- 執行層與介面層讀同一份狀態
- world evolution 變成可觀測、可追蹤、可問答

黑板在這條路裡通常不是 optional cache。
它往往是世界共享狀態面的核心。

如果用 `Grith` 的語言來看，它更像：

- coordination surface
- shared observable substrate

而不是最終治理層。

### 6. Karvi

**角色：世界中的行動與執行驅動層**

Karvi 在世界路線裡不是產品本體，但非常重要。

它負責：

- dispatch
- execution lifecycle
- progress / signals
- runtime status
- external action handling

如果用更白話的說法：

Karvi 是讓世界中的變更真的動起來的執行層。

它比較接近：

- kinetics
- runtime action engine

而不是 world model 本身。

### 7. Edda

**角色：世界的歷史、判例與演化記憶**

Edda 在這條路線裡不是純 transcript memory。
它的真正價值是：

- 哪種變更以前成功
- 哪種變更以前失敗
- 哪條 law 曾經 rollback
- 哪個決策有什麼理由鏈

也就是說，Edda 存的不只是「誰說了什麼」，
而是世界如何被改過，以及改過之後發生了什麼。

它是治理閉環裡的 precedent layer。

### 8. Thyra

**角色：世界的治理層**

Thyra 負責的不是操作細節，而是：

- constitution
- law
- risk
- approval
- budget
- territory
- governance loops

換句話說：

Thyra 不負責世界如何被表示，
也不負責每個具體 patch 怎麼執行。

它負責的是：

> 哪些變更可以做、哪些不可以做、什麼時候要停、什麼叫變好。

這使它成為：

- world governance layer
- control plane

### 9. Village Pack

**角色：人類對世界下規則的入口**

Village Pack 的位置非常關鍵。

它不是 runtime，不是 memory，不是 execution。
它是：

- human constitutional interface
- world configuration authoring surface

這代表：

- 人類不是直接改所有內部狀態
- 人類透過單一入口宣告自己要什麼世界與邊界
- 底層 compiler 再把它落成治理 artefacts

它是人類與 world governance 之間最有價值的 interface 之一。

---

## 四、組合起來怎麼看

如果把整個 stack 組起來，它更像這樣：

### 1. Sidecar 建出世界的形狀

- 把 domain 變成 AI 可理解、可操作的結構

### 2. IR / Patch / Validation 提供世界機械

- 世界如何被表示、如何被合法改變、如何被檢查

### 3. Blackboard / Grith 提供共享表面

- 讓世界的當前狀態對多方可見

### 4. Karvi 讓世界中的行動發生

- 把任務與行動真正執行出來

### 5. Edda 保留世界演化的歷史

- 讓過去變更成為未來治理的材料

### 6. Thyra 對整個世界施加治理

- 訂目標、設邊界、立法、審批、看結果

### 7. Village Pack 讓人類能下規則

- 成為 world governance 的 authoring surface

---

## 五、這個 mapping 的價值

這個 mapping 之所以重要，是因為它讓整個版圖不再像很多平行專案，而像一條堆疊路徑。

它讓下面這些句子能同時成立：

- `Sidecar` 不是旁支，而是 world surface layer
- `Karvi` 不是主產品，而是 execution layer
- `Edda` 不是附加記憶，而是 precedent layer
- `Thyra` 不是抽象 dashboard，而是 governance layer
- `Village Pack` 不是單純 YAML，而是 human constitutional interface

這些位置一旦定住，後面要擴產品或做新 vertical 時，就比較不會亂。

---

## 六、目前最值得記住的一句話

如果要把整個 stack 收斂成一句高密度表述，大概會是：

> **Sidecar 讓世界可表示與可操作，Karvi 讓世界中的行動發生，Edda 讓世界記住自己怎麼演化，Thyra 讓這一切有邊界、有法律、有目標。**

而 Village Pack 則是：

> **人類對這個世界下規則的入口。**

這句話可以作為後續討論各元件角色時的總結基準。
