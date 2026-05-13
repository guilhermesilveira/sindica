#!/usr/bin/env node
import { evaluatePipeline } from "./core/evaluate-pipeline.js";
import { parseArgs } from "./cli/args.js";
import { formatPlan } from "./cli/format-plan.js";
import { loadConfig } from "./cli/load-config.js";
import { createProvider } from "./providers/index.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (!args.configPath) {
    throw new Error(`Missing config path for command: ${args.command}`);
  }

  const pipeline = await loadConfig(args.configPath);
  const provider = createProvider(args.fixture
    ? { provider: args.provider, fixture: args.fixture }
    : { provider: args.provider });

  if (args.command === "doctor") {
    await provider.doctor();
    return;
  }

  if (args.command === "deploy") {
    await provider.deploy(pipeline);
    return;
  }

  const issues = await provider.listIssues();
  const plan = evaluatePipeline(pipeline, issues);

  if (args.command === "plan") {
    console.log(formatPlan(plan));
    if (plan.conflicts.length > 0) {
      process.exitCode = 2;
    }
    return;
  }

  if (args.command === "run") {
    if (plan.conflicts.length > 0) {
      console.error(formatPlan(plan));
      process.exitCode = 2;
      return;
    }
    await provider.apply(plan);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

function printHelp(): void {
  console.log(`Sindica

Usage:
  sindica plan <config.ts> --provider mock --fixture issues.json
  sindica run <config.ts> --provider mock --fixture issues.json
  sindica deploy <config.ts> --provider multica
  sindica doctor <config.ts> --provider multica
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sindica: ${message}`);
  process.exitCode = 1;
});
