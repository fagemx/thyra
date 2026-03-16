# G2: Edda + Karvi Bridge Wiring

> **Layer**: L1
> **Dependencies**: A1（WorldManager）
> **Blocks**: 無
> **Output**: WorldManager 接受 optional EddaBridge + KarviBridge

跟 v1 F1 相同。Issue: #185 + #186。

WorldManager.apply() → fire-and-forget Edda recording。
Karvi dispatch for executable changes。
Bridge down → no crash（BRIDGE-01）。

---

## 驗收
```bash
bun run build && bun run lint && bun test src/world-manager.test.ts
```
