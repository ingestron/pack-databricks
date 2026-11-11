// The after-refresh task's policy functions, run with Python: every policy exempts the
// identity the task runs as, stale Ingestron policies are dropped and nothing else is, and
// names are quoted (spec section 8.7). Skips, saying why, when python3 is not installed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { governanceOf } from "./masked-helpers.js";

const template = (name: string) =>
  readFileSync(join(import.meta.dirname, `../templates/${name}.liquid`), "utf8");

/** The task's quoting and policy functions, with no values to replace. */
const functions = [
  template("quoted"),
  template("governance"),
  "def with_values(text):\n    return text\n",
].join("\n");

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const missing = python.error || python.status !== 0;

/** Calls a function of the task with JSON arguments, and returns its JSON result. */
function call(name: string, ...args: unknown[]): unknown {
  return callWith("", name, ...args);
}

/** Calls a function, with more Python defined beside the task's functions. */
function callWith(more: string, name: string, ...args: unknown[]): unknown {
  const script = [
    functions,
    more,
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

const golden = (name: string, path = "tasks/retail/apply_contract.py") =>
  readFileSync(join(import.meta.dirname, "golden", name, path), "utf8");

const runner = "7f3c2a10-0000-4000-8000-000000000001";
const schema = "SCHEMA `prod_sales`.`bronze`";

describe("the after-refresh task's policy functions", () => {
  if (missing) {
    it.skip("are checked with Python: skipped, python3 is not installed", () => {});
    return;
  }

  it("are valid Python in the generated tasks", () => {
    for (const name of ["masked", "masked-tables"]) {
      const run = spawnSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], {
        input: golden(name),
        encoding: "utf8",
      });
      expect(run.stderr, name).toBe("");
      expect(run.status, name).toBe(0);
    }
  });

  it("exempts run_as in every policy of the goldens, with unmasked empty", () => {
    for (const name of ["masked", "masked-tables"]) {
      const governance = governanceOf(golden(name))!;
      expect(governance.policies.length, name).toBeGreaterThan(0);
      const exempt = call("exempt_principals", runner, []);
      expect(exempt).toEqual([runner]);
      for (const policy of governance.policies) {
        const statement = call("policy_statement", policy, exempt) as string;
        expect(statement, policy.name).toContain(` TO \`account users\` EXCEPT \`${runner}\` `);
      }
    }
  });

  it("makes every golden policy with the identity it runs as in EXCEPT, end to end", () => {
    for (const name of ["masked", "masked-tables"]) {
      const governance = { ...governanceOf(golden(name))!, unmasked: [] };
      const stub = [
        "class Result:",
        "    def __init__(self, rows):",
        "        self.rows = rows",
        "    def first(self):",
        "        return self.rows[0]",
        "    def collect(self):",
        "        return []",
        "class Spark:",
        "    def __init__(self):",
        "        self.statements = []",
        "    def sql(self, statement):",
        "        self.statements.append(statement)",
        `        return Result([["${runner}"]])`,
        "def made(governance):",
        "    global GOVERNANCE",
        "    GOVERNANCE = governance",
        "    spark = Spark()",
        "    apply_policies(spark)",
        "    return spark.statements",
      ].join("\n");
      const statements = callWith(stub, "made", governance) as string[];
      const created = statements.filter((statement) => statement.startsWith("CREATE"));
      expect(created.length, name).toBe(governance.policies.length);
      for (const statement of created)
        expect(statement, name).toContain(` TO \`account users\` EXCEPT \`${runner}\` FOR TABLES `);
      expect(statements[0], name).toBe("SELECT session_user()");
    }
  });

  it("asks for its own identity, and puts it first in EXCEPT", () => {
    const task = golden("masked");
    expect(task).toContain('runner = spark.sql("SELECT session_user()").first()[0]');
    expect(task).not.toContain("current_user");
    expect(task).toContain("exempt = exempt_principals(runner, ");
    expect(
      call("exempt_principals", runner, ["data-stewards", "Data-Stewards", runner.toUpperCase()]),
    ).toEqual([runner, "data-stewards"]);
  });

  it("writes a column mask and a row filter as Unity Catalog policies", () => {
    const exempt = [runner, "data-stewards"];
    const mask = {
      name: "ingestron_mask_confidential",
      on: schema,
      kind: "COLUMN MASK",
      function: "prod_sales.governance.ingestron_mask_hash",
      match: "has_tag_value('sensitivity', 'confidential')",
    };
    expect(call("policy_statement", mask, exempt)).toBe(
      "CREATE OR REPLACE POLICY `ingestron_mask_confidential` ON SCHEMA `prod_sales`.`bronze` COLUMN MASK `prod_sales`.`governance`.`ingestron_mask_hash` TO `account users` EXCEPT `7f3c2a10-0000-4000-8000-000000000001`, `data-stewards` FOR TABLES MATCH COLUMNS has_tag_value('sensitivity', 'confidential') AS c ON COLUMN c",
    );
    const filter = {
      ...mask,
      name: "ingestron_filter_region_rows",
      kind: "ROW FILTER",
      function: "security.filters.region_filter",
      match: "has_tag('region')",
    };
    expect(call("policy_statement", filter, exempt)).toBe(
      "CREATE OR REPLACE POLICY `ingestron_filter_region_rows` ON SCHEMA `prod_sales`.`bronze` ROW FILTER `security`.`filters`.`region_filter` TO `account users` EXCEPT `7f3c2a10-0000-4000-8000-000000000001`, `data-stewards` FOR TABLES MATCH COLUMNS has_tag('region') AS c USING COLUMNS (c)",
    );
  });

  it("quotes policy names, function names and principals, doubling a backtick inside", () => {
    const policy = {
      name: "ingestron_mask_top`secret",
      on: schema,
      kind: "COLUMN MASK",
      function: "prod_sales.gov`ernance.mask",
      match: "has_tag_value('sensitivity', 'top`secret')",
    };
    const statement = call("policy_statement", policy, ["team`s analysts"]) as string;
    expect(statement).toContain("POLICY `ingestron_mask_top``secret` ON");
    expect(statement).toContain("COLUMN MASK `prod_sales`.`gov``ernance`.`mask` TO");
    expect(statement).toContain("EXCEPT `team``s analysts` FOR");
  });

  it("creates each mask function with VARIANT in and out", () => {
    const functions = [
      { name: "prod_sales.governance.ingestron_mask_null", returns: "NULL::VARIANT" },
    ];
    expect(call("function_statements", functions)).toEqual([
      "CREATE OR REPLACE FUNCTION `prod_sales`.`governance`.`ingestron_mask_null`(val VARIANT) RETURNS VARIANT DETERMINISTIC RETURN NULL::VARIANT",
    ]);
  });

  it("drops only Ingestron's policies the place no longer has, of the switches that are on", () => {
    const place = { on: schema, policies: ["ingestron_mask_confidential"] };
    const rows = [
      // Made this run: kept, in any letter case.
      { policy_name: "INGESTRON_MASK_CONFIDENTIAL", policy_type: "COLUMN_MASK" },
      // Ingestron's, no longer made: dropped.
      { policy_name: "ingestron_mask_restricted", policy_type: "COLUMN_MASK" },
      { policy_name: "Ingestron_Mask_Old", policy_type: "COLUMN_MASK" },
      // Another team's: kept.
      { policy_name: "mask_ssn", policy_type: "COLUMN_MASK" },
      { policy_name: "hide_eu_customers", policy_type: "ROW_FILTER" },
      { policy_name: "my_ingestron_mask_x", policy_type: "COLUMN_MASK" },
      // A filter, with filters off: kept.
      { policy_name: "ingestron_filter_region_rows", policy_type: "ROW_FILTER" },
      // A row without the name: kept.
      { name: "ingestron_mask_unknown" },
    ];
    expect(call("stale_drops", rows, place, ["ingestron_mask_"])).toEqual([
      "DROP POLICY `ingestron_mask_restricted` ON SCHEMA `prod_sales`.`bronze`",
      "DROP POLICY `Ingestron_Mask_Old` ON SCHEMA `prod_sales`.`bronze`",
    ]);
    expect(call("stale_drops", rows, place, ["ingestron_mask_", "ingestron_filter_"])).toContain(
      "DROP POLICY `ingestron_filter_region_rows` ON SCHEMA `prod_sales`.`bronze`",
    );
  });

  it("quotes a stale policy's name as SHOW POLICIES gives it", () => {
    const place = { on: schema, policies: [] };
    const rows = [{ policy_name: "ingestron_mask_a`; DROP TABLE x" }];
    expect(call("stale_drops", rows, place, ["ingestron_mask_"])).toEqual([
      "DROP POLICY `ingestron_mask_a``; DROP TABLE x` ON SCHEMA `prod_sales`.`bronze`",
    ]);
  });
});
