// Deploy-time values: each ${envvar:NAME} is a bundle variable the deploying
// pipeline supplies as BUNDLE_VAR_<name>, never a value written in the files.
import { describe, expect, it } from "vitest";
import { fold, foldFailures, resolveAll, shop, yamlOf } from "./fold-helpers.js";

const orders = "src/shop/bronze/orders.sql";

describe("a value supplied when deploying", () => {
  it("is a variable that every target leaves to the pipeline", () => {
    const models = resolveAll(
      shop("  dev: {}\n  prod: {}\n", { "files.yaml": landing("${envvar:SHOP_LANDING}") }),
      ["dev", "prod"],
    );
    const { files, deployValues, problems } = fold(models);
    expect(problems).toEqual([]);
    expect(deployValues).toEqual([
      { name: "SHOP_LANDING", suppliedAs: ["BUNDLE_VAR_shop_landing"] },
    ]);
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.variables.shop_landing).toEqual({
      description:
        "Supplied when deploying, as BUNDLE_VAR_shop_landing (SHOP_LANDING in the definitions).",
    });
    expect(bundle.targets.dev.variables).toEqual({ catalog: "dev" });
    expect(files[orders]).toContain("'${ingestron.shop_landing}/orders'");
    expect(JSON.stringify(files)).not.toContain("${envvar:");
    expect(foldFailures(models)).toEqual([]);
  });

  it("literal in one target and supplied in another is one variable, set where it is literal", () => {
    const environments = "  dev: {}\n  prod: { values: { landing: '${envvar:SHOP_LANDING}' } }\n";
    const models = resolveAll(shop(environments), ["dev", "prod"]);
    const { files, deployValues } = fold(models);
    const bundle = yamlOf(files, "databricks.yml");
    expect(Object.keys(bundle.variables)).toEqual(["shop_landing", "catalog"]);
    expect(bundle.targets.dev.variables).toEqual({
      shop_landing: "/Volumes/main/landing/shop",
      catalog: "dev",
    });
    expect(bundle.targets.prod.variables).toEqual({ catalog: "prod" });
    expect(deployValues).toEqual([
      { name: "SHOP_LANDING", suppliedAs: ["BUNDLE_VAR_shop_landing"] },
    ]);
    expect(foldFailures(models)).toEqual([]);
  });

  it("within a longer text is a variable for that part, which Databricks puts in the text", () => {
    const path = "abfss://landing@${envvar:STORAGE_ACCOUNT}.dfs.core.windows.net/shop";
    const environments = "  dev: {}\n  prod: {}\n";
    const models = resolveAll(shop(environments, { "files.yaml": landing(path) }), ["dev", "prod"]);
    const { files } = fold(models);
    expect(files[orders]).toContain(
      "'abfss://landing@${ingestron.storage_account}.dfs.core.windows.net/shop/orders'",
    );
    const pipeline = yamlOf(files, "resources/shop.pipeline.yml").resources.pipelines.shop;
    expect(pipeline.configuration).toEqual({
      "ingestron.storage_account": "${var.storage_account}",
    });
    expect(foldFailures(models)).toEqual([]);
  });

  it("within a longer text, literal in another target, takes that target's part", () => {
    const environments = [
      "  dev: { values: { landing: 'abfss://landing@shopdev.dfs.core.windows.net/shop' } }",
      "  prod: { values: { landing: 'abfss://landing@${envvar:STORAGE_ACCOUNT}.dfs.core.windows.net/shop' } }",
      "",
    ].join("\n");
    const models = resolveAll(shop(environments), ["dev", "prod"]);
    const { files } = fold(models);
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.targets.dev.variables.storage_account).toBe("shopdev");
    expect(bundle.targets.prod.variables.storage_account).toBeUndefined();
    expect(foldFailures(models)).toEqual([]);
  });

  it("written differently in two targets that supply it is DEPLOY_VALUE", () => {
    const environments = [
      "  dev: { values: { landing: '${envvar:LANDING}/dev' } }",
      "  prod: { values: { landing: '${envvar:LANDING}/prod' } }",
      "",
    ].join("\n");
    const { files, problems } = fold(resolveAll(shop(environments), ["dev", "prod"]));
    expect(files).toEqual({});
    expect(problems).toMatchObject([
      {
        code: "DEPLOY_VALUE",
        message:
          'This value is "${envvar:LANDING}/dev" in dev and "${envvar:LANDING}/prod" in prod; a value supplied when deploying must be written the same way in every environment that supplies it.',
        file: "project.yaml",
      },
    ]);
  });

  it("as the workspace host is left out of the target, for DATABRICKS_HOST", () => {
    const platform = [
      "apiVersion: ingestron.io/v1",
      "kind: Platform",
      "id: lake",
      "workspace: { host: '${values.host}' }",
      "run_as: { service_principal_name: '${envvar:DEPLOYER}' }",
      "",
    ].join("\n");
    const environments = [
      "  dev: { values: { host: 'https://adb-1.1.azuredatabricks.net' } }",
      "  prod: { values: { host: '${envvar:PROD_HOST}' } }",
      "",
    ].join("\n");
    const models = resolveAll(shop(environments, { "platform.yaml": platform }), ["dev", "prod"]);
    const { files, deployValues } = fold(models);
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.targets.dev.workspace).toEqual({ host: "https://adb-1.1.azuredatabricks.net" });
    expect(bundle.targets.prod.workspace).toBeUndefined();
    expect(bundle.targets.prod.run_as).toEqual({ service_principal_name: "${var.deployer}" });
    expect(deployValues).toEqual([
      { name: "DEPLOYER", suppliedAs: ["BUNDLE_VAR_deployer"] },
      { name: "PROD_HOST", suppliedAs: ["DATABRICKS_HOST"] },
    ]);
    expect(foldFailures(models)).toEqual([]);
  });
});

function landing(path: string): string {
  return `apiVersion: ingestron.io/v1\nkind: Connection\nid: files\nconnector: files\nconnectivity: public\nsettings: { path: '${path}' }\n`;
}
