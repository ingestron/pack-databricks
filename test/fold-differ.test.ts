// What targets may not differ in, and what the fold does with the values
// Databricks sets per target: tags and the schedule's pause as presets.
import { describe, expect, it } from "vitest";
import { connection, contract } from "./connect-helpers.js";
import { fold, foldFailures, resolveAll, shop, yamlOf } from "./fold-helpers.js";

const two = "  dev: {}\n  prod: {}\n";
const refunds = {
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: files\ntables:\n  orders: { object: orders, contract: orders }\n  refunds: { object: refunds, contract: orders }\n",
};

describe("ENVIRONMENTS_DIFFER", () => {
  it("refuses a table that only some environments build, and writes nothing", () => {
    const { dev } = resolveAll(shop(two, refunds), ["dev"]);
    const { prod } = resolveAll(shop(two), ["prod"]);
    const { files, problems } = fold({ dev: dev!, prod: prod! });
    expect(files).toEqual({});
    expect(problems).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        severity: "error",
        message: 'Table "refunds" is built in dev but not in prod.',
        file: "flow.yaml",
      },
    ]);
  });

  it("refuses a value that is not text and differs, naming it and its value in each environment", () => {
    const platform = (on: boolean) =>
      `apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: ${on} }\n`;
    const { dev } = resolveAll(shop(two, { "platform.yaml": platform(false) }), ["dev"]);
    const { prod } = resolveAll(shop(two, { "platform.yaml": platform(true) }), ["prod"]);
    const { files, problems } = fold({ dev: dev!, prod: prod! });
    expect(files).toEqual({});
    expect(problems).toContainEqual({
      code: "ENVIRONMENTS_DIFFER",
      severity: "error",
      message:
        "resources/schemas.yml cannot be generated once for every environment: in prod it would not be what that environment gets on its own, because a value that is not text differs between environments: platform setting manage.schemas is false in dev, true in prod.",
      hint: "Make platform setting manage.schemas the same in every environment; only text values, such as names, paths and hosts, and lists can differ.",
      file: "project.yaml",
    });
  });

  it("refuses a Kafka connection read continuously in one environment only", () => {
    const files = {
      "project.yaml": "id: shop\nenvironments: { dev: {}, prod: {} }\nimports: ['*.yaml']\n",
      "standard.yaml":
        "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\n",
      "events.yaml": connection("events", "kafka", "public"),
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: events\ntables:\n  clicks: { object: clicks, contract: clicks }\n",
      "clicks.yaml": contract("clicks"),
    };
    const { problems } = fold(resolveAll(files, ["dev", "prod"]));
    expect(problems).toMatchObject([
      {
        code: "ENVIRONMENTS_DIFFER",
        message: 'Connection "events" is read continuously in prod and by the refresh job in dev.',
        hint: "Set continuous in the flow's ingest settings, so that it is the same in every environment.",
        file: "flow.yaml",
      },
    ]);
  });

  it("refuses values that differ in a PySpark transform's own code, which the pack copies as it is", () => {
    const totals = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: totals",
      "inputs: [orders]",
      "contract: orders",
      "transform: { uses: pyspark }",
      "code: |",
      "  def transform(tables):",
      '      return tables["orders"].where("region = \'${values.region}\'")',
      "",
    ].join("\n");
    const environments =
      "  dev: { values: { region: north } }\n  prod: { values: { region: south } }\n";
    const models = resolveAll(shop(environments, { "totals.yaml": totals }), ["dev", "prod"]);
    expect(fold(models).problems).toMatchObject([
      {
        code: "ENVIRONMENTS_DIFFER",
        message:
          'The code of PySpark transform "totals" would need values that differ between environments (totals_value); a PySpark transform\'s own code cannot take them yet.',
        file: "totals.yaml",
      },
    ]);
  });
});

describe("values in a transform's code", () => {
  it("become pipeline configuration values, token by token", () => {
    const daily = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: daily",
      "inputs: [orders]",
      "contract: orders",
      "code: SELECT * FROM {{ tables.orders }} JOIN ${values.crm}.customers USING (id)",
      "",
    ].join("\n");
    const environments =
      "  dev: { values: { crm: dev_crm.core } }\n  prod: { values: { crm: prod_crm.core } }\n";
    const models = resolveAll(shop(environments, { "daily.yaml": daily }), ["dev", "prod"]);
    const { files } = fold(models);
    expect(files["src/shop/silver/daily.sql"]).toContain(
      "SELECT * FROM `bronze`.`orders` JOIN ${ingestron.daily_value}.core.customers USING (id)",
    );
    expect(yamlOf(files, "databricks.yml").targets.prod.variables.daily_value).toBe("prod_crm");
    expect(foldFailures(models)).toEqual([]);
  });
});

describe("presets", () => {
  const platform = [
    "apiVersion: ingestron.io/v1",
    "kind: Platform",
    "id: lake",
    "tags: { team: sales, environment: '${environment.name}' }",
    "schedule: { cron: '0 0 5 * * ?', timezone: Europe/London }",
    "",
  ].join("\n");
  const three = "  dev: {}\n  test: {}\n  prod: {}\n";

  it("carry the tags that differ; the tags that do not stay on the resources", () => {
    const models = resolveAll(shop(three, { "platform.yaml": platform }), ["dev", "test", "prod"]);
    const { files } = fold(models);
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.targets.prod.presets.tags).toEqual({ environment: "prod" });
    const job = yamlOf(files, "resources/shop_refresh.job.yml").resources.jobs.shop_refresh;
    expect(job.tags).toEqual({ team: "sales" });
    expect(foldFailures(models)).toEqual([]);
  });

  it("pause the schedule where the target's mode does not, and leave it unset in the job", () => {
    const models = resolveAll(shop(three, { "platform.yaml": platform }), ["dev", "test", "prod"]);
    const { files } = fold(models);
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.targets.dev.presets.trigger_pause_status).toBeUndefined();
    expect(bundle.targets.test.presets.trigger_pause_status).toBe("PAUSED");
    expect(bundle.targets.prod.presets.trigger_pause_status).toBeUndefined();
    const job = yamlOf(files, "resources/shop_refresh.job.yml").resources.jobs.shop_refresh;
    expect(job.schedule.pause_status).toBeUndefined();
    expect(foldFailures(models)).toEqual([]);
  });

  it("give way to a variable when a PAUSED preset would also stop a continuous pipeline", () => {
    const files = {
      ...shop(three, { "platform.yaml": platform }),
      "erp.yaml": connection("erp", "sqlserver"),
      "erp.flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  invoices: { object: erp.dbo.invoices, contract: invoices }\n",
      "invoices.yaml": contract("invoices"),
    };
    const models = resolveAll(files, ["dev", "test", "prod"]);
    const folded = fold(models);
    const bundle = yamlOf(folded.files, "databricks.yml");
    expect(bundle.targets.test.presets.trigger_pause_status).toBeUndefined();
    expect(bundle.targets.test.variables.pause_status).toBe("PAUSED");
    const job = yamlOf(folded.files, "resources/shop_refresh.job.yml").resources.jobs.shop_refresh;
    expect(job.schedule.pause_status).toBe("${var.pause_status}");
    expect(foldFailures(models)).toEqual([]);
  });
});

describe("the after-refresh script", () => {
  it("takes the values that differ as task parameters", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { tags: true }\n";
    const models = resolveAll(shop(two, { "platform.yaml": platform }), ["dev", "prod"]);
    const { files } = fold(models);
    expect(files["tasks/shop/apply_contract.py"]).toContain(
      "ALTER STREAMING TABLE `${ingestron.catalog}`.`bronze`.`orders` SET TAGS ('sales' = '')",
    );
    const job = yamlOf(files, "resources/shop_refresh.job.yml").resources.jobs.shop_refresh;
    expect(job.tasks[1].spark_python_task.parameters).toEqual(["ingestron.catalog=${var.catalog}"]);
    expect(foldFailures(models)).toEqual([]);
  });
});
