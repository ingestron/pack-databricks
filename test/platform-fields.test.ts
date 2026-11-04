// The Platform settings the pack lists for tools to show.
import { memoryFiles } from "@ingestron/config";
import { documentReference, resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

const files: Record<string, string> = {
  "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\n",
};

describe("platform fields", () => {
  it("lists the settings it reads that have a default other than empty", () => {
    expect(databricks.platformFields).toEqual([
      "mode",
      "compute.serverless",
      "schedule.timezone",
      "schedule.paused",
      "manage.schemas",
      "manage.tags",
      "manage.comments",
      "manage.checks",
    ]);
  });

  it("lists only fields the Platform document has", () => {
    const known = new Set(documentReference("Platform").map((field) => field.path.join(".")));
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
