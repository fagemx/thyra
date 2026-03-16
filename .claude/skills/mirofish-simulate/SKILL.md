---
name: mirofish-simulate
description: Social simulation using MiroFish engine for community reaction prediction
tags: simulation, mirofish, sentiment
source_type: system
---

# MiroFish Simulate

You are a simulation analyst. Use MiroFish to predict community reactions to proposed market changes.

## Context Input

Read from pipeline step context:
- `change_description`: What is being changed (e.g., "raise food stall prices by 15%")
- `market_state_summary`: Current market state snapshot
- `config.mirofish_url`: MiroFish base URL (default: http://localhost:5001)
- `config.agent_count`: Number of simulated agents (default: 50)
- `config.platform`: Simulation platform (default: "twitter")
- `config.rounds`: Simulation rounds (default: 5)

## Execution Flow

### 1. Prepare MiroFish Input

Build a market situation document from context:
- Current market state from `market_state_summary`
- Proposed change details from `change_description`
- Relevant recent events if available

Compose a single `situation_document` string summarizing the above.

### 2. Build Knowledge Graph

```
POST {mirofish_url}/api/graph/build
Content-Type: application/json

{
  "documents": [{ "content": "<situation_document>" }]
}
```

Expected response: `{ "status": "ok", "graph_id": "..." }`

If this request fails (connection refused, 5xx, timeout), output:

```
STEP_RESULT:{"status":"failed","error":"MiroFish service unreachable","failure_mode":"SERVICE_UNAVAILABLE","retryable":true}
```

### 3. Start Simulation

```
POST {mirofish_url}/api/simulation/start
Content-Type: application/json

{
  "graph_id": "<from step 2>",
  "num_agents": <agent_count>,
  "platform": "<platform>",
  "rounds": <rounds>,
  "inject_events": [{ "description": "<change_description>" }]
}
```

Expected response: `{ "task_id": "..." }`

### 4. Poll for Completion

```
GET {mirofish_url}/api/task/{task_id}
```

Poll every 10 seconds. Maximum 60 attempts (10 minutes).

- When `status` is `"completed"`: proceed to step 5.
- When `status` is `"failed"`: output:

```
STEP_RESULT:{"status":"failed","error":"MiroFish simulation failed","failure_mode":"SIMULATION_ERROR","retryable":false}
```

- If 60 attempts exhausted without completion: output:

```
STEP_RESULT:{"status":"failed","error":"Simulation timed out after 10 minutes","failure_mode":"TIMEOUT","retryable":true}
```

### 5. Generate Report

```
GET {mirofish_url}/api/report/generate?task_id={task_id}
```

Expected response:
```json
{
  "report": {
    "sentiment": {
      "negative_pct": 70,
      "positive_pct": 20,
      "neutral_pct": 10
    },
    "predicted_churn": 15,
    "themes": ["too expensive", "unfair", "considering leaving"],
    "recommendation": "reduce price increase",
    "full_text": "..."
  }
}
```

If the response cannot be parsed, output:

```
STEP_RESULT:{"status":"failed","error":"Cannot parse MiroFish report","failure_mode":"PARSE_ERROR","retryable":false}
```

### 6. Output STEP_RESULT

Compose the final result from the report:

```
STEP_RESULT:{
  "status": "succeeded",
  "summary": "Simulation complete: <negative_pct>% negative reaction",
  "payload": {
    "negative_pct": <from report>,
    "positive_pct": <from report>,
    "neutral_pct": <from report>,
    "predicted_churn": <from report>,
    "key_themes": <from report>,
    "recommendation": <from report>,
    "simulation_id": "<task_id>",
    "agent_count": <agent_count>,
    "rounds": <rounds>,
    "full_report": "<full_text from report>"
  }
}
```

## Error Handling

| Failure Mode | Cause | Retryable |
|---|---|---|
| SERVICE_UNAVAILABLE | MiroFish not reachable | Yes |
| TIMEOUT | Polling exceeded 10 minutes | Yes |
| SIMULATION_ERROR | MiroFish returned error during simulation | No |
| PARSE_ERROR | Cannot parse MiroFish output | No |

Follow THY-06 graceful degradation: MiroFish being unavailable must not crash the pipeline. Always output a well-formed STEP_RESULT even on failure.
