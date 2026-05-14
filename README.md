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
- `deploy`: create or update declared agents, assign their skills, and create or update the provider-side router/autopilot infrastructure.
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
    model: "gpt-5.5",
    thinkingLevel: "medium",
    runtimeProvider: "codex",
    customArgs: [
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      'approval_policy="never"',
    ],
  },
  agents: [
    {
      name: "Refiner",
      description: "Refines fresh issues.",
      instructions: "Execute the refine skill for the issue assigned to you.",
      runtimeProvider: "codex",
      model: "gpt-5.5",
      thinkingLevel: "medium",
      skills: ["refine-issue"],
    },
  ],
  labels: [
    "phase:triage",
    { name: "blocked:human-help", color: "#dc2626" },
  ],
  skills: [
    {
      name: "refine-issue",
      description: "Refines fresh issues.",
      contentPath: ".claude/skills/refine-issue/SKILL.md",
      files: [".claude/commands/refine-issue.md"],
    },
  ],
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

For the Multica provider, `deploy` is an upsert:

- `labels` are created when missing;
- `skills` are created or updated from declared local files before agents are deployed;
- agents are created when missing and updated when names already exist;
- `skills` are resolved by name and assigned to each agent;
- the router agent is created or updated;
- the router autopilot is created or updated in `run_only` mode;
- the schedule trigger is created or updated.

If a declared skill name does not exist in the Multica workspace, deployment fails instead of silently creating an agent with missing capabilities.
