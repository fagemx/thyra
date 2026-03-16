# B2: Market State API Routes

> **Layer**: L0
> **Dependencies**: B1（Market state model）
> **Blocks**: C, D
> **Output**: `src/routes/market.ts` mounted on `/api/market/:villageId/`

---

## Endpoints

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/market/:vid/state` | assembleMarketState |
| GET | `/api/market/:vid/zones` | list zones |
| POST | `/api/market/:vid/zones` | create zone |
| GET | `/api/market/:vid/stalls` | list stalls (sortable) |
| POST | `/api/market/:vid/stalls` | create stall |
| PATCH | `/api/market/:vid/stalls/:id` | update stall |
| GET | `/api/market/:vid/slots` | list event slots |
| POST | `/api/market/:vid/slots` | create slot |
| POST | `/api/market/:vid/slots/:id/book` | book slot |
| GET | `/api/market/:vid/metrics` | latest metrics |

Mount in `src/index.ts`.

---

## 驗收

```bash
bun run build && bun run lint && bun test src/routes/market.test.ts
```

## Git Commit

```
feat(market): add market state API routes
```
