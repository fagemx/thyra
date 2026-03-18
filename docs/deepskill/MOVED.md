# Deep Skill Architecture — 已遷移

> 這批文件已遷移至 **`C:\ai_agent\volva\docs\deepskill\`**。
>
> 原因：這些 spec 定義的是 skill layer 的設計 — 包括 skill object schema、container routing、
> skill lifecycle、four-plane ownership、Völva interaction model。
> 主體歸 Völva（source of meaning / crystallizer），不是 Thyra（live-world governance）。

## 遷移清單

以下文件現在位於 `C:\ai_agent\volva\docs\deepskill\`：

- `skill-object-v0.md` — governable skill object schema
- `container-routing-v0.md` — 6 containers, 4-axis routing protocol
- `skill-lifecycle-v0.md` — 8 stages (capture → govern)
- `four-plane-ownership-v0.md` — field ownership map (Völva/Karvi/Thyra/Edda)
- `volva-interaction-model-v0.md` — 3 planes, 4 postures, steward model
- `raw/` — original GPT discussion transcripts

## Thyra 在 deepskill 的角色

Thyra 不持有 skill definition 本體。
Thyra 持有的是 skill 進入 runtime 後的 **overlay**：

- `environment` — permissions, execution mode, side effects
- `verification` — smoke checks, assertions, human checkpoints
- `guardrails` — what the skill cannot do in this world
- `judgment rules` — runtime constraints

這些定義在 `four-plane-ownership-v0.md` §E（Völva repo）。
Thyra 側的實際 overlay 文件會放在 `thyra/bindings/skills/<skill-id>.runtime.yaml`（尚未建立）。
