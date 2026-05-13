import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActionPlan, Pipeline, Provider } from "../core/types.js";

const execFileAsync = promisify(execFile);

export function createMulticaProvider(): Provider {
  return {
    name: "multica",
    async listIssues() {
      throw new Error(
        "Multica issue listing is not implemented yet. Use the mock provider for local planning."
      );
    },
    async apply(_plan: ActionPlan) {
      throw new Error("Multica action apply is not implemented yet.");
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
