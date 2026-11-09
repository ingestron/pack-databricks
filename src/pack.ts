// The pack: methods, smart defaults, rules and the build function.
import { contract } from "./methods/index.js";
import type { Pack } from "@ingestron/definitions";
import { connectors } from "./methods/index.js";
import { build } from "./output/index.js";
import { buildEnvironments } from "./fold/index.js";
import { request } from "./methods/index.js";
import { capabilities, tagProblems } from "./methods/index.js";
import { lakeflowConnect } from "./methods/index.js";
import { connectGroups, sharedProblems } from "./connect/index.js";
import { files, materialisedView, sql, streamingTable } from "./methods/index.js";
import { pyspark } from "./methods/index.js";

/**
 * The Databricks pack, version 2. Name it in a standard as `packs: [databricks@2]`. It
 * builds every environment into one bundle, with a target per environment.
 * @example
 * const result = loadDefinitions("definitions", { packs: [databricks], environment: "dev" });
 * if (result.model) console.log(Object.keys(databricks.build(result.model)));
 * @public
 */
export const databricks: Pack = {
  id: "databricks",
  version: 2,
  defaults: {
    naming: {
      catalog: "{{ environment }}",
      schema: "{{ layer }}",
      table: "{{ table }}",
      pipeline: "{{ project }}",
      job: "{{ project }}_refresh",
    },
    layers: ["bronze", "silver", "gold"],
    types: {
      string: "STRING",
      integer: "BIGINT",
      number: "DOUBLE",
      boolean: "BOOLEAN",
      date: "DATE",
      timestamp: "TIMESTAMP",
    },
    quality: { required: "warn", default: "warn" },
  },
  rules: {
    ingest: {
      default: "files",
      when: [
        { connector: "sqlserver", use: "lakeflow-connect" },
        { connector: "salesforce", use: "lakeflow-connect" },
        { connector: "kafka", use: "lakeflow-connect", with: { mode: "append" } },
      ],
    },
    transform: { default: "sql" },
    store: { default: "streaming-table", when: [{ input: "query", use: "materialised-view" }] },
  },
  methods: {
    files,
    "lakeflow-connect": lakeflowConnect,
    sql,
    pyspark,
    "streaming-table": streamingTable,
    "materialised-view": materialisedView,
  },
  connectors,
  capabilities,
  platformFields: [
    "mode",
    "workspace.host",
    "workspace.root_path",
    "run_as",
    "permissions",
    "tags",
    "compute.serverless",
    "compute.budget_policy_id",
    "compute.channel",
    "schedule.cron",
    "schedule.timezone",
    "schedule.paused",
    "notifications.on_failure",
    "grants",
    "manage.schemas",
    "manage.tags",
    "manage.comments",
    "manage.checks",
  ],
  contract,
  check(model) {
    const problems: string[] = [];
    if (!model.platform.compute.serverless)
      problems.push("classic compute is not supported yet; leave compute.serverless at true");
    if (model.tables.length === 0)
      problems.push("there is nothing to generate: add a flow or a transform");
    return [...problems, ...tagProblems(model), ...sharedProblems(connectGroups(model))];
  },
  build,
  buildEnvironments,
  request,
};
