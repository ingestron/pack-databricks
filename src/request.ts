// What the bundle expects of the workspace, for `ingestron request`: the
// objects that must exist before deploying, and the job's schedule.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";

/** The Databricks sections of the platform request. Nothing here is checked. */
export function request(model: ResolvedModel): RequestSection[] {
  return [
    {
      title: "Must exist before deploying",
      intro: "Ingestron has not checked these; the generated files expect them.",
      lines: prerequisites(model),
    },
    { title: "Schedules", lines: [schedule(model)] },
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

function schedule(model: ResolvedModel): string {
  const { schedule } = model.platform;
  if (!schedule) return "No schedule: the pipelines run only when someone starts them.";
  const state = schedule.paused ? "paused" : "runs";
  return `Job \`${model.names.job}\`: \`${schedule.cron}\` (${schedule.timezone}), ${state}.`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
