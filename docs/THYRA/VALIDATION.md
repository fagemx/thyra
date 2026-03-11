# Thyra — Validation Plan

## Phase 0 驗收（MVP）

### 自動化

```bash
npx tsc --noEmit
bun test

bun run dev &
sleep 2

# Village
VID=$(curl -s -X POST http://localhost:3462/api/villages \
  -H "Content-Type: application/json" \
  -d '{"name":"test-saas","target_repo":"fagemx/test"}' | jq -r '.data.id')

# Constitution
COID=$(curl -s -X POST http://localhost:3462/api/villages/$VID/constitutions \
  -H "Content-Type: application/json" \
  -d '{"rules":[{"description":"must review","enforcement":"hard","scope":["*"]}],"allowed_permissions":["dispatch_task","propose_law","enact_law_low"],"budget_limits":{"max_cost_per_action":10,"max_cost_per_day":100,"max_cost_per_loop":50}}' | jq -r '.data.id')

# Skill
SID=$(curl -s -X POST http://localhost:3462/api/skills \
  -H "Content-Type: application/json" \
  -d '{"name":"code-review","definition":{"description":"Review code","prompt_template":"Review: {changes}","tools_required":["gh"],"constraints":["cite file:line"]}}' | jq -r '.data.id')
curl -s -X POST http://localhost:3462/api/skills/$SID/verify

# Chief
CID=$(curl -s -X POST http://localhost:3462/api/villages/$VID/chiefs \
  -H "Content-Type: application/json" \
  -d '{"name":"Reviewer","role":"code reviewer","skills":[{"skill_id":"'$SID'","skill_version":1}],"permissions":["dispatch_task","propose_law"]}' | jq -r '.data.id')

# Law
curl -s -X POST http://localhost:3462/api/villages/$VID/laws/propose \
  -H "Content-Type: application/json" \
  -d '{"chief_id":"'$CID'","category":"review","content":{"description":"2 approvals","strategy":{"min":2}},"evidence":{"source":"init","reasoning":"best practice"}}'

# Loop
LID=$(curl -s -X POST http://localhost:3462/api/villages/$VID/loops/start \
  -d '{"chief_id":"'$CID'","trigger":"manual"}' \
  -H "Content-Type: application/json" | jq -r '.data.id')
curl -s -X POST http://localhost:3462/api/loops/$LID/stop | jq '.data.status'  # aborted
```

### 手動

| # | 場景 | 預期 |
|---|------|------|
| 1 | PATCH constitution | 404/405 |
| 2 | Chief permissions 超出 | 400 |
| 3 | Bind draft skill | 400 |
| 4 | Law 違反 hard rule | rejected |
| 5 | Low risk law | auto-approved |
| 6 | Loop 超預算 | 自動停止 |
| 7 | Loop 人類中斷 | aborted |
| 8 | delete_constitution | blocked |

---

## Phase 1 驗收

### Karvi Bridge
```bash
curl -s http://localhost:3462/api/bridges/karvi/status | jq '.data.healthy'
```

### Edda Bridge（降級）
```bash
EDDA_URL=http://localhost:99999 curl -s http://localhost:3462/api/bridges/edda/query \
  -X POST -d '{"domain":"test","topic":"review"}' | jq '.data'  # []
```

### Dashboard
- 村莊卡牌、Chief 能力地圖、審批佇列、迴圈時間線

---

## End-to-End

```
建村莊 → 定憲法 → 建 Skill → 派 Chief → Chief 提 Law
→ Low risk 自動生效 → 啟動迴圈 → 觀察 → 決策
→ 派任務到 Karvi → Karvi 回報 → 評估 Law 效果
→ 記錄到 Edda
```

12 步跑通 = Thyra MVP 完成。
