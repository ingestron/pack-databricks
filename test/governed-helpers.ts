// The governed project: exact grants, a principal per environment, a quoted principal, write
// roles, layer access, managed schemas and a custom classification tag key.
import { join } from "node:path";
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { expect } from "vitest";
import { databricks } from "../src/index.js";
import { folderFiles } from "./fold-helpers.js";

export const governed = folderFiles(join(import.meta.dirname, "fixtures/governed"));

/** The after-refresh task's path in the governed project. */
export const script = "tasks/retail/apply_contract.py";

/** The governed project with the platform's lines changed. */
export function withPlatform(change: (text: string) => string): Record<string, string> {
  return { ...governed, "platform.yaml": change(governed["platform.yaml"]!) };
}

/** The governed project with manage.grants off. */
export const grantsOff = withPlatform((text) => text.replace(", grants: true }", " }"));

/** One environment's resolution, with diagnostics. */
export function resolve(files: Record<string, string>, environment = "dev") {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment });
}

/** One environment's model and files; fails on any error. */
export function built(files: Record<string, string>, environment = "dev") {
  const result = resolve(files, environment);
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  expect(errors).toEqual([]);
  return { result, model: result.model!, out: databricks.build(result.model!) };
}
