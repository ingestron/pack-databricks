// Audit and rescued columns that the pack's own reading of files adds.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { fold, foldFailures, resolveAll, retail } from "./fold-helpers.js";

function resolve(files: Record<string, string>) {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment: "dev" });
}

/** The retail project whose standard gives the bronze layer the intent given. */
function retailWithBronze(bronze: string): Record<string, string> {
  return {
    ...retail,
    "standard.yaml": retail["standard.yaml"]!.replace(
      "naming:",
      `layers:\n  - { name: bronze, ${bronze} }\n  - silver\n  - gold\nnaming:`,
    ),
  };
}

function folded(files: Record<string, string>) {
  const models = resolveAll(files, ["dev", "prod"]);
  const result = fold(models);
  expect(result.problems).toEqual([]);
  expect(foldFailures(models)).toEqual([]);
  return result.files;
}

describe("audit columns", () => {
  it("selects the load time and the file after the columns read, and keeps rescued data", () => {
    const files = folded(retailWithBronze("audit: [loaded_at, source_file], rescued: true"));
    const customers = files["src/retail/bronze/customers.sql"]!;
    expect(customers).toContain(
      "AS SELECT *, current_timestamp() AS _loaded_at, _metadata.file_path AS _source_file FROM STREAM read_files(",
    );
    expect(customers).toContain("rescuedDataColumn => '_rescued_data'");
  });

  it("adds them to the changes a change-data table reads", () => {
    const files = folded(retailWithBronze("audit: [source_modified_at]"));
    const orders = files["src/retail/bronze/orders.sql"]!;
    expect(orders).toContain(
      "AS SELECT *, _metadata.file_modification_time AS _source_modified_at FROM STREAM read_files(",
    );
    expect(orders).not.toContain("rescuedDataColumn");
  });

  it("names a column as the standard renames it", () => {
    const files = folded(retailWithBronze("audit: [{ value: loaded_at, as: ingested_at }]"));
    expect(files["src/retail/bronze/customers.sql"]).toContain(
      "current_timestamp() AS ingested_at",
    );
  });

  it("names the rescued column only once when the method's options name it", () => {
    const files = retailWithBronze("rescued: true");
    files["flows/shop.yaml"] = files["flows/shop.yaml"]!.replace(
      "options: { header: true }",
      "options: { header: true, rescuedDataColumn: _bad_rows }",
    );
    const customers = folded(files)["src/retail/bronze/customers.sql"]!;
    expect(customers.match(/rescuedDataColumn/g)).toHaveLength(1);
    expect(customers).toContain("rescuedDataColumn => '_bad_rows'");
  });
});

describe("a materialised view", () => {
  const planned =
    "Planned: audit columns and rescued data are added by streaming tables over files.";

  it("adds no audit column to a table that reads other tables, and says so", () => {
    const both = retailWithBronze("audit: [loaded_at]");
    both["standard.yaml"] = both["standard.yaml"]!.replace(
      "  - silver\n",
      "  - { name: silver, audit: [loaded_at] }\n",
    );
    const files = folded(both);
    expect(files["src/retail/bronze/customers.sql"]).toContain("_loaded_at");
    expect(files["src/retail/silver/daily_sales.sql"]).not.toContain("_loaded_at");
    const applied = resolve(both).diagnostics.filter((item) => item.code === "NOT_APPLIED");
    expect(applied.map((item) => item.message)).toEqual([
      expect.stringContaining(`audit: loaded_at isn't applied on databricks: ${planned}`),
    ]);
  });

  it("adds no audit or rescued column over files either, and says so", () => {
    const view = retailWithBronze("audit: [loaded_at], rescued: true");
    view["flows/shop.yaml"] = view["flows/shop.yaml"]!.replace(
      "source: shop\n",
      "source: shop\nstore: { uses: materialised-view }\n",
    ).replace(/ {4}store:\n {6}with:.*\n/, "");
    const files = folded(view);
    const customers = files["src/retail/bronze/customers.sql"]!;
    expect(customers).toContain("CREATE OR REFRESH MATERIALIZED VIEW");
    expect(customers).not.toContain("_loaded_at");
    expect(customers).not.toContain("rescuedDataColumn");
    const messages = resolve(view)
      .diagnostics.filter((item) => item.code === "NOT_APPLIED")
      .map((item) => item.message);
    expect(messages).toContain(`audit: loaded_at isn't applied on databricks: ${planned}`);
    expect(messages).toContain(`rescued: true isn't applied on databricks: ${planned}`);
  });
});
