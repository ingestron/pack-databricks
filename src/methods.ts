// The Databricks methods: what each reads and produces, its smart defaults,
// its settings schema, and checks that need the whole table.
import type { Method, ResolvedTable } from "@ingestron/definitions";
import { renderQuery } from "./query.js";

const clusterBy = {
  description: "How the table is clustered: auto, none, or a list of columns.",
  anyOf: [
    {
      enum: ["auto", "none"],
      enumDescriptions: ["Databricks chooses the clustering columns.", "No clustering."],
    },
    { type: "array", minItems: 1, items: { type: "string" } },
  ],
  examples: [["customer_id", "ordered_at"]],
};
const properties = {
  type: "object",
  description: "Table properties (TBLPROPERTIES).",
  additionalProperties: { type: "string" },
};

/** Reads files where they already are, with Auto Loader (`read_files`). */
export const files: Method = {
  action: "ingest",
  description: "Reads files in cloud storage or a volume with Auto Loader.",
  connectors: ["files"],
  connectivity: ["public", "workspace"],
  produces: "files",
  defaults: {
    format: "parquet",
    schema_evolution: "addNewColumns",
    schema_hints: true,
    options: {},
  },
  settings: {
    type: "object",
    additionalProperties: false,
    properties: {
      format: {
        enum: ["parquet", "csv", "json", "avro", "orc", "xml", "text"],
        enumDescriptions: [
          "Parquet files.",
          "CSV text; set options such as header: true.",
          "JSON, one object per line unless options say otherwise.",
          "Avro files.",
          "ORC files.",
          "XML; set options such as rowTag.",
          "Each line as one row.",
        ],
        description: "The files' format.",
      },
      schema_evolution: {
        enum: [
          "addNewColumns",
          "addNewColumnsWithTypeWidening",
          "rescue",
          "failOnNewColumns",
          "none",
        ],
        enumDescriptions: [
          "Stop when files gain columns, then go on with the columns added.",
          "As addNewColumns, and also widen column types, such as int to bigint.",
          "Keep the columns as they are; values that do not fit go to _rescued_data.",
          "Stop when files gain columns, until the table is changed.",
          "Ignore new columns.",
        ],
        description: "What happens when files gain columns.",
      },
      schema_hints: {
        type: "boolean",
        description: "Pass the contract's column types as schemaHints.",
      },
      options: {
        type: "object",
        description: "Other read_files options, such as header: true.",
        additionalProperties: { type: ["string", "number", "boolean"] },
      },
    },
  },
  check: (table) =>
    typeof table.ingest?.connection.settings.path === "string"
      ? []
      : ['the connection needs "settings.path"'],
};

/** Table properties are the organisation's, such as change data feed: written in the standard. */
const storePlacement = { standard: ["properties"] };

/** A streaming table: each file is read once; optionally kept current with AUTO CDC. */
export const streamingTable: Method = {
  action: "store",
  description:
    "A streaming table. mode append adds rows; upsert (SCD type 1) and history (SCD type 2) apply changes by key.",
  accepts: ["files"],
  produces: "table",
  defaults: { mode: "append", cluster_by: "auto", properties: {}, changes_suffix: "_changes" },
  placement: storePlacement,
  settings: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        enum: ["append", "upsert", "history"],
        enumDescriptions: [
          "Add every row as it arrives.",
          "Keep the latest row per key (SCD type 1), ordered by sequence_by.",
          "Keep every version of a row with when it was valid (SCD type 2), ordered by sequence_by.",
        ],
        description: "How rows are kept.",
      },
      sequence_by: {
        type: "string",
        description: "Column that orders changes; needed for upsert and history.",
        examples: ["updated_at"],
      },
      delete_when: {
        type: "string",
        description: "SQL condition for rows that are deletions, such as op = 'D'.",
        examples: ["op = 'D'"],
      },
      except_columns: {
        type: "array",
        items: { type: "string" },
        description: "Change columns not to keep, such as op.",
      },
      changes_suffix: {
        type: "string",
        pattern: "^_[a-z0-9_]+$",
        description: "Suffix of the table that keeps changes as received.",
        examples: ["_changes"],
      },
      cluster_by: clusterBy,
      properties,
    },
  },
  check: checkChangeData,
};

/** A materialised view, recomputed (incrementally where possible) on each update. */
export const materialisedView: Method = {
  action: "store",
  description: "A materialised view. Expectations make every refresh a full one.",
  accepts: ["files", "table", "query"],
  produces: "table",
  defaults: { cluster_by: "auto", properties: {} },
  placement: storePlacement,
  settings: {
    type: "object",
    additionalProperties: false,
    properties: { cluster_by: clusterBy, properties },
  },
};

/** The transform's own SQL, with `{{ tables.<input> }}` replaced by full names. */
export const sql: Method = {
  action: "transform",
  description: "Runs the transform's SQL query.",
  accepts: ["table"],
  produces: "query",
  settings: { type: "object", additionalProperties: false },
  check: (table) => {
    const result = renderQuery(table.transform?.code ?? "", table.transform?.inputs ?? {});
    return "problem" in result ? [result.problem] : [];
  },
};

function checkChangeData(table: ResolvedTable): string[] {
  const settings = table.store?.settings ?? {};
  if (settings.mode === "append") return [];
  const problems: string[] = [];
  if (table.contract.primaryKey.length === 0)
    problems.push(`mode ${String(settings.mode)} needs primary key columns in the contract`);
  if (typeof settings.sequence_by !== "string")
    problems.push(`mode ${String(settings.mode)} needs "sequence_by"`);
  return problems;
}
