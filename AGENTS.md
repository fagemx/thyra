# Thyra — Agent Instructions

> 這份文件會自動注入到所有 agent session 的 system prompt。

## 環境資訊

- **OS**: Windows 11, shell 是 bash（Git Bash）
- **Runtime**: Bun（優先）/ Node 22+
- **語言**: TypeScript 5.x (strict mode)
- **專案根目錄**: 由 worktree 決定，可能是 `.claude/worktrees/GH-XXX/`
- **Repo**: github.com/fagemx/thyra

## 絕對禁止的行為

### 1. 永遠不要丟棄自己的工作

```
❌ git reset HEAD~1
❌ git checkout .
❌ git checkout -- <file>
❌ git restore .
❌ git clean -fd
```

如果你已經 commit 了，**絕對不要 undo**。如果 test 失敗，先診斷原因，修 code 再 commit，不要 revert。

### 2. 永遠不要殺 node.exe / bun

```
❌ taskkill //F //IM node.exe
❌ taskkill //F //IM bun.exe
❌ Stop-Process -Name node
❌ killall node
```

如果 port 被佔，找具體 PID 再殺。

### 3. 不要違反架構契約

開工前必讀 `docs/THYRA/CONTRACT.md`。14 條規則 + 7 條 Safety Invariants。
特別注意：
- **THY-12**: Safety Invariants 硬編碼不可覆寫 — 不要試圖讓它們可配置
- **THY-01**: Constitution 不可修改 — 只能 revoke + supersede
- 層級依賴：下層不得 import 上層

### 4. 不要用 `any`

```typescript
// ❌
const data: any = row;
(row as any).field;
// @ts-ignore

// ✅
const data = row as Village;
interface Row { field: string }
```

## Windows Bash 指令慣例

在 Git Bash 下，Windows 指令的 `/` flag 要用 `//`：

```bash
# 正確
taskkill //F //PID 12345
netstat //ano | grep :3461

# 錯誤 — bash 會把 /F 當成路徑
taskkill /F /PID 12345
```

## 測試指引

### `bun test`

```bash
bun test                                    # 全部測試
bun test src/constitution-store.test.ts     # 單檔
bun test --reporter=verbose                 # 詳細
```

如果遇到 port 衝突：
```bash
netstat //ano | grep ":<port>"
taskkill //F //PID <specific-pid>
bun test
```

### 編譯檢查

修改任何 `.ts` 檔後：
```bash
bun run build
```

## Git 工作流程

- 你在 worktree 的獨立分支上工作（`agent/GH-XXX`）
- commit 格式：`feat(scope): description (GH-XXX)`
- commit 後不要 revert — 如果需要修正，做新的 commit
- 做完所有修改後 push：`git push origin agent/GH-XXX`

## 程式碼慣例

- Zod 做 runtime validation，TypeScript 做 compile-time safety
- SQLite 是 single source of truth
- 所有狀態變更寫 audit_log（append-only）
- API response 統一 `{ ok, data?, error? }`
- JSON 欄位用 `JSON.stringify` / `JSON.parse`
- 所有 export 用 named export，不用 default export

## 規劃文件導航

開工前讀對的文件：

```bash
# 必讀 — 架構契約
cat docs/THYRA/CONTRACT.md

# 全景 — 理解整個系統
cat docs/THYRA/00_OVERVIEW.md

# 導航 — 找到你的 Track 和 Step
cat docs/THYRA/TRACKS.md

# 你的 Track 主文件（完整程式碼）
cat docs/THYRA/T<N>_<NAME>.md

# 你的 Step 文件（起始指令 + 驗收條件）
cat docs/THYRA/T<N>_<NAME>/T<N>_<NN>_<STEP>.md
```

## 思考方法（所有任務通用）

每個任務都用五階段流程處理。不要跳步驟。

1. **Understand** — 讀 CONTRACT.md、讀 Track 文件、讀相關已有 code。
2. **Frame** — 明確說出：這是哪個 Track 的哪個 Step？要改哪些檔案？依賴哪些已有模組？
3. **Analyze** — 在你的框架內做實際實作。每個結論都指向具體證據（檔案路徑 + 行號）。
4. **Challenge** — 有沒有違反 CONTRACT？層級依賴對嗎？Safety Invariant 有被保護嗎？
5. **Conclude** — 你有信心的結論是什麼？什麼仍不確定？

### 證據紀律

- 每個判斷都指向具體證據：`src/law-engine.ts:156` 而非「某處有個問題」
- 區分：「我知道這個因為 [code 證據]」vs「我猜測這個因為 [模式]」
- 如果無法指向證據，標記為不確定或推測

## 任務執行方法論

### Plan Step

1. **Understand**: 讀 Step 文件的「給 Agent 的起始指令」，執行裡面的 `cat` 和 `bun run build`。
2. **Frame**: 從 Step 文件提取所有需求，列成編號清單。
3. **Analyze**: 研究依賴模組的程式碼，理解 import 和型別。
4. **Challenge**: 回頭對照 CONTRACT.md — 有沒有違反任何 THY-XX 規則？
5. **Conclude**: 輸出具體的實作計畫。

### Implement Step

1. **Understand**: 讀 plan 產出 + Track 主文件的完整程式碼。
2. **Frame**: 列出要建/改的檔案清單。確認層級依賴。
3. **Analyze**: 逐步實作。每改完一個檔案跑 `bun run build`。
4. **Challenge**: 對照 Step 文件的驗收條件 — 每一項都做到了嗎？
5. **Conclude**: commit 並 push，建 PR。

### Review Step

1. **Understand**: 讀 PR diff。
2. **Frame**: 這個 PR 對應哪個 Track/Step？
3. **Analyze**: 四點檢查 — Scope / Reality / CONTRACT compliance / Testing
4. **Challenge**: Safety Invariants 被保護了嗎？層級依賴沒違反？
5. **Conclude**: LGTM 或 Changes Requested，每個問題附 `file:line`。

## Step Pipeline

完成時必須輸出：
```
STEP_RESULT:{"status":"succeeded","summary":"what you did"}
```

失敗時：
```
STEP_RESULT:{"status":"failed","error":"what went wrong","failure_mode":"TEST_FAILURE","retryable":true}
```

**不要在中途輸出 STEP_RESULT** — 只在最後一行輸出。
