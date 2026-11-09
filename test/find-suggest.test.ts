// Where a team finds each value it fills in, and what the value looks like: every field of
// the Platform's databricks section, and every method setting a project is given as
// REPLACE_ME, has a description, a `find` and a `suggest` (or an example) for the editor.
import { methodReference, platformSectionReference, type FieldInfo } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

/**
 * The method settings a project is given as REPLACE_ME, as `<method>.<setting>`. Found by
 * reading every REPLACE_ME that the Databricks kits, the Databricks starters of the CLI
 * (retail, kafka, pyspark, salesforce, sql-server, minimal) and `ingestron init` on every
 * connector and route write: each is a connection setting, a flow's object, a Platform field
 * or a value in project.yaml, and none is a method setting of this pack. A setting added here
 * is checked like a Platform field.
 */
const filledIn: string[] = [];

/**
 * The connector settings a project is given as REPLACE_ME, as `<connector>.<setting>`: the
 * Databricks kit's connection (files) and the starters' and `ingestron init`'s connections
 * (files, and the Unity Catalog connection of each Lakeflow Connect source).
 */
const connectors = databricks.connectors ?? [];
const connectorFilledIn = [
  "files.path",
  "sqlserver.uc_connection",
  "salesforce.uc_connection",
  "kafka.uc_connection",
];

/** The fields that hold a value: those with no field below them. */
function leaves(fields: FieldInfo[]): FieldInfo[] {
  const paths = fields.map((field) => field.path.join("."));
  return fields.filter((field) => {
    const path = field.path.join(".");
    return !paths.some((other) => other.startsWith(`${path}.`));
  });
}

/** What a field lacks of a description, a `find`, and a `suggest` or an example. */
function missing(field: FieldInfo): string[] {
  return [
    ...(field.description ? [] : ["description"]),
    ...(field.find ? [] : ["find"]),
    ...(field.suggest !== undefined || field.example !== undefined ? [] : ["suggest"]),
  ];
}

const lacking = (fields: { name: string; field: FieldInfo }[]) =>
  fields.flatMap(({ name, field }) => {
    const absent = missing(field);
    return absent.length > 0 ? [`${name}: ${absent.join(", ")}`] : [];
  });

describe("find and suggest", () => {
  it("are given for every field of the Platform's databricks section", () => {
    const fields = leaves(platformSectionReference(databricks)).map((field) => ({
      name: field.path.join("."),
      field,
    }));
    expect(fields.length).toBeGreaterThan(0);
    expect(lacking(fields)).toEqual([]);
  });

  it("are given for every method setting a project fills in", () => {
    const fields = filledIn.map((name) => {
      const [method = "", ...path] = name.split(".");
      const field = methodReference(databricks, method).find(
        (item) => item.path.join(".") === path.join("."),
      );
      expect(field, `${name} is a setting of the pack`).toBeDefined();
      return { name, field: field! };
    });
    expect(lacking(fields)).toEqual([]);
  });

  it("are given for every connector setting a project fills in", () => {
    const absent = connectorFilledIn.flatMap((name) => {
      const [id, setting] = name.split(".");
      const found = connectors
        .find((connector) => connector.id === id)
        ?.settings.find((item) => item.name === setting);
      expect(found, `${name} is a connector setting of the pack`).toBeDefined();
      const lacks = (["description", "find", "suggest"] as const).filter((key) => !found?.[key]);
      return lacks.length > 0 ? [`${name}: ${lacks.join(", ")}`] : [];
    });
    expect(absent).toEqual([]);
  });

  it("suggests a volume's path for the files connector, as find describes it", () => {
    const path = connectors.find((connector) => connector.id === "files")?.settings[0];
    expect(path?.suggest).toBe("/Volumes/<catalog>/<schema>/<volume>");
    expect(path?.find).toContain(path?.suggest);
  });
});
