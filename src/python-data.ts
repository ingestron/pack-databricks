// Template data for a PySpark transform's Python file. Python string and
// dict literals are written as JSON, which Python reads the same way.
import { fullNameText, type ResolvedTable } from "@ingestron/definitions";

const decorators = {
  warn: "expect_all",
  drop: "expect_all_or_drop",
  fail: "expect_all_or_fail",
} as const;

/** Everything materialised-view.py.liquid needs. */
export function pythonData(table: ResolvedTable, header: string) {
  const store = table.store?.settings ?? {};
  const transform = table.transform!;
  const properties = (store.properties ?? {}) as Record<string, string>;
  return {
    header,
    code: transform.code.trimEnd(),
    name: JSON.stringify(fullNameText(table.fullName)),
    comment: table.contract.description ? JSON.stringify(table.contract.description) : "",
    cluster: clusterOf(store.cluster_by),
    properties: Object.keys(properties).length > 0 ? pythonDict(Object.entries(properties)) : "",
    expectations: (["warn", "drop", "fail"] as const)
      .map((action) => {
        const checks = table.expectations.filter((item) => item.action === action);
        return {
          decorator: decorators[action],
          checks: pythonDict(checks.map((item) => [item.name, item.check])),
          count: checks.length,
        };
      })
      .filter((group) => group.count > 0),
    wrapper: `ingestron_${table.name}`,
    function: String(transform.settings.function),
    inputs: Object.entries(transform.inputs).map(([name, full]) => ({
      name: JSON.stringify(name),
      table: JSON.stringify(full),
    })),
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
