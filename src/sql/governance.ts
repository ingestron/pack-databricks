// Masks and row filters as Unity Catalog policies, as the after-refresh task makes them (spec
// section 8.7). The definitions package has judged each table's masks and filters and recorded
// what is not applied; this reads that judgement and the platform's switches, never judging
// again, and says where each policy goes and which function it uses.
import {
  classificationTag,
  type ColumnMask,
  type FilterMatch,
  type ResolvedModel,
  type ResolvedTable,
  type RowFilter,
} from "@ingestron/definitions";
import { keptPrincipals } from "./access.js";
import { quoteName } from "./query.js";
import { sqlString } from "./text.js";

/** A mask function the task creates: its name as text and the expression it returns. */
export interface MaskFunction {
  name: string;
  returns: string;
}

/** A policy the task makes; names are text, which the task quotes after replacing values. */
export interface Policy {
  name: string;
  /** The securable, quoted: `SCHEMA <name>` or `TABLE <name>`. */
  on: string;
  kind: "COLUMN MASK" | "ROW FILTER";
  function: string;
  /** The `MATCH COLUMNS` condition, aliased `c` by the task. */
  match: string;
}

/** A schema or table of the project, and the Ingestron policies made on it. */
export interface Place {
  on: string;
  policies: string[];
}

/** The task's `GOVERNANCE`. */
export interface Governance {
  functions: MaskFunction[];
  policies: Policy[];
  places: Place[];
  /** The name prefixes of the policies the task may drop: those of the switches that are on. */
  owned: string[];
  unmasked: string[];
}

/**
 * What each built-in mask returns: a VARIANT, cast back to the column's type, so one function
 * masks a column of any type. A value that is not text is `NULL` for `hash` and `redact`.
 */
const builtIns: Record<"null" | "hash" | "redact", string> = {
  null: "NULL::VARIANT",
  hash: textOnly("sha2(try_cast(val AS STRING), 256)::VARIANT"),
  redact: textOnly("'****'::VARIANT"),
};

function textOnly(expression: string): string {
  return `CASE WHEN schema_of_variant(val) = 'STRING' THEN ${expression} ELSE NULL::VARIANT END`;
}

const notApplied = (table: ResolvedTable, feature: string, column?: string) =>
  (table.notApplied ?? []).some(
    (item) => item.feature === feature && (column === undefined || item.column === column),
  );

/** The table's masks the task applies: none with `manage.masks` off. */
export function appliedMasks(model: ResolvedModel, table: ResolvedTable): ColumnMask[] {
  if (!model.platform.manage.masks) return [];
  return (table.access?.masks ?? []).filter((mask) => !notApplied(table, "masks", mask.column));
}

/** The table's row filters the task applies: none with `manage.filters` off. */
export function appliedFilters(model: ResolvedModel, table: ResolvedTable): RowFilter[] {
  if (!model.platform.manage.filters || notApplied(table, "filters")) return [];
  return table.access?.filters ?? [];
}

/** The Platform's `databricks.governance.functions`, the schema of the masks' functions. */
export function functionsSchema(model: ResolvedModel): string | undefined {
  const governance = model.platform.sections.databricks?.governance as
    { functions?: unknown } | undefined;
  return typeof governance?.functions === "string" ? governance.functions : undefined;
}

/** A function's full name: a one-part name is in `governance.functions`. */
export function qualified(model: ResolvedModel, name: string): string {
  const schema = functionsSchema(model);
  return name.includes(".") || schema === undefined ? name : `${schema}.${name}`;
}

function maskFunction(model: ResolvedModel, mask: ColumnMask): string {
  return typeof mask.mask === "string"
    ? qualified(model, `ingestron_mask_${mask.mask}`)
    : qualified(model, mask.mask.function);
}

/** The built-in mask functions the tables apply, each once, in the order first applied. */
export function maskFunctionsUsed(model: ResolvedModel): MaskFunction[] {
  const used = model.tables.flatMap((table) =>
    appliedMasks(model, table).flatMap((mask) =>
      typeof mask.mask === "string" ? [mask.mask] : [],
    ),
  );
  return [...new Set(used)].map((mask) => ({
    name: qualified(model, `ingestron_mask_${mask}`),
    returns: builtIns[mask],
  }));
}

/**
 * The team's functions that applied masks and filters name, each once, in the order of the
 * tables, then of their masks and filters.
 */
export function teamFunctions(model: ResolvedModel): string[] {
  const names = model.tables.flatMap((table) => [
    ...appliedMasks(model, table).flatMap((mask) =>
      typeof mask.mask === "string" ? [] : [qualified(model, mask.mask.function)],
    ),
    ...appliedFilters(model, table).map((filter) => qualified(model, filter.function)),
  ]);
  return [...new Set(names)];
}

/** True when any table has a mask or filter the task applies, so it creates policies. */
export function policiesApplied(model: ResolvedModel): boolean {
  return model.tables.some(
    (table) => appliedMasks(model, table).length + appliedFilters(model, table).length > 0,
  );
}

/**
 * The policies are on the project's schemas when the bundle creates them (`manage.schemas`),
 * else on its tables.
 */
const onSchemas = (model: ResolvedModel) => model.platform.manage.schemas;

/** The tables the project keeps in Unity Catalog: not those that end at the landed files. */
const keptTables = (model: ResolvedModel) => model.tables.filter((table) => !table.endsAtFiles);

const schemaOf = ({ fullName }: ResolvedTable) =>
  `SCHEMA ${quoteName(`${fullName.catalog}.${fullName.schema}`)}`;

const tableOf = ({ fullName }: ResolvedTable) =>
  `TABLE ${quoteName(`${fullName.catalog}.${fullName.schema}.${fullName.table}`)}`;

/** The project's schemas as `catalog.schema`, each once, when the policies are on them. */
export function projectSchemas(model: ResolvedModel): string[] {
  if (!onSchemas(model)) return [];
  const names = keptTables(model).map(({ fullName }) => `${fullName.catalog}.${fullName.schema}`);
  return [...new Set(names)];
}

/** The match condition of a filter, as the standard writes it. */
function filterMatch(model: ResolvedModel, filter: RowFilter): string {
  const match = model.standard.governance?.filters?.[filter.name]?.match as FilterMatch;
  if ("classification" in match)
    return `has_tag_value(${sqlString(classificationTag(model))}, ${sqlString(match.classification)})`;
  if (match.value === undefined) return `has_tag(${sqlString(match.tag)})`;
  return `has_tag_value(${sqlString(match.tag)}, ${sqlString(match.value)})`;
}

/** The policies of the tables at one place: each masked classification, then each filter. */
function placePolicies(model: ResolvedModel, on: string, tables: ResolvedTable[]): Policy[] {
  const tag = classificationTag(model);
  const masks = new Map<string, Policy>();
  const filters = new Map<string, Policy>();
  for (const table of tables) {
    for (const mask of appliedMasks(model, table))
      if (!masks.has(mask.classification))
        masks.set(mask.classification, {
          name: `ingestron_mask_${mask.classification}`,
          on,
          kind: "COLUMN MASK",
          function: maskFunction(model, mask),
          match: `has_tag_value(${sqlString(tag)}, ${sqlString(mask.classification)})`,
        });
    for (const filter of appliedFilters(model, table))
      if (!filters.has(filter.name))
        filters.set(filter.name, {
          name: `ingestron_filter_${filter.name}`,
          on,
          kind: "ROW FILTER",
          function: qualified(model, filter.function),
          match: filterMatch(model, filter),
        });
  }
  return [...masks.values(), ...filters.values()];
}

/**
 * The task's `GOVERNANCE`, or undefined with `manage.masks` and `manage.filters` off. The
 * places are the project's schemas, when the policies are on them, then its tables.
 */
export function governanceOf(model: ResolvedModel): Governance | undefined {
  const { masks, filters } = model.platform.manage;
  if (!masks && !filters) return undefined;
  const tables = keptTables(model);
  const groups = new Map<string, ResolvedTable[]>();
  const place = onSchemas(model) ? schemaOf : tableOf;
  for (const table of tables)
    groups.set(place(table), [...(groups.get(place(table)) ?? []), table]);
  const policies = [...groups].flatMap(([on, group]) => placePolicies(model, on, group));
  const places = [...(onSchemas(model) ? [...groups.keys()] : []), ...tables.map(tableOf)].map(
    (on) => ({
      on,
      policies: policies.filter((policy) => policy.on === on).map((policy) => policy.name),
    }),
  );
  return {
    functions: maskFunctionsUsed(model),
    policies,
    places,
    owned: [...(masks ? ["ingestron_mask_"] : []), ...(filters ? ["ingestron_filter_"] : [])],
    unmasked: keptPrincipals(model),
  };
}
