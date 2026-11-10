// Grants from the contracts' roles and the layers, made by the after-refresh task, with
// USE_SCHEMA on managed schemas (spec section 8.6).
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { yamlOf } from "./fold-helpers.js";
import { built, governed, grantsOff, script } from "./governed-helpers.js";

/** The task's ACCESS list, read back from its JSON. */
function accessOf(text: string | undefined): unknown {
  const found = /^ACCESS = json\.loads\(r"""([\s\S]*?)"""\)$/m.exec(text ?? "");
  return found ? JSON.parse(found[1]!) : undefined;
}

describe("grants with manage.grants off", () => {
  it("builds the files a project without roles builds, and warns once per role line", () => {
    const { result, out } = built(grantsOff);
    expect(out[script]).not.toContain("ACCESS");
    expect(out[script]).not.toContain("apply_access");
    const noRoles = {
      ...grantsOff,
      "contracts/customers.yaml": governed["contracts/customers.yaml"]!.replace(
        /roles:[\s\S]*$/,
        "",
      ),
      "contracts/orders.yaml": governed["contracts/orders.yaml"]!.replace(/roles:[\s\S]*$/, ""),
    };
    const plain = built(noRoles).out;
    expect(out).toEqual(plain);
    const off = result.diagnostics.filter((item) => item.code === "CAPABILITY_OFF");
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((item) => item.message.includes("Grants off"))).toBe(true);
  });

  it("adds no USE_SCHEMA to the managed schemas", () => {
    const schemas = yamlOf(built(grantsOff).out, "resources/schemas.yml");
    expect(schemas.resources.schemas.bronze.grants).toEqual([
      { principal: "data-engineers", privileges: ["SELECT"] },
    ]);
    expect(schemas.resources.schemas.silver.grants).toBeUndefined();
  });
});

describe("grants with manage.grants on", () => {
  it("lists each table's grants, joined per principal, and exact grants", () => {
    const { out } = built(governed);
    const quoted = (table: string, schema = "bronze") => `\`dev_sales\`.\`${schema}\`.\`${table}\``;
    expect(accessOf(out[script])).toEqual([
      {
        table: quoted("orders"),
        name: "dev_sales.bronze.orders",
        grants: [
          { principal: "marketing-analysts-dev", privileges: ["SELECT"] },
          { principal: "sales-ops", privileges: ["SELECT", "MODIFY"] },
          { principal: "data-engineers", privileges: ["SELECT", "MODIFY"] },
        ],
        exact: true,
      },
      {
        table: quoted("customers"),
        name: "dev_sales.bronze.customers",
        grants: [
          { principal: "marketing-analysts-dev", privileges: ["SELECT"] },
          { principal: "team`s analysts", privileges: ["SELECT"] },
          { principal: "data-engineers", privileges: ["SELECT", "MODIFY"] },
        ],
        exact: true,
      },
      {
        table: quoted("daily_sales", "silver"),
        name: "dev_sales.silver.daily_sales",
        grants: [{ principal: "finance", privileges: ["SELECT"] }],
        exact: true,
      },
      {
        table: quoted("top_customers", "gold"),
        name: "dev_sales.gold.top_customers",
        grants: [],
        exact: true,
      },
    ]);
    expect(out[script]).toContain('KEEP = json.loads(r"""[\n  "data-stewards"\n]""")');
    expect(out[script]).toContain(
      "    for statement in STATEMENTS:\n        spark.sql(with_values(statement))\n    apply_access(spark)\n    failures = []",
    );
  });

  it("grants SELECT alone to a write role on a materialised view, which takes no MODIFY", () => {
    const { result } = built(governed);
    const write = result.diagnostics.filter(
      (item) => item.code === "NOT_APPLIED" && item.subject?.feature === "write",
    );
    expect(write.map((item) => item.message)).toEqual([
      expect.stringContaining('Write access for the role "finance" in table "daily_sales"'),
    ]);
  });

  it("joins a role that both the contract and the layer grant into one grant", () => {
    const files = {
      ...governed,
      "contracts/orders.yaml": governed["contracts/orders.yaml"]!.replace(
        "{ role: sales-ops, access: write }",
        "{ role: data-engineers }",
      ),
    };
    const access = accessOf(built(files).out[script]) as { grants: unknown[] }[];
    expect(access[0]!.grants).toEqual([
      { principal: "marketing-analysts-dev", privileges: ["SELECT"] },
      { principal: "data-engineers", privileges: ["SELECT", "MODIFY"] },
    ]);
  });

  it("leaves out what the model says is not applied", () => {
    const { model } = built(governed);
    const changed: ResolvedModel = structuredClone(model);
    changed.tables[0]!.notApplied = [{ feature: "grants", reason: "Not here." }];
    changed.tables[1]!.notApplied = [{ feature: "exact", reason: "Not here." }];
    const access = accessOf(databricks.build(changed)[script]) as {
      name: string;
      exact: boolean;
    }[];
    expect(access.map((item) => [item.name, item.exact])).toEqual([
      ["dev_sales.bronze.customers", false],
      ["dev_sales.silver.daily_sales", true],
      ["dev_sales.gold.top_customers", true],
    ]);
  });

  it("takes away the direct grants of a table without roles only when grants are exact", () => {
    const additive = {
      ...governed,
      "standard.yaml": governed["standard.yaml"]!.replace("grants: exact", "grants: additive"),
    };
    const access = accessOf(built(additive).out[script]) as { name: string }[];
    expect(access.map((item) => item.name)).not.toContain("dev_sales.gold.top_customers");
    expect(yamlOf(built(governed).out, "resources/schemas.yml").resources.schemas.gold.grants).toBe(
      undefined,
    );
  });

  it("adds USE_SCHEMA for each principal granted in a managed schema", () => {
    const schemas = yamlOf(built(governed).out, "resources/schemas.yml");
    expect(schemas.resources.schemas.bronze.grants).toEqual([
      { principal: "data-engineers", privileges: ["SELECT", "USE_SCHEMA"] },
      { principal: "marketing-analysts-dev", privileges: ["USE_SCHEMA"] },
      { principal: "sales-ops", privileges: ["USE_SCHEMA"] },
      { principal: "team`s analysts", privileges: ["USE_SCHEMA"] },
    ]);
    expect(schemas.resources.schemas.silver.grants).toEqual([
      { principal: "finance", privileges: ["USE_SCHEMA"] },
    ]);
  });

  it("leaves prerequisites.sql as it is without grants", () => {
    expect(built(governed).out["prerequisites/dev.sql"]).toBe(
      built(grantsOff).out["prerequisites/dev.sql"],
    );
  });
});
