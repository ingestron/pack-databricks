// What the Databricks pack does with each ODCS contract field: used, not yet
// (with why), or handled elsewhere. The documentation and the editor show
// these, and a contract field no pack uses yet is a warning.
import { contractCommon, type ContractUse } from "@ingestron/definitions";

const used = (does: string): ContractUse => ({ use: "used", does });
/** Used when the platform turns the capability on, after each refresh. */
const needs = (id: string, does: string): ContractUse => ({ use: "used", does, needs: id });
/** Used, with the fields under it read as part of it. */
const whole = (does: string): ContractUse => ({ use: "used", does, whole: true });
const notYet = (reason: string): ContractUse => ({ use: "not-yet", reason });
const elsewhere = (reason: string): ContractUse => ({ use: "elsewhere", reason });
const object = "schema.*";
const column = "schema.*.properties.*";
const tags = needs(
  "tags",
  "Set as Unity Catalog tags after each refresh; key:value gives a value.",
);
const relationships = notYet("Relationships between tables are not declared on the tables yet.");

/** The Databricks pack's use of every contract field, by path. */
export const contract: Record<string, ContractUse> = {
  ...contractCommon,
  schema: used("One object per table; each table uses the object named like it."),
  [`${object}.name`]: used("Matched to the table by its name."),
  [`${object}.logicalType`]: { use: "documentation" },
  [`${object}.physicalName`]: elsewhere("The table's name comes from the standard's naming."),
  [`${object}.physicalType`]: elsewhere(
    "The store method decides: a streaming table or a materialised view.",
  ),
  [`${object}.description`]: used("The table's comment."),
  [`${object}.properties`]: used("The table's columns."),
  [`${object}.relationships`]: relationships,
  [`${object}.quality`]: {
    use: "used",
    whole: true,
    needs: "checks",
    does: "Rules with a comparison are counted over all rows after each refresh, then warn or fail the run as quality.default says.",
  },
  [`${object}.tags`]: tags,
  [`${column}.name`]: used("The column's name in the table."),
  [`${column}.logicalType`]: used(
    "The column's type, through the standard's types; a schema hint when reading files.",
  ),
  [`${column}.physicalType`]: used("The column's type, as written."),
  [`${column}.required`]: used(
    "A not-null expectation with the standard's quality.required action.",
  ),
  [`${column}.primaryKey`]: used("The keys that upsert and history keep the current row by."),
  [`${column}.primaryKeyPosition`]: used("The order of the keys."),
  [`${column}.physicalName`]: used(
    "The column's name at the source: files are read with it renamed to the contract's name. Lakeflow Connect keeps source names, so it refuses physicalName.",
  ),
  [`${column}.logicalTypeOptions`]: whole(
    "Limits become expectations with quality.default's action: length, pattern, minimum and maximum, multipleOf and array items. format is documentation.",
  ),
  [`${column}.unique`]: needs("checks", "A table check after each refresh that no value repeats."),
  [`${column}.partitioned`]: elsewhere(
    "Tables use liquid clustering; set the store method's cluster_by.",
  ),
  [`${column}.partitionKeyPosition`]: elsewhere(
    "Tables use liquid clustering; set the store method's cluster_by.",
  ),
  [`${column}.classification`]: needs(
    "tags",
    "Set as the column's tag classification after each refresh.",
  ),
  [`${column}.encryptedName`]: elsewhere("Encryption is managed outside Ingestron."),
  [`${column}.relationships`]: relationships,
  [`${column}.quality`]: whole(
    "Rules that allow no failing row (nullValues, missingValues, invalidValues with mustBe: 0) become expectations; the others are a warning.",
  ),
  [`${column}.description`]: needs(
    "comments",
    "Set as the column's comment after each refresh: a pipeline takes column comments only with every column's type.",
  ),
  [`${column}.tags`]: tags,
  [`${column}.properties`]: notYet(
    "The fields of an object column are not read yet; give the column's physicalType, such as STRUCT<street: STRING>.",
  ),
  [`${column}.items`]: notYet(
    "The element of an array column is not read yet; give the column's physicalType, such as ARRAY<STRING>.",
  ),
};
