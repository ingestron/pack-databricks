// Pipelines for Lakeflow Connect: one ingestion pipeline per connection, and
// a gateway in front of it for databases.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { schemaRef } from "./bundle.js";
import { gatewayConnectors } from "./connect-method.js";
import { quoteName } from "./query.js";

type Data = Record<string, unknown>;

/** The tables one connection ingests, and the pipelines it needs. */
export interface ConnectGroup {
  connection: NonNullable<ResolvedTable["ingest"]>["connection"];
  tables: ResolvedTable[];
  ingestion: string;
  gateway?: string;
  /** Kafka runs continuously (by default in production only); the others are refreshed by the job. */
  continuous: boolean;
}

/** Bundle keys of managed schemas, by `catalog.schema` (see bundle.ts). */
type Keys = Map<string, string>;

/** Tables ingested by lakeflow-connect, grouped by connection in path order. */
export function connectGroups(model: ResolvedModel): ConnectGroup[] {
  const groups = new Map<string, ConnectGroup>();
  for (const table of model.tables.filter(
    (candidate) => candidate.ingest?.method === "lakeflow-connect",
  )) {
    const connection = table.ingest!.connection;
    const base = `${model.names.pipeline}_${connection.id}`;
    const continuous = table.ingest!.settings.continuous ?? model.platform.mode === "production";
    const group = groups.get(connection.id) ?? {
      connection,
      tables: [],
      ingestion: `${base}_ingestion`,
      ...(gatewayConnectors.has(connection.connector) && { gateway: `${base}_gateway` }),
      continuous: connection.connector === "kafka" && continuous === true,
    };
    group.tables.push(table);
    groups.set(connection.id, group);
  }
  return [...groups.values()];
}

/**
 * Problems with settings that one connection's tables share: its gateway, or
 * whether its ingestion runs continuously.
 */
export function sharedProblems(groups: ConnectGroup[]): string[] {
  return groups.flatMap((group) => {
    const keys = group.gateway ? ["gateway_policy_id", "staging_schema"] : ["continuous"];
    const shared = (table: ResolvedTable) =>
      JSON.stringify([
        group.gateway ? gatewayStorage(table) : undefined,
        ...keys.map((key) => table.ingest?.settings[key]),
      ]);
    const [first] = group.tables;
    const different = group.tables.find((table) => shared(table) !== shared(first!));
    if (!first || !different) return [];
    const what = group.gateway ? "one gateway" : "one ingestion pipeline";
    return [
      `the tables of connection ${group.connection.id} share ${what}, so ${keys.join(" and ")} must be the same; ${different.name} differs from ${first.name}`,
    ];
  });
}

/** Where the gateway stages changes: the table's catalog, and its schema unless set. */
function gatewayStorage(table: ResolvedTable): { catalog: string; schema: string } {
  const staging = table.ingest?.settings.staging_schema;
  return {
    catalog: table.fullName.catalog,
    schema: typeof staging === "string" ? staging : table.fullName.schema,
  };
}

/** The gateway pipeline: captures changes continuously on classic compute. */
export function gatewayPipeline(group: ConnectGroup, keys: Keys): Data {
  const first = group.tables[0]!;
  const { catalog, schema } = gatewayStorage(first);
  const staging = schemaRef(keys, catalog, schema);
  const policy = first.ingest?.settings.gateway_policy_id;
  return {
    name: group.gateway,
    catalog,
    schema: staging,
    continuous: true,
    gateway_definition: {
      connection_name: group.connection.settings.uc_connection,
      gateway_storage_catalog: catalog,
      gateway_storage_schema: staging,
    },
    ...(typeof policy === "string" && {
      clusters: [{ label: "default", policy_id: policy, apply_policy_default_values: true }],
    }),
  };
}

/** The serverless ingestion pipeline that writes the tables. */
export function ingestionPipeline(group: ConnectGroup, keys: Keys): Data {
  const first = group.tables[0]!;
  const kafka = group.connection.connector === "kafka";
  const source = group.gateway
    ? { ingestion_gateway_id: `\${resources.pipelines.${group.gateway}.id}` }
    : { connection_name: group.connection.settings.uc_connection };
  return {
    name: group.ingestion,
    catalog: first.fullName.catalog,
    schema: schemaRef(keys, first.fullName.catalog, first.fullName.schema),
    serverless: true,
    ...(group.continuous && { continuous: true }),
    ...(kafka && { channel: "PREVIEW" }),
    ingestion_definition: {
      ...source,
      objects: group.tables.map((table) => ({ table: tableObject(group, table, keys) })),
    },
  };
}

function tableObject(group: ConnectGroup, table: ResolvedTable, keys: Keys): Data {
  const ingest = table.ingest!;
  const destination = {
    destination_catalog: table.fullName.catalog,
    destination_schema: schemaRef(keys, table.fullName.catalog, table.fullName.schema),
    destination_table: table.fullName.table,
    table_configuration: tableConfiguration(table),
  };
  if (group.connection.connector === "kafka")
    return {
      source_table: "N/A",
      ...destination,
      connector_options: { kafka_options: kafkaOptions(table) },
    };
  if (group.gateway) {
    const [catalog, schema, name] = ingest.object.split(".");
    return { source_catalog: catalog, source_schema: schema, source_table: name, ...destination };
  }
  return { source_schema: "objects", source_table: ingest.object, ...destination };
}

const scdTypes: Record<string, string> = {
  append: "APPEND_ONLY",
  upsert: "SCD_TYPE_1",
  history: "SCD_TYPE_2",
};

function tableConfiguration(table: ResolvedTable): Data {
  const settings = table.ingest!.settings;
  const keyed = settings.mode !== "append" && table.contract.primaryKey.length > 0;
  // Kafka values are parsed with the contract's schema hints instead.
  const kafka = table.ingest!.connection.connector === "kafka";
  return {
    scd_type: scdTypes[String(settings.mode)],
    ...(settings.columns === "contract" &&
      !kafka && { include_columns: table.contract.columns.map((column) => column.name) }),
    ...(keyed && { primary_keys: table.contract.primaryKey }),
  };
}

function kafkaOptions(table: ResolvedTable): Data {
  const settings = table.ingest!.settings;
  const format = String(settings.value_format ?? "json");
  const hints = table.contract.columns
    .filter((column) => column.type)
    .map((column) => `${quoteName(column.name)} ${column.type}`);
  const json =
    format === "json" && hints.length > 0
      ? { json_options: { schema_hints: hints.join(", ") } }
      : {};
  return {
    topics: [table.ingest!.object],
    ...(typeof settings.starting_offset === "string" && {
      starting_offset: settings.starting_offset,
    }),
    value_transformer: { format: format.toUpperCase(), ...json },
  };
}

/** A note for generated files that use features Databricks has not made generally available. */
export function previewNote(group: ConnectGroup): string {
  if (group.connection.connector === "kafka")
    return "Lakeflow Connect for Kafka is in Beta on Databricks (checked 2026-10-25).";
  return "Lakeflow Connect fields used here are marked Preview in the Databricks CLI v1.22.1 bundle schema (checked 2026-10-25).";
}
