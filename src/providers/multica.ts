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
      await execFileAsync("multica", ["--version"]);
      console.log(
        `multica provider detected. Router upsert is not implemented yet: ${pipeline.router.name}`
      );
    },
    async doctor() {
      const { stdout } = await execFileAsync("multica", ["--version"]);
      console.log(stdout.trim());
    },
  };
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
