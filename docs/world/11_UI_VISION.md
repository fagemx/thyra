# UI Vision — 怎麼表演運行中狀態

> 狀態：`early exploration`
> 目的：記錄 UI 視覺方向的思考，不是最終決定。

---

## 1. 核心問題

> **怎麼讓人「看到」世界在運行？**

不是看 JSON。不是看 log。不是看無聊的卡片。
是一眼就知道：這個世界是活的，chiefs 在做事，有事情正在發生。

---

## 2. 三種 UI 形式

### 形式 A：傳統 Web Dashboard

```
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Health  │ │ Chiefs  │ │ Budget  │
│ 72.3    │ │ 5 active│ │ $385    │
└─────────┘ └─────────┘ └─────────┘

Timeline:
  14:45  Safety Chief 限流 Zone B
  14:30  Economy Chief 降價 -10%
```

**優點**：最快做出來、資訊密度高、工程師友善
**缺點**：沒有「活著」的感覺、像在看後台、不性感

### 形式 B：場景式 Dashboard（Star-Office-UI 啟發）

```
┌────────────────────────────────────┐
│  🏮 Midnight Market — Live View    │
│                                    │
│  ┌──主街──────────────────────┐   │
│  │ 🟢🟢🟢🟡⬛⬛              │   │
│  └────────────────────────────┘   │
│                                    │
│  🤵 Economy Chief 在主街巡視       │
│  👮 Safety Chief 在側巷觀察        │
│  🎩 Event Chief 在舞台旁          │
│                                    │
│  ── 72.3 ──                        │
└────────────────────────────────────┘
```

**優點**：一看就懂、有「活著」的感覺、chiefs 像角色在動
**缺點**：開發成本高、資訊密度低、需要 game engine（Phaser/PixiJS）

### 形式 C：混合式

```
┌─────────────────────┬──────────────┐
│                     │ Chief Status │
│  場景式 Live View   │ Economy 🟢  │
│  （夜市鳥瞰圖）     │ Safety  🔵  │
│                     │ Event   🟡  │
│                     │              │
│                     │ Quick Stats  │
│                     │ Budget: 77%  │
│                     │ Proposals: 3 │
├─────────────────────┤              │
│  Timeline           │ Alerts       │
│  14:45 限流         │ ⚠️ Zone B熱 │
│  14:30 降價         │              │
└─────────────────────┴──────────────┘
```

**優點**：兼顧「活著的感覺」+ 資訊密度
**缺點**：最複雜

---

## 3. Star-Office-UI 的啟發

參考：`C:\ai_agent\Star-Office-UI`

### 核心洞察

用 **Phaser**（2D 遊戲引擎）做 dashboard。Agent 狀態不用文字表達，用角色位置和動作表達：

| Agent 狀態 | 傳統 dashboard | Star-Office |
|-----------|---------------|-------------|
| idle | `● idle` | 角色躺在沙發上 |
| running | `● running` | 角色坐在桌前打字 |
| error | `● error` | 角色在 bug 區焦慮踱步 |
| syncing | `● syncing` | 角色旁邊出現同步動畫 |

### 讓場景「活著」的技巧

1. **環境動畫**：咖啡機在轉、伺服器燈在閃、植物在搖 — 即使沒有 agent 動作，場景也在「呼吸」
2. **角色移動**：狀態改變 → 角色走到對應區域 → 有路徑動畫，不是瞬移
3. **對話氣泡**：角色會冒出 contextual 文字（「穩住，我們能贏」）— 增加個性
4. **Auto-idle**：25 秒沒更新 → 角色自動回沙發 — 防止 UI 看起來壞掉
5. **多 agent 共存**：不同 agent 用不同顏色，在同一場景各自活動

### 對 Midnight Market 的映射

| Star-Office | Midnight Market |
|-------------|----------------|
| 辦公室場景 | 夜市鳥瞰圖 |
| 辦公桌 = working | 主街 = 營業中 |
| 沙發 = idle | 休息區 = 待命 |
| Bug 區 = error | 警戒區 = 異常 |
| Agent 角色 | Chief 角色 |
| 咖啡機動畫 | 攤位燈光動畫 |

---

## 4. 設計原則

### 原則 1：API-first

不管最後 UI 是什麼形式，backend API 一樣。

```
所有 UI 形式都需要的 API：
  GET /api/villages/:id/world/state      — 世界狀態
  GET /api/villages/:id/world/pulse      — SSE 即時推送
  GET /api/chiefs/status                  — 每個 chief 在做什麼
  GET /api/villages/:id/activity          — 最近事件
  GET /api/villages/:id/alerts            — 告警
  GET /api/market/:id/state              — 攤位/區域狀態
```

Phase 1 做好 API，Phase 2 換任何 UI 都不需要改後端。

### 原則 2：先功能後美學

Phase 1 用傳統 dashboard 驗證功能完整性。Phase 2 再考慮場景式。

```
Phase 1: 傳統 web dashboard（驗證數據流通）
Phase 2: 場景式 view（加上「活著」的感覺）
Phase 3: 多種 view 讓用戶選（dashboard / scene / mobile）
```

### 原則 3：「活著」不靠花俏

回到之前的結論：

> 活的東西就是：**它在動。**

一個數字在跳、一條線在呼吸、一個角色在走。不需要 3D、不需要 VR。

最小的「活著」= **SSE pulse + CSS transition + 一個數字**。
最豐富的「活著」= **Phaser 場景 + 角色動畫 + 環境動畫**。

兩者之間有很多中間地帶。

### 原則 4：營運者 ≠ 觀眾

```
觀眾（tonight page）：看到的是「夜市」— 攤位、活動、商品
營運者（operator）：  看到的是「引擎」— chiefs、proposals、budget、alerts

兩者用同樣的數據，但視角完全不同。
```

---

## 5. 技術決定：Rive

經過評估，選定 **Rive** (rive.app) 做場景動畫引擎。

### 為什麼不選其他方案

| 方案 | 問題 |
|------|------|
| Phaser（遊戲引擎） | 太重（3.8MB runtime），打開 dashboard 要載遊戲 |
| SVG + CSS animation | 太手動，設計改了工程師要跟著改 code |
| PixiJS | 比 Phaser 輕但還是要寫動畫 code |
| 純 React + CSS | 不醜很難，天花板低 |

### 為什麼選 Rive

- **Runtime 60KB**（Phaser 的 1/60）
- **設計和工程完全分離**：設計師在 Rive Editor 做 → 導出 .riv → 工程師餵數據
- **State Machine 內建**：數據輸入 → 動畫自動切換 → 不用寫 CSS/JS animation
- **設計師改動畫不用碰 code**：替換 .riv 就上線
- **主題切換**：不同 .riv = 不同世界風格
- **可擴展到 Steam**：Rive 有 Unity / Unreal runtime

### 工作流

```
設計師（Rive Editor）           工程師（React）
  │                               │
  ├── 畫場景 + 動畫               │
  ├── 定義 State Machine inputs   │
  ├── 導出 .riv                   │
  │                               │
  │─── .riv ────────────────────→ │
  │                               ├── 載入 .riv
  │                               ├── SSE → setInput()
  │                               └── 完成
```

### Issues

- #238: Design System
- #239: Rive Scene Engine
- #240: Night Market .riv theme
- #241: Scene-State Bridge (SSE → Rive)

## 6. Phase 路線（更新）

```
Phase 1（引擎驗證）:
  React dashboard — #233 operator dashboard
  功能：pulse + chief status + timeline + intervention + alerts
  技術：React + Vite + SSE
  視覺：basic dark theme（#238 design system）
  目標：功能跑通

Phase 2（上線吸引用戶）:
  Rive 場景式 view — 夜市鳥瞰圖
  功能：chiefs 像角色在場景裡移動、攤位有視覺狀態
  技術：React + Rive (@rive-app/react-canvas, ~60KB)
  視覺：設計師做 .riv 場景
  目標：一眼覺得「這東西活著」

Phase 3:
  多 view 切換
  - Scene view（Rive，直覺）
  - Dashboard view（React，資訊密度）
  - Mobile view（簡化版）

Phase 4:
  多 theme
  - night-market.riv（暖橘夜市）
  - frontier-town.riv（大地色小鎮）
  - freeport.riv（海洋色港口）
  - custom theme upload（用戶自訂）
```

---

## 6. 參考資源

| 項目 | 路徑 | 價值 |
|------|------|------|
| Star-Office-UI | `C:\ai_agent\Star-Office-UI` | Phaser 場景式 dashboard、角色動畫、多 agent |
| MiroFish | `C:\ai_agent\MiroFish` | D3 力導向圖、即時 action feed |
| Paperclip | `C:\ai_agent\paperclip` | 傳統 dashboard、org chart、cost views |
