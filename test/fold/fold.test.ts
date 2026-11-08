// One bundle for every environment: values that differ become variables set in
// each target, and the fold property holds for the first one, two and three targets.
import { describe, expect, it } from "vitest";
import { databricks } from "../../src/index.js";
import { fold, foldFailures, resolveAll, shop, yamlOf } from "../fold-helpers.js";

const three = [
  "  dev: {}",
  "  test: {}",
  "  prod: { values: { landing: /Volumes/prod/landing/shop } }",
  "",
].join("\n");
const orders = "src/shop/bronze/orders.sql";

describe("one environment", () => {
  it("gives a bundle with one target and no variables, as build gives it", () => {
    const models = resolveAll(shop("  dev: {}\n"), ["dev"]);
    const { files, problems, deployValues } = fold(models);
    expect(problems).toEqual([]);
    expect(deployValues).toEqual([]);
    expect(yamlOf(files, "databricks.yml").variables).toBeUndefined();
    expect(Object.keys(yamlOf(files, "databricks.yml").targets)).toEqual(["dev"]);
    expect(files).toEqual(databricks.build(models.dev!));
    expect(foldFailures(models)).toEqual([]);
  });
});

describe("values that differ", () => {
  const models = resolveAll(shop(three), ["dev", "test", "prod"]);
  const { files, problems } = fold(models);
  const bundle = yamlOf(files, "databricks.yml");

  it("become described variables with no default, set in every target", () => {
    expect(problems).toEqual([]);
    expect(bundle.variables).toEqual({
      catalog: { description: "Catalog of the shop tables." },
      files_path: { description: 'Folder the files of connection "files" are read from.' },
    });
    expect(bundle.targets.dev.variables).toEqual({
      catalog: "dev",
      files_path: "/Volumes/main/landing/shop",
    });
    expect(bundle.targets.test.variables).toEqual({
      catalog: "test",
      files_path: "/Volumes/main/landing/shop",
    });
    expect(bundle.targets.prod.variables).toEqual({
      catalog: "prod",
      files_path: "/Volumes/prod/landing/shop",
    });
  });

  it("reach the SQL through the pipeline's configuration, with two-part table names", () => {
    const pipeline = yamlOf(files, "resources/shop.pipeline.yml").resources.pipelines.shop;
    expect(pipeline.catalog).toBe("${var.catalog}");
    expect(pipeline.configuration).toEqual({ "ingestron.files_path": "${var.files_path}" });
    expect(files[orders]).toContain("CREATE OR REFRESH STREAMING TABLE `bronze`.`orders`");
    expect(files[orders]).toContain("'${ingestron.files_path}/orders'");
  });

  it("make the default target the first and write each target's mode", () => {
    expect(bundle.targets.dev).toMatchObject({ mode: "development", default: true });
    expect(bundle.targets.test.mode).toBe("production");
    expect(bundle.targets.test.default).toBeUndefined();
  });

  it("give each target what it gets alone, for one, two and three targets", () => {
    expect(foldFailures(models)).toEqual([]);
  });
});

describe("values that are the same in every target", () => {
  it("stay as they are, with no variable", () => {
    const models = resolveAll(shop("  dev: {}\n  test: {}\n"), ["dev", "test"]);
    const { files } = fold(models);
    expect(Object.keys(yamlOf(files, "databricks.yml").variables)).toEqual(["catalog"]);
    expect(files[orders]).toContain("'/Volumes/main/landing/shop/orders'");
    const pipeline = yamlOf(files, "resources/shop.pipeline.yml").resources.pipelines.shop;
    expect(pipeline).toMatchObject({ name: "shop", schema: "bronze", serverless: true });
    expect(pipeline.configuration).toBeUndefined();
  });
});

describe("prerequisites", () => {
  it("are one file per environment, which the bundle does not deploy", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: true }\n";
    const models = resolveAll(shop(three, { "platform.yaml": platform }), ["dev", "test", "prod"]);
    const { files } = fold(models);
    expect(Object.keys(files).filter((path) => path.startsWith("prerequisites/"))).toEqual([
      "prerequisites/dev.sql",
      "prerequisites/test.sql",
      "prerequisites/prod.sql",
    ]);
    expect(files["prerequisites/prod.sql"]).toContain("ON CATALOG `prod` TO");
    expect(yamlOf(files, "databricks.yml").sync).toEqual({
      exclude: [".generated.json", ".generated.lock", "prerequisites/**"],
    });
  });

  it("keep managed schemas under their layer's key, in the target's catalog", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: true }\n";
    const models = resolveAll(shop(three, { "platform.yaml": platform }), ["dev", "test", "prod"]);
    const { files } = fold(models);
    expect(yamlOf(files, "resources/schemas.yml").resources.schemas).toEqual({
      bronze: { catalog_name: "${var.catalog}", name: "bronze", comment: "Layer bronze of shop." },
    });
    expect(foldFailures(models)).toEqual([]);
  });
});

describe("managed schemas, several in one layer", () => {
  const files = (schema: string) =>
    shop("  dev: {}\n  prod: {}\n", {
      "standard.yaml": `apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\nnaming: { schema: '${schema}' }\n`,
      "platform.yaml":
        "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: true }\n",
      "web.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: web\nsource: files\ntables:\n  visits: { object: visits, contract: orders }\n",
    });

  it("are keyed by schema name, the same in every environment", () => {
    const models = resolveAll(files("{{ layer }}_{{ flow }}"), ["dev", "prod"]);
    const { files: folded, problems } = fold(models);
    expect(problems).toEqual([]);
    const schemas = yamlOf(folded, "resources/schemas.yml").resources.schemas;
    expect(Object.keys(schemas)).toEqual(["bronze_shop", "bronze_web"]);
    expect(schemas.bronze_web).toMatchObject({
      catalog_name: "${var.catalog}",
      name: "bronze_web",
    });
    expect(foldFailures(models)).toEqual([]);
  });

  it("whose names differ between environments are refused, naming the resource key", () => {
    const models = resolveAll(files("{{ layer }}_{{ flow }}_{{ environment }}"), ["dev", "prod"]);
    expect(fold(models).problems.map((problem) => problem.message)).toContain(
      "The resource key <schema_bronze> in resources/schemas.yml would be named after a value that differs between environments; names that decide files and resource keys must be the same in every environment.",
    );
  });

  it("in two catalogs with the same name are keyed <catalog>_<schema>", () => {
    const standard =
      "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\nnaming: { catalog: '{{ environment }}_{{ flow }}' }\n";
    const models = resolveAll({ ...files("{{ layer }}"), "standard.yaml": standard }, ["dev"]);
    const schemas = yamlOf(databricks.build(models.dev!), "resources/schemas.yml").resources
      .schemas;
    expect(Object.keys(schemas)).toEqual(["dev_shop_bronze", "dev_web_bronze"]);
  });
});
