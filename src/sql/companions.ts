// The tables the pack creates beside a table, which hold its columns under the same names
// (spec section 8.7): a change-data table's changes, and the quarantine. Masks and row filters
// cover them too, or their copies would show what the policies hide.
import type { ResolvedTable } from "@ingestron/definitions";
import { failedChecks } from "./cleanse.js";

/** A table the pack creates, as `ALTER` and `ON TABLE` name it. */
export interface Companion {
  kind: "STREAMING TABLE" | "MATERIALIZED VIEW";
  fullName: ResolvedTable["fullName"];
}

/** `STREAMING TABLE` or `MATERIALIZED VIEW`, as `ALTER` names the table. */
export function kindOf(table: ResolvedTable): Companion["kind"] {
  const view = table.store?.method === "materialised-view" || table.transform?.method === "pyspark";
  return view ? "MATERIALIZED VIEW" : "STREAMING TABLE";
}

/**
 * The published tables the pack creates beside the table, as sql.ts writes them: the changes
 * of a streaming table that keeps history, read from the files under the contract's names,
 * and the quarantine, which adds a column to the table's rows. A private table, such as the
 * one a quarantined table reads its files into, is not published, so it is not one.
 */
export function companionsOf(table: ResolvedTable): Companion[] {
  const settings = table.store?.settings ?? {};
  const changes =
    table.transform?.method !== "pyspark" &&
    table.store?.method === "streaming-table" &&
    settings.mode !== "append";
  return [
    ...(changes
      ? [
          {
            kind: "STREAMING TABLE" as const,
            fullName: {
              ...table.fullName,
              table: `${table.fullName.table}${String(settings.changes_suffix)}`,
            },
          },
        ]
      : []),
    ...(failedChecks(table) && table.quarantine
      ? [{ kind: kindOf(table), fullName: table.quarantine.fullName }]
      : []),
  ];
}
