// Renders each table's SQL file from the templates in ../templates.
import type { ResolvedTable } from "@ingestron/definitions";
import { Liquid } from "liquidjs";
import { templatesFolder } from "./folders.js";
import { renderQuery } from "./query.js";
import { pythonData } from "./python-data.js";
import { changeData, localText, sourceData, tableData } from "./sql-data.js";

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
  const data = {
    header,
    table: tableData(table, "STREAMING TABLE", catalog),
    source: sourceData(table, true),
  };
  if (table.store?.settings.mode === "append")
    return { template: "streaming-table.sql.liquid", data, extension: "sql" };
  return {
    template: "change-data.sql.liquid",
    data: { ...data, cdc: changeData(table, catalog) },
    extension: "sql",
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
  const query = "sql" in rendered ? rendered.sql : "";
  const source = table.ingest
    ? sourceData(table, false)
    : { stream: false, select: "*", path: "", options: [] };
  return {
    template: "materialised-view.sql.liquid",
    data: { header, table: tableData(table, "MATERIALIZED VIEW", catalog), source, query },
    extension: "sql",
  };
}
