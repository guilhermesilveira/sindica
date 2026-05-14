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
            await deployRouter(workspaceId, pipeline);
        },
        async doctor() {
            const { stdout } = await execFileAsync("multica", ["--version"]);
            console.log(stdout.trim());
        },
    };
}
async function deployRouter(workspaceId, pipeline) {
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
    const runtimeProvider = pipeline.router.runtimeProvider ?? "codex";
    const runtimeId = await resolveRuntimeId(workspaceId, runtimeProvider);
    const customArgs = pipeline.router.customArgs ?? defaultCustomArgs(runtimeProvider);
    const agent = await upsertAgent(workspaceId, {
        name: agentName,
        description,
        instructions,
        model,
        runtimeId,
        customArgs,
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
async function resolveRuntimeId(workspaceId, preferredProvider) {
    const runtimes = await multicaJson(workspaceId, "runtime", "list", "--output", "json");
    const preferred = runtimes.find((runtime) => runtime.status === "online" && runtime.provider === preferredProvider);
    const online = runtimes.find((runtime) => runtime.status === "online");
    const fallback = runtimes[0];
    const runtime = preferred ?? online ?? fallback;
    if (!runtime) {
        throw new Error("No Multica runtime found for router agent deployment.");
    }
    return runtime.id;
}
async function upsertAgent(workspaceId, input) {
    const agents = await multicaJson(workspaceId, "agent", "list", "--output", "json");
    const existing = agents.find((agent) => agent.name === input.name);
    if (existing) {
        const updated = await multicaJson(workspaceId, "agent", "update", existing.id, "--name", input.name, "--description", input.description, "--instructions", input.instructions, "--model", input.model, "--runtime-id", input.runtimeId, "--custom-args", JSON.stringify(input.customArgs), "--visibility", "private", "--max-concurrent-tasks", "1", "--output", "json");
        return updated;
    }
    return multicaJson(workspaceId, "agent", "create", "--name", input.name, "--description", input.description, "--instructions", input.instructions, "--model", input.model, "--runtime-id", input.runtimeId, "--custom-args", JSON.stringify(input.customArgs), "--visibility", "private", "--max-concurrent-tasks", "1", "--output", "json");
}
function defaultCustomArgs(runtimeProvider) {
    if (runtimeProvider !== "codex") {
        return [];
    }
    return [
        "-c",
        'sandbox_mode="danger-full-access"',
        "-c",
        'approval_policy="never"',
    ];
}
async function upsertAutopilot(workspaceId, input) {
    const autopilots = await multicaJson(workspaceId, "autopilot", "list", "--output", "json");
    const existing = autopilots.autopilots.find((autopilot) => autopilot.title === input.title);
    if (existing) {
        return multicaJson(workspaceId, "autopilot", "update", existing.id, "--title", input.title, "--description", input.description, "--agent", input.agentName, "--mode", "run_only", "--status", "active", "--output", "json");
    }
    return multicaJson(workspaceId, "autopilot", "create", "--title", input.title, "--description", input.description, "--agent", input.agentName, "--mode", "run_only", "--output", "json");
}
async function upsertTrigger(workspaceId, autopilotId, input) {
    const current = await multicaJson(workspaceId, "autopilot", "get", autopilotId, "--output", "json");
    const existing = current.triggers?.find((trigger) => trigger.label === input.label);
    if (existing) {
        await multica(workspaceId, "autopilot", "trigger-update", autopilotId, existing.id, "--label", input.label, "--cron", input.cron, "--timezone", input.timezone, "--enabled=true", "--output", "json");
        return;
    }
    await multica(workspaceId, "autopilot", "trigger-add", autopilotId, "--label", input.label, "--cron", input.cron, "--timezone", input.timezone, "--output", "json");
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