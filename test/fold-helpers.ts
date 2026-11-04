// Projects resolved for every environment, as the CLI resolves them for a pack
// that builds environments together, and the fold property checked on them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { memoryFiles } from "@ingestron/config";
import {
  checkFold,
  resolveDefinitions,
  type FoldView,
  type ResolvedModel,
  type SuppliedValue,
} from "@ingestron/definitions";
import { parse } from "yaml";
import { databricks } from "../src/index.js";
import { bundleView, sameFile, suppliedFor } from "../src/view.js";

/** Every file under a folder, by path relative to it. */
export function folderFiles(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(folder, path)] = readFileSync(path, "utf8");
    }
  };
  walk(folder);
  return files;
}

/** The retail-shaped project: files into bronze, orders kept current, daily sales in silver. */
export const retail = folderFiles(join(import.meta.dirname, "fixtures/retail"));

type Models = Record<string, ResolvedModel>;

/** Each environment's model, resolved with deploy-time values; fails on any error. */
export function resolveAll(files: Record<string, string>, environments: string[]): Models {
  return Object.fromEntries(
    environments.map((environment) => {
      const result = resolveDefinitions(memoryFiles(files), {
        packs: [databricks],
        environment,
        deployTime: true,
        environmentsTogether: true,
      });
      const errors = result.diagnostics.filter((item) => item.severity === "error");
      if (errors.length > 0 || !result.model)
        throw new Error(`${environment}: ${errors.map((item) => item.message).join("; ")}`);
      return [environment, result.model];
    }),
  );
}

/** The folded bundle for the models. */
export function fold(models: Models) {
  return databricks.buildEnvironments!(models);
}

/** How Databricks reads the folded files for one target, given what the pipeline supplies. */
export function bundleFold(models: Models, deployValues: SuppliedValue[]): FoldView {
  return {
    view: (files, target) => bundleView(files, target, suppliedFor(models[target]!, deployValues)),
    same: sameFile,
  };
}

/** The fold property's failures for the models of the first one, two and more targets. */
export function foldFailures(models: Models): string[] {
  return checkFold(databricks, models, bundleFold(models, fold(models).deployValues));
}

// Parsed YAML is untyped; the assertions check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Yaml = Record<string, any>;

/** A folded YAML file as data. */
export function yamlOf(files: Record<string, string>, path: string): Yaml {
  return parse(files[path] ?? "null") as Yaml;
}

/** A small project of one flow table, with the environments given in project.yaml. */
export function shop(environments: string, more: Record<string, string> = {}) {
  return {
    "project.yaml": `id: shop\nvalues: { landing: /Volumes/main/landing/shop }\nenvironments:\n${environments}imports: ['*.yaml']\n`,
    "standard.yaml":
      "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\n",
    "files.yaml":
      "apiVersion: ingestron.io/v1\nkind: Connection\nid: files\nconnector: files\nconnectivity: public\nsettings: { path: '${values.landing}' }\n",
    "flow.yaml":
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: files\ntables:\n  orders: { object: orders, contract: orders }\n",
    "orders.yaml": [
      "apiVersion: v3.1.0",
      "kind: DataContract",
      "id: orders",
      "version: 1.0.0",
      "status: active",
      "schema:",
      "  - name: orders",
      "    logicalType: object",
      "    tags: [sales]",
      "    properties:",
      "      - { name: id, logicalType: integer, required: true, primaryKey: true }",
      "      - { name: total, logicalType: number }",
      "",
    ].join("\n"),
    ...more,
  };
}
