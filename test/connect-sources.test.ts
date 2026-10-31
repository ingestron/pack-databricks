// Lakeflow Connect: Salesforce, Kafka, and ingestion before our own pipeline.
import { describe, expect, it } from "vitest";
import { connection, contract, flow, generate } from "./connect-helpers.js";

const sqlServer = {
  "erp.yaml": connection("erp", "sqlserver"),
  "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders"),
  "orders.yaml": contract("orders"),
};

describe("Salesforce", () => {
  it("ingests objects with the connection, without a gateway", () => {
    const { yaml, output } = generate({
      "crm.yaml": connection("crm", "salesforce", "public"),
      "accounts.flow.yaml": flow("crm", "crm", "accounts", "Account"),
      "accounts.yaml": contract("accounts"),
    });
    expect(Object.keys(output).filter((path) => path.includes("gateway"))).toEqual([]);
    const definition = yaml("resources/shop_crm_ingestion.pipeline.yml").resources.pipelines
      .shop_crm_ingestion.ingestion_definition;
    expect(definition.connection_name).toBe("crm_conn");
    expect(definition.objects[0].table).toMatchObject({
      source_schema: "objects",
      source_table: "Account",
      destination_table: "accounts",
    });
  });

  it("takes only the contract's columns when appending too", () => {
    const append = flow(
      "crm",
      "crm",
      "accounts",
      "Account",
      "    ingest:\n      with: { mode: append }\n",
    );
    const { yaml } = generate({
      "crm.yaml": connection("crm", "salesforce", "public"),
      "accounts.flow.yaml": append,
      "accounts.yaml": contract("accounts"),
    });
    const table = yaml("resources/shop_crm_ingestion.pipeline.yml").resources.pipelines
      .shop_crm_ingestion.ingestion_definition.objects[0].table;
    expect(table.table_configuration).toEqual({
      scd_type: "APPEND_ONLY",
      include_columns: ["id", "total"],
    });
  });
});

describe("Kafka", () => {
  const kafka = {
    "events.yaml": connection("events", "kafka"),
    "clicks.flow.yaml": flow("events", "events", "clicks", "web.clicks"),
    "clicks.yaml": contract("clicks"),
  };

  const pipeline = (environment: string, files: Record<string, string> = kafka) =>
    generate(files, environment).yaml("resources/shop_events_ingestion.pipeline.yml").resources
      .pipelines.shop_events_ingestion;

  it("streams continuously in production and is refreshed by the job elsewhere, to save cost", () => {
    expect(pipeline("prod")).toMatchObject({ continuous: true });
    expect(pipeline("dev").continuous).toBeUndefined();
    const always = flow(
      "events",
      "events",
      "clicks",
      "web.clicks",
      "    ingest:\n      with: { continuous: true }\n",
    );
    expect(pipeline("dev", { ...kafka, "clicks.flow.yaml": always })).toMatchObject({
      continuous: true,
    });
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nschedule: { cron: 0 0 5 * * ? }\n";
    const { yaml } = generate({ ...kafka, "platform.yaml": platform });
    expect(yaml("resources/shop_refresh.job.yml").resources.jobs.shop_refresh.tasks).toEqual([
      {
        task_key: "ingest_events",
        pipeline_task: { pipeline_id: "${resources.pipelines.shop_events_ingestion.id}" },
      },
    ]);
  });

  it("reads a topic on the preview channel, appending, with JSON schema hints from the contract", () => {
    const { yaml, output } = generate(kafka, "prod");
    const pipeline = yaml("resources/shop_events_ingestion.pipeline.yml").resources.pipelines
      .shop_events_ingestion;
    expect(pipeline).toMatchObject({ channel: "PREVIEW", serverless: true });
    expect(pipeline.ingestion_definition.objects[0].table).toEqual({
      source_table: "N/A",
      destination_catalog: "prod",
      destination_schema: "bronze",
      destination_table: "clicks",
      table_configuration: { scd_type: "APPEND_ONLY" },
      connector_options: {
        kafka_options: {
          topics: ["web.clicks"],
          value_transformer: {
            format: "JSON",
            json_options: { schema_hints: "`id` BIGINT, `total` DOUBLE" },
          },
        },
      },
    });
    expect(output["resources/shop_events_ingestion.pipeline.yml"]).toContain(
      "Lakeflow Connect for Kafka is in Beta",
    );
  });
});

describe("together with our own pipeline", () => {
  it("runs triggered ingestion first, then the pipeline that reads the ingested tables", () => {
    const transform =
      "apiVersion: ingestron.io/v1\nkind: Transform\nid: totals\ninputs: [orders]\ncode: SELECT * FROM {{ tables.orders }}\ncontract: totals\n";
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nschedule: { cron: 0 0 5 * * ? }\n";
    const { yaml, output } = generate({
      ...sqlServer,
      "totals.t.yaml": transform,
      "totals.yaml": contract("totals"),
      "platform.yaml": platform,
    });
    expect(output["src/shop/silver/totals.sql"]).toContain("FROM `dev`.`bronze`.`orders`");
    expect(yaml("resources/shop_refresh.job.yml").resources.jobs.shop_refresh.tasks).toEqual([
      {
        task_key: "ingest_erp",
        pipeline_task: { pipeline_id: "${resources.pipelines.shop_erp_ingestion.id}" },
      },
      {
        task_key: "refresh",
        depends_on: [{ task_key: "ingest_erp" }],
        pipeline_task: { pipeline_id: "${resources.pipelines.shop.id}" },
      },
    ]);
  });
});
