// The projects the quality and cleansing tests build (spec/behaviour.md, section 8.5).
import { join } from "node:path";
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { expect } from "vitest";
import { databricks } from "../src/index.js";
import { folderFiles } from "./fold-helpers.js";
import { base } from "./pack-helpers.js";

/** The synthetic CRM project: bronze as it comes, silver cleansed, checked and quarantined. */
export const quality = folderFiles(join(import.meta.dirname, "fixtures/quality"));

export function resolve(files: Record<string, string>) {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment: "dev" });
}

/** The model for dev, which has no error. */
export function modelOf(files: Record<string, string>): ResolvedModel {
  const result = resolve(files);
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  expect(errors).toEqual([]);
  return result.model!;
}

/** The files built for dev. */
export function built(files: Record<string, string>) {
  return databricks.build(modelOf(files));
}

/** The one-table project, with the standard's lines and the flow table's lines added. */
export function shopWith(
  standard: string,
  table: string,
  contract = base["orders.yaml"]!,
): Record<string, string> {
  return {
    ...base,
    "standard.yaml": `${base["standard.yaml"]}${standard}`,
    "flow.yaml": `${base["flow.yaml"]!.replace("  orders: { object: /orders, contract: orders }\n", "")}  orders:\n    object: /orders\n    contract: orders\n${table}`,
    "orders.yaml": contract,
  };
}

/** The project's flow table stored as a materialised view. */
export function asView(files: Record<string, string>): Record<string, string> {
  return {
    ...files,
    "flow.yaml": files["flow.yaml"]!.replace(
      "source: files\n",
      "source: files\nstore: { uses: materialised-view }\n",
    ),
  };
}

/** The base contract with text columns: `status`, read from `state` in the files, and `note`. */
export const withStatus = base["orders.yaml"]!.replace(
  "      - { name: updated_at, logicalType: timestamp }\n",
  "      - { name: updated_at, logicalType: timestamp }\n      - { name: status, logicalType: string, physicalName: state }\n      - { name: note, logicalType: string }\n",
);
