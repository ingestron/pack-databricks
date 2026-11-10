// Template data for a PySpark transform's Python file. Python string and
// dict literals are written as JSON, which Python reads the same way.
import type { ResolvedTable } from "@ingestron/definitions";
import { cleansedByName, failedChecks, quarantineComment, rowNumber } from "./cleanse.js";
import { conditionOf } from "./conditions.js";
import { localName, localText } from "./sql-data.js";

const decorators = {
  warn: "expect_all",
  drop: "expect_all_or_drop",
  fail: "expect_all_or_fail",
} as const;

/** What the Python table template reads. */
export interface PythonTableData {
  header: string;
  code: string;
  name: string;
  comment: string;
  cluster: string;
  properties: string;
  expectations: { decorator: string; checks: string; count: number }[];
  wrapper: string;
  function: string;
  inputs: { name: string; table: string }[];
  /** The function that returns the cleansed, deduplicated rows; empty when none is needed. */
  rows: "" | { function: string; columns: { name: string; expression: string }[]; window: string };
  /** The quarantine table's decorator and function; empty without one. */
  quarantine:
    | ""
    | {
        name: string;
        comment: string;
        function: string;
        column: string;
        failed: string;
        keep: string;
      };
}

/** Everything materialised-view.py.liquid needs, in the pipeline whose catalog is `catalog`. */
export function pythonData(table: ResolvedTable, header: string, catalog: string): PythonTableData {
  const store = table.store?.settings ?? {};
  const transform = table.transform!;
  const properties = (store.properties ?? {}) as Record<string, string>;
  return {
    header,
    code: transform.code.trimEnd(),
    name: JSON.stringify(localName(table.fullName, catalog)),
    comment: table.contract.description ? JSON.stringify(table.contract.description) : "",
    cluster: clusterOf(store.cluster_by),
    properties: Object.keys(properties).length > 0 ? pythonDict(Object.entries(properties)) : "",
    expectations: (["warn", "drop", "fail"] as const)
      .map((action) => {
        const checks = table.expectations.filter((item) => item.action === action);
        return {
          decorator: decorators[action],
          checks: pythonDict(checks.map((item) => [item.name, conditionOf(item)])),
          count: checks.length,
        };
      })
      .filter((group) => group.count > 0),
    wrapper: `ingestron_${table.name}`,
    function: String(transform.settings.function),
    inputs: Object.entries(transform.inputs).map(([name, full]) => ({
      name: JSON.stringify(name),
      table: JSON.stringify(localText(full, catalog)),
    })),
    ...rowsAndQuarantine(table, catalog),
  };
}

/** The rows function, when the table cleanses, deduplicates or quarantines, and the quarantine. */
function rowsAndQuarantine(
  table: ResolvedTable,
  catalog: string,
): Pick<PythonTableData, "rows" | "quarantine"> {
  const failed = failedChecks(table);
  if (!table.cleanse && !failed) return { rows: "", quarantine: "" };
  const rows = `ingestron_${table.name}_rows`;
  const window = rowNumber(table);
  return {
    rows: {
      function: rows,
      columns: cleansedByName(table).map(({ name, expression }) => ({
        name: JSON.stringify(name),
        expression: JSON.stringify(expression),
      })),
      window: window ? JSON.stringify(window) : "",
    },
    quarantine:
      failed && table.quarantine
        ? {
            name: JSON.stringify(localName(table.quarantine.fullName, catalog)),
            comment: JSON.stringify(quarantineComment(table)),
            function: `ingestron_${table.name}_quarantine`,
            column: JSON.stringify(failed.column),
            failed: JSON.stringify(failed.failed),
            keep: JSON.stringify(failed.keep),
          }
        : "",
  };
}

function clusterOf(value: unknown): string {
  if (value === "auto") return "cluster_by_auto=True";
  if (Array.isArray(value)) return `cluster_by=${JSON.stringify(value)}`;
  return "";
}

/** `{"a": "b", …}`: a Python dict of strings, written the way Python code usually is. */
function pythonDict(entries: [string, string][]): string {
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")}}`;
}
