# T8: Dashboard

> Phase 1（可與 T9, T10 並行）
> 新建：`app/` 目錄
> 依賴：T1-T7
> 預估：10-12 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
# 確認所有 Phase 0 API 可用
bun run dev &
curl http://localhost:3462/api/villages | jq '.ok'
```

---

## 最終結果

- 治理面板：Village 概覽 / Chief 能力地圖 / 審批佇列 / 迴圈時間線
- 唯讀 + 審批（THY-10）
- React + Vite + Tailwind
- SSE 或 polling 即時更新
- 非技術用戶友好：零程式碼操作
- 響應式設計（桌面 + 手機）

---

## 設計原則

### 策略遊戲 UI 隱喻

Thyra 的用戶不是工程師，是「策略制定者」。UI 要像**策略遊戲**，不像 IDE。

| 概念 | UI 表現 |
|------|---------|
| Village | 卡牌式面板，顯示名稱 + 狀態 + Chief 數量 + 活躍 Laws |
| Chief | 角色卡牌，有頭像佔位 + personality badges |
| Constitution | 「憲法卷軸」：唯讀展示，版本鏈 |
| Law | 「法典」列表，proposed 的有「審批」按鈕 |
| Loop | 時間線視圖，每個 action 是一個節點 |
| Risk | 紅綠燈：🟢 low / 🟡 medium / 🔴 high |

### 唯讀 + 審批

Dashboard **不直接修改內部狀態**。它只做兩件事：
1. **展示**：所有資料透過 API 讀取
2. **審批動作**：approve/reject law、start/stop loop

---

## 技術選型

| 層 | 選型 |
|----|------|
| Framework | React 19 + Vite |
| Styling | Tailwind CSS |
| 狀態管理 | Zustand |
| 即時更新 | SSE（EventSource）或 30s polling |
| 圖表 | 無外部圖表庫（CSS grid + progress bar 夠用） |
| 路由 | React Router v7 |

---

## 頁面結構

```
/                           # Village 概覽（卡牌式）
/villages/:id               # 村莊詳情
  /constitution              # 憲法版本鏈
  /chiefs                    # Chief 列表 + 能力地圖
  /skills                    # Skill Registry 瀏覽
  /laws                      # 法典 + proposed 審批
  /loops                     # 迴圈歷史 + 進行中
/approval-queue              # 跨村莊審批佇列
/audit-log                   # 全域審計搜尋
```

---

## 關鍵畫面

### 1. Village Overview（首頁）

```
┌──────────────────────────────────────────┐
│  🏘️ My Villages                          │
│                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Blog    │ │ Trading │ │ Game    │   │
│  │ 🟢 Active│ │ 🟢 Active│ │ 🟡 Paused│   │
│  │ 2 Chiefs│ │ 1 Chief │ │ 3 Chiefs│   │
│  │ 5 Laws  │ │ 12 Laws │ │ 0 Laws  │   │
│  │ Loop 🔄 │ │ Loop 🔄 │ │ Loop ⏸ │   │
│  └─────────┘ └─────────┘ └─────────┘   │
│                                          │
│  ⚠️ 2 Laws awaiting approval             │
└──────────────────────────────────────────┘
```

### 2. Chief 能力地圖

展示所有 Chiefs 的 skill binding 關係圖，一眼看出團隊能力分布和缺口。

### 3. Approval Queue

```
┌──────────────────────────────────────────┐
│  📋 Approval Queue (2 pending)           │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🟡 MEDIUM RISK                     │  │
│  │ "Reduce PR review from 2 to 1"    │  │
│  │ Village: Blog  Chief: Reviewer     │  │
│  │ Reason: 過去 7 天 PR 品質穩定      │  │
│  │ Edda 判例: 3 similar decisions     │  │
│  │                                    │  │
│  │ [✅ Approve]  [❌ Reject]           │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

按 risk level 排序（high → medium），顯示 evidence + Edda 判例參考。

### 4. Loop Timeline

```
┌──────────────────────────────────────────┐
│  🔄 Loop Cycle #12 — Running (2m 15s)   │
│  Budget: $3.20 / $50.00                  │
│  ─────────────────────────────────────── │
│                                          │
│  ⏱ 10:00:00  OBSERVE                     │
│  │  Collected 3 signals from Karvi       │
│  │                                       │
│  ⏱ 10:00:05  DECIDE                      │
│  │  Chief "Reviewer" recommends:         │
│  │  → propose law: reduce review count   │
│  │                                       │
│  ⏱ 10:00:06  ACT                         │
│  │  🟡 Risk: medium → queued for approval│
│  │                                       │
│  ✅ 10:00:07  COMPLETED (no observations) │
│                                          │
│  [⏹ Stop Loop]                           │
└──────────────────────────────────────────┘
```

每個 action 一個節點，顏色 = risk level，圖標 = outcome（success/blocked/pending）。

---

## 關鍵互動

| 動作 | API |
|------|-----|
| Approve/Reject Law | `POST /api/laws/:id/approve\|reject` |
| Start/Stop Loop | `POST /api/villages/:vid/loops/start\|stop` |
| Verify Skill | `POST /api/skills/:id/verify` |
| 其他 | 全部唯讀 |

---

## 實作步驟

### Step 1: 初始化 React 專案

```bash
cd app/
bun create vite . --template react-ts
bun add zustand react-router-dom
bun add -d tailwindcss @tailwindcss/vite
```

### Step 2: API Client Layer

`app/src/api/client.ts` — 統一的 API 呼叫層：
- 自動 handle `{ ok, data, error }` 格式
- SSE 連線管理

### Step 3: 各頁面實作

按上述 4 個關鍵畫面依序實作。先 static mockup，再接 API。

### Step 4: 審批功能

只有有限的 write 動作：
- `POST /api/laws/:id/approve`
- `POST /api/laws/:id/reject`
- `POST /api/villages/:vid/loops/start`
- `POST /api/loops/:id/stop`
- `POST /api/skills/:id/verify`

其他全部唯讀。

---

## 驗收條件

- 村莊列表正確顯示
- 點進村莊可看 constitution / chiefs / skills / laws / loops
- Chief 能力地圖正確顯示 skill binding 關係
- Approval queue 可操作 approve / reject
- Loop 可 start / stop
- 手機端可用
