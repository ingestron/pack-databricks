// The pack: methods, smart defaults, rules and the build function.
import { contract } from "./contract.js";
import type { Pack } from "@ingestron/definitions";
import { connectors } from "./connectors.js";
import { build } from "./build.js";
import { request } from "./request.js";
import { capabilities, tagProblems } from "./capabilities.js";
import { lakeflowConnect } from "./connect-method.js";
import { connectGroups, sharedProblems } from "./connect.js";
import { files, materialisedView, sql, streamingTable } from "./methods.js";
import { pyspark } from "./pyspark-method.js";

/**
 * The Databricks pack, version 1. Name it in a standard as `pack: databricks@1`.
 * @example
 * const result = loadDefinitions("definitions", { pack: databricks, environment: "dev" });
 * if (result.model) console.log(Object.keys(databricks.build(result.model)));
 */
export const databricks: Pack = {
  id: "databricks",
  version: 1,
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
  request,
};
