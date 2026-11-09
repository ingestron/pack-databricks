// The bundle's YAML files, built as data and serialised (never templated).
// Built for one environment, every value is resolved; fold.ts turns the
// values that differ between environments into bundle variables.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { stringify } from "yaml";
import { jobAlerts } from "./alerts.js";
import { jobOperations, taskOperations } from "./operations.js";

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
  const extras = { ...pipelineExtras(model), ...eventLog(model, pipeline) };
  return { resources: { pipelines: { [names.pipeline]: { ...pipeline, ...extras } } } };
}

/**
 * With quality results, the pipeline publishes its event log, where the expectation
 * metrics are, to `<pipeline>_event_log` in the pipeline's own catalog and schema.
 */
export function eventLog(model: ResolvedModel, pipeline: Data): Data {
  if (!model.qualityResults) return {};
  const { name, catalog, schema } = pipeline;
  return { event_log: { catalog, schema, name: `${String(name)}_event_log` } };
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
 * Its alerts come from a model built `withAlerts`.
 */
export function jobFile(model: ResolvedModel, tasks: Task[]): Data | undefined {
  const { platform, names } = model;
  const python = tasks.some((task) => task.python);
  if ((!platform.schedule && !python) || tasks.length === 0) return undefined;
  const pipelineTask = taskOperations(model);
  const job: Data = {
    name: names.job,
    ...(platform.schedule && {
      schedule: {
        quartz_cron_expression: platform.schedule.cron,
        timezone_id: platform.schedule.timezone,
        pause_status: platform.schedule.paused ? "PAUSED" : "UNPAUSED",
      },
    }),
    ...jobOperations(model),
    tasks: tasks.map((task) => jobTask(task, pipelineTask)),
    ...(python && { environments: [environment] }),
  };
  if (Object.keys(platform.tags).length > 0) job.tags = platform.tags;
  return { resources: { jobs: { [names.job]: { ...job, ...jobAlerts(model) } } } };
}

/** A task of the job; a pipeline task also takes `pipelineTask`, its retries and timeout. */
function jobTask(task: Task, pipelineTask: Data): Data {
  return {
    task_key: task.key,
    ...(task.after.length > 0 && { depends_on: task.after.map((key) => ({ task_key: key })) }),
    ...(task.pipeline && {
      pipeline_task: { pipeline_id: `\${resources.pipelines.${task.pipeline}.id}` },
      ...pipelineTask,
    }),
    ...(task.python && {
      environment_key: environment.environment_key,
      spark_python_task: { python_file: task.python },
    }),
  };
}

/**
 * Bundle keys of the schemas this bundle manages, by `catalog.schema`, the same in every
 * environment where only the catalog differs: the layer when the layer has one schema,
 * else the schema's name. When two catalogs hold a schema of that name, or the key is
 * taken, it is `<catalog>_<schema>`. Empty unless `manage.schemas`.
 */
export function schemaKeys(model: ResolvedModel): Map<string, string> {
  if (!model.platform.manage.schemas) return new Map();
  const schemas = new Map<string, { catalog: string; schema: string; layer: string }>();
  for (const { fullName, layer } of model.tables)
    schemas.set(`${fullName.catalog}.${fullName.schema}`, { ...fullName, layer });
  const list = [...schemas.values()];
  const keys = new Map<string, string>();
  const used = new Set<string>();
  for (const { catalog, schema, layer } of list) {
    const alone = list.filter((other) => other.layer === layer).length === 1;
    const shared = list.filter((other) => other.schema === schema).length > 1;
    const both = `${catalog}_${schema}`;
    const key = alone ? layer : shared ? both : schema;
    const unique = used.has(key) ? both : key;
    used.add(unique);
    keys.set(`${catalog}.${schema}`, unique);
  }
  return keys;
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

/**
 * Tags and failure notifications, the same on every pipeline that builds tables. The
 * notifications come from a model built `withAlerts`.
 */
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
