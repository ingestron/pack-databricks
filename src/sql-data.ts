// Template data for a table's SQL file. All quoting happens here, so the
// templates only arrange text. Key names avoid Liquid keywords (such as
// `required` or `with`) because python-liquid refuses them after a dot.
import type { Column, FullName, ResolvedTable } from "@ingestron/definitions";
import { quoteName } from "./query.js";

/** The table definition shared by every SQL file. */
export interface TableData {
  kind: "STREAMING TABLE" | "MATERIALIZED VIEW";
  target: string;
  constraints: { name: string; check: string; on_violation: string }[];
  comment: string;
  cluster: string;
  properties: { key: string; value: string }[];
}

/** A `read_files` call. */
export interface SourceData {
  stream: boolean;
  /** The select list: `*`, or with source columns renamed to their contract names. */
  select: string;
  path: string;
  options: { key: string; value: string }[];
}

const onViolation = { warn: "", drop: " ON VIOLATION DROP ROW", fail: " ON VIOLATION FAIL UPDATE" };

/** A SQL string literal. */
export function sqlString(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/**
 * A table's name in a pipeline's code: `schema.table` when the pipeline's own
 * catalog holds it, as the pipeline reads names in its catalog; else all three parts.
 */
export function localName(name: FullName, catalog: string): string {
  return name.catalog === catalog
    ? `${name.schema}.${name.table}`
    : `${name.catalog}.${name.schema}.${name.table}`;
}

/** A full name written `catalog.schema.table`, as transform inputs are, in a pipeline's code. */
export function localText(fullName: string, catalog: string): string {
  return fullName.startsWith(`${catalog}.`) ? fullName.slice(catalog.length + 1) : fullName;
}

/** The definition of the table itself, in the pipeline whose catalog is `catalog`. */
export function tableData(
  table: ResolvedTable,
  kind: TableData["kind"],
  catalog: string,
): TableData {
  const settings = table.store?.settings ?? {};
  return {
    kind,
    target: quoteName(localName(table.fullName, catalog)),
    constraints: table.expectations.map((item) => ({
      name: quoteName(item.name),
      check: item.check,
      on_violation: onViolation[item.action],
    })),
    comment: table.contract.description ? sqlString(table.contract.description) : "",
    cluster: clusterOf(settings.cluster_by),
    properties: Object.entries((settings.properties ?? {}) as Record<string, string>).map(
      ([key, value]) => ({ key: sqlString(key), value: sqlString(value) }),
    ),
  };
}

function clusterOf(value: unknown): string {
  if (value === "auto") return "AUTO";
  if (Array.isArray(value))
    return `(${value.map((column) => quoteName(String(column))).join(", ")})`;
  return "";
}

/** The `read_files` call for a flow table's files. */
export function sourceData(table: ResolvedTable, stream: boolean): SourceData {
  return {
    stream,
    select: selectOf(table),
    path: sqlString(pathOf(table)),
    options: optionsOf(table),
  };
}

/** The columns read under another name at the source, unless the ingest step renamed them. */
function renamedColumns(table: ResolvedTable) {
  if (table.ingest?.renamed) return [];
  return table.contract.columns.filter(
    (column) => column.physicalName && column.physicalName !== column.name,
  );
}

/**
 * Timestamps the landed files carry beyond the contract (such as ADF's audit
 * columns), which the step that adds them writes as ISO 8601 text.
 */
function textTimestamps(table: ResolvedTable): string[] {
  const extra = (table.ingest?.output as { columns?: Column[] } | undefined)?.columns ?? [];
  return extra.filter((column) => column.logicalType === "timestamp").map((column) => column.name);
}

/**
 * `*`, or `* EXCEPT (<source names>), <source> AS <name>, …` for renamed
 * columns, and `CAST(<name> AS TIMESTAMP) AS <name>` for timestamps written as text.
 */
function selectOf(table: ResolvedTable): string {
  const renamed = renamedColumns(table);
  const timestamps = textTimestamps(table);
  if (renamed.length === 0 && timestamps.length === 0) return "*";
  const sources = [
    ...renamed.map((column) => quoteName(column.physicalName!)),
    ...timestamps.map(quoteName),
  ];
  const aliases = [
    ...renamed.map((column) => `${quoteName(column.physicalName!)} AS ${quoteName(column.name)}`),
    ...timestamps.map((name) => `CAST(${quoteName(name)} AS TIMESTAMP) AS ${quoteName(name)}`),
  ];
  return `* EXCEPT (${sources.join(", ")}), ${aliases.join(", ")}`;
}

/** The connection's `path` joined with the table's object. */
function pathOf(table: ResolvedTable): string {
  // Files copied by another pack (such as adf-copy) are read where it lands them.
  const ingest = table.ingest;
  const folder = ingest?.settings.landing ?? ingest?.connection.settings.path ?? "";
  const base = String(folder).replace(/\/+$/, "");
  const object = (table.ingest?.object ?? "").replace(/^\/+/, "");
  return `${base}/${object}`;
}

/** Format, schema hints from the contract, schema evolution, then the user's own options. */
function optionsOf(table: ResolvedTable): SourceData["options"] {
  const settings = table.ingest?.settings ?? {};
  const options: SourceData["options"] = [
    { key: "format", value: sqlString(String(settings.format)) },
  ];
  // Hints name the columns as the files have them.
  const source = new Set(renamedColumns(table));
  const hints = table.contract.columns
    .filter((column) => column.type)
    .map((column) => {
      const name = source.has(column) ? column.physicalName! : column.name;
      return `${quoteName(name)} ${column.type}`;
    });
  if (settings.schema_hints === true && hints.length > 0)
    options.push({ key: "schemaHints", value: sqlString(hints.join(", ")) });
  if (settings.schema_evolution)
    options.push({
      key: "schemaEvolutionMode",
      value: sqlString(String(settings.schema_evolution)),
    });
  for (const [key, value] of Object.entries((settings.options ?? {}) as Record<string, unknown>)) {
    options.push({ key, value: typeof value === "string" ? sqlString(value) : String(value) });
  }
  return options;
}

/** The AUTO CDC parts of a change-data table, in the pipeline whose catalog is `catalog`. */
export function changeData(table: ResolvedTable, catalog: string) {
  const settings = table.store?.settings ?? {};
  const changes = {
    ...table.fullName,
    table: `${table.fullName.table}${String(settings.changes_suffix)}`,
  };
  const except = (settings.except_columns ?? []) as string[];
  return {
    changes: quoteName(localName(changes, catalog)),
    flow: quoteName(`${table.fullName.table}_cdc`),
    keys: table.contract.primaryKey.map(quoteName).join(", "),
    sequence: quoteName(String(settings.sequence_by)),
    delete_when: typeof settings.delete_when === "string" ? settings.delete_when : "",
    except_columns: except.map(quoteName).join(", "),
    scd: settings.mode === "history" ? 2 : 1,
  };
}
