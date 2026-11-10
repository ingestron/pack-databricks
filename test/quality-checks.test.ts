// Checks written from their rules, per-table results and the quality project as a whole
// (spec/behaviour.md, sections 2 and 8.5).
import type { RowRule } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { conditionOf } from "../src/sql/conditions.js";
import { yamlOf } from "./fold-helpers.js";
import { built, modelOf, quality, resolve } from "./quality-helpers.js";

describe("checks written from their rules", () => {
  it("gives every rule kind the text the check has, in the quality project", () => {
    const model = modelOf(quality);
    const ruled = model.tables.flatMap((table) => table.expectations.filter((item) => item.rule));
    expect(new Set(ruled.map((item) => item.rule!.kind))).toEqual(
      new Set(["notNull", "in", "notIn", "pattern", "length", "range", "multipleOf", "items"]),
    );
    for (const item of ruled) expect(conditionOf(item), item.name).toBe(item.check);
  });

  it("reads the rule, not the check text, when an expectation has one", () => {
    const model = modelOf(quality);
    const table = model.tables.find((item) => item.name === "customers_clean")!;
    for (const item of table.expectations) if (item.rule) item.check = "ignored";
    const sql = databricks.build(model)["src/crm/silver/customers_clean.sql"]!;
    expect(sql).not.toContain("ignored");
    expect(sql).toContain(
      "CONSTRAINT `id_not_null` EXPECT (`id` IS NOT NULL) ON VIOLATION DROP ROW,",
    );
    expect(sql).toContain(
      "CONSTRAINT `recent` EXPECT (updated_at >= TIMESTAMP '2000-01-01') ON VIOLATION FAIL UPDATE",
    );
  });

  it("writes each kind and limit, and a value list that does not allow null", () => {
    const rules: [RowRule, string][] = [
      [{ kind: "notNull", column: "a" }, "`a` IS NOT NULL"],
      [
        { kind: "in", column: "a", values: [1, "x'y"], allowNull: false },
        "`a` IS NOT NULL AND `a` IN (1, 'x\\'y')",
      ],
      [
        { kind: "notIn", column: "a", values: ["n/a"], allowNull: true },
        "`a` IS NULL OR `a` NOT IN ('n/a')",
      ],
      [{ kind: "pattern", column: "a", pattern: "^x$" }, "`a` IS NULL OR `a` RLIKE '^x$'"],
      [
        { kind: "length", column: "a", min: 1, max: 9 },
        "`a` IS NULL OR length(`a`) >= 1 AND length(`a`) <= 9",
      ],
      [
        { kind: "range", column: "a", min: "2026-01-01", exclusive: true },
        "`a` IS NULL OR `a` > '2026-01-01'",
      ],
      [{ kind: "range", column: "a", max: 5 }, "`a` IS NULL OR `a` <= 5"],
      [{ kind: "multipleOf", column: "a", value: 0.5 }, "`a` IS NULL OR `a` % 0.5 = 0"],
      [
        { kind: "items", column: "a", min: 1, unique: true },
        "`a` IS NULL OR size(`a`) >= 1 AND size(array_distinct(`a`)) = size(`a`)",
      ],
    ];
    for (const [rule, text] of rules)
      expect(
        conditionOf({ name: "x", check: "ignored", rule, action: "warn", from: "contract" }),
      ).toBe(text);
  });
});

describe("the quality project", () => {
  it("resolves with nothing reported: Databricks applies every rule, action and operation", () => {
    const result = resolve(quality);
    expect(result.diagnostics).toEqual([]);
    const tables = Object.fromEntries(result.model!.tables.map((table) => [table.name, table]));
    expect(tables.orders_clean?.timezone).toBe("UTC");
    expect(tables.customers_clean?.timezone).toBeUndefined();
  });
});

describe("the event log", () => {
  const pipeline = (files: Record<string, string>) =>
    yamlOf(built(files), "resources/crm.pipeline.yml").resources.pipelines.crm;

  it("is published when a table the pipeline builds keeps its results", () => {
    expect(pipeline(quality).event_log).toEqual({
      catalog: "dev",
      schema: "bronze",
      name: "crm_event_log",
    });
  });

  it("is not published when no table keeps its results", () => {
    const files = {
      ...quality,
      "standard.yaml": quality["standard.yaml"]!.replace("    quality: { results: true }\n", ""),
    };
    expect(pipeline(files).event_log).toBeUndefined();
  });
});
