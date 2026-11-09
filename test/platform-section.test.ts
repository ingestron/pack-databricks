// The Platform's databricks section: what it accepts, and that it builds and folds as the
// top-level fields did.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { fold, folderFiles, foldFailures, resolveAll, retail, yamlOf } from "./fold-helpers.js";
import { join } from "node:path";

const golden = folderFiles(join(import.meta.dirname, "golden/retail"));

function resolve(files: Record<string, string>, environment = "dev") {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment });
}

describe("the Platform's databricks section", () => {
  const platform = (body: string) => ({
    ...retail,
    "platform.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Platform",
      "id: lakehouse",
      body,
      "",
    ].join("\n"),
  });
  const bundle = (files: Record<string, string>) => {
    const result = resolve(files);
    return {
      result,
      yml: result.model ? databricks.build(result.model)["databricks.yml"] : undefined,
    };
  };

  it("builds the same databricks.yml from a section as from a top-level field", () => {
    const top = bundle(platform("mode: production"));
    const section = bundle(platform("databricks:\n  mode: production"));
    expect(top.yml).toBeDefined();
    expect(section.yml).toBe(top.yml);
    expect(section.result.diagnostics.map((item) => item.code)).not.toContain(
      "PLATFORM_FIELD_MOVED",
    );
    expect(top.result.diagnostics.map((item) => item.code)).toContain("PLATFORM_FIELD_MOVED");
  });

  it("refuses a value the section's schema does not allow", () => {
    const { result } = bundle(platform("databricks:\n  mode: staging"));
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("accepts warehouse_id and lists it as a platform field", () => {
    const { result } = bundle(platform("databricks:\n  warehouse_id: abc123"));
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(databricks.platformFields).toContain("databricks.warehouse_id");
  });

  it("keeps the section's field schemas the same as the Platform's", () => {
    const properties = (databricks.platformSection as { properties: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties).sort()).toEqual([
      "compute",
      "grants",
      "manage",
      "mode",
      "permissions",
      "run_as",
      "warehouse_id",
      "workspace",
    ]);
  });
});

describe("folding with the new model fields", () => {
  /** The retail Platform with its Databricks fields in their section. */
  const moved = {
    ...retail,
    "platform.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Platform",
      "id: lakehouse",
      "tags:",
      "  team: sales",
      "  environment: ${environment.name}",
      "schedule:",
      "  cron: 0 0 5 * * ?",
      "  timezone: Europe/London",
      "notifications:",
      "  on_failure: [sales-data@example.com]",
      "databricks:",
      "  workspace:",
      "    host: ${values.host}",
      "  run_as:",
      "    service_principal_name: 7f3c2a10-0000-4000-8000-000000000001",
      "  permissions:",
      "    - group_name: sales-engineers",
      "      level: CAN_MANAGE",
      "    - group_name: sales-analysts",
      "      level: CAN_VIEW",
      "",
    ].join("\n"),
  };

  it("folds a Platform written with a section into the golden files", () => {
    const models = resolveAll(moved, ["dev", "prod"]);
    const folded = fold(models);
    expect(folded.problems).toEqual([]);
    expect(foldFailures(models)).toEqual([]);
    expect(folded.files).toEqual(golden);
  });

  it("makes email alerts that differ between environments one list variable", () => {
    const withAlerts = {
      ...moved,
      "platform.yaml": moved["platform.yaml"]!.replace(
        "databricks:\n",
        "alerts:\n  - { kind: email, to: ['${values.alert}'] }\ndatabricks:\n",
      ),
      "project.yaml": retail["project.yaml"]!.replace(
        "  dev: {}\n",
        "  dev:\n    values:\n      alert: dev-team@example.com\n",
      ).replace(
        "  prod:\n    values:\n",
        "  prod:\n    values:\n      alert: sales-data@example.com\n",
      ),
    };
    expect(withAlerts["project.yaml"]).toContain("alert: dev-team");
    const models = resolveAll(withAlerts, ["dev", "prod"]);
    const folded = fold(models);
    expect(folded.problems).toEqual([]);
    expect(foldFailures(models)).toEqual([]);
    const job = yamlOf(folded.files, "resources/retail_refresh.job.yml").resources.jobs;
    expect(job.retail_refresh.email_notifications).toEqual({
      on_failure: "${var.notifications_on_failure}",
    });
    const pipeline = yamlOf(folded.files, "resources/retail.pipeline.yml").resources.pipelines;
    expect(pipeline.retail.notifications[0].email_recipients).toBe(
      "${var.notifications_on_failure}",
    );
    const bundle = yamlOf(folded.files, "databricks.yml");
    expect(bundle.variables.notifications_on_failure).toEqual({
      description: "Platform setting notifications.on_failure.",
      type: "complex",
    });
    expect(bundle.targets.dev.variables.notifications_on_failure).toEqual([
      "dev-team@example.com",
      "sales-data@example.com",
    ]);
    expect(bundle.targets.prod.variables.notifications_on_failure).toEqual([
      "sales-data@example.com",
    ]);
    const unchanged = (path: string) => !path.startsWith("resources/") && path !== "databricks.yml";
    for (const path of Object.keys(golden).filter(unchanged))
      expect(folded.files[path], path).toBe(golden[path]);
  });
});
