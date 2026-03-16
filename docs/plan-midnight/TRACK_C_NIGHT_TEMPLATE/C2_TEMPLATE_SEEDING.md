# C2: Template Seeding + Validation

> **Layer**: L1
> **Dependencies**: C1, A2, B1
> **Blocks**: D1
> **Output**: Integration test 驗證完整 seeding

pack/apply → village + constitution + chiefs + skills + zones + stalls 全部建立。
Issue: #197

## 驗收
```bash
bun test  # seeding test: WorldState + MarketState both complete
```
