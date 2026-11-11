// What the pack declares for the quality and cleansing paths of intent (spec section 8.2).
import { intentUseOf, type Method } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

describe("quality and cleansing coverage", () => {
  it("uses every cleansing operation and quarantine, checked on 2026-11-10", () => {
    const paths = [
      "cleanse.trim",
      "cleanse.empty",
      "cleanse.map",
      "cleanse.case",
      "cleanse.default",
      "cleanse.timezone",
      "quality.quarantine",
    ];
    for (const path of paths) {
      const use = intentUseOf(databricks, path, "true");
      expect(use?.use, path).toBe("used");
      if (use?.use === "used") {
        expect(use.status, path).toMatchObject({ level: "ga", checked: "2026-11-10" });
        expect(use.onlyWhere, path).toBeUndefined();
      }
    }
  });

  it("deduplicates in a materialised view only", () => {
    const view = databricks.methods["materialised-view"] as Method;
    expect(intentUseOf(view, "deduplicate", "true")).toMatchObject({
      use: "used",
      status: { level: "ga", checked: "2026-11-10" },
    });
    expect(intentUseOf(databricks, "deduplicate", "true")).toEqual({
      use: "not-applicable",
      reason:
        "A streaming table keeps one row per key through its history, latest or full; deduplicate in a materialised view.",
    });
  });

  it("says Lakeflow Connect checks and cleanses nothing, and where to do it instead", () => {
    const connect = databricks.methods["lakeflow-connect"] as Method;
    const writes = "Managed ingestion writes the table as the source gives it;";
    const expected: [string, string | undefined, string][] = [
      ["quality.rules", "notNull", `${writes} check it in a transform in the next layer.`],
      ["quality.actions", "drop", `${writes} check it in a transform in the next layer.`],
      ["quality.quarantine", "true", `${writes} check it in a transform in the next layer.`],
      ["cleanse.trim", "true", `${writes} cleanse it in a transform in the next layer.`],
      ["cleanse.timezone", "true", `${writes} cleanse it in a transform in the next layer.`],
      ["deduplicate", "true", `${writes} deduplicate it in a transform in the next layer.`],
    ];
    for (const [path, value, reason] of expected)
      expect(intentUseOf(connect, path, value), path).toEqual({ use: "not-applicable", reason });
    expect(intentUseOf(connect, "quality.table-checks", "true")).toBeUndefined();
    expect(intentUseOf(databricks, "quality.table-checks", "true")?.use).toBe("used");
    expect(intentUseOf(connect, "quality.results", "true")).toBeUndefined();
  });
});
