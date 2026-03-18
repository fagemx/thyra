不是「單獨一個 repo」，也不是「四散四份各自複製」。
更準的是：

# **一個 logical skill object，四個 plane 各自持有自己那一段權責。**

也就是：

- **不是一份 skill 在四個 repo 各 copy 一份**
- **而是同一個 skill，有 core + overlays + history**

這樣才不會 drift 到地獄。

---

## 我會這樣切

### 1. Völva：**core definition**
這裡放 skill 的本體定義：
- identity
- purpose
- routing
- contract
- package 結構
- gotchas / refs / templates
- 基本 governance 草案

也就是：
> 這個 skill 是什麼、解什麼、怎麼被理解、怎麼被包裝

這是 **可編輯主檔**。

---

### 2. Karvi：**dispatch overlay**
這裡不要存 skill 的完整本體，只存：
- 這個 skill 可以派到哪些 repo
- 哪些 runtime 可跑
- 哪些 worker class 可接
- timeout / retry / escalation
- artifact 回收方式
- merge / approval 邊界

也就是：
> 這個 skill 如何被組織化派工

Karvi 不該改 skill 的語義本體，只該加上 **派工視角的綁定**。

---

### 3. Thyra：**runtime/governance overlay**
這裡也不要存完整 skill，只存：
- world binding
- execution mode
- state 接口
- guardrails
- judgment rules
- verification hooks
- outcome schema

也就是：
> 這個 skill 一旦進入某個 governed runtime，要怎麼被約束、怎麼驗證、怎麼寫回 outcome

---

### 4. Edda：**history / precedent / supersession**
Edda 不該持有可編輯主檔。
它應該持有的是 append-only 的東西：

- 為什麼建立這個 skill
- 哪次 patch 有效
- 哪些 gotcha 被確認
- 哪次 promotion 通過 / 被退回
- 哪些 dispatch 結果好 / 壞
- 哪些 runtime outcome 反過來修正 skill

也就是：
> **skill 的時間維度**

---

# 所以不是四散，而是：

## **1 個 canonical core + 2 個 operational overlays + 1 個 precedent spine**

我會寫成：

- **Völva = source of meaning**
- **Karvi = source of dispatch truth**
- **Thyra = source of runtime truth**
- **Edda = source of historical truth**

這樣就很清楚。

---

# 如果更具體一點，檔案大概會長這樣

## Völva repo
```text
skills/arch-spec/
skill.object.yaml
SKILL.md
references/
scripts/
assets/
```

## Karvi repo
```text
bindings/skills/arch-spec.dispatch.yaml
```

## Thyra repo
```text
bindings/skills/arch-spec.runtime.yaml
```

## Edda
不是普通檔案主檔，而是事件 / precedent：
```text
events:
skill.created
skill.patched
skill.promoted
skill.dispatched
skill.run.succeeded
skill.run.failed
skill.superseded
```

---

# 但如果你問我 **v0 要不要真的拆成四邊都落檔？**

我會說：

## **不要一開始就物理拆太開。**

先做：

### v0
- **Völva repo 放 canonical skill object**
- Karvi / Thyra 先用最小 overlay 或甚至先用 inline metadata
- Edda 正式記事件

因為如果一開始四邊都 heavy split，你很容易花時間在同步問題，不是 skill 本身。

---

# 所以我的實際建議是

## 現在先採：
### **一主三側**
- **主檔在 Völva**
- **Karvi / Thyra 各自持有最小必要投影**
- **Edda 持有 append-only history**

不是：
- 一個大統一 repo

也不是：
- 四個 repo 各存完整 skill

---

# 為什麼不能只放單一 repo？

因為那樣會讓三件事混在一起：

- skill 是什麼
- skill 怎麼被派
- skill 在哪個世界怎麼跑

久了會變成一坨。

---

# 為什麼不能四份各自完整？

因為會立刻出現：
- trigger 改了 Karvi 不知道
- runtime guardrails 改了 skill 主檔沒反映
- promotion 過了但 dispatch policy 還是舊的
- Edda 記的 precedent 沒有回到 core

也就是 **多真相源** 問題。

---

# 最後壓成一句

> **skill 應該是 federated object，不是 monolith repo，也不是 replicated repo。**

如果你要，我下一步我可以直接幫你畫一版：

## **skill object 欄位 ownership map**
也就是每個欄位明確標：
- 哪些欄位屬於 Völva
- 哪些欄位屬於 Karvi
- 哪些欄位屬於 Thyra
- 哪些只寫進 Edda、不回寫主檔

這一步會很實。

####

好，我直接給你一版 **skill object 欄位 ownership map v0**。
核心原則先釘死一句：

> **每個欄位只能有一個 canonical owner。**
> 其他系統只能：
> - 讀
> - 投影
> - 提案
> - 記事件
> **不能偷偷變成第二真相源。**

---

# 一、四個 repo / plane 的角色

## Völva
管的是：
> **這個 skill 到底是什麼**

也就是：
- 意圖
- 問題形狀
- 方法
- trigger semantics
- package 本體
- gotchas / refs / templates 的語義

---

## Karvi
管的是：
> **這個 skill 怎麼被派工**

也就是：
- 派到哪個 repo
- 哪個 runtime / worker 可接
- timeout / retry / escalation
- artifact 怎麼回來
- merge / approval boundary

---

## Thyra
管的是：
> **這個 skill 在受治理的 runtime 裡怎麼跑**

也就是：
- execution mode
- state interface
- guardrails
- judgment / verification
- outcome schema
- world binding

---

## Edda
管的是：
> **這個 skill 隨時間怎麼演化、為什麼演化、結果如何**

也就是：
- 建立原因
- promotion 決策
- patch 為什麼有效
- confirmed gotchas
- supersede chain
- outcome-backed precedent

---

# 二、欄位 ownership map

我用這四種標記：

- **Owner** = 唯一可寫的 canonical owner
- **Readable by** = 誰會讀
- **Proposable by** = 誰可以提案修改
- **Recorded in Edda** = 哪些要進歷史

---

## A. Identity / Meaning 層

### `id`
- **Owner:** Völva
- Readable by: Karvi / Thyra / Edda
- Proposable by: human, Völva
- Recorded in Edda: create / rename / supersede

### `name`
- **Owner:** Völva
- Readable by: all
- Proposable by: human, Völva
- Recorded in Edda: rename history

### `summary`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva, human
- Recorded in Edda: major semantic shift only

### `domain`, `tags`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva
- Recorded in Edda: when changed materially

### `owners.human`, `owners.agent`
- **Owner:** Völva
- Readable by: all
- Proposable by: human
- Recorded in Edda: owner transfer

---

## B. Purpose / Routing 層

### `purpose.problemShapes`
- **Owner:** Völva
- Readable by: Karvi / Thyra
- Proposable by: Völva
- Recorded in Edda: when broadened/narrowed

### `purpose.desiredOutcomes`
- **Owner:** Völva
- Readable by: Thyra / Karvi
- Proposable by: Völva, human
- Recorded in Edda: major change

### `purpose.nonGoals`, `purpose.notFor`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva / Thyra / Karvi
- Recorded in Edda: yes, especially after incidents

### `routing.description`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva
- Recorded in Edda: not every wording tweak

### `routing.triggerWhen`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva, Karvi, Thyra
- Recorded in Edda: yes, because trigger drift matters

### `routing.doNotTriggerWhen`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva, Thyra, Karvi
- Recorded in Edda: yes

### `routing.conflictsWith`, `routing.mayChainTo`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva / Karvi
- Recorded in Edda: yes if behavior changes

---

## C. Contract / Package 層

### `contract.inputs`, `contract.outputs`
- **Owner:** Völva
- Readable by: Karvi / Thyra
- Proposable by: Völva / Thyra
- Recorded in Edda: major contract changes only

### `contract.successCriteria`
- **Owner:** Völva
- Readable by: Thyra / Karvi
- Proposable by: Völva / Thyra
- Recorded in Edda: yes if promotion standard changed

### `contract.failureModes`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva / Thyra / Edda-derived proposal
- Recorded in Edda: yes, especially when newly confirmed

### `package.root`, `package.entryFile`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva
- Recorded in Edda: only on structural migration

### `package.references`, `package.assets`, `package.scripts`
- **Owner:** Völva
- Readable by: all
- Proposable by: Völva / Karvi / Thyra
- Recorded in Edda: only important additions/removals

### `package.localState`
- **Owner:** Völva
- Readable by: Thyra / Edda
- Proposable by: Völva
- Recorded in Edda: storage policy changes only

### `gotchas`
- **Canonical authoring owner:** Völva
- **Evidence source:** Edda + runtime reports
- Readable by: all
- Proposable by: Thyra / Karvi / agents / Edda-derived review
- Recorded in Edda: every confirmed gotcha
- Important note:
- **candidate gotcha** 先進 local state / run logs
- **confirmed gotcha** 再回寫 Völva package + 記進 Edda

---

## D. Dispatch / Org Execution 層

### `dispatch.mode`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi / human
- Recorded in Edda: yes

### `dispatch.targetSelection.repoPolicy`
- **Owner:** Karvi
- Readable by: Völva / Thyra
- Proposable by: Karvi
- Recorded in Edda: major policy shifts

### `dispatch.targetSelection.runtimeOptions`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi / Thyra
- Recorded in Edda: yes if changed

### `dispatch.workerClass`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi
- Recorded in Edda: yes

### `dispatch.handoff.inputArtifacts`, `dispatch.handoff.outputArtifacts`
- **Owner:** Karvi
- Readable by: Völva / Thyra
- Proposable by: Karvi / Völva / Thyra
- Recorded in Edda: when changed materially

### `dispatch.executionPolicy.timeoutMinutes`, `retries`, `escalationOnFailure`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi
- Recorded in Edda: yes, because operational behavior changes

### `dispatch.approval.requireHumanBeforeDispatch`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi / human
- Recorded in Edda: yes

### `dispatch.approval.requireHumanBeforeMerge`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi / human
- Recorded in Edda: yes

### `repoBindings`
- **Owner:** Karvi
- Readable by: all
- Proposable by: Karvi
- Recorded in Edda: yes

---

## E. Runtime / Governance / World 層

### `environment.toolsRequired`, `toolsOptional`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra / Völva
- Recorded in Edda: when changed materially

### `environment.permissions`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra / human
- Recorded in Edda: always
- Important: permission change = governance event

### `environment.externalSideEffects`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra / human
- Recorded in Edda: always

### `environment.executionMode`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra
- Recorded in Edda: yes

### `runtimeBindings`
- **Owner:** Thyra
- Readable by: Karvi / Völva
- Proposable by: Thyra
- Recorded in Edda: yes

### `verification.smokeChecks`, `assertions`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra / Völva
- Recorded in Edda: when promotion-relevant

### `verification.humanCheckpoints`
- **Owner:** Thyra
- Readable by: Karvi / Völva
- Proposable by: Thyra / human
- Recorded in Edda: yes

### `verification.outcomeSignals`
- **Owner:** Thyra
- Readable by: Edda / Völva / Karvi
- Proposable by: Thyra
- Recorded in Edda: outcome events themselves

### `judgmentRules`, `guardrails`
- **Owner:** Thyra
- Readable by: all
- Proposable by: Thyra / human
- Recorded in Edda: yes, because these are institutional changes

### `outcomeSchema`
- **Owner:** Thyra
- Readable by: Edda / Karvi / Völva
- Proposable by: Thyra
- Recorded in Edda: schema version changes

---

## F. Memory / History / Evolution 層

### `memory.localMemoryPolicy`
- **Owner:** Völva
- Readable by: Thyra / Edda
- Proposable by: Völva / Thyra
- Recorded in Edda: policy changes only

### `memory.precedentWriteback`
- **Owner:** Edda interface contract co-owned conceptually, but canonical config should live in **Völva**
- Readable by: all
- Proposable by: Völva / Edda
- Recorded in Edda: yes

### `telemetry.track`
- Split owner:
- **Karvi** owns dispatch telemetry
- **Thyra** owns runtime telemetry
- **Völva** may own authoring/discovery telemetry
- Edda stores historical outcome/decision events
- Important: telemetry source is distributed, but historical interpretation belongs to Edda

### `promotion history`
- **Owner:** Edda
- Readable by: all
- Proposable by: none directly; written from approved events
- Recorded in Edda: canonical

### `supersedes`, `supersededBy`
- **Canonical owner:** Edda
- Völva may mirror current reference
- Readable by: all
- Proposable by: Völva / human / review process
- Recorded in Edda: canonical append-only

### `confirmed gotchas`
- **Canonical history owner:** Edda
- **Current active skill text owner:** Völva
- This one is dual-layer:
- Edda owns the fact/history that gotcha was confirmed
- Völva owns the present packaged wording shown to agents

---

## G. Lifecycle / Status 層

這一塊最容易混，我建議拆開。

### `lifecycle.currentStage`
- **Owner:** Völva
- Values: draft / sandbox / promoted / core / deprecated
- Readable by: all
- Proposable by: human / Völva
- Recorded in Edda: every stage change

### `operational.enabled`
- **Owner:** Karvi or Thyra depending on scope**
- dispatch enable/disable → Karvi
- runtime enable/disable → Thyra
- Readable by: all
- Recorded in Edda: yes

### `riskTier`
不要只有一個總風險，拆三個比較乾淨：

- `semanticRiskTier` → **Völva**
- `dispatchRiskTier` → **Karvi**
- `runtimeRiskTier` → **Thyra**

Edda 記所有變更歷史。

不然一個 `riskTier` 會變成大家都想寫。

---

# 三、最小檔案落點

## Völva repo
放 canonical core

```text
skills/<skill-id>/
skill.object.yaml
SKILL.md
references/
scripts/
assets/
```

裡面主要包含：
- identity
- purpose
- routing
- contract
- package
- local memory policy
- lifecycle.currentStage

---

## Karvi repo
放 dispatch overlay

```text
bindings/skills/<skill-id>.dispatch.yaml
```

裡面主要包含：
- dispatch.mode
- repoBindings
- runtimeOptions
- workerClass
- retry / timeout / escalation
- merge / approval boundary
- dispatch telemetry config

---

## Thyra repo
放 runtime overlay

```text
bindings/skills/<skill-id>.runtime.yaml
```

裡面主要包含：
- environment
- permissions
- executionMode
- runtimeBindings
- verification
- guardrails
- judgment rules
- outcome schema
- runtime telemetry config

---

## Edda
不放「可編輯主檔」，只放 append-only 事件與派生索引

例如：
- `skill.created`
- `skill.patched`
- `skill.gotcha.confirmed`
- `skill.promoted`
- `skill.dispatch.executed`
- `skill.run.succeeded`
- `skill.run.failed`
- `skill.rollback`
- `skill.superseded`

---

# 四、最重要的三條規則

## 規則 1
**Völva 不決定 dispatch truth。**
它可以說「這 skill 大概適合什麼」，但不能決定：
- 丟哪個 repo
- 哪個 worker 接
- retry 幾次

那是 Karvi 的。

---

## 規則 2
**Völva 也不決定 runtime truth。**
它可以說這 skill 希望怎麼運作，
但：
- 可不可以有 side effect
- 哪些 guardrails 必須存在
- verification 怎麼做
- outcome 怎麼定義

那是 Thyra 的。

---

## 規則 3
**Edda 不回頭當配置主檔。**
它要做的是：
- 記住
- 追溯
- 比較
- supersede
- 提供 precedent

不是直接變成現在配置的真相源。

---

# 五、如果你想最省事地先做 v0

我會建議這樣落：

### 先做 1 個主檔 + 2 個 overlay + 事件寫入
- `skill.object.yaml` → Völva
- `skill.dispatch.yaml` → Karvi
- `skill.runtime.yaml` → Thyra
- Edda 記事件

這樣夠清楚，但不會一開始就過度分散。

---

# 六、最後壓成一句

> **skill 是 federated object：Völva 定義其意義，Karvi 定義其派工，Thyra 定義其運行，Edda 定義其歷史。**

如果你要，我下一步我可以直接幫你把這個整理成一份正式文件口吻的：

## `skill-object-ownership-map-v0.md`

或者更進一步，直接做一個：

## `arch-spec` 的實例化四分檔樣板

我覺得後者更有用，因為一做實例就會立刻暴露哪裡還是假清楚。