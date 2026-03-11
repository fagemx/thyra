# T2_02: Constitution Store Core

> **Layer**: L1
> **Dependencies**: T2_01
> **Blocks**: T2_03, T2_04
> **Output**: `src/constitution-store.ts` — ConstitutionStore class

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-01 不可變
cat docs/THYRA/T2_CONSTITUTION_STORE.md # 完整 class 定義
cat src/schemas/constitution.ts        # 確認 T2_01 完成
bun run build
```

---

## 關鍵行為

- `create(villageId, input, actor)` — 建立首個 constitution，如已有 active → throw
- `get(id)` / `getActive(villageId)` / `list(villageId)`
- `revoke(id, actor)` — status → revoked
- `supersede(id, newInput, actor)` — 舊版 superseded + 新版 active，**用 transaction**
- **沒有 `update()` 方法**（THY-01）

完整程式碼見 `T2_CONSTITUTION_STORE.md` Step 3。

---

## 驗收

```bash
bun run build
bun -e "
  import{createDb,initSchema}from'./src/db';
  import{ConstitutionStore}from'./src/constitution-store';
  import{VillageManager}from'./src/village-manager';
  const db=createDb(':memory:');initSchema(db);
  const v=new VillageManager(db).create({name:'t',target_repo:'r'},'u');
  const s=new ConstitutionStore(db);
  const c=s.create(v.id,{rules:[{description:'r',enforcement:'hard'}],allowed_permissions:['dispatch_task']},'human');
  console.log(c.id, c.version, c.status);  // const-xxx 1 active
  const c2=s.supersede(c.id,{rules:[{description:'r2',enforcement:'soft'}],allowed_permissions:['dispatch_task','deploy']},'human');
  console.log(c2.version, s.get(c.id).status);  // 2 superseded
"
```
