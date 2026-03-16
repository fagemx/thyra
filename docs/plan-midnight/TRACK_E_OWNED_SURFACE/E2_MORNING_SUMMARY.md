# E2: Morning Summary Page

> **Layer**: L2
> **Dependencies**: E1（scaffold）, D3（summary generator）
> **Blocks**: 無
> **Output**: `tonight/src/pages/Summary.tsx`

顯示「昨晚發生了什麼」：
- 跑了幾輪
- 多少提案 applied / rejected
- key events（spotlight 換人、限流、rollback）
- market delta（攤位增減、收入、投訴）

Issue: #204（重新定義，不再是 pulse view）

---

## 驗收
```bash
cd tonight && npm run dev    # 看到 summary page
cd tonight && npm run build
```
