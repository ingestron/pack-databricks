// Presets and continuous pipelines: a gateway carries the platform's tags, and a
// preset that would change whether a continuous pipeline runs gives way to a variable.
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { connection, contract } from "./connect-helpers.js";
import { fold, foldFailures, resolveAll, shop, yamlOf } from "./fold-helpers.js";

const erp = {
  "erp.yaml": connection("erp", "sqlserver"),
  "erp.flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  invoices: { object: erp.dbo.invoices, contract: invoices }\n",
  "invoices.yaml": contract("invoices"),
};

describe("a gateway", () => {
  it("carries the platform's tags, as every pipeline does, so that presets tag it alike", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\ntags: { team: sales }\n";
    const models = resolveAll(shop("  dev: {}\n", { ...erp, "platform.yaml": platform }), ["dev"]);
    const files = databricks.build(models.dev!);
    const gateway = yamlOf(files, "resources/shop_erp_gateway.pipeline.yml").resources.pipelines
      .shop_erp_gateway;
    expect(gateway.tags).toEqual({ team: "sales" });
  });
});

describe("an UNPAUSED preset in development mode", () => {
  it("gives way to a variable when the bundle has a continuous pipeline, which the mode would stop", () => {
    const project = [
      "id: shop",
      "values: { landing: /Volumes/main/landing/shop }",
      "environments:",
      "  dev: { values: { paused: false } }",
      "  staging: { values: { paused: true } }",
      "imports: ['*.yaml']",
      "",
    ].join("\n");
    const platform = [
      "apiVersion: ingestron.io/v1",
      "kind: Platform",
      "id: lake",
      "mode: development",
      "schedule: { cron: '0 0 5 * * ?', paused: '${values.paused}' }",
      "",
    ].join("\n");
    const files = { ...shop("", erp), "project.yaml": project, "platform.yaml": platform };
    const models = resolveAll(files, ["dev", "staging"]);
    const bundle = yamlOf(fold(models).files, "databricks.yml");
    expect(bundle.targets.dev.presets).toBeUndefined();
    expect(bundle.targets.dev.variables.pause_status).toBe("UNPAUSED");
    expect(bundle.targets.staging.variables.pause_status).toBe("PAUSED");
    expect(foldFailures(models)).toEqual([]);
  });
});
