// What Databricks makes of the folded bundle for one target, in the layout of
// that target's own bundle (spec/behaviour.md, section 4): the fold property
// compares it with what `build` gives for the target alone.
import { isDeepStrictEqual } from "node:util";
import { splitDeployText, type ResolvedModel, type SuppliedValue } from "@ingestron/definitions";
import { parse, stringify } from "yaml";
import type { Data } from "./bundle.js";
import { mapStrings } from "./walk.js";

/** What the deploying pipeline supplies for one target, as the deploy-time values' text. */
export interface Supplied {
  /** Each variable the pipeline supplies as BUNDLE_VAR_<name>, by name. */
  variables: Record<string, string>;
  /** The host, when the pipeline supplies it as DATABRICKS_HOST. */
  host?: string;
  /** Each deploy-time value's text, by NAME. */
  values: Record<string, string>;
}

/** What the pipeline supplies for a target, from the fold's deploy-time values. */
export function suppliedFor(
  model: ResolvedModel,
  deployValues: readonly SuppliedValue[],
): Supplied {
  const prefix = "BUNDLE_VAR_";
  const variables = Object.fromEntries(
    deployValues.flatMap((value) =>
      value.suppliedAs
        .filter((name) => name.startsWith(prefix))
        .map((name) => [name.slice(prefix.length), `\${envvar:${value.name}}`]),
    ),
  );
  const host = model.platform.workspace.host ?? "";
  const parts = splitDeployText(host, model.deployValues ?? []);
  const whole = parts.length === 1 && typeof parts[0] !== "string";
  const values = Object.fromEntries(
    (model.deployValues ?? []).map((value) => [value.name, value.text]),
  );
  return { variables, ...(whole && { host }), values };
}

/** Whether two texts at one path are the same: YAML as data, other files as text. */
export function sameFile(path: string, viewed: string, rendered: string): boolean {
  return path.endsWith(".yml")
    ? isDeepStrictEqual(parse(viewed), parse(rendered))
    : viewed === rendered;
}

/** Folder → `${key}` → value: what the pipelines' configuration and the job's parameters give the code. */
type Values = Record<string, Record<string, string>>;

/** The folded files as Databricks deploys them for `target`, laid out as `build` lays out one target. */
export function bundleView(
  files: Readonly<Record<string, string>>,
  target: string,
  supplied: Supplied,
): Record<string, string> {
  const bundle = parse(files["databricks.yml"]!) as Data;
  const settings = (bundle.targets as Record<string, Data>)[target]!;
  const values = { ...supplied.variables, ...(settings.variables as Data | undefined) };
  const resolve = (node: unknown) => resolved(node, values);
  const presets = resolve(settings.presets ?? {}) as Data;
  const code: Values = {};
  const view: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (path === "databricks.yml")
      view[path] = stringify(resolve(bundleOf(bundle, target, supplied)));
    else if (path.startsWith("resources/")) {
      const data = resolve(parse(text)) as Data;
      applyPresets(data, presets, settings.mode === "development");
      takeValues(data, code);
      view[path] = stringify(data);
    } else if (path === `prerequisites/${target}.sql`) view[path] = deployTexts(text, supplied);
    else if (!path.startsWith("prerequisites/")) view[path] = text;
  }
  for (const [path, text] of Object.entries(view)) view[path] = withValues(path, text, code);
  return view;
}

function bundleOf(bundle: Data, target: string, supplied: Supplied): Data {
  const settings = { ...(bundle.targets as Record<string, Data>)[target] };
  delete settings.variables;
  delete settings.presets;
  const workspace = settings.workspace as Data | undefined;
  if (supplied.host && !workspace?.host) settings.workspace = { ...workspace, host: supplied.host };
  const { bundle: name, include, sync } = bundle;
  return { bundle: name, include, sync, targets: { [target]: { ...settings, default: true } } };
}

/** Each `${var.<name>}` replaced: a whole value by the variable's value, a part by its text. */
function resolved(node: unknown, values: Data): unknown {
  return mapStrings(node, (text) => {
    const whole = /^\$\{var\.([a-z0-9_]+)\}$/.exec(text);
    if (whole && values[whole[1]!] !== undefined) return values[whole[1]!];
    return text.replace(/\$\{var\.([a-z0-9_]+)\}/g, (found, name: string) =>
      values[name] === undefined ? found : String(values[name]),
    );
  });
}

/**
 * Presets as Databricks applies them: tags that a resource does not set, the pause of
 * schedules that do not set one (development mode pauses them), and no continuous
 * pipelines under a PAUSED preset.
 */
function applyPresets(data: Data, presets: Data, development: boolean): void {
  const resources = { jobs: {}, pipelines: {}, ...(data.resources as Data | undefined) };
  const jobs = Object.values(resources.jobs as Record<string, Data>);
  const pipelines = Object.values(resources.pipelines as Record<string, Data>);
  const tags = { ...(presets.tags as Record<string, string> | undefined) };
  if (Object.keys(tags).length > 0)
    for (const resource of [...jobs, ...pipelines])
      resource.tags = { ...tags, ...dropEmpty(resource.tags) };
  const pause = presets.trigger_pause_status as string | undefined;
  if (pause === "PAUSED") for (const pipeline of pipelines) delete pipeline.continuous;
  const status = pause ?? (development ? "PAUSED" : "UNPAUSED");
  for (const job of jobs) pauseSchedule(job, status);
}

function pauseSchedule(job: Data, status: string): void {
  const schedule = job.schedule as Data | undefined;
  if (schedule && !schedule.pause_status) schedule.pause_status = status;
}

function dropEmpty(tags: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries((tags ?? {}) as Record<string, string>).filter(([, value]) => value !== ""),
  );
}

/** Takes the pipelines' `ingestron.*` configuration and the job's `ingestron.*` parameters out, by folder or file. */
function takeValues(data: Data, code: Values): void {
  const resources = (data.resources ?? {}) as Record<string, Record<string, Data>>;
  for (const pipeline of Object.values(resources.pipelines ?? {}))
    takeConfiguration(pipeline, code);
  for (const job of Object.values(resources.jobs ?? {}))
    for (const task of (job.tasks ?? []) as Data[]) takeParameters(task, code);
}

function takeConfiguration(pipeline: Data, code: Values): void {
  const configuration = pipeline.configuration as Record<string, string> | undefined;
  if (!configuration) return;
  const folder = `${String(pipeline.root_path ?? "").replace(/^\.\.\//, "")}/`;
  for (const [key, value] of Object.entries(configuration)) {
    if (!key.startsWith("ingestron.")) continue;
    code[folder] = { ...code[folder], [`\${${key}}`]: value };
    delete configuration[key];
  }
  if (Object.keys(configuration).length === 0) delete pipeline.configuration;
}

function takeParameters(task: Data, code: Values): void {
  const python = task.spark_python_task as Data | undefined;
  const parameters = (python?.parameters ?? []) as string[];
  if (!python || parameters.length === 0) return;
  const file = String(python.python_file).replace(/^\.\.\//, "");
  for (const parameter of parameters) {
    const [key, value] = parameter.split(/=(.*)/s) as [string, string];
    code[file] = { ...code[file], [`\${${key}}`]: JSON.stringify(value).slice(1, -1) };
  }
  delete python.parameters;
}

/** Pipeline SQL with its folder's configuration values; the script with its parameters. */
function withValues(path: string, text: string, code: Values): string {
  const applies = Object.entries(code).filter(([at]) =>
    at.endsWith("/") ? path.startsWith(at) && path.endsWith(".sql") : path === at,
  );
  return applies.reduce(
    (result, [, values]) =>
      Object.entries(values).reduce(
        (inner, [key, value]) => inner.replaceAll(key, () => value),
        result,
      ),
    text,
  );
}

/** The grants file's placeholders, as the deploy-time values they stand for. */
function deployTexts(text: string, supplied: Supplied): string {
  return Object.entries(supplied.values).reduce(
    (result, [name, value]) => result.replaceAll(`<value of ${name}>`, () => value),
    text,
  );
}
