// A table that ends at the landed files is not in Unity Catalog, even when another pack serves
// it and the definitions give it access: the pack grants nothing on it, asks for no grants on
// it and adds no USE_SCHEMA for it (spec section 8.6).
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { yamlOf } from "./fold-helpers.js";
import { built, governed, script } from "./governed-helpers.js";

/**
 * The governed model with `daily_sales` (in silver, granted to `finance`, with exact grants)
 * ending at the files ADF lands and served as a Synapse view, as the definitions resolve such
 * a table: its access kept, judged only on the serve step.
 */
function landedAndServed(): ResolvedModel {
  const changed: ResolvedModel = structuredClone(built(governed).model);
  const table = changed.tables.find((item) => item.name === "daily_sales")!;
  expect(table.access?.grants.length).toBeGreaterThan(0);
  table.access!.exact = true;
  delete table.transform;
  delete table.store;
  table.endsAtFiles = { by: "definition" };
  table.serve = {
    method: "synapse-view",
    pack: "synapse",
    settings: {},
    origins: {},
    chosenBy: { by: "standard-default" },
  };
  return changed;
}

describe("a table that ends at the landed files, served by another pack", () => {
  it("is in no GRANT and no SHOW GRANTS of the after-refresh task", () => {
    const text = databricks.build(landedAndServed())[script] ?? "";
    const found = /^ACCESS = json\.loads\(r"""([\s\S]*?)"""\)$/m.exec(text);
    const names = (JSON.parse(found![1]!) as { name: string }[]).map((item) => item.name);
    expect(names).toContain("dev_sales.bronze.orders");
    expect(names).not.toContain("dev_sales.silver.daily_sales");
  });

  it("adds no USE_SCHEMA for its principals to the managed schema", () => {
    const files = databricks.build(landedAndServed());
    const schemas = yamlOf(files, "resources/schemas.yml").resources.schemas;
    expect(schemas.silver?.grants).toBeUndefined();
    expect(schemas.bronze.grants).toEqual(
      yamlOf(built(governed).out, "resources/schemas.yml").resources.schemas.bronze.grants,
    );
  });

  it("is in no line of the request", () => {
    const sections = databricks.request!(landedAndServed());
    const lines = (title: string) =>
      sections.find((section) => section.title === title)?.lines.join("\n") ?? "";
    expect(lines("Exact grants")).toContain("dev_sales.bronze.orders");
    expect(lines("Exact grants")).not.toContain("daily_sales");
    expect(lines("Must exist before deploying")).toContain("`marketing-analysts-dev`");
    expect(lines("Must exist before deploying")).not.toContain("`finance`");
  });
});
