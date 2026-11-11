// The golden bundles against the bundle schema of the installed Databricks CLI
// (`databricks bundle schema`). Nothing stores the schema: the test asks the CLI for it,
// and skips, saying why, when the CLI is missing or older than v1.23.0.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { folderFiles } from "./fold-helpers.js";

/** The oldest Databricks CLI whose bundle schema the bundles are checked against. */
const minimum = [1, 23, 0];

/** Why the bundles cannot be checked here, or undefined when the Databricks CLI is fit. */
function databricksMissing(): string | undefined {
  const run = spawnSync("databricks", ["--version"], { encoding: "utf8" });
  if (run.error || run.status !== 0)
    return "the Databricks CLI is not installed; install v1.23.0 or later to check the bundles";
  const found = /v(\d+)\.(\d+)\.(\d+)/.exec(run.stdout);
  if (!found) return `cannot read the Databricks CLI's version from: ${run.stdout.trim()}`;
  const version = found.slice(1).map(Number);
  const differs = version.findIndex((part, at) => part !== minimum[at]);
  if (differs >= 0 && version[differs]! < minimum[differs]!)
    return `the Databricks CLI is v${version.join(".")}; the bundles need v1.23.0 or later`;
  return undefined;
}

/** Keys that only describe; a key named like one under `properties` is a property, and stays. */
const annotations = new Set([
  "description",
  "markdownDescription",
  "deprecationMessage",
  "enumDescriptions",
]);
/** Definitions of model serving providers, which no bundle here uses, left open. */
const open = new Set([
  "catalog.ModelProviderServiceConfig",
  "serving.AmazonBedrockConfigBedrockProvider",
  "serving.ExternalModelProvider",
]);

/** The schema without annotations, as the standards repository trims it. */
function trimmed(node: unknown, parent?: string): unknown {
  if (Array.isArray(node)) return node.map((item) => trimmed(item));
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => parent === "properties" || !annotations.has(key))
      .map(([key, value]) => [key, open.has(key) ? {} : trimmed(value, key)]),
  );
}

/** The bundle schema the installed Databricks CLI prints. */
function bundleSchema(): object {
  const printed = spawnSync("databricks", ["bundle", "schema"], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (printed.status !== 0) throw new Error(printed.stderr);
  return trimmed(JSON.parse(printed.stdout)) as object;
}

const goldens = join(import.meta.dirname, "golden");
const missing = databricksMissing();

describe("the golden bundles", () => {
  if (missing) {
    it.skip(`are valid for the Databricks CLI's bundle schema: skipped, ${missing}`, () => {});
    return;
  }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(bundleSchema());
  for (const name of readdirSync(goldens).sort()) {
    it(`are valid for the Databricks CLI's bundle schema: ${name}`, () => {
      const files = folderFiles(join(goldens, name));
      const bundle = Object.keys(files).filter(
        (path) => path === "databricks.yml" || /^resources\/[^/]+\.yml$/.test(path),
      );
      expect(bundle).toContain("databricks.yml");
      expect(bundle.length).toBeGreaterThan(1);
      for (const path of bundle) {
        const valid = validate(parse(files[path]!));
        expect(valid ? [] : validate.errors, path).toEqual([]);
      }
    });
  }
});
