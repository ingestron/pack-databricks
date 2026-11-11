// The Platform settings the pack lists for tools to show.
import { memoryFiles } from "@ingestron/config";
import {
  documentReference,
  platformSectionReference,
  resolveDefinitions,
} from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

const files: Record<string, string> = {
  "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\n",
};

describe("platform fields", () => {
  it("lists every Platform setting it reads", () => {
    expect(databricks.platformFields).toEqual([
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
      "alerts",
      "grants",
      "manage.schemas",
      "manage.tags",
      "manage.comments",
      "manage.checks",
      "manage.grants",
      "manage.masks",
      "manage.filters",
      "principals",
      "databricks.warehouse_id",
      "databricks.governance.unmasked",
      "databricks.governance.functions",
    ]);
  });

  it("lists only fields the Platform document or the pack's own section has", () => {
    const known = new Set(
      [...documentReference("Platform"), ...platformSectionReference(databricks)].map((field) =>
        field.path.join("."),
      ),
    );
    for (const path of databricks.platformFields ?? []) expect(known.has(path), path).toBe(true);
  });

  it("is accepted when resolving, and refused for a field the Platform lacks", () => {
    const options = { environment: "dev" };
    expect(() =>
      resolveDefinitions(memoryFiles(files), { ...options, packs: [databricks] }),
    ).not.toThrow();
    expect(() =>
      resolveDefinitions(memoryFiles(files), {
        ...options,
        packs: [{ ...databricks, platformFields: ["manage.nothing"] }],
      }),
    ).toThrow('lists the platform field "manage.nothing"');
  });
});

describe("the schema for mask functions", () => {
  /**
   * The errors resolving a Platform whose databricks.governance.functions is `functions`, but
   * the pack's own that the project has nothing to generate.
   */
  const errors = (functions: string) =>
    resolveDefinitions(
      memoryFiles({
        ...files,
        "platform.yaml": `apiVersion: ingestron.io/v1\nkind: Platform\nid: lakehouse\ndatabricks:\n  governance:\n    functions: "${functions}"\n`,
      }),
      { packs: [databricks], environment: "dev" },
    ).diagnostics.filter((item) => item.severity === "error" && item.code !== "PACK_CHECK");

  it("takes catalog.schema, written without backticks, which the task quotes itself", () => {
    expect(errors("main.governance")).toEqual([]);
    expect(errors("my-cat.gov")).toEqual([]);
    for (const refused of ["`my-cat`.gov", "main.`gov`", "main.gov.more", "main", "main.go v"])
      expect(errors(refused).length, refused).toBeGreaterThan(0);
  });
});
