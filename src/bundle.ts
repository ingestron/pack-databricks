// The bundle's YAML files, built as data and serialised (never templated).
// Built for one environment, every value is resolved; fold.ts turns the
// values that differ between environments into bundle variables.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { stringify } from "yaml";

/** A YAML document as data. */
export type Data = Record<string, unknown>;

/**
 * Files in the bundle folder that are not deployed: the generation manifest, its lock
 * (left behind if writing stops part way), and the grants an administrator runs by hand.
 */
export const notDeployed = [".generated.json", ".generated.lock", "prerequisites/**"];

/** `databricks.yml`: one target, named after the environment. */
export function bundleFile(model: ResolvedModel): Data {
  return {
    bundle: { name: model.project.id },
    include: ["resources/*.yml"],
    sync: { exclude: notDeployed },
    targets: { [model.project.environment]: { ...targetOf(model), default: true } },
  };
}

/** The settings Databricks takes per target: mode, workspace, run_as and permissions. */
export function targetOf(model: ResolvedModel): Data {
  const { platform } = model;
  const target: Data = { mode: platform.mode };
  const workspace = Object.fromEntries(
    Object.entries(platform.workspace).filter(([, value]) => value),
  );
  if (Object.keys(workspace).length > 0) target.workspace = workspace;
  if (platform.run_as) target.run_as = platform.run_as;
  if (platform.permissions.length > 0) target.permissions = platform.permissions;
  return target;
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

/**
 * Bundle keys of the schemas this bundle manages, by `catalog.schema`: the layer, the
 * same in every environment, or `<catalog>_<schema>` for a layer with several schemas.
 * Empty unless `manage.schemas`.
 */
export function schemaKeys(model: ResolvedModel): Map<string, string> {
  if (!model.platform.manage.schemas) return new Map();
  const schemas = new Map<string, string>();
  for (const { fullName, layer } of model.tables)
    schemas.set(`${fullName.catalog}.${fullName.schema}`, layer);
  const perLayer = new Map<string, number>();
  for (const layer of schemas.values()) perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1);
  return new Map(
    [...schemas].map(([name, layer]) => [
      name,
      perLayer.get(layer) === 1 ? layer : name.replace(".", "_"),
    ]),
  );
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

/** The platform's tags, on every pipeline and job. */
export function pipelineTags(model: ResolvedModel): Data {
  const { tags } = model.platform;
  return Object.keys(tags).length > 0 ? { tags } : {};
}

/** Tags and failure notifications, the same on every pipeline that builds tables. */
export function pipelineExtras(model: ResolvedModel): Data {
  const { platform } = model;
  const alerts = ["on-update-failure", "on-update-fatal-failure", "on-flow-failure"];
  return {
    ...pipelineTags(model),
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
