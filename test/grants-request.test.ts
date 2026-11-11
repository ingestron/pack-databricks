// Tags under the standard's classification tag key, the tag keys Unity Catalog allows, and
// what the request asks for with grants (spec section 8.6).
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { built, governed, grantsOff, resolve, script, withPlatform } from "./governed-helpers.js";

describe("tags under a custom classification key", () => {
  it("sets the classification as that key, once, over a column tag with the key", () => {
    const text = built(governed).out[script] ?? "";
    expect(text).toContain(
      "ALTER STREAMING TABLE `dev_sales`.`bronze`.`customers` ALTER COLUMN `email` SET TAGS ('pii' = '', 'sensitivity' = 'confidential')",
    );
    expect(text).not.toContain("'sensitivity' = 'internal'");
  });

  it("keeps a column tag with the key when the column has no classification", () => {
    const files = {
      ...governed,
      "contracts/customers.yaml": governed["contracts/customers.yaml"]!.replace(
        "        classification: confidential\n",
        "",
      ),
    };
    expect(built(files).out[script]).toContain("SET TAGS ('pii' = '', 'sensitivity' = 'internal')");
  });
});

describe("tag keys", () => {
  const withTag = (tag: string) => ({
    ...governed,
    "contracts/customers.yaml": governed["contracts/customers.yaml"]!.replace(
      "[pii, ",
      `[${JSON.stringify(tag)}, `,
    ),
  });
  const problems = (files: Record<string, string>) =>
    resolve(files)
      .diagnostics.filter((item) => item.severity === "error")
      .map((item) => item.message);

  it("refuses a key that either the tags page or the governed tags page refuses", () => {
    for (const key of [
      "pii-strict",
      "a,b",
      "a.b",
      "a/b",
      "a*b",
      "a<b",
      "a%b",
      "a&b",
      "a?b",
      "a\\b",
      " pii",
      "pii ",
    ])
      expect(problems(withTag(`${key}:x`)).join("\n"), key).toContain(`"${key}:x"`);
  });

  it("allows a key of 256 characters, and refuses one of 257", () => {
    expect(problems(withTag("k".repeat(256)))).toEqual([]);
    expect(problems(withTag("k".repeat(257)))).toHaveLength(1);
  });

  it("refuses a classification tag key Unity Catalog does not allow", () => {
    const files = {
      ...governed,
      "standard.yaml": governed["standard.yaml"]!.replace(
        "tag: sensitivity",
        "tag: data.sensitivity",
      ),
    };
    expect(problems(files).join("\n")).toContain('"data.sensitivity"');
  });
});

describe("the request", () => {
  const lines = (files: Record<string, string>, environment = "dev") => {
    const sections = databricks.request!(built(files, environment).model);
    return Object.fromEntries(sections.map((section) => [section.title, section]));
  };

  it("names each principal, with USE CATALOG, and USE SCHEMA when schemas are not managed", () => {
    const managed = lines(governed)["Must exist before deploying"]!.lines;
    expect(managed).toContain(
      "Principal `marketing-analysts-dev`, which is granted access to tables here, with USE CATALOG on `dev_sales`.",
    );
    const unmanaged = lines(withPlatform((text) => text.replace("schemas: true, ", "")))[
      "Must exist before deploying"
    ]!.lines;
    expect(unmanaged).toContain(
      "Principal `data-engineers`, which is granted access to tables here, with USE CATALOG on `dev_sales` and USE SCHEMA on `dev_sales.bronze`.",
    );
    expect(unmanaged).toContain(
      "Principal `` team`s analysts ``, which is granted access to tables here, with USE CATALOG on `dev_sales` and USE SCHEMA on `dev_sales.bronze`.",
    );
  });

  it("asks an account administrator for the governed tag when masks or filters are on", () => {
    const line =
      "Governed tag `sensitivity`, with the values `public`, `internal` and `confidential`, which an account administrator creates; the run_as identity needs ASSIGN on it.";
    const { model } = built(governed);
    for (const switched of ["masks", "filters"] as const) {
      const changed = structuredClone(model);
      changed.platform.manage[switched] = true;
      const request = databricks.request!(changed);
      expect(request[0]!.lines, switched).toContain(line);
    }
  });

  it("asks for no governed tag with tags alone, which plain tags need no administrator for", () => {
    const request = lines(governed)["Must exist before deploying"]!.lines;
    expect(request.join("\n")).not.toContain("Governed tag");
  });

  it("leaves the request of a project without grants, masks or filters as it was", () => {
    const noRoles = {
      ...grantsOff,
      "contracts/customers.yaml": governed["contracts/customers.yaml"]!.replace(
        /roles:[\s\S]*$/,
        "",
      ),
      "contracts/orders.yaml": governed["contracts/orders.yaml"]!.replace(/roles:[\s\S]*$/, ""),
    };
    const request = databricks.request!(built(noRoles).model);
    expect(request.map((section) => section.title)).toEqual([
      "Must exist before deploying",
      "Schedules",
    ]);
    expect(request[0]!.lines).toEqual([
      "Catalog `dev_sales`, which the deploying identity can use.",
      "Files at `abfss://landing@retaildev.dfs.core.windows.net/shop`, which the pipeline can read.",
      "Serverless compute for pipelines and jobs, turned on in the workspace.",
    ]);
  });

  it("says what exact grants remove and keep, and lists the tables", () => {
    const exact = lines(governed)["Exact grants"]!;
    expect(exact.intro).toBe(
      "Exact grants are on. After each refresh, Ingestron removes every privilege granted directly on these tables to anyone their contracts and layers don't name, and any privilege a role's access doesn't give, such as MODIFY for a role that reads. It keeps ownership, grants on schemas and catalogs, the run_as identity and `data-stewards`. Before turning this on, move any access given by hand into the contracts.",
    );
    expect(exact.lines).toEqual([
      "`dev_sales.bronze.orders`",
      "`dev_sales.bronze.customers`",
      "`dev_sales.silver.daily_sales`",
      "`dev_sales.gold.top_customers`",
    ]);
  });

  it("adds nothing with manage.grants off", () => {
    const request = lines(grantsOff);
    expect(request["Exact grants"]).toBeUndefined();
    expect(request["Must exist before deploying"]!.lines.join("\n")).not.toContain("Principal");
  });
});
