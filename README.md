# Sindica

Sindica is a deterministic workflow router for AI-agent issue pipelines.

It does not decide with an LLM. It reads issue state, evaluates typed rules, produces a plan, detects conflicts, and optionally applies actions through a provider adapter.

```bash
sindica plan examples/basic.sindica.ts --provider mock --fixture examples/issues.json
sindica run examples/basic.sindica.ts --provider mock --fixture examples/issues.json
sindica deploy examples/basic.sindica.ts --provider multica
```

## Commands

- `plan`: load the TypeScript config, validate provider setup, fetch issues, evaluate rules, and print the actions without changing anything.
- `run`: do the same validation as `plan`, then apply the planned actions.
- `deploy`: create or update the provider-side router/autopilot infrastructure.
- `doctor`: check provider connectivity and config loading.

## Config

Rules live in TypeScript so they can be tested directly.

```ts
import { addLabel, assignAgent, comment, definePipeline } from "sindica";

export default definePipeline({
  name: "example",
  router: {
    name: "Example Pipeline Router",
    schedule: "* * * * *",
    timezone: "UTC",
  },
  conflictPolicy: "fail",
  rules: [
    {
      id: "triage",
      priority: 10,
      match: issue => issue.open && issue.status === "TODO",
      actions: [
        addLabel("phase:triage"),
        assignAgent("Refiner"),
        comment("sindica/triage: moved into triage."),
      ],
    },
  ],
});
```
