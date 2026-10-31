// Renders each table's SQL file from the templates in ../templates.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedTable } from "@ingestron/definitions";
import { Liquid } from "liquidjs";
import { renderQuery } from "./query.js";
import { pythonData } from "./python-data.js";
import { changeData, sourceData, tableData } from "./sql-data.js";

/** The templates folder, also used by the template parity check. */
export const templatesFolder = join(dirname(fileURLToPath(import.meta.url)), "../templates/");

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

/** The SQL or Python file for one table; `header` is its first comment line. */
export function tableSql(table: ResolvedTable, header: string): string {
  return renderSql(sqlFile(table, header));
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

/** Chooses the template by transform and store method, and builds its data. */
export function sqlFile(table: ResolvedTable, header: string): SqlFile {
  if (table.transform?.method === "pyspark") {
    return {
      template: "materialised-view.py.liquid",
      data: pythonData(table, header),
      extension: "py",
    };
  }
  const store = table.store?.method;
  if (store === "streaming-table") return streamingTable(table, header);
  if (store === "materialised-view") return materialisedView(table, header);
  throw new Error(`No SQL for store method "${String(store)}" (table ${table.name}).`);
}

function streamingTable(table: ResolvedTable, header: string): SqlFile {
  const data = {
    header,
    table: tableData(table, "STREAMING TABLE"),
    source: sourceData(table, true),
  };
  if (table.store?.settings.mode === "append")
    return { template: "streaming-table.sql.liquid", data, extension: "sql" };
  return {
    template: "change-data.sql.liquid",
    data: { ...data, cdc: changeData(table) },
    extension: "sql",
  };
}

function materialisedView(table: ResolvedTable, header: string): SqlFile {
  const rendered = table.transform
    ? renderQuery(table.transform.code, table.transform.inputs)
    : { sql: "" };
  // The sql method's check has already reported SQL that cannot be rendered.
  const query = "sql" in rendered ? rendered.sql : "";
  const source = table.ingest
    ? sourceData(table, false)
    : { stream: false, select: "*", path: "", options: [] };
  return {
    template: "materialised-view.sql.liquid",
    data: { header, table: tableData(table, "MATERIALIZED VIEW"), source, query },
    extension: "sql",
  };
}
