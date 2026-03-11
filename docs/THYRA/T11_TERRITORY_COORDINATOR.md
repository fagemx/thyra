# T11: Territory Coordinator

> Phase 2
> 新建：`src/territory.ts`
> 依賴：T1, T6, T7
> 預估：15-20 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test  # 所有 Phase 0 + Phase 1 測試通過
```

---

## 最終結果

- 跨 Village 協調：雙方 Constitution 合規檢查（SI #7）
- Skill 共享：A 村 verified skill → B 村一鍵採用
- Law Template 共享：A 村的好策略 → B 村參考
- Territory 協議管理

---

## 核心設計

### 為什麼需要 Territory？

Phase 0/1 每個 Village 完全獨立。但真實場景：
- Blog 專案的 AI reviewer 想參考 Trading 專案的 review 策略
- 遊戲專案想用 Blog 專案培訓出來的 Chief
- 老闆想對所有專案設定統一預算上限

Territory Coordinator 是跨村莊的「外交官」。

### 安全模型

```
A 想跟 B 合作
  → A constitution 允許 cross_village? ✅
  → B constitution 允許 cross_village? ✅
  → 建立 Territory
```

任一方 constitution 不允許 → 拒絕（SI #7）。

### Skill 共享

```
Village A 的 "code-review" v3 → verify 有效
  → 透過 Territory 共享給 Village B
  → B 的 Chief 可以 bind 這個 skill
```

---

## 模組設計

### Territory

```typescript
interface Territory {
  id: string;
  name: string;
  village_ids: string[];    // 參與的村莊
  agreements: Agreement[];  // 雙邊/多邊協議
  created_at: string;
  status: 'active' | 'dissolved';
}

interface Agreement {
  id: string;
  type: 'resource_sharing' | 'law_template' | 'chief_lending' | 'budget_pool';
  parties: string[];        // village ids
  terms: Record<string, unknown>;
  approved_by: Record<string, string>;  // village_id → human who approved
}
```

### Nation（Territory 的上層，Phase 3+）

```typescript
interface Nation {
  id: string;
  name: string;
  territory_ids: string[];
  governor_chief_id: string;  // 國家級 Chief
  constitution_id: string;    // 國家級 Constitution（優先於村莊級）
}
```

---

## Phase 2 Scope

1. Territory 建立 + 雙方 Constitution 驗證
2. Skill 跨 Village 共享
3. Law Template 共享
4. 跨村莊狀態查詢

Nation（多 Territory 聯盟）是 Phase 3+，先不實作。

---

## 驗收

```bash
bun test src/territory.test.ts

# 安全驗證
# 1. Village A constitution 不允許 cross_village
# 2. 嘗試建 territory 包含 A
# 3. 預期：rejected with CONSTITUTION_FORBIDS_CROSS_VILLAGE
```
