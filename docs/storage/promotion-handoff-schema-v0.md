# promotion-handoff-schema-v0.md

> 狀態：`working draft`
>
> 目的：定義 decision engineering 裡的 **promotion package**。
>
> 也就是說，當某塊 working state 或 spec stack 穩到要升格時，
> 它不應該只靠一句「看起來差不多可以了」，
> 而應該交出一個固定形狀的 handoff object。
>
> 這份文件回答的是：
>
> > **從 Völva / arch-spec 升到 project-plan，或升到 Thyra runtime 之前，應該交出什麼資料包？**

---

## 1. 一句話

> **Promotion handoff 是把“可討論的狀態”升格成“可接手的狀態”。**
>
> 它的目的不是複製全部上下文，而是把下一層真正需要的、且已經足夠穩定的部分，打包成有邊界的輸入物件。

---

## 2. 兩種 promotion

v0 先只處理兩種：

### A. `arch-spec -> project-plan`
把已穩定的設計定義交給 planning/decomposition。

### B. `arch-spec -> thyra-runtime`
把已選定的 world form / canonical slice / runtime contract 交給 Thyra 實作或 live instantiation。

---

## 3. Promotion handoff 的共同原則

### 原則 1：handoff 不是整包 spec dump
下一層不需要每一輪討論細節，只需要：
- 目前已穩定的 truth
- 尚未解決但可容忍的 gaps
- 不可違反的 constraints

### 原則 2：promotion 要帶「為什麼現在可以升」
不是只有內容，還要有 promotion rationale。

### 原則 3：必須保留 source links
handoff object 應能回指：
- session ids
- spec files
- commit memo
- promotion check

### 原則 4：未決問題要顯式列出
不要假裝完全成熟。把 open gaps 一併交給下一層。

---

## 4. Core schema

```ts
type PromotionHandoff = {
  id: string;                       // handoff_...
  fromLayer: "volva-working" | "arch-spec";
  toLayer: "project-plan" | "thyra-runtime";

  targetId: string;                // e.g. target planning pack slug / world slug
  title: string;
  summary: string;

  promotionVerdict: "ready" | "partial";
  whyNow: string[];
  blockersResolved: string[];
  knownGaps: string[];

  stableObjects: StableObjectRef[];
  constraints: string[];
  sourceLinks: SourceLink[];

  handoffPayload: ProjectPlanPayload | ThyraRuntimePayload;

  createdAt: string;
};
```

```ts
type StableObjectRef = {
  kind:
    | "decision-session"
    | "card"
    | "spec-file"
    | "shared-types"
    | "commit-memo"
    | "promotion-check"
    | "canonical-slice";
  id: string;
  path?: string;
  note?: string;
};
```

```ts
type SourceLink = {
  kind: "session" | "spec" | "event" | "precedent";
  ref: string;
  whyRelevant?: string;
};
```

---

## 5. `arch-spec -> project-plan` payload

這條 promotion 的目的是：
> **概念已穩到可以拆工。**

### Schema

```ts
type ProjectPlanPayload = {
  projectName: string;

  coreQuestion: string;
  canonicalFormSummary: string;
  firstClassNouns: string[];
  stableNames: string[];

  invariantRules: string[];
  moduleBoundaries: string[];
  sharedTypesPath?: string;

  requiredSpecs: Array<{
    path: string;
    role: "overview" | "canonical-form" | "schema" | "rules" | "api" | "slice" | "demo-path" | "handoff";
  }>;

  canonicalSliceSummary?: string;
  demoPathSummary?: string;

  planningHints: {
    likelyTracks: string[];
    obviousDependencies: string[];
    suggestedValidationTargets: string[];
  };
};
```

### 最小必要欄位
- projectName
- coreQuestion
- canonicalFormSummary
- firstClassNouns
- invariantRules
- requiredSpecs

### 為什麼需要這些
因為 `project-plan` 真正需要的不是完整討論史，
而是：
- 這東西到底是什麼
- 哪些詞不能再改
- 哪些邊界不能被拆工時破壞
- 哪些文件是 planning 時必讀

---

## 6. `arch-spec -> thyra-runtime` payload

這條 promotion 的目的是：
> **某個 world form / runtime contract 已穩到可 instantiate。**

### Schema

```ts
type ThyraRuntimePayload = {
  worldSlug: string;
  worldForm: string;               // market / night_engine / commons ...

  canonicalCyclePath: string;
  sharedTypesPath?: string;
  runtimeApiPath?: string;
  judgmentRulesPath?: string;
  metricsPath?: string;

  minimumWorld: {
    summary: string;
    keyStateObjects: string[];
    keyChangeKinds: string[];
    keyMetrics: string[];
    keyRoles: string[];
  };

  closureTarget: {
    story: string;
    mustDemonstrate: string[];
  };

  runtimeConstraints: {
    mustNotViolate: string[];
    requiresHumanApproval?: string[];
    rollbackExpectations?: string[];
  };
};
```

### 最小必要欄位
- worldSlug
- worldForm
- canonicalCyclePath
- minimumWorld
- closureTarget
- runtimeConstraints

### 為什麼需要這些
因為 Thyra 不應自己重想：
- 這是什麼世界
- 最小世界長什麼樣
- 核心 cycle 是什麼
- 什麼 change 重要
- 什麼不能破壞

這些都應在 promotion 前確定。

---

## 7. Promotion checklist output

handoff 應該搭配一份 promotion check 結果。

```ts
type PromotionChecklist = {
  id: string;
  targetLayer: "project-plan" | "thyra-runtime";
  results: Array<{
    item: string;
    passed: boolean;
    note?: string;
  }>;
  verdict: "ready" | "partial" | "not_ready";
};
```

### project-plan 常見 checklist items
- 核心名詞穩定
- canonical form 存在
- shared types 清楚
- canonical slice 存在
- demo path 可跑
- module boundary 清楚

### thyra-runtime 常見 checklist items
- world form 已選定
- minimum world 有 shape
- closure target 清楚
- change/judgment/pulse/outcome 至少有初版定義
- runtime constraints 明確

---

## 8. Handoff package 結構

### 建議落地形式
一個 promotion handoff 最終應該對應到：

```text
promotion-package/
  handoff.json
  checklist.json
  links.md
```

### `handoff.json`
機器可讀

### `checklist.json`
明確可驗條件

### `links.md`
給人快速跳讀：
- 必讀 spec
- open gaps
- 不要重問的問題

---

## 9. Open gaps 的寫法

這裡非常重要。

### 錯的寫法
- 還有些東西之後再說
- 細節未定

### 對的寫法
- `pricing rule schema still provisional`
- `secondary regime evaluator not yet implemented`
- `runtime metrics thresholds not calibrated`

也就是：
> **gap 要具體到下一層能決定「接受這個不確定性」還是「先不要接」。**

---

## 10. 與 `storage-topology-v0.md` 的關係

- `storage-topology-v0.md` 定整體儲存拓樸
- 這份定跨層 promotion 時的資料包格式

也就是這份是「跨層升格接口」。

---

## 11. v0 不做什麼

- 不做自動雙向同步
- 不假設 promotion 後 source layer 消失
- 不把 handoff 當完整 context dump
- 不做 multi-target promotion（一次同時升兩層）

---

## 12. 最後一句

> **Promotion handoff 不是“把文件丟給下一層”。**
>
> **它是把已穩定、已被授權的設計狀態，打包成下一層可接手、可施工、可實例化的輸入物件。**
>
> 沒有這個接口，promotion 就只是感覺；有了它，promotion 才會變成工程動作。
