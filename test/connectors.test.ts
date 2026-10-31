// Every connector an ingest method reads is described, and each description
// names a method that really reads it.
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

const ingest = Object.entries(databricks.methods).filter(
  ([, method]) => method.action === "ingest",
);

describe("connector facts", () => {
  it("describes every connector an ingest method reads", () => {
    const read = new Set(ingest.flatMap(([, method]) => method.connectors ?? []));
    expect(new Set(databricks.connectors?.map((connector) => connector.id))).toEqual(read);
  });

  it("names a method that reads the connector, and an https link", () => {
    for (const connector of databricks.connectors ?? []) {
      const method = databricks.methods[connector.method];
      expect(method?.connectors, connector.id).toContain(connector.id);
      expect(connector.docs).toMatch(/^https:\/\//);
    }
  });
});
