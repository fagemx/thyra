# E3: Commerce / Slot Checkout

> **Layer**: L2
> **Dependencies**: E1（scaffold）, B2（market routes — orders, slots）
> **Blocks**: 無
> **Output**: `tonight/src/pages/Checkout.tsx`

---

## 實作

### 最小 checkout flow

1. 使用者瀏覽 stalls / event slots
2. 點「Book slot」或「Purchase」
3. 呼叫 POST /api/market/:vid/slots/:id/book 或 POST /api/market/:vid/orders
4. 顯示確認結果

### MVP 不需要真金流

第一版用模擬交易：
- 不接 Stripe / Shopify
- 只記錄 order 到 DB
- 顯示 order confirmation

### 元件

- `SlotBooking.tsx` — 選 slot → book
- `OrderConfirmation.tsx` — 顯示結果
- `OrderHistory.tsx` — 我的訂單

Issue: #205（重新定義，不再是 change panel）

---

## 驗收
```bash
cd tonight && npm run dev    # slot booking flow 可走通
cd tonight && npm run build
```
