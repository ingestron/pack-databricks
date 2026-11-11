// The whole after-refresh task, run with Python against a stand-in for Spark that records each
// statement: tags and comments, then mask functions, policies and stale-policy drops, then grants
// and exact revokes, then table checks; every policy exempts the identity the task runs as
// (spec section 8.7). Skips, saying why, when python3 is not installed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const missing = python.error || python.status !== 0;

const runner = "7f3c2a10-0000-4000-8000-000000000001";

/**
 * A stand-in for pyspark.sql: session_user() is the runner, SHOW GRANTS gives a stranger's
 * direct SELECT on the table, SHOW POLICIES gives a stale Ingestron policy, and a check's
 * count is zero.
 */
const stub = `
import json, sys, types

class Row(dict):
    def asDict(self):
        return dict(self)
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else dict.get(self, key)

class Result:
    def __init__(self, rows):
        self.rows = rows
    def first(self):
        return self.rows[0]
    def collect(self):
        return self.rows

class Spark:
    statements = []
    def sql(self, statement):
        Spark.statements.append(statement)
        if statement == "SELECT session_user()":
            return Result([Row(user="${runner}")])
        if statement.startswith("SHOW GRANTS ON TABLE "):
            name = statement[len("SHOW GRANTS ON TABLE "):].replace("\`", "")
            return Result([Row(principal="stranger", actionType="SELECT", objectKey=name)])
        if statement.startswith("SHOW POLICIES"):
            return Result([Row(policy_name="ingestron_mask_retired")])
        return Result([Row(counted=0, total=0)])

class Builder:
    def getOrCreate(self):
        return Spark()

class SparkSession:
    builder = Builder()

pyspark = types.ModuleType("pyspark")
pyspark.sql = types.ModuleType("pyspark.sql")
pyspark.sql.SparkSession = SparkSession
sys.modules["pyspark"] = pyspark
sys.modules["pyspark.sql"] = pyspark.sql
sys.argv = ["apply_contract.py", "ingestron.catalog=dev_sales"]
exec(compile(sys.stdin.read(), "apply_contract.py", "exec"), {"__name__": "__main__"})
print(json.dumps(Spark.statements))
`;

/** One check, so the order of the table checks shows too. */
const check = JSON.stringify([
  {
    table: "t",
    name: "rows",
    query: "SELECT 0 AS counted, 0 AS total",
    unit: "rows",
    operator: "mustBe",
    value: 0,
    action: "fail",
  },
]);

/** The statements the golden's task runs, in order. */
function statementsOf(name: string): string[] {
  const path = join(import.meta.dirname, "golden", name, "tasks/retail/apply_contract.py");
  const task = readFileSync(path, "utf8").replace(
    'CHECKS = json.loads(r"""[]""")',
    `CHECKS = json.loads(r"""${check}""")`,
  );
  const run = spawnSync("python3", ["-I", "-c", stub], { input: task, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout) as string[];
}

/** The positions of the statements that start with any of the prefixes. */
function where(statements: string[], ...prefixes: string[]): number[] {
  return statements.flatMap((statement, index) =>
    prefixes.some((prefix) => statement.startsWith(prefix)) ? [index] : [],
  );
}

describe("the whole after-refresh task, in order", () => {
  if (missing) {
    it.skip("is run with Python: skipped, python3 is not installed", () => {});
    return;
  }

  it.each(["masked", "masked-tables"])(
    "makes %s's policies before it grants or revokes anything",
    (name) => {
      const statements = statementsOf(name);
      const tags = where(statements, "ALTER ");
      const functions = where(statements, "CREATE OR REPLACE FUNCTION");
      const policies = where(statements, "CREATE OR REPLACE POLICY");
      const drops = where(statements, "DROP POLICY");
      const grants = where(statements, "GRANT ");
      const revokes = where(statements, "REVOKE ");
      const checks = where(statements, "SELECT 0 AS counted");
      for (const found of [tags, functions, policies, drops, grants, revokes, checks])
        expect(found.length, statements.join("\n")).toBeGreaterThan(0);
      expect(Math.max(...tags)).toBeLessThan(Math.min(...functions));
      expect(Math.max(...functions)).toBeLessThan(Math.min(...policies));
      expect(Math.max(...policies)).toBeLessThan(Math.min(...drops));
      expect(Math.max(...drops)).toBeLessThan(Math.min(...grants));
      expect(Math.min(...grants)).toBeLessThan(Math.min(...revokes));
      expect(Math.max(...grants, ...revokes)).toBeLessThan(Math.min(...checks));
    },
  );

  it.each(["masked", "masked-tables"])(
    "exempts the identity it runs as in every policy of %s",
    (name) => {
      const policies = statementsOf(name).filter((statement) =>
        statement.startsWith("CREATE OR REPLACE POLICY"),
      );
      expect(policies.length).toBeGreaterThan(0);
      for (const statement of policies)
        expect(statement).toMatch(new RegExp(` TO \`account users\` EXCEPT \`${runner}\`[ ,]`));
    },
  );

  it("grants and revokes as before where the task makes no policies", () => {
    const statements = statementsOf("grants");
    expect(where(statements, "CREATE OR REPLACE POLICY", "DROP POLICY")).toEqual([]);
    const grants = where(statements, "GRANT ");
    expect(grants.length).toBeGreaterThan(0);
    expect(Math.min(...grants)).toBeLessThan(Math.min(...where(statements, "REVOKE ")));
  });
});
