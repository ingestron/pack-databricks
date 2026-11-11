// What the contract asks of the tables beyond their definitions: tags, column
// comments and checks over all rows. Lakeflow pipelines cannot do these, so a
// job task applies them after each refresh, for the capabilities turned on.
import {
  classificationTag,
  type ResolvedModel,
  type ResolvedTable,
  type TableCheck,
} from "@ingestron/definitions";
import { companionsOf, kindOf } from "./companions.js";
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
  // With masks or filters, the tables the pack creates beside a table are tagged as it is,
  // so the policies that match the tags cover their copies of its columns too.
  const policies = manage.masks === true || manage.filters === true;
  return {
    statements: model.tables.flatMap((table) => [
      ...(manage.tags ? tagStatements(table, classificationTag(model)) : []),
      ...(manage.tags && policies ? companionTags(table, classificationTag(model)) : []),
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

const fullText = ({ catalog, schema, table }: ResolvedTable["fullName"]) =>
  quoteName(`${catalog}.${schema}.${table}`);

const nameOf = (table: ResolvedTable) => fullText(table.fullName);

const tagList = (tags: string[]) =>
  tags
    .map(tagParts)
    .map(([key, value]) => `${sqlString(key)} = ${sqlString(value)}`)
    .join(", ");

/**
 * The table's and its columns' tags. A column's classification is the tag `key`; a column
 * tag of its own with that key is left out then, so the key is set once.
 */
function tagStatements(table: ResolvedTable, key: string): string[] {
  const alter = `ALTER ${kindOf(table)} ${nameOf(table)}`;
  const own =
    table.contract.tags.length > 0 ? [`${alter} SET TAGS (${tagList(table.contract.tags)})`] : [];
  return [...own, ...columnTags(table, key, alter)];
}

/** The column tags of each table the pack creates beside the table, which has its columns. */
function companionTags(table: ResolvedTable, key: string): string[] {
  return companionsOf(table).flatMap(({ kind, fullName }) =>
    columnTags(table, key, `ALTER ${kind} ${fullText(fullName)}`),
  );
}

/** The `ALTER … ALTER COLUMN … SET TAGS` of each of the contract's tagged columns. */
function columnTags(table: ResolvedTable, key: string, alter: string): string[] {
  return table.contract.columns.flatMap((column) => {
    const classified = column.classification !== undefined && column.classification !== "";
    const tags = [
      ...(column.tags ?? []).filter((tag) => !classified || tagParts(tag)[0] !== key),
      ...(classified ? [`${key}:${column.classification}`] : []),
    ];
    return tags.length > 0
      ? [`${alter} ALTER COLUMN ${quoteName(column.name)} SET TAGS (${tagList(tags)})`]
      : [];
  });
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
