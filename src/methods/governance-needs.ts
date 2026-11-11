// What masks and row filters need of the platform once (spec section 8.7): the privileges an
// administrator gives run_as in prerequisites.sql, and what the request asks to exist.
import { classificationTag, type ResolvedModel } from "@ingestron/definitions";
import {
  appliedFilters,
  appliedMasks,
  functionsSchema,
  maskFunctionsUsed,
  policiesApplied,
  projectSchemas,
  quoteName,
  tagParts,
  teamFunctions,
} from "../sql/index.js";

/** The schema, as `catalog.schema`, of a function's three-part name. */
const functionSchemaOf = (name: string) => name.split(".").slice(0, 2).join(".");

/**
 * The GRANT statements that let run_as create the built-in mask functions, use the functions
 * the policies name, and make and drop policies on the managed schemas. `principal` is quoted.
 * A catalog the managed schemas' grant already gives USE CATALOG on is not given it again.
 */
export function governanceGrants(model: ResolvedModel, principal: string): string[] {
  const builtIns = maskFunctionsUsed(model).map((item) => item.name);
  const team = teamFunctions(model);
  const schemas = [...new Set([...builtIns, ...team].map(functionSchemaOf))];
  const creates = new Set(builtIns.map(functionSchemaOf));
  const used = new Set(
    model.platform.manage.schemas ? model.tables.map((table) => table.fullName.catalog) : [],
  );
  const catalogs = [...new Set(schemas.map((schema) => schema.split(".")[0]!))].filter(
    (catalog) => !used.has(catalog),
  );
  const to = ` TO ${principal};`;
  const managed = projectSchemas(model);
  return [
    ...catalogs.map((catalog) => `GRANT USE CATALOG ON CATALOG ${quoteName(catalog)}${to}`),
    ...schemas.map(
      (schema) =>
        `GRANT USE SCHEMA${creates.has(schema) ? ", CREATE FUNCTION" : ""} ON SCHEMA ${quoteName(schema)}${to}`,
    ),
    ...team.map((name) => `GRANT EXECUTE ON FUNCTION ${quoteName(name)}${to}`),
    ...(managed.length > 0
      ? [
          "-- The bundle creates these schemas: run the lines below after the first deployment, unless run_as deploys and so owns them.",
          ...managed.map((schema) => `GRANT MANAGE ON SCHEMA ${quoteName(schema)}${to}`),
        ]
      : []),
  ];
}

/**
 * What must exist before deploying, when any mask or filter is applied: the functions schema
 * for the built-in masks, the team's functions, and compute that can read tables with policies.
 */
export function governanceRequest(model: ResolvedModel, code: (name: string) => string): string[] {
  if (!policiesApplied(model)) return [];
  const functions = functionsSchema(model);
  const builtIn = maskFunctionsUsed(model).length > 0 && functions !== undefined;
  return [
    ...(builtIn
      ? [`Schema ${code(functions)}, in which the run_as identity creates the mask functions.`]
      : []),
    ...teamFunctions(model).map(
      (name) =>
        `Function ${code(name)}, which a mask or row filter uses; the run_as identity needs EXECUTE on it.`,
    ),
    "Serverless compute, or Databricks Runtime 16.4 or later, for everyone who reads the masked or filtered tables: older runtimes cannot read a table with a policy.",
  ];
}

/**
 * Masked classifications that differ only in letter case: their policies' names would clash, as
 * Unity Catalog names do not tell letter case apart, and the second would replace the first.
 */
export function maskNameProblems(model: ResolvedModel): string[] {
  const classifications = model.tables.flatMap((table) =>
    appliedMasks(model, table).map((mask) => mask.classification),
  );
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const classification of new Set(classifications)) {
    const first = seen.get(classification.toLowerCase());
    if (first === undefined) seen.set(classification.toLowerCase(), classification);
    else
      problems.push(
        `the masked classifications "${first}" and "${classification}" differ only in letter case, so their policies ingestron_mask_${first} and ingestron_mask_${classification} would clash; write them the same way`,
      );
  }
  return problems;
}

/** The tag key and value an applied filter matches with `{ tag }`, other than the classification's. */
function filterTagOf(
  model: ResolvedModel,
  name: string,
): { key: string; value?: string } | undefined {
  const match = model.standard.governance?.filters?.[name]?.match;
  if (!match || "classification" in match || match.tag === classificationTag(model))
    return undefined;
  return { key: match.tag, ...(match.value !== undefined && { value: match.value }) };
}

/** The values the table's contract gives the tag key on its columns. */
function columnValues(table: ResolvedModel["tables"][number], key: string): string[] {
  return table.contract.columns
    .flatMap((column) => column.tags ?? [])
    .map(tagParts)
    .filter(([tagKey, value]) => tagKey === key && value !== "")
    .map(([, value]) => value);
}

/**
 * The governed tag of each key that an applied row filter matches with `{ tag }`, other than the
 * classification's, which has its own line: with the values the filters and the contracts' column
 * tags give it, when they give any. A filter matches only governed tags.
 */
export function filterTags(
  model: ResolvedModel,
  code: (name: string) => string,
  listed: (names: string[]) => string,
): string[] {
  const keys = new Map<string, Set<string>>();
  for (const table of model.tables)
    for (const filter of appliedFilters(model, table)) {
      const tag = filterTagOf(model, filter.name);
      if (!tag) continue;
      const values = keys.get(tag.key) ?? new Set<string>();
      for (const value of [
        ...(tag.value === undefined ? [] : [tag.value]),
        ...columnValues(table, tag.key),
      ])
        values.add(value);
      keys.set(tag.key, values);
    }
  return [...keys].map(
    ([key, values]) =>
      `Governed tag ${code(key)}${values.size > 0 ? `, with the values ${listed([...values])}` : ""}, which a row filter matches; an account administrator creates it, and the run_as identity needs ASSIGN on it.`,
  );
}
