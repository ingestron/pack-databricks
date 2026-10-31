// The lakeflow-connect method: Databricks' managed connectors write the
// tables themselves, so there is no store step and no SQL.
import type { Method, ResolvedTable } from "@ingestron/definitions";

/** Connectors that read through an ingestion gateway (database change capture). */
export const gatewayConnectors = new Set(["sqlserver"]);
/** Every connector this method supports, verified against the Databricks docs. */
export const managedConnectors = ["sqlserver", "salesforce", "kafka"];

/** Lakeflow Connect managed ingestion. */
export const lakeflowConnect: Method = {
  action: "ingest",
  description:
    "Databricks Lakeflow Connect: managed ingestion from databases (with a gateway), SaaS applications and Kafka.",
  connectors: managedConnectors,
  connectivity: ["public", "workspace"],
  produces: "table",
  defaults: { mode: "upsert", columns: "contract" },
  settings: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        enum: ["append", "upsert", "history"],
        enumDescriptions: [
          "Add every change as a row.",
          "Keep the latest row per key (SCD type 1).",
          "Keep every version of a row with when it was valid (SCD type 2).",
        ],
        description: "How rows are kept.",
      },
      columns: {
        enum: ["contract", "all"],
        enumDescriptions: ["Only the contract's columns.", "Every source column."],
        description: "Which source columns are ingested.",
      },
      gateway_policy_id: {
        type: "string",
        description: "Cluster policy for the gateway, which runs on classic compute.",
        examples: ["0012AB34CD56EF78"],
      },
      staging_schema: {
        type: "string",
        description: "Schema for the gateway's staging volume. Default: the table's schema.",
        examples: ["staging"],
      },
      value_format: {
        enum: ["json", "avro", "protobuf", "string"],
        enumDescriptions: ["JSON text.", "Avro.", "Protocol Buffers.", "Plain text, not parsed."],
        description: "Kafka: how message values are parsed.",
      },
      continuous: {
        type: "boolean",
        description:
          "Kafka: run the ingestion pipeline continuously. Default: true in production; elsewhere the refresh job runs it, which costs less.",
      },
      starting_offset: {
        enum: ["earliest", "latest"],
        enumDescriptions: [
          "From the oldest message the topic keeps.",
          "From the messages that arrive after the pipeline starts.",
        ],
        description: "Kafka: where a new pipeline starts reading.",
      },
    },
  },
  check: checkConnect,
};

/** Lakeflow Connect writes the table with the source's names, so it cannot rename columns. */
function renamesOf(table: ResolvedTable): string[] {
  return table.contract.columns
    .filter((column) => column.physicalName && column.physicalName !== column.name)
    .map(
      (column) =>
        `Lakeflow Connect keeps the source's column names, so it cannot read "${column.physicalName}" as "${column.name}"; remove physicalName, or rename the column in a transform`,
    );
}

function checkConnect(table: ResolvedTable): string[] {
  const ingest = table.ingest;
  if (!ingest) return [];
  const problems: string[] = renamesOf(table);
  if (typeof ingest.connection.settings.uc_connection !== "string") {
    problems.push(
      'the connection needs "settings.uc_connection", the name of a Unity Catalog connection',
    );
  }
  if (gatewayConnectors.has(ingest.connection.connector) && ingest.object.split(".").length !== 3) {
    problems.push(
      `a ${ingest.connection.connector} object is written database.schema.table, not "${ingest.object}"`,
    );
  }
  if (ingest.connection.connector === "kafka" && ingest.settings.mode !== "append") {
    problems.push("kafka topics can only be appended (mode: append)");
  }
  const own = table.expectations
    .filter((item) => item.from === "definition")
    .map((item) => item.name);
  if (own.length > 0)
    problems.push(
      `managed ingestion cannot run expectations (${own.join(", ")}); check the data in a transform`,
    );
  return problems;
}
