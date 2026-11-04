// The retail-shaped project folded for dev and prod, and for dev, test and prod,
// against the files in test/golden. UPDATE_GOLDEN=1 writes them again.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fold, foldFailures, folderFiles, resolveAll, retail, shop } from "./fold-helpers.js";

const threeEnvironments = [
  "id: retail",
  "name: Retail sales",
  "values:",
  "  host: https://adb-1111111111111111.1.azuredatabricks.net",
  "  storage: abfss://landing@retaildev.dfs.core.windows.net",
  "environments:",
  "  dev: {}",
  "  test:",
  "    values:",
  "      host: https://adb-2222222222222222.2.azuredatabricks.net",
  "  prod:",
  "    values:",
  "      host: https://adb-2222222222222222.2.azuredatabricks.net",
  "      storage: abfss://landing@retailprod.dfs.core.windows.net",
  "imports:",
  "  - standard.yaml",
  "  - platform.yaml",
  "  - connections/*.yaml",
  "  - flows/*.yaml",
  "  - transforms/*.yaml",
  "  - contracts/*.yaml",
  "",
].join("\n");

/** A PySpark transform whose tables' schemas differ by environment, read with spark.conf.get. */
const pyspark = shop("  dev: {}\n  prod: {}\n", {
  "standard.yaml":
    "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\nnaming: { schema: '{{ layer }}_{{ environment }}' }\n",
  "totals.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: totals",
    "inputs: [orders]",
    "contract: orders",
    "transform: { uses: pyspark }",
    "code: |",
    "  from pyspark.sql import functions as F",
    "",
    "  def transform(tables):",
    '      return tables["orders"].groupBy("id").agg(F.sum("total").alias("total"))',
    "",
  ].join("\n"),
});

const cases = {
  retail: { files: retail, environments: ["dev", "prod"] },
  "retail-three": {
    files: { ...retail, "project.yaml": threeEnvironments },
    environments: ["dev", "test", "prod"],
  },
  pyspark: { files: pyspark, environments: ["dev", "prod"] },
};

describe("golden bundles", () => {
  for (const [name, { files, environments }] of Object.entries(cases)) {
    it(`folds ${name} (${environments.join(", ")}) into the files in test/golden/${name}`, () => {
      const models = resolveAll(files, environments);
      const folded = fold(models);
      expect(folded.problems).toEqual([]);
      expect(foldFailures(models)).toEqual([]);
      const folder = join(import.meta.dirname, "golden", name);
      if (process.env.UPDATE_GOLDEN === "1") write(folder, folded.files);
      expect(existsSync(folder)).toBe(true);
      expect(folded.files).toEqual(folderFiles(folder));
    });
  }
});

function write(folder: string, files: Record<string, string>): void {
  rmSync(folder, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}
