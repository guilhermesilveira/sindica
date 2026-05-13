import { resolve } from "node:path";
import { createJiti } from "jiti";
import type { Pipeline } from "../core/types.js";

export async function loadConfig(configPath: string): Promise<Pipeline> {
  const absolutePath = resolve(configPath);
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  });
  const loaded = await jiti.import<Pipeline | { default: Pipeline }>(absolutePath);

  if (isPipeline(loaded)) {
    return loaded;
  }

  if (isPipeline((loaded as { default?: unknown }).default)) {
    return (loaded as { default: Pipeline }).default;
  }

  throw new Error(`Config did not export a Sindica pipeline: ${absolutePath}`);
}

function isPipeline(value: unknown): value is Pipeline {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Pipeline>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.conflictPolicy === "string" &&
    Array.isArray(candidate.rules)
  );
}
