// Cleansing, time zones and deduplicate in the table's SELECT (spec/behaviour.md, section 8.5).
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { base } from "./pack-helpers.js";
import { asView, built, modelOf, quality, shopWith, withStatus } from "./quality-helpers.js";

describe("cleansing", () => {
  it("wraps a transform's query and cleanses each column in the model's order of operations", () => {
    const sql = built(quality)["src/crm/silver/customers_clean.sql"]!;
    const select = sql.slice(sql.indexOf("FROM (\nSELECT * EXCEPT"), sql.indexOf(") AS source"));
    expect(select).toContain(
      "FROM (\nSELECT * EXCEPT (`email`, `name`, `country`, `status`, `segment`, `phone`, `code`, `score`, `vip`, `signed_up`, `contacted_at`, `last_seen`, `updated_at`), ",
    );
    for (const expression of [
      "lower(nullif(trim(`email`), '')) AS `email`",
      "nullif(`name`, '') AS `name`",
      "upper(CASE nullif(trim(`country`), '') WHEN 'United Kingdom' THEN 'GB' WHEN 'UK' THEN 'GB' WHEN '-' THEN NULL ELSE nullif(trim(`country`), '') END) AS `country`",
      "coalesce(nullif(trim(`status`), ''), 'active') AS `status`",
      "CASE `score` WHEN -1 THEN 0 ELSE `score` END AS `score`",
      "coalesce(`vip`, FALSE) AS `vip`",
      "to_utc_timestamp(`signed_up`, 'Europe/London') AS `signed_up`",
      "from_utc_timestamp(to_utc_timestamp(`contacted_at`, 'UTC'), 'Europe/London') AS `contacted_at`",
      "convert_timezone('Europe/London', 'UTC', `last_seen`) AS `last_seen`",
    ])
      expect(select).toContain(expression);
    expect(sql).toContain("AS\nSELECT *\nFROM (\nSELECT * EXCEPT (");
    expect(sql).toContain(
      "FROM (\nSELECT * FROM `bronze`.`customers`\n) AS source\n) AS cleansed\nQUALIFY row_number() OVER (PARTITION BY `id` ORDER BY `updated_at` DESC) = 1;\n",
    );
  });

  it("leaves bronze, which keeps the files as they come, uncleansed", () => {
    const sql = built(quality)["src/crm/bronze/customers.sql"]!;
    expect(sql).toContain("AS SELECT * FROM STREAM read_files(");
    expect(sql).not.toContain("_quarantine");
  });

  it("cleanses a streaming table in the select list over read_files, renamed columns included", () => {
    const files = shopWith(
      "cleanse:\n  text: { trim: true }\n",
      "    cleanse:\n      columns:\n        note: { empty: null, default: none }\n",
      withStatus,
    );
    const sql = built(files)["src/shop/bronze/orders.sql"]!;
    expect(sql).toContain(
      "AS SELECT * EXCEPT (`state`, `note`), trim(`state`) AS `status`, coalesce(nullif(trim(`note`), ''), 'none') AS `note` FROM STREAM read_files(",
    );
  });

  it("cleanses a change-data table's changes, which AUTO CDC then keeps", () => {
    const files = shopWith(
      "cleanse:\n  text: { trim: true }\n",
      "    history: latest\n    sequence: updated_at\n",
      withStatus,
    );
    const sql = built(files)["src/shop/bronze/orders.sql"]!;
    expect(sql).toContain(
      "CREATE OR REFRESH STREAMING TABLE `bronze`.`orders_changes`\nAS SELECT * EXCEPT (`state`, `note`), trim(`state`) AS `status`, trim(`note`) AS `note` FROM STREAM read_files(",
    );
  });

  it("converts a timestamp in a streaming table from the connection's zone", () => {
    const files = shopWith("cleanse:\n  timestamps: { to: UTC }\n", "");
    files["files.yaml"] = files["files.yaml"]!.replace(
      "connectivity: public\n",
      "connectivity: public\ntimezone: Europe/London\n",
    );
    const model = modelOf(files);
    expect(model.tables[0]!.timezone).toBe("UTC");
    expect(databricks.build(model)["src/shop/bronze/orders.sql"]).toContain(
      "AS SELECT * EXCEPT (`updated_at`), to_utc_timestamp(`updated_at`, 'Europe/London') AS `updated_at` FROM STREAM read_files(",
    );
  });

  it("writes values of other types as the column's type", () => {
    const contract = base["orders.yaml"]!.replace(
      "      - { name: updated_at, logicalType: timestamp }\n",
      "      - { name: updated_at, logicalType: timestamp }\n      - { name: active, logicalType: boolean }\n      - { name: day, logicalType: date }\n      - { name: seen, logicalType: timestamp, physicalType: TIMESTAMP_NTZ }\n      - { name: total, logicalType: number }\n",
    );
    const columns = [
      'active: { map: { "false": true } }',
      'day: { default: "2026-01-01" }',
      'seen: { default: "2026-01-01 00:00:00" }',
      'updated_at: { default: "2026-01-01T00:00:00" }',
      'total: { map: { "1.5": 2 }, default: 0 }',
    ];
    const table = `    cleanse:\n      columns:\n${columns.map((line) => `        ${line}\n`).join("")}`;
    const sql = built(shopWith("", table, contract))["src/shop/bronze/orders.sql"]!;
    for (const expression of [
      "coalesce(`updated_at`, TIMESTAMP '2026-01-01T00:00:00') AS `updated_at`",
      "CASE `active` WHEN FALSE THEN TRUE ELSE `active` END AS `active`",
      "coalesce(`day`, DATE '2026-01-01') AS `day`",
      "coalesce(`seen`, TIMESTAMP_NTZ '2026-01-01 00:00:00') AS `seen`",
      "coalesce(CASE `total` WHEN 1.5 THEN 2 ELSE `total` END, 0) AS `total`",
    ])
      expect(sql).toContain(expression);
  });
});

describe("deduplicate", () => {
  it("keeps the last row per key in a materialised view over files", () => {
    const files = asView(
      shopWith("", "    cleanse:\n      deduplicate: { order_by: [updated_at, id] }\n"),
    );
    const sql = built(files)["src/shop/bronze/orders.sql"]!;
    expect(sql).toContain(
      "  format => 'parquet',\n  schemaHints => '`id` BIGINT, `updated_at` TIMESTAMP',\n  schemaEvolutionMode => 'addNewColumns'\n)\nQUALIFY row_number() OVER (PARTITION BY `id` ORDER BY `updated_at` DESC, `id` DESC) = 1;\n",
    );
  });

  it("keeps a row per key in a select of its own when columns are selected under other names", () => {
    const files = asView(
      shopWith("", "    cleanse:\n      deduplicate: { order_by: [updated_at] }\n", withStatus),
    );
    const sql = built(files)["src/shop/bronze/orders.sql"]!;
    expect(sql).toContain(
      "AS\nSELECT *\nFROM (\nSELECT * EXCEPT (`state`), `state` AS `status` FROM read_files(",
    );
    expect(sql).toContain(
      ")\n) AS cleansed\nQUALIFY row_number() OVER (PARTITION BY `id` ORDER BY `updated_at` DESC) = 1;\n",
    );
  });

  it("wraps a transform's query in a plain select when no column is cleansed", () => {
    const transform = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: latest",
      "inputs: [orders]",
      "contract: orders",
      "cleanse:",
      "  deduplicate: { order_by: [updated_at] }",
      "",
    ].join("\n");
    const sql = built({ ...base, "latest.yaml": transform })["src/shop/silver/latest.sql"]!;
    expect(sql).toContain(
      "AS\nSELECT *\nFROM (\nSELECT * FROM `bronze`.`orders`\n) AS source\nQUALIFY row_number() OVER (PARTITION BY `id` ORDER BY `updated_at` DESC) = 1;\n",
    );
  });
});
