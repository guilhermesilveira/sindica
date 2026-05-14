import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLabels } from "../core/labels.js";
const execFileAsync = promisify(execFile);
export function createMulticaProvider(options = {}) {
    const workspaceId = options.workspaceId;
    return {
        name: "multica",
        async listIssues() {
            const issues = [];
            const limit = 100;
            let offset = 0;
            while (true) {
                const response = await multicaJson(workspaceId, "issue", "list", "--limit", String(limit), "--offset", String(offset), "--output", "json");
                issues.push(...response.issues.map(toIssue));
                if (!response.has_more) {
                    break;
                }
                offset += response.limit ?? limit;
            }
            return issues;
        },
        async apply(plan) {
            const labels = await listLabels(workspaceId);
            for (const item of plan.planned) {
                for (const action of item.actions) {
                    await applyAction(workspaceId, labels, item.issue, action);
                }
            }
        },
        async deploy(pipeline) {
            await execFileAsync("multica", ["--version"]);
            console.log(`multica provider detected. Router upsert is not implemented yet: ${pipeline.router.name}`);
        },
        async doctor() {
            const { stdout } = await execFileAsync("multica", ["--version"]);
            console.log(stdout.trim());
        },
    };
}
function toIssue(issue) {
    const converted = {
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
async function applyAction(workspaceId, labels, issue, action) {
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
            await multica(workspaceId, "issue", "comment", "add", issue.id, "--content", action.body, "--output", "json");
            return;
    }
}
async function listLabels(workspaceId) {
    const labels = await multicaJson(workspaceId, "label", "list", "--output", "json");
    return new Map(labels.map((label) => [label.name, label.id]));
}
function requireLabel(labels, name) {
    const id = labels.get(name);
    if (!id) {
        throw new Error(`Multica label not found: ${name}`);
    }
    return id;
}
async function multicaJson(workspaceId, ...args) {
    const { stdout } = await multica(workspaceId, ...args);
    return JSON.parse(stdout);
}
async function multica(workspaceId, ...args) {
    const fullArgs = workspaceId ? ["--workspace-id", workspaceId, ...args] : args;
    return execFileAsync("multica", fullArgs, {
        maxBuffer: 50 * 1024 * 1024,
    });
}
//# sourceMappingURL=multica.js.map