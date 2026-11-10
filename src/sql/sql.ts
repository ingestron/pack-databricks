// Renders each table's SQL file from the templates in ../templates.
import type { ResolvedTable } from "@ingestron/definitions";
import { Liquid } from "liquidjs";
import { templatesFolder } from "../folders.js";
import {
  cleansedQuery,
  deduplicated,
  failedChecks,
  qualifyOf,
  quarantineComment,
} from "./cleanse.js";
import { quoteName, renderQuery } from "./query.js";
import { pythonData } from "./python-data.js";
import {
  changeData,
  localName,
  localText,
  sourceData,
  tableData,
  type SourceData,
  type TableData,
} from "./sql-data.js";
import { sqlString } from "./text.js";

const engine = new Liquid({
  root: templatesFolder,
  extname: ".liquid",
  strictVariables: true,
  strictFilters: true,
});

/** Which template renders a table's file, its data, and the file's extension. */
export interface SqlFile {
  template: string;
  data: object;
  extension: "sql" | "py";
}

/** Renders a file chosen by `sqlFile`. */
export function renderSql({ template, data }: SqlFile): string {
  return `${(engine.renderFileSync(template, data) as string).trimEnd()}\n`;
}

/** The after-refresh Python file, with its statements and checks as JSON. */
export function renderApply(data: {
  header: string;
  statements: string[];
  checks: object[];
}): string {
  return renderSql({
    template: "apply-contract.py.liquid",
    data: {
      header: data.header,
      statements: JSON.stringify(data.statements, null, 2),
      checks: JSON.stringify(data.checks, null, 2),
    },
    extension: "py",
  });
}

/**
 * Chooses the template by transform and store method, and builds its data. `catalog`
 * is the pipeline's catalog, whose tables the code names with two parts.
 */
export function sqlFile(table: ResolvedTable, header: string, catalog: string): SqlFile {
  if (table.transform?.method === "pyspark") {
    return {
      template: "materialised-view.py.liquid",
      data: pythonData(table, header, catalog),
      extension: "py",
    };
  }
  const store = table.store?.method;
  if (store === "streaming-table") return streamingTable(table, header, catalog);
  if (store === "materialised-view") return materialisedView(table, header, catalog);
  throw new Error(`No SQL for store method "${String(store)}" (table ${table.name}).`);
}

function streamingTable(table: ResolvedTable, header: string, catalog: string): SqlFile {
  const kind = "STREAMING TABLE";
  const source = sourceData(table, true);
  const data = { header, table: tableData(table, kind, catalog), source };
  if (table.store?.settings.mode === "append") {
    // With quarantine, the files are read once, into a private table both tables read.
    const checked = quoteName(`${table.name}_checked`);
    const quarantine = quarantineData(table, kind, catalog, `STREAM(${checked})`);
    if (quarantine === "")
      return { template: "streaming-table.sql.liquid", data, extension: "sql" };
    return {
      template: "quarantined-streaming-table.sql.liquid",
      data: { ...data, checked, quarantine },
      extension: "sql",
    };
  }
  const cdc = changeData(table, catalog);
  const quarantine = quarantineData(table, kind, catalog, `STREAM(${cdc.changes})`);
  return {
    template: "change-data.sql.liquid",
    data: { ...data, cdc, quarantine },
    extension: "sql",
  };
}

/** The `read_files` select of a table, as the read-files template writes it. */
function readFiles(source: SourceData): string {
  return engine.renderFileSync("read-files", { source }) as string;
}

/** What the quarantine template reads; empty when the table keeps no quarantine table. */
function quarantineData(
  table: ResolvedTable,
  kind: TableData["kind"],
  catalog: string,
  rows: string,
): object | "" {
  const failed = failedChecks(table);
  if (!failed || !table.quarantine) return "";
  return {
    table: table.name,
    kind,
    target: quoteName(localName(table.quarantine.fullName, catalog)),
    comment: sqlString(quarantineComment(table)),
    rows,
    ...failed,
  };
}

function materialisedView(table: ResolvedTable, header: string, catalog: string): SqlFile {
  const inputs = Object.entries(table.transform?.inputs ?? {}).map(
    ([name, full]) => [name, localText(full, catalog)] as const,
  );
  const rendered = table.transform
    ? renderQuery(table.transform.code, Object.fromEntries(inputs))
    : { sql: "" };
  // The sql method's check has already reported SQL that cannot be rendered.
  const code = "sql" in rendered ? rendered.sql : "";
  const source = table.ingest
    ? sourceData(table, false)
    : { stream: false, select: "*", path: "", options: [] };
  const query = code ? cleansedQuery(table, code) : filesQuery(table, source);
  const rows = query || readFiles(source);
  const kind = "MATERIALIZED VIEW";
  return {
    template: "materialised-view.sql.liquid",
    data: {
      header,
      table: tableData(table, kind, catalog),
      source,
      query,
      quarantine: quarantineData(table, kind, catalog, `(\n${rows}\n) AS checked`),
    },
    extension: "sql",
  };
}

/**
 * A materialised view's query over files when it deduplicates: `QUALIFY` after
 * `read_files(…)`, in a `SELECT` of its own when columns are selected under their
 * contract names. Empty when it does not deduplicate, and the template reads the files.
 */
function filesQuery(table: ResolvedTable, source: SourceData): string {
  const qualify = qualifyOf(table);
  if (!qualify) return "";
  const read = readFiles(source);
  return source.select === "*" ? `${read}\n${qualify}` : deduplicated(table, read, "cleansed");
}
