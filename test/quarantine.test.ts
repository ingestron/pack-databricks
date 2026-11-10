// Quarantine tables, in SQL and in PySpark (spec/behaviour.md, section 8.5).
import { describe, expect, it } from "vitest";
import { fold, foldFailures, resolveAll, shop } from "./fold-helpers.js";
import { built, quality, shopWith } from "./quality-helpers.js";

describe("quarantine", () => {
  const dropping =
    "quality: { required: drop, quarantine: true }\nlayers:\n  - { name: bronze, does: [check, quarantine] }\n  - silver\n  - gold\n";

  it("keeps a materialised view's dropped rows apart, with the checks they failed", () => {
    const sql = built(quality)["src/crm/silver/customers_clean.sql"]!;
    const quarantine = sql.slice(sql.indexOf("\n\n-- Rows that"));
    expect(quarantine).toBe(
      [
        "",
        "",
        "-- Rows that a check with the action drop removed from customers_clean, with the checks they failed.",
        "CREATE OR REFRESH MATERIALIZED VIEW `silver`.`customers_clean_quarantine`",
        "COMMENT 'Rows of customers_clean that failed a check that drops rows; _failed_checks names the checks.'",
        "AS SELECT *, filter(array(IF(`id` IS NOT NULL, NULL, 'id_not_null'), IF(`email` IS NOT NULL, NULL, 'email_not_null'), IF(`updated_at` IS NOT NULL, NULL, 'updated_at_not_null')), name -> name IS NOT NULL) AS _failed_checks",
        "FROM (",
        sql.slice(sql.indexOf("AS\nSELECT") + 3, sql.indexOf(" = 1;\n") + 4),
        ") AS checked",
        "WHERE NOT ((`id` IS NOT NULL) AND (`email` IS NOT NULL) AND (`updated_at` IS NOT NULL));",
        "",
      ].join("\n"),
    );
  });

  it("reads the files again for a streaming table that appends", () => {
    const sql = built(shopWith(dropping, ""))["src/shop/bronze/orders.sql"]!;
    expect(sql).toContain(
      "CREATE OR REFRESH STREAMING TABLE `bronze`.`orders_quarantine`\nCOMMENT 'Rows of orders that failed a check that drops rows; _failed_checks names the checks.'\nAS SELECT *, filter(array(IF(`id` IS NOT NULL, NULL, 'id_not_null')), name -> name IS NOT NULL) AS _failed_checks\nFROM (\nSELECT * FROM STREAM read_files(\n",
    );
    expect(sql).toMatch(/\n\) AS checked\nWHERE NOT \(`id` IS NOT NULL\);\n$/);
  });

  it("reads a change-data table's changes", () => {
    const sql = built(shopWith(dropping, "    history: latest\n    sequence: updated_at\n"))[
      "src/shop/bronze/orders.sql"
    ]!;
    expect(sql).toMatch(
      /AS SELECT \*, filter\(array\(IF\(`id` IS NOT NULL, NULL, 'id_not_null'\)\), name -> name IS NOT NULL\) AS _failed_checks\nFROM STREAM\(`bronze`\.`orders_changes`\)\nWHERE NOT \(`id` IS NOT NULL\);\n$/,
    );
  });

  it("adds nothing for a table that drops no rows", () => {
    const sql = built(shopWith("quality: { quarantine: true }\n", ""))[
      "src/shop/bronze/orders.sql"
    ]!;
    expect(sql).not.toContain("_quarantine");
  });
});

describe("a PySpark transform", () => {
  it("cleanses, deduplicates and quarantines in Python, with the same SQL expressions", () => {
    const python = built(quality)["src/crm/silver/orders_clean.py"]!;
    expect(python).toContain("from pyspark.sql.functions import expr as ingestron_expr\n");
    expect(python).toContain(
      [
        "def ingestron_orders_clean_rows():",
        '    """The transform\'s rows, cleansed and deduplicated, before the checks."""',
        "    rows = transform({",
        '        "orders": spark.read.table("bronze.orders"),',
        "    })",
        "    rows = rows.withColumns({",
        '        "status": ingestron_expr("upper(nullif(trim(`status`), \'\'))"),',
        '        "updated_at": ingestron_expr("to_utc_timestamp(`updated_at`, \'Europe/London\')"),',
        "    })",
        "    rows = rows.withColumn(",
        '        "_ingestron_row",',
        '        ingestron_expr("row_number() OVER (PARTITION BY `id` ORDER BY `updated_at` DESC)"),',
        '    ).filter("_ingestron_row = 1").drop("_ingestron_row")',
        "    return rows",
        "",
        "",
        "@dp.materialized_view(",
      ].join("\n"),
    );
    expect(python).toContain(
      "def ingestron_orders_clean():\n    return ingestron_orders_clean_rows()\n",
    );
    expect(python).toContain(
      [
        "@dp.materialized_view(",
        '    name="silver.orders_clean_quarantine",',
        '    comment="Rows of orders_clean that failed a check that drops rows; _failed_checks names the checks.",',
        ")",
        "def ingestron_orders_clean_quarantine():",
        "    return ingestron_orders_clean_rows().withColumn(",
        '        "_failed_checks",',
        "        ingestron_expr(\"filter(array(IF(`id` IS NOT NULL, NULL, 'id_not_null'), IF(`customer_id` IS NOT NULL, NULL, 'customer_id_not_null'), IF(`updated_at` IS NOT NULL, NULL, 'updated_at_not_null')), name -> name IS NOT NULL)\"),",
        '    ).filter("NOT ((`id` IS NOT NULL) AND (`customer_id` IS NOT NULL) AND (`updated_at` IS NOT NULL))")',
        "",
      ].join("\n"),
    );
  });
});

describe("a PySpark transform whose names differ by environment", () => {
  it("names its quarantine table from the configuration, as it names the table", () => {
    const files = shop("  dev: {}\n  prod: {}\n", {
      "standard.yaml": [
        "apiVersion: ingestron.io/v1",
        "kind: Standard",
        "id: acme",
        "packs: [databricks@2]",
        "naming: { schema: '{{ layer }}_{{ environment }}' }",
        "quality: { required: drop, quarantine: true }",
        "layers: [bronze, { name: silver, does: [check, quarantine] }, gold]",
        "",
      ].join("\n"),
      "totals.yaml": [
        "apiVersion: ingestron.io/v1",
        "kind: Transform",
        "id: totals",
        "inputs: [orders]",
        "contract: orders",
        "transform: { uses: pyspark }",
        "code: |",
        "  def transform(tables):",
        '      return tables["orders"]',
        "",
      ].join("\n"),
    });
    const models = resolveAll(files, ["dev", "prod"]);
    const folded = fold(models);
    expect(folded.problems).toEqual([]);
    expect(foldFailures(models)).toEqual([]);
    const python = folded.files["src/shop/silver/totals.py"]!;
    expect(python).toContain('    name=f"{ingestron_schema_silver}.totals_quarantine",\n');
    expect(python).toContain(
      'def ingestron_totals_rows():\n    """The transform\'s rows, cleansed and deduplicated, before the checks."""\n    rows = transform({\n        "orders": spark.read.table(spark.conf.get("ingestron.schema_bronze") + ".orders"),\n',
    );
  });
});
