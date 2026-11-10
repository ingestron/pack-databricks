// The after-refresh task's own access functions, run with Python over synthetic
// SHOW GRANTS rows: which direct grants exact grants revoke, and how principals are
// quoted. Skips, saying why, when python3 is not installed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The task's access functions, as the template writes them into the task. */
const functions = readFileSync(join(import.meta.dirname, "../templates/access.liquid"), "utf8");

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const missing = python.error || python.status !== 0;

/** Calls a function of the task with JSON arguments, and returns its JSON result. */
function call(name: string, ...args: unknown[]): unknown {
  const script = [
    functions,
    "import json, sys",
    `print(json.dumps(${name}(*json.load(sys.stdin))))`,
  ].join("\n");
  const run = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(args),
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}

const table = "`prod_sales`.`bronze`.`customers`";
const name = "prod_sales.bronze.customers";

/** A row of SHOW GRANTS ON TABLE. */
const row = (principal: string, actionType: string, objectType: string, objectKey: string) => ({
  principal,
  actionType,
  objectType,
  objectKey,
});

describe("the after-refresh task's access functions", () => {
  if (missing) {
    it.skip("are checked with Python: skipped, python3 is not installed", () => {});
    return;
  }

  it("are valid Python in the generated task", () => {
    const task = readFileSync(
      join(import.meta.dirname, "golden/governed/tasks/retail/apply_contract.py"),
      "utf8",
    );
    const run = spawnSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], {
      input: task,
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("exact-revokes-only-direct-extras", () => {
    const item = {
      table,
      name,
      grants: [
        { principal: "marketing-analysts", privileges: ["SELECT"] },
        { principal: "sales-ops", privileges: ["SELECT", "MODIFY"] },
      ],
      exact: true,
    };
    const rows = [
      // Inherited from the schema: kept.
      row("auditors", "SELECT", "SCHEMA", "prod_sales.bronze"),
      // The owner: kept.
      row("table-owners", "OWN", "TABLE", name),
      // The run_as identity, in another letter case: kept.
      row("7F3C2A10-0000-4000-8000-000000000001", "MODIFY", "TABLE", name),
      // An unmasked steward: kept.
      row("data-stewards", "SELECT", "TABLE", name),
      // A read role with what its role gives, and MODIFY, which it does not.
      row("marketing-analysts", "SELECT", "TABLE", name),
      row("marketing-analysts", "MODIFY", "TABLE", name),
      // A write role with what its role gives.
      row("Sales-Ops", "SELECT", "TABLE", name),
      row("sales-ops", "MODIFY", "TABLE", name),
      // A principal no role names, granted directly.
      row("someone@example.com", "SELECT", "TABLE", name.toUpperCase()),
      // A denial: kept.
      row("contractors", "DENY SELECT", "TABLE", name),
    ];
    const keep = ["data-stewards", "7f3c2a10-0000-4000-8000-000000000001"];
    expect(call("revokes", rows, item, keep)).toEqual([
      "REVOKE MODIFY ON TABLE `prod_sales`.`bronze`.`customers` FROM `marketing-analysts`",
      "REVOKE SELECT ON TABLE `prod_sales`.`bronze`.`customers` FROM `someone@example.com`",
    ]);
  });

  it("finds the table's own rows by name, with or without backticks, in any letter case", () => {
    const item = { table, name, grants: [], exact: true };
    const rows = [
      row("a", "SELECT", "TABLE", "`prod_sales`.`bronze`.`customers`"),
      row("b", "SELECT", "CATALOG", "prod_sales"),
      row("c", "SELECT", "TABLE", "prod_sales.bronze.orders"),
    ];
    expect(call("revokes", rows, item, [])).toEqual([
      "REVOKE SELECT ON TABLE `prod_sales`.`bronze`.`customers` FROM `a`",
    ]);
  });

  it("revokes ALL PRIVILEGES of a named principal, then grants its privileges again", () => {
    const item = {
      table,
      name,
      grants: [{ principal: "marketing-analysts", privileges: ["SELECT"] }],
      exact: true,
    };
    const rows = [row("marketing-analysts", "ALL_PRIVILEGES", "TABLE", name)];
    expect(call("revokes", rows, item, [])).toEqual([
      "REVOKE ALL PRIVILEGES ON TABLE `prod_sales`.`bronze`.`customers` FROM `marketing-analysts`",
      "GRANT SELECT ON TABLE `prod_sales`.`bronze`.`customers` TO `marketing-analysts`",
    ]);
  });

  it("keeps a row whose action is not a privilege name, and revokes each privilege once", () => {
    const item = { table, name, grants: [], exact: true };
    const rows = [
      row("a", "SELECT; DROP TABLE x", "TABLE", name),
      row("a", "APPLY TAG", "TABLE", name),
      row("a", "APPLY TAG", "TABLE", name),
    ];
    expect(call("revokes", rows, item, [])).toEqual([
      "REVOKE APPLY TAG ON TABLE `prod_sales`.`bronze`.`customers` FROM `a`",
    ]);
  });

  it("quotes every principal in backticks, doubling a backtick inside", () => {
    const item = {
      table,
      name,
      grants: [{ principal: "team`s analysts", privileges: ["SELECT", "MODIFY"] }],
      exact: true,
    };
    expect(call("grant_statements", item)).toEqual([
      "GRANT SELECT, MODIFY ON TABLE `prod_sales`.`bronze`.`customers` TO `team``s analysts`",
    ]);
    const rows = [row("ops`admins", "SELECT", "TABLE", name)];
    expect(call("revokes", rows, item, [])).toEqual([
      "REVOKE SELECT ON TABLE `prod_sales`.`bronze`.`customers` FROM `ops``admins`",
    ]);
  });
});
