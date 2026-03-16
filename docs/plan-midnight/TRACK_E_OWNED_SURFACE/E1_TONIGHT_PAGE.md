# E1: Tonight Page — Event Page + Stall Map + Live Status

> **Layer**: L2
> **Dependencies**: A3（world routes）, B2（market routes）, G1（SSE pulse）
> **Blocks**: E2, E3
> **Output**: `tonight/` React app — Tonight page

---

## 給 Agent 的起始指令

```bash
cat docs/plan-midnight/CONTRACT.md          # SURFACE-01
cat docs/營運/營運5.md                       # MVP 前台 4 物件
cat src/routes/world.ts                     # world API
cat src/routes/market.ts                    # market API
```

---

## 實作

### 初始化

```bash
npm create vite@latest tonight -- --template react-ts
cd tonight && npm install
```

### Tonight page 內容

**營運5 定義的 4 物件：**

1. **Tonight page** — 今晚主題 + 活動時段
2. **Stall list / zone map** — 攤位地圖 + 排位
3. **Live updates** — 即時變化（SSE pulse + activity feed）
4. **Morning summary** → E2

### 元件

- `StallMap.tsx` — zones + stalls 視覺化（grid 或 list，不用 D3）
- `LiveStatus.tsx` — SSE 連線，breathing pulse number
- `ActivityFeed.tsx` — 最近 events（polling /api/audit）
- `WorldPulse.tsx` — 呼吸數字（reuse from v1 E2）

### Vite proxy

```typescript
server: { proxy: { '/api': 'http://localhost:3462' } }
```

### API Client

```typescript
// tonight/src/api/client.ts
const BASE = '';  // proxied
export const getMarketState = (vid: string) => fetch(`/api/market/${vid}/state`).then(r => r.json());
export const getWorldState = (vid: string) => fetch(`/api/villages/${vid}/world/state`).then(r => r.json());
export const getStalls = (vid: string) => fetch(`/api/market/${vid}/stalls`).then(r => r.json());
export const getSlots = (vid: string) => fetch(`/api/market/${vid}/slots`).then(r => r.json());
```

Issue: #203

---

## 驗收
```bash
cd tonight && npm run dev    # 瀏覽器看到 tonight page
cd tonight && npm run build  # 無錯誤
```
