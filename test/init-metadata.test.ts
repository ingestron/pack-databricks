// Where a new project's README.md says to find each value: `find` on the connectors'
// settings (definitions specification, "Connector authoring metadata").
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

describe("where to find a value", () => {
  it("says where each Lakeflow Connect connector's Unity Catalog connection is", () => {
    const managed = databricks.connectors!.filter((item) => item.method === "lakeflow-connect");
    expect(managed.length).toBeGreaterThan(0);
    for (const connector of managed)
      expect(connector.settings.find((item) => item.name === "uc_connection")?.find).toBe(
        "Catalog Explorer: the gear icon at the top of the Catalog pane, then Connections.",
      );
  });

  it("says where the files' volume path is", () => {
    const files = databricks.connectors!.find((item) => item.id === "files")!;
    expect(files.settings[0]?.find).toMatch(/\/Volumes\/<catalog>\/<schema>\/<volume>/);
  });
});
