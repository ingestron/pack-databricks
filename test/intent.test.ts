// What the pack declares about intent: coverage, aliases and defaults.
import { memoryFiles } from "@ingestron/config";
import {
  intentCoverageGaps,
  intentUseOf,
  resolveDefinitions,
  type Method,
} from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";
import { join } from "node:path";
import { fold, folderFiles, resolveAll, retail } from "./fold-helpers.js";

const golden = folderFiles(join(import.meta.dirname, "golden/retail"));

function resolve(files: Record<string, string>, environment = "dev") {
  return resolveDefinitions(memoryFiles(files), { packs: [databricks], environment });
}

describe("coverage", () => {
  it("covers every intent path and value", () => {
    expect(intentCoverageGaps(databricks)).toEqual([]);
  });

  it("uses what the pack generates, with a status from the research", () => {
    for (const key of ["history=none", "history=latest", "history=full", "load.mode=files"]) {
      const use = intentUseOf(databricks, key.split("=")[0]!, key.split("=")[1]);
      expect(use?.use, key).toBe("used");
      if (use?.use === "used") expect(use.status?.level, key).toBe("ga");
    }
    expect(intentUseOf(databricks, "history", "bitemporal")).toEqual({
      use: "not-yet",
      reason: "Planned.",
    });
    expect(intentUseOf(databricks, "operations.trigger", "upstream")?.use).toBe("not-yet");
    expect(intentUseOf(databricks, "operations.retries")?.use).toBe("used");
  });

  it("leaves landed files and ingest-step audit columns to the landing pack", () => {
    expect(intentUseOf(databricks, "retention.landed_files")?.use).toBe("elsewhere");
    expect(intentUseOf(databricks, "audit", "run_id")?.use).toBe("elsewhere");
    expect(intentUseOf(databricks, "audit", "loaded_at")?.use).toBe("used");
  });

  it("differs by method where a method cannot do what the pack does", () => {
    const view = databricks.methods["materialised-view"] as Method;
    expect(intentUseOf(view, "history", "full")?.use).toBe("not-applicable");
    expect(intentUseOf(view, "history", "none")?.use).toBe("used");
    const connect = databricks.methods["lakeflow-connect"] as Method;
    expect(intentUseOf(connect, "load.mode", "files")?.use).toBe("not-applicable");
    expect(intentUseOf(connect, "history", "full")?.use).toBe("used");
  });
});

describe("aliases and defaults", () => {
  it("declares the aliases and intent defaults", () => {
    const streaming = databricks.methods["streaming-table"] as Method;
    expect(streaming.aliases).toEqual({
      mode: {
        values: {
          append: { history: "none" },
          upsert: { history: "latest" },
          history: { history: "full" },
        },
      },
      sequence_by: { path: "sequence" },
      delete_when: { path: "load.deletes.when" },
    });
    expect(streaming.intentDefaults).toEqual({ history: "none" });
    expect((databricks.methods["lakeflow-connect"] as Method).intentDefaults).toEqual({
      history: "latest",
    });
    expect((databricks.methods.files as Method).intentDefaults).toEqual({
      load: { mode: "files" },
    });
    expect((databricks.methods["lakeflow-connect"] as Method).aliases).toEqual(
      streaming.aliases?.mode ? { mode: streaming.aliases.mode } : {},
    );
  });

  it("gives the same orders table from history: latest as from mode: upsert", () => {
    const changed = {
      ...retail,
      "flows/shop.yaml": retail["flows/shop.yaml"]!.replace(
        "store:\n      with: { mode: upsert, sequence_by",
        "history: latest\n    store:\n      with: { sequence_by",
      ),
    };
    expect(changed["flows/shop.yaml"]).toContain("history: latest");
    const files = fold(resolveAll(changed, ["dev", "prod"])).files;
    expect(files["src/retail/bronze/orders.sql"]).toBe(golden["src/retail/bronze/orders.sql"]);
    expect(files["src/retail/bronze/orders.sql"]).toContain("STORED AS SCD TYPE 1");
    expect(files).toEqual(golden);
  });

  it("reports a method that cannot keep the history asked for", () => {
    const changed = {
      ...retail,
      "flows/shop.yaml": retail["flows/shop.yaml"]!.replace(
        / {4}store:\n {6}with:.*\n/,
        "    history: full\n",
      ).replace("source: shop\n", "source: shop\nstore: { uses: materialised-view }\n"),
    };
    const applied = resolve(changed).diagnostics.filter((item) => item.code === "NOT_APPLIED");
    expect(applied.map((item) => item.message)).toEqual([
      expect.stringContaining("A materialised view is recomputed on each update"),
    ]);
  });
});
