// A table with no contract, whose columns and key come from source metadata, builds as a
// table with a contract does (specification section 12.4).
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { connection } from "./connect-helpers.js";
import { base } from "./pack-helpers.js";

const idColumn =
  "{ name: id, sourceType: int, logicalType: integer, primaryKeyPosition: 1, required: true }";
const totalColumn = "{ name: total, sourceType: decimal, logicalType: number, required: false }";

/** A `SourceMetadata` document of one table. */
function metadata(connectionId: string, object: string, columns: string[]) {
  return [
    "apiVersion: ingestron.io/v1",
    "kind: SourceMetadata",
    `id: ${connectionId}`,
    `connection: ${connectionId}`,
    "tables:",
    `  - object: ${object}`,
    "    captured: { at: 2026-11-12T09:30:00Z, from: catalog, file: source.csv }",
    "    columns:",
    ...columns.map((column) => `      - ${column}`),
    "",
  ].join("\n");
}

const flowOf = (source: string, object: string, extra = "") =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: ${source}\ntables:\n  orders:\n    object: ${object}\n${extra}`;

function generate(files: Record<string, string>) {
  const all = { ...base, ...files };
  delete all["orders.yaml"];
  const result = resolveDefinitions(memoryFiles(all), { packs: [databricks], environment: "dev" });
  return { result, output: result.model ? databricks.build(result.model) : {} };
}

describe("a table with no contract", () => {
  it("passes the metadata's columns to Auto Loader as schema hints", () => {
    const { result, output } = generate({
      "flow.yaml": flowOf("files", "/orders"),
      "files.metadata.yaml": metadata("files", "/orders", [idColumn, totalColumn]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.tables[0]?.contract).toMatchObject({ origin: "metadata" });
    expect(output["src/shop/bronze/orders.sql"]).toContain(
      "schemaHints => '`id` BIGINT, `total` DOUBLE'",
    );
  });

  it("includes the metadata's columns and keys them by its primary key in Lakeflow Connect", () => {
    const { result, output } = generate({
      "erp.yaml": connection("erp", "sqlserver"),
      "flow.yaml": flowOf("erp", "sales.dbo.orders"),
      "erp.metadata.yaml": metadata("erp", "sales.dbo.orders", [idColumn, totalColumn]),
    });
    expect(result.diagnostics).toEqual([]);
    const pipeline = output["resources/shop_erp_ingestion.pipeline.yml"] ?? "";
    expect(pipeline).toContain("include_columns:\n");
    expect(pipeline).toMatch(/- id\n\s+- total/);
    expect(pipeline).toMatch(/primary_keys:\n\s+- id/);
  });

  it("refuses change data when the source metadata has no key", () => {
    const store = "store:\n  with: { mode: upsert, sequence_by: total }\n";
    const flow = flowOf("files", "/orders").replace("tables:", `${store}tables:`);
    const { result } = generate({
      "flow.yaml": flow,
      "files.metadata.yaml": metadata("files", "/orders", [totalColumn]),
    });
    expect(result.diagnostics.map((item) => item.message)).toContain(
      '"streaming-table" for table "orders": mode upsert needs primary key columns in the source metadata.',
    );
  });
});
