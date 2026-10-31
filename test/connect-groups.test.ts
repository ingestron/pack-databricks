// Lakeflow Connect: settings one gateway shares, and schemas the bundle manages.
import { describe, expect, it } from "vitest";
import { connection, contract, flow, generate } from "./connect-helpers.js";

const two = (extra = "") => ({
  "erp.yaml": connection("erp", "sqlserver"),
  "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders"),
  "orders.yaml": contract("orders"),
  "refunds.flow.yaml": flow("refunds", "erp", "refunds", "sales.dbo.refunds", extra),
  "refunds.yaml": contract("refunds"),
});

describe("one gateway per connection", () => {
  it("refuses tables that would need a different gateway policy or staging schema", () => {
    const { result } = generate(two("    ingest:\n      with: { gateway_policy_id: ABC123 }\n"));
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "the tables of connection erp share one gateway, so gateway_policy_id and staging_schema must be the same; refunds differs from orders.",
    ]);
  });

  it("accepts the same values on every table", () => {
    expect(generate(two()).result.diagnostics).toEqual([]);
  });
});

describe("schemas the bundle manages", () => {
  it("refers to them from the Lakeflow pipelines, so the bundle creates them first", () => {
    const platform =
      "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: { schemas: true }\n";
    const { yaml } = generate({ ...two(), "platform.yaml": platform });
    const schema = "${resources.schemas.dev_bronze.name}";
    const gateway = yaml("resources/shop_erp_gateway.pipeline.yml").resources.pipelines
      .shop_erp_gateway;
    expect(gateway.schema).toBe(schema);
    expect(gateway.gateway_definition.gateway_storage_schema).toBe(schema);
    const ingestion = yaml("resources/shop_erp_ingestion.pipeline.yml").resources.pipelines
      .shop_erp_ingestion;
    expect(ingestion.schema).toBe(schema);
    expect(ingestion.ingestion_definition.objects[0].table.destination_schema).toBe(schema);
  });
});
