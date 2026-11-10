// The tables the pack creates beside a masked or filtered table, its changes and quarantine,
// are tagged and covered as the table is (spec section 8.7); and masked classifications that
// differ only in letter case are refused.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { built, script } from "./governed-helpers.js";
import { governanceOf, masked, maskedTables, maskedWith } from "./masked-helpers.js";

const table = (layer: string, name: string) => `TABLE \`dev_sales\`.\`${layer}\`.\`${name}\``;

/** The tables the pack creates beside a table, with the classified columns they copy. */
const companions = [
  { name: "orders_changes", of: "orders" },
  { name: "orders_quarantine", of: "orders" },
  { name: "customers_quarantine", of: "customers" },
];

describe("the tables the pack creates beside a table, with policies on tables", () => {
  const governance = governanceOf(built(maskedTables).out[script]);

  it("makes a table's policies on the tables the pack creates beside it", () => {
    const on = (name: string) =>
      governance?.policies.filter((policy) => policy.on === table("bronze", name));
    for (const { name, of } of companions)
      expect(
        on(name)?.map((policy) => ({ ...policy, on: "" })),
        name,
      ).toEqual(on(of)?.map((policy) => ({ ...policy, on: "" })));
  });
});

describe("the tables the pack creates beside a masked table", () => {
  const golden = (name: string) =>
    readFileSync(join(import.meta.dirname, "golden", name, script), "utf8");
  const tag = (kind: string, name: string, column: string, tags: string) =>
    `ALTER ${kind} \`\${ingestron.catalog}\`.\`bronze\`.\`${name}\` ALTER COLUMN \`${column}\` SET TAGS (${tags})`;

  it("are tagged as their table is, so the policies on the schemas match them", () => {
    const text = golden("masked");
    for (const name of ["orders", "orders_changes", "orders_quarantine"])
      expect(text, name).toContain(
        tag("STREAMING TABLE", name, "card_last4", "'sensitivity' = 'restricted'"),
      );
    for (const name of ["customers", "customers_quarantine"]) {
      expect(text, name).toContain(
        tag("STREAMING TABLE", name, "email", "'pii' = '', 'sensitivity' = 'confidential'"),
      );
      expect(text, name).toContain(
        tag("STREAMING TABLE", name, "country", "'region' = '', 'sensitivity' = 'internal'"),
      );
    }
  });

  it("are places of the table's own policies when the policies are on tables", () => {
    const governance = governanceOf(golden("masked-tables"))!;
    const names = (on: string) =>
      governance.policies
        .filter((policy) => policy.on.endsWith(`\`${on}\``))
        .map((policy) => policy.name);
    expect(names("orders_changes")).toEqual([
      "ingestron_mask_restricted",
      "ingestron_filter_restricted_rows",
    ]);
    expect(names("orders_quarantine")).toEqual(names("orders_changes"));
    expect(names("customers_quarantine")).toEqual([
      "ingestron_mask_confidential",
      "ingestron_mask_internal",
      "ingestron_filter_region_rows",
    ]);
  });

  it("are not tagged with masks and filters off, as before", () => {
    const off = maskedWith("platform.yaml", (text) =>
      text.replace(", masks: true, filters: true", ""),
    );
    expect(built(off).out[script]).not.toMatch(/_changes|_quarantine/);
  });
});

describe("classifications that differ only in letter case", () => {
  it("are refused, since their mask policies would share a name", () => {
    const { model } = built(masked);
    const daily = model.tables.find((item) => item.name === "daily_sales")!;
    daily.access!.masks[0]!.classification = "Restricted";
    expect(databricks.check!(model)).toContain(
      'the masked classifications "restricted" and "Restricted" differ only in letter case, so their policies ingestron_mask_restricted and ingestron_mask_Restricted would clash; write them the same way',
    );
  });
});
