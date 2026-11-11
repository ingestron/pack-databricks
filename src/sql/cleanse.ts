// Cleansing, deduplicate and quarantine as Spark SQL text (spec/behaviour.md, section 8.5).
// SQL files and PySpark files write the same expressions.
import type { Column, ColumnCleanse, Expectation, ResolvedTable } from "@ingestron/definitions";
import { conditionOf } from "./conditions.js";
import { quoteName } from "./query.js";
import { sqlString } from "./text.js";

/** The zones that are UTC itself. */
const utc = new Set(["UTC", "Etc/UTC"]);

/** True when the column's type is a timestamp without a time zone. */
function withoutZone(column: Column | undefined): boolean {
  return /^TIMESTAMP_NTZ\b/i.test(column?.type ?? "");
}

/**
 * The column, read as `start`, with each of its cleansing operations applied in the model's
 * order; undefined when the table cleanses nothing in it.
 */
export function cleansedColumn(
  table: ResolvedTable,
  column: Column,
  start: string,
): string | undefined {
  const operations = table.cleanse?.columns[column.name];
  return operations ? cleansed(operations, column, start) : undefined;
}

function cleansed(operations: ColumnCleanse, column: Column, start: string): string {
  const value = (item: unknown) => literalOf(item, column);
  let text = start;
  if (operations.timezone) text = converted(text, operations.timezone, column);
  if (operations.trim) text = `trim(${text})`;
  if (operations.empty) text = `nullif(${text}, '')`;
  if (operations.map) {
    const cases = Object.entries(operations.map).map(
      ([key, to]) => `WHEN ${value(key)} THEN ${value(to)}`,
    );
    text = `CASE ${text} ${cases.join(" ")} ELSE ${text} END`;
  }
  if (operations.case) text = `${operations.case}(${text})`;
  if (operations.default !== undefined) text = `coalesce(${text}, ${value(operations.default)})`;
  return text;
}

/** A timestamp converted from one zone to another. */
function converted(text: string, zone: { from: string; to: string }, column: Column): string {
  if (withoutZone(column))
    return `convert_timezone(${sqlString(zone.from)}, ${sqlString(zone.to)}, ${text})`;
  const inUtc = `to_utc_timestamp(${text}, ${sqlString(zone.from)})`;
  return utc.has(zone.to) ? inUtc : `from_utc_timestamp(${inUtc}, ${sqlString(zone.to)})`;
}

/** A value of a number column: a number, or text that reads as one. */
const numeric = (item: unknown, text: string) =>
  typeof item === "number" || /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)
    ? text
    : sqlString(text);

/** How each logical type writes a value, given the value and its text. */
const writers: Record<string, (item: unknown, text: string, column: Column) => string> = {
  string: (_item, text) => sqlString(text),
  integer: numeric,
  number: numeric,
  boolean: (_item, text) =>
    text === "true" || text === "false" ? text.toUpperCase() : sqlString(text),
  date: (_item, text) => `DATE ${sqlString(text)}`,
  timestamp: (_item, text, column) =>
    `${withoutZone(column) ? "TIMESTAMP_NTZ" : "TIMESTAMP"} ${sqlString(text)}`,
};

/** A value written for the column's logical type; a `map` key, which is text, too. */
function literalOf(item: unknown, column: Column): string {
  if (item === null) return "NULL";
  const text = String(item);
  const type = column.logicalType ?? "";
  const writer = Object.hasOwn(writers, type) ? writers[type] : undefined;
  if (writer) return writer(item, text, column);
  if (typeof item === "number") return text;
  if (typeof item === "boolean") return text.toUpperCase();
  return sqlString(text);
}

/** Each cleansed column of the table, in the contract's order, read as its own name. */
export function cleansedByName(table: ResolvedTable): { name: string; expression: string }[] {
  return table.contract.columns.flatMap((column) => {
    const expression = cleansedColumn(table, column, quoteName(column.name));
    return expression ? [{ name: column.name, expression }] : [];
  });
}

/**
 * The window that numbers each key's rows, the last by `order_by` first; empty when the
 * table does not deduplicate.
 */
export function rowNumber(table: ResolvedTable): string {
  const deduplicate = table.cleanse?.deduplicate;
  if (!deduplicate) return "";
  const keys = table.contract.primaryKey.map(quoteName).join(", ");
  const order = deduplicate.orderBy.map((column) => `${quoteName(column)} DESC`).join(", ");
  return `row_number() OVER (PARTITION BY ${keys} ORDER BY ${order})`;
}

/** `QUALIFY <window> = 1`, or empty when the table does not deduplicate. */
export function qualifyOf(table: ResolvedTable): string {
  const window = rowNumber(table);
  return window ? `QUALIFY ${window} = 1` : "";
}

/**
 * A transform's query, cleansed and deduplicated: wrapped in a `SELECT` that names the
 * contract's columns in its order, each cleansed one as its expression, then the query's
 * other columns; then in one that keeps a row per key. The query as it is when the table
 * has no cleansing.
 */
export function cleansedQuery(table: ResolvedTable, query: string): string {
  if (!table.cleanse) return query;
  if (cleansedByName(table).length === 0) return deduplicated(table, query, "source");
  const names = table.contract.columns.map((column) => quoteName(column.name));
  const selected = table.contract.columns.map((column, at) => {
    const expression = cleansedColumn(table, column, names[at]!);
    return expression === undefined ? names[at]! : `${expression} AS ${names[at]!}`;
  });
  const list = [...selected, `* EXCEPT (${names.join(", ")})`].join(", ");
  const cleansed = `SELECT ${list}\nFROM (\n${query}\n) AS source`;
  return deduplicated(table, cleansed, "cleansed");
}

/**
 * The rows, with one row per key when the table deduplicates: `QUALIFY` in a `SELECT` of
 * its own, so that the window reads the columns as selected, not as they were before.
 */
export function deduplicated(table: ResolvedTable, rows: string, alias: string): string {
  const qualify = qualifyOf(table);
  return qualify ? `SELECT *\nFROM (\n${rows}\n) AS ${alias}\n${qualify}` : rows;
}

/** What a quarantine table adds to the rows it reads: its column, and which rows it keeps. */
export interface FailedChecks {
  /** The column that holds the names of the checks a row failed. */
  column: string;
  /** The array of the names of the failed checks. */
  failed: string;
  /**
   * True for a row that fails any check that drops rows; a check that is null counts as
   * failed, as `failed` names it.
   */
  keep: string;
}

/** The table's checks that drop rows, as a quarantine table reads them; undefined without one. */
export function failedChecks(table: ResolvedTable): FailedChecks | undefined {
  const drops = table.expectations.filter((item: Expectation) => item.action === "drop");
  if (!table.quarantine || drops.length === 0) return undefined;
  const conditions = drops.map(conditionOf);
  const names = drops.map((item, at) => `IF(${conditions[at]}, NULL, ${sqlString(item.name)})`);
  return {
    column: table.quarantine.column,
    failed: `filter(array(${names.join(", ")}), name -> name IS NOT NULL)`,
    keep: `NOT coalesce(${
      conditions.length === 1
        ? conditions[0]
        : conditions.map((condition) => `(${condition})`).join(" AND ")
    }, FALSE)`,
  };
}

/** The quarantine table's comment, as text. */
export function quarantineComment(table: ResolvedTable): string {
  return `Rows of ${table.name} that failed a check that drops rows; ${table.quarantine?.column ?? ""} names the checks.`;
}
