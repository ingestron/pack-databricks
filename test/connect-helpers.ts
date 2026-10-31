// A small project in memory, resolved with the Databricks pack and built.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { parse } from "yaml";
import { databricks } from "../src/index.js";

const standard = "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@1]\n";

export function connection(id: string, connector: string, connectivity = "workspace") {
  return `apiVersion: ingestron.io/v1\nkind: Connection\nid: ${id}\nconnector: ${connector}\nconnectivity: ${connectivity}\nsettings: { uc_connection: ${id}_conn }\n`;
}

export function contract(id: string) {
  return [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    `id: ${id}`,
    "version: 1.0.0",
    "status: active",
    "schema:",
    `  - name: ${id}`,
    "    logicalType: object",
    "    properties:",
    "      - { name: id, logicalType: integer, required: true, primaryKey: true }",
    "      - { name: total, logicalType: number }",
    "",
  ].join("\n");
}

export function flow(id: string, source: string, table: string, object: string, extra = "") {
  return `apiVersion: ingestron.io/v1\nkind: Flow\nid: ${id}\nsource: ${source}\ntables:\n  ${table}:\n    object: ${object}\n    contract: ${table}\n${extra}`;
}

// Parsed YAML is untyped; the assertions check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Yaml = Record<string, any>;

export function generate(files: Record<string, string>, environment = "dev") {
  const all = {
    "project.yaml": "id: shop\nenvironments: { dev: {}, prod: {} }\nimports: ['*.yaml']\n",
    "standard.yaml": standard,
    ...files,
  };
  const result = resolveDefinitions(memoryFiles(all), { packs: [databricks], environment });
  const output = result.model ? databricks.build(result.model) : {};
  return { result, output, yaml: (path: string) => parse(output[path] ?? "null") as Yaml };
}
