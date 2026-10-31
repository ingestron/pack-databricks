// The bundle's YAML files, built as data and serialised (never templated),
// with every value resolved: the bundle has no variables.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { stringify } from "yaml";

type Data = Record<string, unknown>;

/** `databricks.yml`: one target, named after the environment. */
export function bundleFile(model: ResolvedModel): Data {
  const { platform } = model;
  const target: Data = { mode: platform.mode, default: true };
  if (platform.workspace.host || platform.workspace.root_path)
    target.workspace = { ...platform.workspace };
  if (platform.run_as) target.run_as = platform.run_as;
  if (platform.permissions.length > 0) target.permissions = platform.permissions;
  return {
    bundle: { name: model.project.id },
    include: ["resources/*.yml"],
    targets: { [model.project.environment]: target },
  };
}

/** The pipeline that builds the tables with SQL files under `src/`. */
export function pipelineFile(
  model: ResolvedModel,
  tables: ResolvedTable[],
  schemaKeys: Map<string, string>,
): Data {
  const { platform, names } = model;
  const first = tables[0]!.fullName;
  const pipeline: Data = {
    name: names.pipeline,
    catalog: first.catalog,
    schema: schemaRef(schemaKeys, first.catalog, first.schema),
    serverless: platform.compute.serverless,
    ...(platform.compute.budget_policy_id && {
      budget_policy_id: platform.compute.budget_policy_id,
    }),
    ...(platform.compute.channel && { channel: platform.compute.channel }),
    root_path: `../src/${names.pipeline}`,
    libraries: [{ glob: { include: `../src/${names.pipeline}/**` } }],
  };
  return {
    resources: { pipelines: { [names.pipeline]: { ...pipeline, ...pipelineExtras(model) } } },
  };
}

/** A task of the refresh job: a pipeline to refresh, or a Python file to run, after others. */
export interface Task {
  key: string;
  pipeline?: string;
  /** A Python file, relative to the job's resource file, run on serverless. */
  python?: string;
  after: string[];
}

/** The serverless environment Python tasks run in. */
const environment = { environment_key: "ingestron", spec: { environment_version: "6" } };

/**
 * A job that refreshes the pipelines in order, on the platform's schedule.
 * With a Python task it is built without a schedule too, to run on demand.
 */
export function jobFile(model: ResolvedModel, tasks: Task[]): Data | undefined {
  const { platform, names } = model;
  const python = tasks.some((task) => task.python);
  if ((!platform.schedule && !python) || tasks.length === 0) return undefined;
  const job: Data = {
    name: names.job,
    ...(platform.schedule && {
      schedule: {
        quartz_cron_expression: platform.schedule.cron,
        timezone_id: platform.schedule.timezone,
        pause_status: platform.schedule.paused ? "PAUSED" : "UNPAUSED",
      },
    }),
    tasks: tasks.map(jobTask),
    ...(python && { environments: [environment] }),
  };
  if (Object.keys(platform.tags).length > 0) job.tags = platform.tags;
  if (platform.notifications.on_failure.length > 0)
    job.email_notifications = { on_failure: platform.notifications.on_failure };
  return { resources: { jobs: { [names.job]: job } } };
}

function jobTask(task: Task): Data {
  return {
    task_key: task.key,
    ...(task.after.length > 0 && { depends_on: task.after.map((key) => ({ task_key: key })) }),
    ...(task.pipeline && {
      pipeline_task: { pipeline_id: `\${resources.pipelines.${task.pipeline}.id}` },
    }),
    ...(task.python && {
      environment_key: environment.environment_key,
      spark_python_task: { python_file: task.python },
    }),
  };
}

/** Bundle keys of the schemas this bundle manages, by `catalog.schema`. Empty unless `manage.schemas`. */
export function schemaKeys(model: ResolvedModel): Map<string, string> {
  if (!model.platform.manage.schemas) return new Map();
  const keys = model.tables.map(
    ({ fullName }) =>
      [`${fullName.catalog}.${fullName.schema}`, `${fullName.catalog}_${fullName.schema}`] as const,
  );
  return new Map(keys);
}

/** A schema's name, or a reference to it when the bundle manages it, so the bundle creates it first. */
export function schemaRef(keys: Map<string, string>, catalog: string, schema: string): string {
  const key = keys.get(`${catalog}.${schema}`);
  return key ? `\${resources.schemas.${key}.name}` : schema;
}

/** Managed schemas, with the platform's grants for their layer. */
export function schemasFile(model: ResolvedModel, keys: Map<string, string>): Data | undefined {
  if (keys.size === 0) return undefined;
  const schemas: Data = {};
  for (const table of uniqueSchemas(model.tables)) {
    const key = keys.get(`${table.fullName.catalog}.${table.fullName.schema}`) as string;
    const grants = model.platform.grants[table.layer] ?? [];
    schemas[key] = {
      catalog_name: table.fullName.catalog,
      name: table.fullName.schema,
      comment: `Layer ${table.layer} of ${model.project.id}.`,
      ...(grants.length > 0 && { grants }),
    };
  }
  return { resources: { schemas } };
}

function uniqueSchemas(tables: ResolvedTable[]): ResolvedTable[] {
  const seen = new Set<string>();
  return tables.filter(({ fullName }) => {
    const key = `${fullName.catalog}.${fullName.schema}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tags and failure notifications, the same on every pipeline. */
export function pipelineExtras(model: ResolvedModel): Data {
  const { platform } = model;
  const alerts = ["on-update-failure", "on-update-fatal-failure", "on-flow-failure"];
  return {
    ...(Object.keys(platform.tags).length > 0 && { tags: platform.tags }),
    ...(platform.notifications.on_failure.length > 0 && {
      notifications: [{ email_recipients: platform.notifications.on_failure, alerts }],
    }),
  };
}

/** YAML text with header comments, one per line given. */
export function yamlText(headers: string | string[], data: Data): string {
  const comments = (Array.isArray(headers) ? headers : [headers])
    .map((line) => `# ${line}\n`)
    .join("");
  return `${comments}${stringify(data, { lineWidth: 0 })}`;
}
