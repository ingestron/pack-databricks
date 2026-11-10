// Intent the pack's own rules and its store methods decide: the Kafka rule's mode, delete
// conditions, and schedules.
import { memoryFiles } from "@ingestron/config";
import { intentUseOf, resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { base } from "./pack-helpers.js";

function resolve(files: Record<string, string>, environment = "dev") {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment });
}

/** The intent a table's steps do not apply, without the checks managed ingestion does not apply. */
function notApplied(diagnostics: ReturnType<typeof resolve>["diagnostics"]) {
  return diagnostics.filter(
    (item) =>
      item.code === "NOT_APPLIED" &&
      !item.message.includes("Managed ingestion writes the table as the source gives it"),
  );
}

describe("the pack's Kafka rule", () => {
  // The Kafka starter, with its topics named and the flow's history left to the standard.
  const kafka: Record<string, string> = {
    "project.yaml": "id: clickstream\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
    "standard.yaml":
      "apiVersion: ingestron.io/v1\nkind: Standard\nid: web\npacks: [databricks@2]\n",
    "events.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Connection",
      "id: events",
      "connector: kafka",
      "connectivity: public",
      "settings: { uc_connection: kafka_events }",
      "",
    ].join("\n"),
    "flow.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Flow",
      "id: events",
      "source: events",
      "ingest:",
      "  with: { starting_offset: earliest, continuous: false }",
      "tables:",
      "  page_views: { object: page_views, contract: web.page_views }",
      "",
    ].join("\n"),
    "page_views.yaml": [
      "apiVersion: v3.1.0",
      "kind: DataContract",
      "id: web.page_views",
      "version: 1.0.0",
      "status: active",
      "schema:",
      "  - name: page_views",
      "    logicalType: object",
      "    properties:",
      "      - { name: session_id, logicalType: string, required: true }",
      "      - { name: viewed_at, logicalType: timestamp }",
      "",
    ].join("\n"),
  };

  it("gives the history its append mode stands for when nothing declares one", () => {
    const { model, diagnostics } = resolve(kafka);
    expect(notApplied(diagnostics)).toEqual([]);
    const table = model!.tables[0]!;
    expect(table.ingest?.settings.mode).toBe("append");
    expect(table.intent.history).toBe("none");
    expect(table.intentOrigins.history).toEqual({ layer: "pack", alias: "mode" });
  });

  it("keeps appending, and says so, when a layer asks for the latest row per key", () => {
    const layered = `${kafka["standard.yaml"]}layers: [{ name: bronze, history: latest }, silver, gold]\n`;
    const { model, diagnostics } = resolve({ ...kafka, "standard.yaml": layered });
    expect(model!.tables[0]!.ingest?.settings.mode).toBe("append");
    expect(notApplied(diagnostics)).toMatchObject([
      {
        message:
          "history: latest isn't applied on databricks: the pack's rule for connector kafka writes \"mode: append\".",
        location: { file: "standard.yaml", line: 5 },
      },
    ]);
    const files = databricks.build(model!);
    const before = databricks.build(resolve(kafka).model!);
    expect(files).toEqual(before);
  });
});

describe("deletes", () => {
  const flow = (lines: string[]) =>
    ["apiVersion: ingestron.io/v1", "kind: Flow", "id: shop", "source: files", ...lines, ""].join(
      "\n",
    );

  it("are judged by a materialised view, which applies none", () => {
    const changed = flow([
      "store: { uses: materialised-view }",
      "tables:",
      "  orders: { object: /orders, contract: orders, load: { deletes: { when: \"op = 'D'\" } } }",
    ]);
    const { diagnostics } = resolve({ ...base, "flow.yaml": changed });
    expect(diagnostics.filter((item) => item.code === "NOT_APPLIED")).toMatchObject([
      {
        message:
          "load.deletes.when: op = 'D' isn't applied on databricks: A materialised view is recomputed; a delete condition needs a streaming table with history.",
      },
    ]);
  });

  it("need history in a streaming table when written as intent", () => {
    const changed = flow([
      "tables:",
      "  orders: { object: /orders, contract: orders, load: { deletes: { when: \"op = 'D'\" } } }",
    ]);
    const { diagnostics } = resolve({ ...base, "flow.yaml": changed });
    expect(diagnostics.filter((item) => item.severity === "error")).toMatchObject([
      { message: expect.stringContaining("a delete condition needs history latest or full") },
    ]);
  });

  it("apply with history latest, as the delete_when setting does", () => {
    const fromIntent = flow([
      "history: latest",
      "sequence: updated_at",
      "tables:",
      "  orders: { object: /orders, contract: orders, load: { deletes: { when: \"op = 'D'\" } } }",
    ]);
    const fromSettings = flow([
      "store: { with: { mode: upsert, sequence_by: updated_at, delete_when: \"op = 'D'\" } }",
      "tables:",
      "  orders: { object: /orders, contract: orders }",
    ]);
    const intent = resolve({ ...base, "flow.yaml": fromIntent });
    const settings = resolve({ ...base, "flow.yaml": fromSettings });
    expect(intent.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const sql = databricks.build(intent.model!)["src/shop/bronze/orders.sql"];
    expect(sql).toContain("APPLY AS DELETE WHEN op = 'D'");
    expect(sql).toBe(databricks.build(settings.model!)["src/shop/bronze/orders.sql"]);
  });

  it("keep what an appending delete_when setting built before intent existed", () => {
    const changed = flow([
      "store: { with: { mode: append, delete_when: \"op = 'D'\" } }",
      "tables:",
      "  orders: { object: /orders, contract: orders }",
    ]);
    const { diagnostics } = resolve({ ...base, "flow.yaml": changed });
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});

describe("schedules", () => {
  it("run one job for the project, and plan one per flow", () => {
    expect(intentUseOf(databricks, "operations.schedule", "project")?.use).toBe("used");
    expect(intentUseOf(databricks, "operations.schedule", "flow")).toEqual({
      use: "not-yet",
      reason: "Planned.",
    });
  });
});
