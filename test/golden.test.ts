// The retail-shaped project folded for dev and prod, and for dev, test and prod, and
// under a kit's standard, a project that cleanses and quarantines, and projects with grants,
// masks and row filters, against the files in test/golden. UPDATE_GOLDEN=1 writes them again.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fold, foldFailures, folderFiles, resolveAll, retail, shop } from "./fold-helpers.js";

/** The retail project under the lakehouse-streaming kit's standard, with alerts. */
const standards = folderFiles(join(import.meta.dirname, "fixtures/standards"));

/** A CRM project: bronze as it comes, silver cleansed, deduplicated, checked and quarantined. */
const quality = folderFiles(join(import.meta.dirname, "fixtures/quality"));

/**
 * A project with access: exact grants, a role whose principal differs by environment, a
 * principal with a backtick, write roles, layer access and a custom classification tag key.
 */
const governed = folderFiles(join(import.meta.dirname, "fixtures/governed"));

/** The governed project with masks and row filters on managed schemas. */
const masked = folderFiles(join(import.meta.dirname, "fixtures/masked"));

/** The masked project without managed schemas, so its policies are on its tables. */
const maskedTables = {
  ...masked,
  "platform.yaml": masked["platform.yaml"]!.replace("schemas: true, ", ""),
};

/** The same project with additive grants and without managed schemas. */
const grants = {
  ...governed,
  "standard.yaml": governed["standard.yaml"]!.replace("grants: exact", "grants: additive"),
  "platform.yaml": governed["platform.yaml"]!.replace("schemas: true, ", ""),
};

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
  standards: { files: standards, environments: ["dev", "test", "prod"] },
  quality: { files: quality, environments: ["dev", "prod"] },
  governed: { files: governed, environments: ["dev", "prod"] },
  grants: { files: grants, environments: ["dev", "prod"] },
  masked: { files: masked, environments: ["dev", "prod"] },
  "masked-tables": { files: maskedTables, environments: ["dev", "prod"] },
};

describe("a PySpark transform whose names differ", () => {
  it("reads the table's name into a module-level constant, and its inputs inside the function", () => {
    const models = resolveAll(pyspark, ["dev", "prod"]);
    const python = fold(models).files["src/shop/silver/totals.py"] ?? "";
    expect(python).toContain(
      '# Values that differ between environments, from the pipeline\'s configuration.\ningestron_schema_silver = spark.conf.get("ingestron.schema_silver")\n\n\n@dp.materialized_view(\n    name=f"{ingestron_schema_silver}.totals",',
    );
    const body = python.slice(python.indexOf("def ingestron_totals():"));
    expect(body).toContain(
      'spark.read.table(spark.conf.get("ingestron.schema_bronze") + ".orders")',
    );
    expect(python.slice(0, python.indexOf("def ingestron_totals():"))).not.toContain(
      "ingestron.schema_bronze",
    );
  });
});

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
