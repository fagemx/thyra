# C1: Midnight Market YAML + Market Skills

> **Layer**: L1
> **Dependencies**: A2（pack/apply）, B1（market schema）
> **Blocks**: C2, D1
> **Output**: `templates/midnight-market.yaml`

YAML 定義 5 chiefs + 5 skills + constitution + market-specific initial zones/stalls。
跟 v1 B1 類似但需要包含 market domain 初始資料（zones, initial stalls）。
Issue: #196

## 驗收
```bash
bun run build && bun test  # template parse test
```
