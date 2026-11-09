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
});
