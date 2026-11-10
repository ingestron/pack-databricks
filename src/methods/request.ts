// What the bundle expects of the workspace, for `ingestron request`: the
// objects that must exist before deploying, the job's schedule, and what exact
// grants remove.
import { classificationTag, type RequestSection, type ResolvedModel } from "@ingestron/definitions";
import { exactOn, keptPrincipals, tableGrants } from "../sql/index.js";

/** The Databricks sections of the platform request. Nothing here is checked. */
export function request(model: ResolvedModel): RequestSection[] {
  return [
    {
      title: "Must exist before deploying",
      intro: "Ingestron has not checked these; the generated files expect them.",
      lines: [...prerequisites(model), ...principals(model), ...governedTag(model)],
    },
    { title: "Schedules", lines: [schedule(model)] },
    ...exactGrants(model),
  ];
}

function prerequisites(model: ResolvedModel): string[] {
  const { platform } = model;
  const names = model.tables.map((table) => table.fullName);
  const catalogs = unique(names.map((name) => name.catalog));
  const schemas = platform.manage.schemas
    ? []
    : unique(names.map((name) => `${name.catalog}.${name.schema}`));
  const folders = unique(
    model.tables.flatMap((table) => {
      const folder = table.ingest?.settings.landing ?? table.ingest?.connection.settings.path;
      return typeof folder === "string" ? [folder] : [];
    }),
  );
  return [
    ...catalogs.map((catalog) => `Catalog \`${catalog}\`, which the deploying identity can use.`),
    ...schemas.map((schema) => `Schema \`${schema}\`, in which it can create tables and views.`),
    ...folders.map((folder) => `Files at \`${folder}\`, which the pipeline can read.`),
    platform.compute.serverless
      ? "Serverless compute for pipelines and jobs, turned on in the workspace."
      : "Classic compute that the pipelines may use.",
    ...(platform.workspace.host
      ? []
      : [
          "No workspace host is set, so `databricks bundle deploy` uses the workspace of the Databricks CLI profile that runs it.",
        ]),
  ];
}

/**
 * Each principal the tables are granted to, with the privileges it needs to reach them:
 * USE CATALOG, and USE SCHEMA unless the bundle manages the schemas and grants it.
 */
function principals(model: ResolvedModel): string[] {
  const reach = new Map<string, { catalogs: string[]; schemas: string[] }>();
  for (const table of model.tables)
    for (const { principal } of tableGrants(model, table)) {
      const found = reach.get(principal) ?? { catalogs: [], schemas: [] };
      found.catalogs.push(table.fullName.catalog);
      found.schemas.push(`${table.fullName.catalog}.${table.fullName.schema}`);
      reach.set(principal, found);
    }
  return [...reach].map(([principal, { catalogs, schemas }]) => {
    const schemaPart = model.platform.manage.schemas
      ? ""
      : ` and USE SCHEMA on ${listed(unique(schemas))}`;
    return `Principal ${code(principal)}, which is granted access to tables here, with USE CATALOG on ${listed(unique(catalogs))}${schemaPart}.`;
  });
}

/**
 * With masks or filters on and a classified column, the governed tag an account administrator
 * creates: their policies match governed tags, while plain tags need no administrator.
 */
function governedTag(model: ResolvedModel): string[] {
  const { manage } = model.platform;
  if (!manage.masks && !manage.filters) return [];
  const used = unique(
    model.tables.flatMap((table) =>
      table.contract.columns.flatMap((column) =>
        column.classification ? [column.classification] : [],
      ),
    ),
  );
  if (used.length === 0) return [];
  const values = model.standard.governance?.classification?.values ?? used;
  return [
    `Governed tag \`${classificationTag(model)}\`, with the values ${listed(values)}, which an account administrator creates; the run_as identity needs ASSIGN on it.`,
  ];
}

/** What exact grants remove and keep, and the tables, when any table has them. */
function exactGrants(model: ResolvedModel): RequestSection[] {
  const tables = model.tables.filter((table) => exactOn(model, table));
  if (tables.length === 0) return [];
  const kept = ["the run_as identity", ...keptPrincipals(model).map(code)];
  return [
    {
      title: "Exact grants",
      intro: `Exact grants are on. After each refresh, Ingestron removes every privilege granted directly on these tables to anyone their contracts and layers don't name, and any privilege a role's access doesn't give, such as MODIFY for a role that reads. It keeps ownership, grants on schemas and catalogs, ${and(kept)}. Before turning this on, move any access given by hand into the contracts.`,
      lines: tables.map(
        ({ fullName }) => `\`${fullName.catalog}.${fullName.schema}.${fullName.table}\``,
      ),
    },
  ];
}

function schedule(model: ResolvedModel): string {
  const { schedule } = model.platform;
  if (!schedule) return "No schedule: the pipelines run only when someone starts them.";
  const state = schedule.paused ? "paused" : "runs";
  return `Job \`${model.names.job}\`: \`${schedule.cron}\` (${schedule.timezone}), ${state}.`;
}

/** Names as Markdown code, joined with commas and `and`. */
function listed(names: string[]): string {
  return and(names.map(code));
}

/** A name as Markdown code; one with a backtick in it in double backticks. */
function code(name: string): string {
  return name.includes("`") ? `\`\` ${name} \`\`` : `\`${name}\``;
}

/** `a`, `a and b`, `a, b and c`. */
function and(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
