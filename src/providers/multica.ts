import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLabels } from "../core/labels.js";
import type { Action, ActionPlan, Issue, Pipeline, Provider } from "../core/types.js";

const execFileAsync = promisify(execFile);

interface MulticaProviderOptions {
  workspaceId?: string;
}

interface MulticaIssueLabel {
  id: string;
  name: string;
}

interface MulticaIssue {
  id: string;
  identifier?: string;
  title: string;
  status: string;
  labels?: MulticaIssueLabel[];
  assignee_id?: string | null;
}

interface MulticaIssueListResponse {
  issues: MulticaIssue[];
  has_more?: boolean;
  limit?: number;
  offset?: number;
}

interface MulticaLabel {
  id: string;
  name: string;
}

interface MulticaRuntime {
  id: string;
  provider?: string;
  status?: string;
}

interface MulticaAgent {
  id: string;
  name: string;
}

interface MulticaAutopilotListResponse {
  autopilots: MulticaAutopilot[];
}

interface MulticaAutopilot {
  id: string;
  title: string;
  status: string;
}

interface MulticaAutopilotGetResponse {
  autopilot: MulticaAutopilot;
  triggers?: MulticaTrigger[];
}

interface MulticaTrigger {
  id: string;
  label?: string | null;
  cron_expression?: string | null;
}

export function createMulticaProvider(options: MulticaProviderOptions = {}): Provider {
  const workspaceId = options.workspaceId;

  return {
    name: "multica",
    async listIssues() {
      const issues: Issue[] = [];
      const limit = 100;
      let offset = 0;

      while (true) {
        const response = await multicaJson<MulticaIssueListResponse>(
          workspaceId,
          "issue",
          "list",
          "--limit",
          String(limit),
          "--offset",
          String(offset),
          "--output",
          "json"
        );

        issues.push(...response.issues.map(toIssue));

        if (!response.has_more) {
          break;
        }

        offset += response.limit ?? limit;
      }

      return issues;
    },
    async apply(plan: ActionPlan) {
      const labels = await listLabels(workspaceId);

      for (const item of plan.planned) {
        for (const action of item.actions) {
          await applyAction(workspaceId, labels, item.issue, action);
        }
      }
    },
    async deploy(pipeline: Pipeline) {
      await deployRouter(workspaceId, pipeline);
    },
    async doctor() {
      const { stdout } = await execFileAsync("multica", ["--version"]);
      console.log(stdout.trim());
    },
  };
}

async function deployRouter(workspaceId: string | undefined, pipeline: Pipeline): Promise<void> {
  const agentName = pipeline.router.agentName ?? pipeline.router.name;
  const command = pipeline.router.command ?? "sindica-run run";
  const description = pipeline.router.description ??
    `Runs the Sindica deterministic router for pipeline ${pipeline.name}.`;
  const instructions = pipeline.router.instructions ?? [
    "Execute the configured Sindica router command exactly once:",
    "",
    `  ${command}`,
    "",
    "Report the command result. Do not manually move issues outside Sindica.",
  ].join("\n");
  const model = pipeline.router.model ?? "gpt-5.5";
  const triggerLabel = pipeline.router.triggerLabel ?? "sindica-router";
  const runtimeId = await resolveRuntimeId(workspaceId, pipeline.router.runtimeProvider ?? "claude");
  const agent = await upsertAgent(workspaceId, {
    name: agentName,
    description,
    instructions,
    model,
    runtimeId,
  });
  const autopilot = await upsertAutopilot(workspaceId, {
    title: pipeline.router.name,
    description: [
      "Run the Sindica deterministic issue router.",
      "",
      `Command: ${command}`,
    ].join("\n"),
    agentName,
  });

  await upsertTrigger(workspaceId, autopilot.id, {
    label: triggerLabel,
    cron: pipeline.router.schedule,
    timezone: pipeline.router.timezone,
  });

  console.log(`deployed agent: ${agent.name} (${agent.id})`);
  console.log(`deployed autopilot: ${autopilot.title} (${autopilot.id})`);
  console.log(`deployed trigger: ${triggerLabel} ${pipeline.router.schedule} ${pipeline.router.timezone}`);
}

async function resolveRuntimeId(
  workspaceId: string | undefined,
  preferredProvider: string
): Promise<string> {
  const runtimes = await multicaJson<MulticaRuntime[]>(workspaceId, "runtime", "list", "--output", "json");
  const preferred = runtimes.find(
    (runtime) => runtime.status === "online" && runtime.provider === preferredProvider
  );
  const online = runtimes.find((runtime) => runtime.status === "online");
  const fallback = runtimes[0];
  const runtime = preferred ?? online ?? fallback;

  if (!runtime) {
    throw new Error("No Multica runtime found for router agent deployment.");
  }

  return runtime.id;
}

async function upsertAgent(
  workspaceId: string | undefined,
  input: {
    name: string;
    description: string;
    instructions: string;
    model: string;
    runtimeId: string;
  }
): Promise<MulticaAgent> {
  const agents = await multicaJson<MulticaAgent[]>(workspaceId, "agent", "list", "--output", "json");
  const existing = agents.find((agent) => agent.name === input.name);

  if (existing) {
    const updated = await multicaJson<MulticaAgent>(
      workspaceId,
      "agent",
      "update",
      existing.id,
      "--name",
      input.name,
      "--description",
      input.description,
      "--instructions",
      input.instructions,
      "--model",
      input.model,
      "--runtime-id",
      input.runtimeId,
      "--visibility",
      "private",
      "--max-concurrent-tasks",
      "1",
      "--output",
      "json"
    );
    return updated;
  }

  return multicaJson<MulticaAgent>(
    workspaceId,
    "agent",
    "create",
    "--name",
    input.name,
    "--description",
    input.description,
    "--instructions",
    input.instructions,
    "--model",
    input.model,
    "--runtime-id",
    input.runtimeId,
    "--visibility",
    "private",
    "--max-concurrent-tasks",
    "1",
    "--output",
    "json"
  );
}

async function upsertAutopilot(
  workspaceId: string | undefined,
  input: {
    title: string;
    description: string;
    agentName: string;
  }
): Promise<MulticaAutopilot> {
  const autopilots = await multicaJson<MulticaAutopilotListResponse>(
    workspaceId,
    "autopilot",
    "list",
    "--output",
    "json"
  );
  const existing = autopilots.autopilots.find((autopilot) => autopilot.title === input.title);

  if (existing) {
    return multicaJson<MulticaAutopilot>(
      workspaceId,
      "autopilot",
      "update",
      existing.id,
      "--title",
      input.title,
      "--description",
      input.description,
      "--agent",
      input.agentName,
      "--mode",
      "run_only",
      "--status",
      "active",
      "--output",
      "json"
    );
  }

  return multicaJson<MulticaAutopilot>(
    workspaceId,
    "autopilot",
    "create",
    "--title",
    input.title,
    "--description",
    input.description,
    "--agent",
    input.agentName,
    "--mode",
    "run_only",
    "--output",
    "json"
  );
}

async function upsertTrigger(
  workspaceId: string | undefined,
  autopilotId: string,
  input: {
    label: string;
    cron: string;
    timezone: string;
  }
): Promise<void> {
  const current = await multicaJson<MulticaAutopilotGetResponse>(
    workspaceId,
    "autopilot",
    "get",
    autopilotId,
    "--output",
    "json"
  );
  const existing = current.triggers?.find((trigger) => trigger.label === input.label);

  if (existing) {
    await multica(
      workspaceId,
      "autopilot",
      "trigger-update",
      autopilotId,
      existing.id,
      "--label",
      input.label,
      "--cron",
      input.cron,
      "--timezone",
      input.timezone,
      "--enabled=true",
      "--output",
      "json"
    );
    return;
  }

  await multica(
    workspaceId,
    "autopilot",
    "trigger-add",
    autopilotId,
    "--label",
    input.label,
    "--cron",
    input.cron,
    "--timezone",
    input.timezone,
    "--output",
    "json"
  );
}

function toIssue(issue: MulticaIssue): Issue {
  const converted: Issue = {
    id: issue.id,
    title: issue.title,
    open: issue.status !== "done",
    status: issue.status,
    labels: createLabels((issue.labels ?? []).map((label) => label.name)),
    raw: issue,
  };

  if (issue.assignee_id) {
    converted.assignee = issue.assignee_id;
  }

  return converted;
}

async function applyAction(
  workspaceId: string | undefined,
  labels: ReadonlyMap<string, string>,
  issue: Issue,
  action: Action
): Promise<void> {
  switch (action.type) {
    case "addLabel": {
      const labelId = requireLabel(labels, action.label);
      await multica(workspaceId, "issue", "label", "add", issue.id, labelId, "--output", "json");
      return;
    }
    case "removeLabel": {
      const labelId = requireLabel(labels, action.label);
      await multica(workspaceId, "issue", "label", "remove", issue.id, labelId, "--output", "json");
      return;
    }
    case "moveStatus":
      await multica(workspaceId, "issue", "status", issue.id, action.status, "--output", "json");
      return;
    case "assignAgent":
      await multica(workspaceId, "issue", "assign", issue.id, "--to", action.agent, "--output", "json");
      return;
    case "comment":
      await multica(
        workspaceId,
        "issue",
        "comment",
        "add",
        issue.id,
        "--content",
        action.body,
        "--output",
        "json"
      );
      return;
  }
}

async function listLabels(workspaceId: string | undefined): Promise<ReadonlyMap<string, string>> {
  const labels = await multicaJson<MulticaLabel[]>(workspaceId, "label", "list", "--output", "json");
  return new Map(labels.map((label) => [label.name, label.id]));
}

function requireLabel(labels: ReadonlyMap<string, string>, name: string): string {
  const id = labels.get(name);
  if (!id) {
    throw new Error(`Multica label not found: ${name}`);
  }
  return id;
}

async function multicaJson<T>(workspaceId: string | undefined, ...args: string[]): Promise<T> {
  const { stdout } = await multica(workspaceId, ...args);
  return JSON.parse(stdout) as T;
}

async function multica(workspaceId: string | undefined, ...args: string[]) {
  const fullArgs = workspaceId ? ["--workspace-id", workspaceId, ...args] : args;
  return execFileAsync("multica", fullArgs, {
    maxBuffer: 50 * 1024 * 1024,
  });
}
