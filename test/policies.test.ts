// Masks and row filters as Unity Catalog policies, made by the after-refresh task (spec
// section 8.7): the functions, the policies on schemas or tables, and the places whose
// stale Ingestron policies are dropped.
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { built, script } from "./governed-helpers.js";
import { governanceOf, masked, maskedTables, maskedWith } from "./masked-helpers.js";

const schema = (name: string) => `SCHEMA \`dev_sales\`.\`${name}\``;
const table = (layer: string, name: string) => `TABLE \`dev_sales\`.\`${layer}\`.\`${name}\``;
const tagged = (value: string) => `has_tag_value('sensitivity', '${value}')`;

const nullMask = {
  name: "dev_sales.governance.ingestron_mask_null",
  returns: "NULL::VARIANT",
};
const hashMask = {
  name: "dev_sales.governance.ingestron_mask_hash",
  returns:
    "CASE WHEN schema_of_variant(val) = 'STRING' THEN sha2(try_cast(val AS STRING), 256)::VARIANT ELSE NULL::VARIANT END",
};

/** The policies of the masked project, on the place given for each table. */
function policies(bronze: (name: string) => string, silver: string, gold: string) {
  const mask = (on: string, classification: string, fn: string) => ({
    name: `ingestron_mask_${classification}`,
    on,
    kind: "COLUMN MASK",
    function: fn,
    match: tagged(classification),
  });
  const filter = (on: string, name: string, fn: string, match: string) => ({
    name: `ingestron_filter_${name}`,
    on,
    kind: "ROW FILTER",
    function: fn,
    match,
  });
  const orders = bronze("orders");
  const customers = bronze("customers");
  const ordersMasks = [mask(orders, "restricted", nullMask.name)];
  const ordersFilters = [
    filter(orders, "restricted_rows", "security.filters.restricted_rows", tagged("restricted")),
  ];
  const customersMasks = [
    mask(customers, "confidential", hashMask.name),
    mask(customers, "internal", "dev_sales.governance.mask_internal"),
  ];
  const customersFilters = [
    filter(customers, "region_rows", "dev_sales.governance.region_filter", "has_tag('region')"),
  ];
  const secret = (on: string) => mask(on, "secret", "security.masks.mask_secret");
  const bronzeFirst =
    orders === customers
      ? [...ordersMasks, ...customersMasks, ...ordersFilters, ...customersFilters]
      : [...ordersMasks, ...ordersFilters, ...customersMasks, ...customersFilters];
  return [...bronzeFirst, secret(silver), secret(gold)];
}

/** The project's tables, each followed by the tables the pack creates beside it. */
const tables = [
  table("bronze", "orders"),
  table("bronze", "orders_changes"),
  table("bronze", "orders_quarantine"),
  table("bronze", "customers"),
  table("bronze", "customers_quarantine"),
  table("silver", "daily_sales"),
  table("gold", "top_customers"),
];

/** The tables the pack creates beside a table, with the classified columns they copy. */
const companions = [
  { name: "orders_changes", of: "orders", columns: ["card_last4"] },
  { name: "orders_quarantine", of: "orders", columns: ["card_last4"] },
  { name: "customers_quarantine", of: "customers", columns: ["email", "country"] },
];

describe("masks and row filters on managed schemas", () => {
  const governance = governanceOf(built(masked).out[script]);

  it("creates only the built-in mask functions a table applies, in the functions schema", () => {
    expect(governance?.functions).toEqual([nullMask, hashMask]);
  });

  it("makes one policy per schema for each masked classification, then each filter", () => {
    expect(governance?.policies).toEqual(
      policies(() => schema("bronze"), schema("silver"), schema("gold")),
    );
  });

  it("names a one-part function in governance.functions, and a three-part one as written", () => {
    const functions = governance?.policies.map((policy) => policy.function);
    expect(functions).toContain("dev_sales.governance.mask_internal");
    expect(functions).toContain("dev_sales.governance.region_filter");
    expect(functions).toContain("security.masks.mask_secret");
    expect(functions).toContain("security.filters.restricted_rows");
  });

  it("lists the project's schemas and tables, whose stale policies it drops", () => {
    expect(governance?.places).toEqual([
      {
        on: schema("bronze"),
        policies: [
          "ingestron_mask_restricted",
          "ingestron_mask_confidential",
          "ingestron_mask_internal",
          "ingestron_filter_restricted_rows",
          "ingestron_filter_region_rows",
        ],
      },
      { on: schema("silver"), policies: ["ingestron_mask_secret"] },
      { on: schema("gold"), policies: ["ingestron_mask_secret"] },
      ...tables.map((on) => ({ on, policies: [] })),
    ]);
    expect(governance?.owned).toEqual(["ingestron_mask_", "ingestron_filter_"]);
    expect(governance?.unmasked).toEqual(["data-stewards"]);
  });

  it("runs the functions before the grants, and the policies after them", () => {
    const text = built(masked).out[script] ?? "";
    const main = text.slice(text.indexOf("def main():"));
    const order = [
      "for statement in STATEMENTS:",
      "for statement in function_statements(GOVERNANCE[",
      "apply_access(spark)",
      "apply_policies(spark)",
      "for check in CHECKS:",
    ].map((line) => main.indexOf(line));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("says in the task's header that it grants and applies policies", () => {
    expect(built(masked).out[script]).toContain(
      "# It also grants the tables to the principals of their roles, and with exact\n# grants revokes what they do not give.\n# It also creates the mask functions, masks columns and filters rows with\n# policies, and drops the policies it made that are no longer declared.\n",
    );
  });
});

describe("masks and row filters without managed schemas", () => {
  const governance = governanceOf(built(maskedTables).out[script]);

  it("makes each policy on the tables, which the project owns", () => {
    const companion = new Set(companions.map((item) => table("bronze", item.name)));
    expect(governance?.policies.filter((policy) => !companion.has(policy.on))).toEqual(
      policies(
        (name) => table("bronze", name),
        table("silver", "daily_sales"),
        table("gold", "top_customers"),
      ),
    );
  });

  it("lists only the project's tables as places, never a schema", () => {
    expect(governance?.places.map((place) => place.on)).toEqual(tables);
    expect(governance?.places[0]?.policies).toEqual([
      "ingestron_mask_restricted",
      "ingestron_filter_restricted_rows",
    ]);
  });
});

describe("one switch on", () => {
  it("with masks alone, makes no filter and drops only stale masks", () => {
    const files = maskedWith("platform.yaml", (text) => text.replace(", filters: true", ""));
    const governance = governanceOf(built(files).out[script]);
    expect(governance?.policies.every((policy) => policy.kind === "COLUMN MASK")).toBe(true);
    expect(governance?.owned).toEqual(["ingestron_mask_"]);
  });

  it("with filters alone, creates no mask function and drops only stale filters", () => {
    const files = maskedWith("platform.yaml", (text) => text.replace("masks: true, ", ""));
    const governance = governanceOf(built(files).out[script]);
    expect(governance?.functions).toEqual([]);
    expect(governance?.policies.every((policy) => policy.kind === "ROW FILTER")).toBe(true);
    expect(governance?.owned).toEqual(["ingestron_filter_"]);
  });
});

describe("masks and row filters off", () => {
  const off = maskedWith("platform.yaml", (text) =>
    text.replace(", masks: true, filters: true", ""),
  );

  it("builds the files a project without masks or filters builds", () => {
    const { out } = built(off);
    expect(out[script]).not.toContain("GOVERNANCE");
    expect(out[script]).not.toContain("apply_policies");
    const plain = {
      ...off,
      "standard.yaml": off["standard.yaml"]!.replace(/ {2}masks:[\s\S]*$/, ""),
    };
    expect(out).toEqual(built(plain).out);
  });

  it("leaves the task's header as it was without access", () => {
    const files = maskedWith("platform.yaml", (text) =>
      text.replace(", grants: true, masks: true, filters: true", ""),
    );
    expect(built(files).out[script]).toMatch(/so this task does\.\nimport json\n/);
  });
});

describe("a mask that is not applied", () => {
  it("makes no policy for it, and keeps the masks the table applies", () => {
    const { model } = built(maskedTables);
    const customers = model.tables.find((item) => item.name === "customers")!;
    customers.notApplied = [{ feature: "masks", reason: "Not here.", column: "email" }];
    const governance = governanceOf(databricks.build(model)[script]);
    const names = governance?.policies
      .filter((policy) => policy.on.endsWith("`customers`"))
      .map((policy) => policy.name);
    expect(names).toEqual(["ingestron_mask_internal", "ingestron_filter_region_rows"]);
    expect(governance?.functions.map((item) => item.name)).toEqual([
      "dev_sales.governance.ingestron_mask_null",
    ]);
  });

  it("makes no policy for a table whose filters are not applied", () => {
    const { model } = built(maskedTables);
    const orders = model.tables.find((item) => item.name === "orders")!;
    orders.notApplied = [{ feature: "filters", reason: "Not here." }];
    const governance = governanceOf(databricks.build(model)[script]);
    expect(governance?.policies.map((policy) => policy.name)).not.toContain(
      "ingestron_filter_restricted_rows",
    );
  });
});
