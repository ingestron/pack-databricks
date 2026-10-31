// What the contract asks of the tables beyond their definitions: tags, column
// comments and checks over all rows. Lakeflow pipelines cannot do these, so a
// job task applies them after each refresh, for the capabilities turned on.
import type { ResolvedModel, ResolvedTable, TableCheck } from "@ingestron/definitions";
import { quoteName } from "./query.js";
import { sqlString } from "./sql-data.js";

/** A check with the table it runs on and the query that counts its failures. */
export interface CheckRun extends Omit<TableCheck, "arguments" | "query" | "metric" | "columns"> {
  table: string;
  /** Returns one row with `counted` and `total`. */
  query: string;
}

/** The statements and checks to run after the refresh; both empty when nothing is on. */
export function applyContract(model: ResolvedModel): { statements: string[]; checks: CheckRun[] } {
  const { manage } = model.platform;
  return {
    statements: model.tables.flatMap((table) => [
      ...(manage.tags ? tagStatements(table) : []),
      ...(manage.comments ? commentStatements(table) : []),
    ]),
    checks: manage.checks ? model.tables.flatMap(checkRuns) : [],
  };
}

/** `domain:retail` → key `domain`, value `retail`; `sales` → key `sales`, no value. */
export function tagParts(tag: string): [string, string] {
  const at = tag.indexOf(":");
  return at < 0 ? [tag, ""] : [tag.slice(0, at), tag.slice(at + 1)];
}

/** `STREAMING TABLE` or `MATERIALIZED VIEW`, as `ALTER` names the table. */
function kindOf(table: ResolvedTable): string {
  const view = table.store?.method === "materialised-view" || table.transform?.method === "pyspark";
  return view ? "MATERIALIZED VIEW" : "STREAMING TABLE";
}

const nameOf = (table: ResolvedTable) =>
  quoteName(`${table.fullName.catalog}.${table.fullName.schema}.${table.fullName.table}`);

const tagList = (tags: string[]) =>
  tags
    .map(tagParts)
    .map(([key, value]) => `${sqlString(key)} = ${sqlString(value)}`)
    .join(", ");

function tagStatements(table: ResolvedTable): string[] {
  const alter = `ALTER ${kindOf(table)} ${nameOf(table)}`;
  const own =
    table.contract.tags.length > 0 ? [`${alter} SET TAGS (${tagList(table.contract.tags)})`] : [];
  const columns = table.contract.columns.flatMap((column) => {
    const tags = [
      ...(column.tags ?? []),
      ...(column.classification ? [`classification:${column.classification}`] : []),
    ];
    return tags.length > 0
      ? [`${alter} ALTER COLUMN ${quoteName(column.name)} SET TAGS (${tagList(tags)})`]
      : [];
  });
  return [...own, ...columns];
}

function commentStatements(table: ResolvedTable): string[] {
  return table.contract.columns.flatMap((column) =>
    column.description
      ? [
          `COMMENT ON COLUMN ${nameOf(table)}.${quoteName(column.name)} IS ${sqlString(column.description)}`,
        ]
      : [],
  );
}

function checkRuns(table: ResolvedTable): CheckRun[] {
  return table.contract.tableChecks.map((check) => ({
    name: check.name,
    table: table.fullName.table,
    query: countQuery(check, nameOf(table)),
    operator: check.operator,
    value: check.value,
    unit: check.unit,
    action: check.action,
  }));
}

/** A query whose one row has `counted`, the number the rule compares, and `total`, all rows. */
export function countQuery(check: TableCheck, from: string): string {
  if (check.metric === "sql") {
    const query = (check.query ?? "").replaceAll("${object}", from);
    return `SELECT (${query}) AS counted, (SELECT count(*) FROM ${from}) AS total`;
  }
  return `SELECT ${countOf(check)} AS counted, count(*) AS total FROM ${from}`;
}

function countOf(check: TableCheck): string {
  const columns = check.columns.map(quoteName);
  const [column = "*"] = columns;
  switch (check.metric) {
    case "rowCount":
      return "count(*)";
    case "duplicateValues":
      return `count(*) - count(DISTINCT ${columns.length > 0 ? columns.join(", ") : "*"})`;
    case "nullValues":
      return `count_if(${column} IS NULL)`;
    case "missingValues":
      return Array.isArray(check.arguments.missingValues)
        ? `count_if(${column} IS NULL OR ${column} IN (${valuesOf(check.arguments.missingValues)}))`
        : `count_if(${column} IS NULL)`;
    default:
      return `count_if(${column} IS NOT NULL AND NOT ${validOf(check, column)})`;
  }
}

/** For invalidValues: within `validValues`, or matching `pattern`. */
function validOf(check: TableCheck, column: string): string {
  const { validValues, pattern } = check.arguments;
  if (typeof pattern === "string") return `regexp_like(${column}, ${sqlString(pattern)})`;
  return `${column} IN (${valuesOf(validValues)})`;
}

function valuesOf(values: unknown): string {
  const list = Array.isArray(values) && values.length > 0 ? values : [""];
  return list
    .map((value) => (typeof value === "number" ? String(value) : sqlString(String(value))))
    .join(", ");
}
