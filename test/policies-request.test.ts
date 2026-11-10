// What masks and row filters need once of an administrator, in prerequisites.sql, and what
// the request asks for (spec section 8.7).
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { built, governed } from "./governed-helpers.js";
import { masked, maskedTables, maskedWith } from "./masked-helpers.js";

const runAs = "`7f3c2a10-0000-4000-8000-000000000001`";

/** The lines of an environment's prerequisites.sql. */
const prerequisites = (files: Record<string, string>, environment = "dev") =>
  (built(files, environment).out[`prerequisites/${environment}.sql`] ?? "").split("\n");

describe("prerequisites.sql with masks and row filters", () => {
  it("gives run_as the functions schema, the team's functions and the managed schemas", () => {
    const lines = prerequisites(masked).filter((line) => line.startsWith("GRANT"));
    expect(lines).toEqual([
      `GRANT USE CATALOG, CREATE SCHEMA ON CATALOG \`dev_sales\` TO ${runAs};`,
      `GRANT USE CATALOG ON CATALOG \`dev_sales\` TO ${runAs};`,
      `GRANT USE CATALOG ON CATALOG \`security\` TO ${runAs};`,
      `GRANT USE SCHEMA, CREATE FUNCTION ON SCHEMA \`dev_sales\`.\`governance\` TO ${runAs};`,
      `GRANT USE SCHEMA ON SCHEMA \`security\`.\`filters\` TO ${runAs};`,
      `GRANT USE SCHEMA ON SCHEMA \`security\`.\`masks\` TO ${runAs};`,
      `GRANT EXECUTE ON FUNCTION \`security\`.\`filters\`.\`restricted_rows\` TO ${runAs};`,
      `GRANT EXECUTE ON FUNCTION \`dev_sales\`.\`governance\`.\`mask_internal\` TO ${runAs};`,
      `GRANT EXECUTE ON FUNCTION \`dev_sales\`.\`governance\`.\`region_filter\` TO ${runAs};`,
      `GRANT EXECUTE ON FUNCTION \`security\`.\`masks\`.\`mask_secret\` TO ${runAs};`,
      `GRANT MANAGE ON SCHEMA \`dev_sales\`.\`bronze\` TO ${runAs};`,
      `GRANT MANAGE ON SCHEMA \`dev_sales\`.\`silver\` TO ${runAs};`,
      `GRANT MANAGE ON SCHEMA \`dev_sales\`.\`gold\` TO ${runAs};`,
    ]);
  });

  it("says why MANAGE on the schemas waits for the first deployment", () => {
    expect(prerequisites(masked)).toContain(
      "-- The bundle creates these schemas: run the lines below after the first deployment, unless run_as deploys and so owns them.",
    );
  });

  it("uses each environment's functions schema", () => {
    expect(prerequisites(masked, "prod")).toContain(
      `GRANT USE SCHEMA, CREATE FUNCTION ON SCHEMA \`prod_sales\`.\`governance\` TO ${runAs};`,
    );
  });

  it("asks for no MANAGE when the policies are on the project's own tables", () => {
    const lines = prerequisites(maskedTables);
    expect(lines.join("\n")).not.toContain("MANAGE ON SCHEMA");
    expect(lines).toContain(
      `GRANT USE SCHEMA, CREATE FUNCTION ON SCHEMA \`dev_sales\`.\`governance\` TO ${runAs};`,
    );
  });

  it("lists what masks and filters need", () => {
    const lines = prerequisites(masked);
    expect(lines).toContain("-- Column masks needs:");
    expect(lines).toContain("-- Row filters needs:");
  });

  it("quotes a run_as with dots in it as one name", () => {
    const files = maskedWith("platform.yaml", (text) =>
      text.replace(
        "service_principal_name: 7f3c2a10-0000-4000-8000-000000000001",
        "user_name: first.last@example.com",
      ),
    );
    expect(prerequisites(files)).toContain(
      "GRANT MANAGE ON SCHEMA `dev_sales`.`bronze` TO `first.last@example.com`;",
    );
  });

  it("leaves prerequisites.sql as it was without masks or filters", () => {
    const off = maskedWith("platform.yaml", (text) =>
      text.replace(", masks: true, filters: true", ""),
    );
    expect(prerequisites(off)).toEqual(prerequisites(governed));
  });
});

describe("the request with masks and row filters", () => {
  const must = (files: Record<string, string>) =>
    databricks.request!(built(files).model).find(
      (section) => section.title === "Must exist before deploying",
    )!.lines;

  it("asks for the functions schema, the team's functions, readers' compute and the tag", () => {
    const lines = must(masked);
    const added = lines.slice(
      lines.indexOf(
        "Schema `dev_sales.governance`, in which the run_as identity creates the mask functions.",
      ),
    );
    expect(added).toEqual([
      "Schema `dev_sales.governance`, in which the run_as identity creates the mask functions.",
      "Function `security.filters.restricted_rows`, which a mask or row filter uses; the run_as identity needs EXECUTE on it.",
      "Function `dev_sales.governance.mask_internal`, which a mask or row filter uses; the run_as identity needs EXECUTE on it.",
      "Function `dev_sales.governance.region_filter`, which a mask or row filter uses; the run_as identity needs EXECUTE on it.",
      "Function `security.masks.mask_secret`, which a mask or row filter uses; the run_as identity needs EXECUTE on it.",
      "Serverless compute, or Databricks Runtime 16.4 or later, for everyone who reads the masked or filtered tables: older runtimes cannot read a table with a policy.",
      "Governed tag `sensitivity`, with the values `public`, `internal`, `confidential`, `restricted` and `secret`, which an account administrator creates; the run_as identity needs ASSIGN on it.",
    ]);
  });

  it("asks for no functions schema when no built-in mask is applied", () => {
    const files = maskedWith("standard.yaml", (text) =>
      text.replace("    confidential: hash\n    restricted: null\n", ""),
    );
    expect(must(files).join("\n")).not.toContain("Schema `dev_sales.governance`");
  });
});

describe("the exact grants section", () => {
  it("writes a table name with a backtick as Markdown code", () => {
    const { model } = built(governed);
    model.tables[0]!.fullName.table = "odd`orders";
    const exact = databricks.request!(model).find((section) => section.title === "Exact grants")!;
    expect(exact.lines[0]).toBe("`` dev_sales.bronze.odd`orders ``");
  });
});
