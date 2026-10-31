// Each Databricks option and refusal, on a one-table project in memory.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

const base: Record<string, string> = {
  "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@1]\n",
  "files.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: files\nconnector: files\nconnectivity: public\nsettings: { path: /Volumes/dev/landing/shop/ }\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: files\ntables:\n  orders: { object: /orders, contract: orders }\n",
  "orders.yaml": [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: orders",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: orders",
    "    logicalType: object",
    "    description: It's every order.",
    "    properties:",
    "      - { name: id, logicalType: integer, required: true, primaryKey: true }",
    "      - { name: updated_at, logicalType: timestamp }",
    "",
  ].join("\n"),
};

function generate(changes: Record<string, string> = {}) {
  const result = resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [databricks],
    environment: "dev",
  });
  return { result, files: result.model ? databricks.build(result.model) : {} };
}

const withStore = (store: string) => ({
  "flow.yaml": base["flow.yaml"]!.replace("tables:", `store:\n${store}\ntables:`),
});
const orders = (files: Record<string, string>) => files["src/shop/bronze/orders.sql"] ?? "";

describe("streaming tables", () => {
  it("reads files once each with Auto Loader, joining the connection path and the object", () => {
    const sql = orders(generate().files);
    expect(sql).toContain(
      "FROM STREAM read_files(\n  '/Volumes/dev/landing/shop/orders',\n  format => 'parquet'",
    );
    expect(sql).toContain("schemaHints => '`id` BIGINT, `updated_at` TIMESTAMP'");
    expect(sql).toContain("COMMENT 'It\\'s every order.'\nCLUSTER BY AUTO\nAS SELECT");
  });

  it("keeps history with AUTO CDC as SCD type 2", () => {
    const sql = orders(
      generate(withStore("  with: { mode: history, sequence_by: updated_at }")).files,
    );
    expect(sql).toContain("KEYS (`id`)\nSEQUENCE BY `updated_at`\nSTORED AS SCD TYPE 2;");
  });

  it("refuses change data without a sequence column or a primary key", () => {
    const noKey = { "orders.yaml": base["orders.yaml"]!.replace(", primaryKey: true", "") };
    const { result } = generate({ ...withStore("  with: { mode: upsert }"), ...noKey });
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      '"streaming-table" for table "orders": mode upsert needs primary key columns in the contract.',
      '"streaming-table" for table "orders": mode upsert needs "sequence_by".',
    ]);
  });

  it("clusters by named columns, or not at all", () => {
    expect(orders(generate(withStore("  with: { cluster_by: [id] }")).files)).toContain(
      "CLUSTER BY (`id`)",
    );
    expect(orders(generate(withStore("  with: { cluster_by: none }")).files)).not.toContain(
      "CLUSTER BY",
    );
  });
});

describe("physical names", () => {
  const renamed = {
    "orders.yaml": base["orders.yaml"]!.replace(
      "{ name: updated_at, logicalType: timestamp }",
      "{ name: updated_at, logicalType: timestamp, physicalName: upd_ts }",
    ),
  };

  it("reads a source column under its contract name, with schema hints by the source name", () => {
    const { result, files } = generate(renamed);
    expect(result.diagnostics).toEqual([]);
    const sql = orders(files);
    expect(sql).toContain(
      "AS SELECT * EXCEPT (`upd_ts`), `upd_ts` AS `updated_at` FROM STREAM read_files(",
    );
    expect(sql).toContain("schemaHints => '`id` BIGINT, `upd_ts` TIMESTAMP'");
  });

  it("reads everything as it is when no column is renamed", () => {
    expect(orders(generate().files)).toContain("AS SELECT * FROM STREAM read_files(");
  });
});

describe("quality", () => {
  it("writes each expectation's action", () => {
    const standard = base["standard.yaml"] + "quality: { required: fail }\n";
    const sql = orders(generate({ "standard.yaml": standard }).files);
    expect(sql).toContain(
      "CONSTRAINT `id_not_null` EXPECT (`id` IS NOT NULL) ON VIOLATION FAIL UPDATE",
    );
  });
});

describe("materialised views", () => {
  it("reads files without STREAM when a flow stores into a view", () => {
    const sql = orders(generate(withStore("  uses: materialised-view")).files);
    expect(sql).toContain("CREATE OR REFRESH MATERIALIZED VIEW `dev`.`bronze`.`orders`");
    expect(sql).toContain("AS\nSELECT * FROM read_files(");
  });

  it("refuses transform SQL that reads a table it does not list as an input", () => {
    const transform =
      "apiVersion: ingestron.io/v1\nkind: Transform\nid: totals\ninputs: [orders]\ncode: SELECT * FROM {{ tables.refunds }}\ncontract: orders\n";
    const { result } = generate({ "totals.yaml": transform });
    expect(result.diagnostics[0]?.message).toMatch(
      /"sql" for table "totals": the SQL cannot be rendered \(undefined variable: tables.refunds/,
    );
  });
});

describe("platform", () => {
  it("leaves out workspace, job and schemas when the platform does not ask for them", () => {
    const { files } = generate();
    expect(Object.keys(files).sort()).toEqual([
      "databricks.yml",
      "resources/shop.pipeline.yml",
      "src/shop/bronze/orders.sql",
    ]);
    expect(files["databricks.yml"]).not.toContain("workspace:");
  });

  it("creates managed schemas with grants and makes the pipeline wait for them", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: true }\ngrants:\n  bronze: [{ principal: engineers, privileges: [USE_SCHEMA] }]\n";
    const { files } = generate({ "platform.yaml": platform });
    expect(files["resources/schemas.yml"]).toContain(
      "dev_bronze:\n      catalog_name: dev\n      name: bronze",
    );
    expect(files["resources/schemas.yml"]).toContain("principal: engineers");
    expect(files["resources/shop.pipeline.yml"]).toContain(
      "schema: ${resources.schemas.dev_bronze.name}",
    );
  });

  it("refuses classic compute, which this version cannot configure", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\ncompute: { serverless: false }\n";
    const { result } = generate({ "platform.yaml": platform });
    expect(result.diagnostics).toMatchObject([
      { code: "PACK_CHECK", location: { file: "platform.yaml" } },
    ]);
  });

  it("refuses a files connection without a path", () => {
    const { result } = generate({
      "files.yaml": base["files.yaml"]!.replace(
        "settings: { path: /Volumes/dev/landing/shop/ }\n",
        "",
      ),
    });
    expect(result.diagnostics[0]?.message).toContain('the connection needs "settings.path"');
  });
});
