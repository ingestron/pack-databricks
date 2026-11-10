// What masks and row filters need of the platform once (spec section 8.7): the privileges an
// administrator gives run_as in prerequisites.sql, and what the request asks to exist.
import type { ResolvedModel } from "@ingestron/definitions";
import {
  functionsSchema,
  maskFunctionsUsed,
  policiesApplied,
  projectSchemas,
  quoteName,
  teamFunctions,
} from "../sql/index.js";

/** The schema of a function's three-part name. */
const schemaOf = (name: string) => name.split(".").slice(0, 2).join(".");

/**
 * The GRANT statements that let run_as create the mask functions, use the team's functions in
 * policies, and make and drop policies on the managed schemas. `principal` is quoted.
 */
export function governanceGrants(model: ResolvedModel, principal: string): string[] {
  const functions = functionsSchema(model);
  const team = teamFunctions(model);
  const others = team.map(schemaOf).filter((schema) => schema !== functions);
  const schemas = [...new Set([...(functions === undefined ? [] : [functions]), ...others])];
  const catalogs = [...new Set(schemas.map((schema) => schema.split(".")[0]!))];
  const to = ` TO ${principal};`;
  const managed = projectSchemas(model);
  return [
    ...catalogs.map((catalog) => `GRANT USE CATALOG ON CATALOG ${quoteName(catalog)}${to}`),
    ...schemas.map(
      (schema) =>
        `GRANT USE SCHEMA${schema === functions ? ", CREATE FUNCTION" : ""} ON SCHEMA ${quoteName(schema)}${to}`,
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
