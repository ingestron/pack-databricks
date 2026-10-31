// Lakeflow Connect: SQL Server through an ingestion gateway.
import { describe, expect, it } from "vitest";
import { connection, contract, flow, generate } from "./connect-helpers.js";

const sqlServer = {
  "erp.yaml": connection("erp", "sqlserver"),
  "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders"),
  "orders.yaml": contract("orders"),
};

describe("SQL Server through an ingestion gateway", () => {
  it("chooses lakeflow-connect for the connector and writes the table without a store step", () => {
    const table = generate(sqlServer).result.model?.tables[0];
    expect(table?.ingest?.method).toBe("lakeflow-connect");
    expect(table?.store).toBeUndefined();
  });

  it("generates a continuous gateway and an ingestion pipeline that uses it", () => {
    const { yaml, output } = generate(sqlServer);
    expect(Object.keys(output).sort()).toEqual([
      "databricks.yml",
      "resources/shop_erp_gateway.pipeline.yml",
      "resources/shop_erp_ingestion.pipeline.yml",
    ]);
    expect(
      yaml("resources/shop_erp_gateway.pipeline.yml").resources.pipelines.shop_erp_gateway,
    ).toEqual({
      name: "shop_erp_gateway",
      catalog: "dev",
      schema: "bronze",
      continuous: true,
      gateway_definition: {
        connection_name: "erp_conn",
        gateway_storage_catalog: "dev",
        gateway_storage_schema: "bronze",
      },
    });
    expect(
      yaml("resources/shop_erp_ingestion.pipeline.yml").resources.pipelines.shop_erp_ingestion,
    ).toEqual({
      name: "shop_erp_ingestion",
      catalog: "dev",
      schema: "bronze",
      serverless: true,
      ingestion_definition: {
        ingestion_gateway_id: "${resources.pipelines.shop_erp_gateway.id}",
        objects: [
          {
            table: {
              source_catalog: "sales",
              source_schema: "dbo",
              source_table: "orders",
              destination_catalog: "dev",
              destination_schema: "bronze",
              destination_table: "orders",
              table_configuration: {
                scd_type: "SCD_TYPE_1",
                include_columns: ["id", "total"],
                primary_keys: ["id"],
              },
            },
          },
        ],
      },
    });
  });

  it("keeps history, takes all columns, and uses a cluster policy when asked", () => {
    const extra =
      "    ingest:\n      with: { mode: history, columns: all, gateway_policy_id: ABC123 }\n";
    const { yaml } = generate({
      ...sqlServer,
      "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders", extra),
    });
    const ingestion = yaml("resources/shop_erp_ingestion.pipeline.yml").resources.pipelines
      .shop_erp_ingestion;
    expect(ingestion.ingestion_definition.objects[0].table.table_configuration).toEqual({
      scd_type: "SCD_TYPE_2",
      primary_keys: ["id"],
    });
    const gateway = yaml("resources/shop_erp_gateway.pipeline.yml").resources.pipelines
      .shop_erp_gateway;
    expect(gateway.clusters).toEqual([
      { label: "default", policy_id: "ABC123", apply_policy_default_values: true },
    ]);
  });

  it("refuses an object that is not database.schema.table and a missing connection", () => {
    const files = {
      ...sqlServer,
      "erp.yaml": connection("erp", "sqlserver").replace(
        "settings: { uc_connection: erp_conn }\n",
        "",
      ),
      "orders.flow.yaml": flow("erp", "erp", "orders", "dbo.orders"),
    };
    expect(generate(files).result.diagnostics.map((item) => item.message)).toEqual([
      '"lakeflow-connect" for table "orders": the connection needs "settings.uc_connection", the name of a Unity Catalog connection.',
      '"lakeflow-connect" for table "orders": a sqlserver object is written database.schema.table, not "dbo.orders".',
    ]);
  });

  it("does not use Lakeflow Connect for a source the workspace cannot reach", () => {
    const { result } = generate({
      ...sqlServer,
      "erp.yaml": connection("erp", "sqlserver", "private"),
    });
    expect(result.diagnostics).toMatchObject([
      {
        code: "CONNECTOR_NOT_SUPPORTED",
        hint: expect.stringContaining("lakeflow-connect (public, workspace)"),
      },
    ]);
  });

  it("refuses checks written in the definitions, which managed ingestion cannot run", () => {
    const extra = "    expectations:\n      - { name: positive, check: total > 0 }\n";
    const { result } = generate({
      ...sqlServer,
      "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders", extra),
    });
    expect(result.diagnostics[0]?.message).toContain(
      "managed ingestion cannot run expectations (positive)",
    );
  });

  it("refuses physicalName, because Lakeflow Connect keeps the source's column names", () => {
    const renamed = contract("orders").replace(
      "{ name: total, logicalType: number }",
      "{ name: total, logicalType: number, physicalName: amt }",
    );
    const { result } = generate({ ...sqlServer, "orders.yaml": renamed });
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      '"lakeflow-connect" for table "orders": Lakeflow Connect keeps the source\'s column names, so it cannot read "amt" as "total"; remove physicalName, or rename the column in a transform.',
    );
  });
});
