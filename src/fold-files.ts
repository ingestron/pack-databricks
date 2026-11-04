// The folded bundle's files: the template rendered as one environment's
// bundle, then each marker made a bundle variable in YAML, a pipeline
// configuration value in SQL, or a task parameter of the after-refresh script.
import type { Data } from "./bundle.js";
import { bundleData, headerOf, scriptPath, written, type YamlFile } from "./build.js";
import { prerequisites } from "./capabilities.js";
import type { Plan } from "./fold-plan.js";
import { codeProblem, differ, listOf } from "./fold-problems.js";
import { pauseOf, targetSettings, type Targets } from "./fold-target.js";
import { hasMarker, marker, markers, type Variable } from "./fold-values.js";
import { configurationKey, pythonValues } from "./fold-python.js";
import { mapStrings } from "./walk.js";

/** The folded files, and each target's host when it is supplied when deploying. */
export interface Folded {
  files: Record<string, string>;
  hosts: Targets["hosts"];
  /** The variables the files declare. */
  declared: Variable[];
}

/** The files for every target, folded from the plan's template. */
export function foldFiles(plan: Plan): Folded {
  const { files, origins } = bundleData(plan.template);
  const { pipeline, job } = plan.template.names;
  const used = { configuration: new Set<string>(), parameters: new Set<string>() };
  for (const [path, file] of Object.entries(files)) {
    if (hasMarker(path)) plan.problems.push(named(path));
    const key = typeof file === "string" ? undefined : markedKey(file.data);
    if (key !== undefined) plan.problems.push(keyed(path, key));
    if (path.startsWith("prerequisites/")) delete files[path];
    else if (typeof file === "string") files[path] = foldCodeFile(plan, path, file, used, origins);
  }
  configure(files[`resources/${pipeline}.pipeline.yml`], pipeline, used.configuration);
  const refresh = jobOf(files[`resources/${job}.job.yml`], job);
  parameterise(refresh, used.parameters);
  const targets = targetSettings(plan);
  pause(plan, refresh, targets);
  for (const file of Object.values(files))
    if (typeof file !== "string") file.data = variablesIn(file.data) as Data;
  const declared = declare(plan, files, targets);
  addPrerequisites(plan, files);
  return { files: written(files), hosts: targets.hosts, declared };
}

function jobOf(file: YamlFile | string | undefined, job: string): Data | undefined {
  if (!file || typeof file === "string") return undefined;
  return ((file.data.resources as Data).jobs as Record<string, Data>)[job];
}

/** Each target's grants file, from its own model: an administrator runs it by hand. */
function addPrerequisites(plan: Plan, files: Record<string, YamlFile | string>): void {
  for (const target of plan.targets) {
    const model = plan.models[target]!;
    const needs = prerequisites(model, headerOf(model));
    if (needs) files[`prerequisites/${target}.sql`] = placeholders(plan, target, needs);
  }
}

function named(path: string) {
  return differ(
    `The generated file ${shown(path)} would be named after a value that differs between environments; names that decide files and resource keys must be the same in every environment.`,
    "project.yaml",
  );
}

function keyed(path: string, key: string) {
  return differ(
    `The resource key ${shown(key)} in ${path} would be named after a value that differs between environments; names that decide files and resource keys must be the same in every environment.`,
    "project.yaml",
  );
}

/** A text with each marker shown as `<variable>`. */
function shown(text: string): string {
  return text.replaceAll(markers, (_, name: string) => `<${name}>`);
}

/** The first key in a YAML document that holds a marker. */
function markedKey(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  for (const [key, value] of Object.entries(node)) {
    const found = hasMarker(key) ? key : markedKey(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Pipeline SQL takes `${ingestron.<name>}` from the pipeline's configuration; the script, from parameters. */
function foldCodeFile(
  plan: Plan,
  path: string,
  text: string,
  used: { configuration: Set<string>; parameters: Set<string> },
  origins: Record<string, string>,
): string {
  if (!hasMarker(text)) return text;
  const names = [...text.matchAll(markers)].map((match) => match[1]!);
  const kind = kindOf(plan, path);
  const folded = kind && foldedCode(plan, path, text, kind);
  if (!kind || folded === undefined) {
    plan.problems.push(codeProblem(plan, path, names, origins[path] ?? "project.yaml"));
    return text;
  }
  for (const name of names) (kind === "script" ? used.parameters : used.configuration).add(name);
  return folded;
}

/**
 * SQL and the script take `${ingestron.<name>}`; a PySpark file reads spark.conf.get,
 * except in the transform's own code. Undefined when the file cannot take the values.
 */
function foldedCode(plan: Plan, path: string, text: string, kind: string): string | undefined {
  if (kind !== "python")
    return text.replaceAll(markers, (_, name: string) => `\${${configurationKey(name)}}`);
  return userCode(plan, path) ? undefined : pythonValues(text);
}

/** The after-refresh script, or a SQL or Python file of the pipeline that builds the tables. */
function kindOf(plan: Plan, path: string): "script" | "sql" | "python" | undefined {
  const { pipeline } = plan.template.names;
  if (path === scriptPath(pipeline)) return "script";
  if (!path.startsWith(`src/${pipeline}/`)) return undefined;
  if (path.endsWith(".sql")) return "sql";
  return path.endsWith(".py") ? "python" : undefined;
}

/** True when the values are in a PySpark transform's own code, which the pack copies as it is. */
function userCode(plan: Plan, path: string): boolean {
  const name = path.replace(/^.*\//, "").replace(/\.py$/, "");
  const table = plan.template.tables.find((candidate) => candidate.name === name);
  return hasMarker(table?.transform?.code ?? "");
}

function configure(file: YamlFile | string | undefined, pipeline: string, names: Set<string>) {
  if (!file || typeof file === "string" || names.size === 0) return;
  const pipelines = (file.data.resources as Data).pipelines as Record<string, Data>;
  const configuration = Object.fromEntries(
    [...names].map((name) => [configurationKey(name), marker(name)]),
  );
  pipelines[pipeline] = { ...pipelines[pipeline], configuration };
}

function parameterise(job: Data | undefined, names: Set<string>) {
  if (!job || names.size === 0) return;
  for (const task of job.tasks as Data[]) {
    const python = task.spark_python_task as Data | undefined;
    if (python)
      python.parameters = [...names].map((name) => `${configurationKey(name)}=${marker(name)}`);
  }
}

/** The refresh job's pause, when it differs: unset in the job and set per target, or a variable. */
function pause(plan: Plan, job: Data | undefined, targets: Targets) {
  const schedule = job?.schedule as Data | undefined;
  if (!schedule) return;
  const how = pauseOf(plan);
  if (how.kind === "same") return;
  if (how.kind === "variable") {
    schedule.pause_status = marker(how.variable.name);
    return;
  }
  delete schedule.pause_status;
  for (const [target, status] of Object.entries(how.presets)) {
    const settings = targets.settings[target]!;
    settings.presets = { ...(settings.presets as Data | undefined), trigger_pause_status: status };
  }
}

/** Each marker in YAML becomes `${var.<name>}`. */
function variablesIn(node: unknown): unknown {
  return mapStrings(node, (text) =>
    text.replaceAll(markers, (_, name: string) => `\${var.${name}}`),
  );
}

/** Declares the variables the files use, sets them in each target, and writes the targets. */
function declare(
  plan: Plan,
  files: Record<string, YamlFile | string>,
  targets: Targets,
): Variable[] {
  const text = JSON.stringify([Object.values(files), targets.settings]);
  const used = new Set([...text.matchAll(/\$\{var\.([a-z0-9_]+)\}/g)].map((match) => match[1]!));
  const declared = plan.variables.list.filter((variable) => used.has(variable.name));
  const variables = Object.fromEntries(
    declared.map((variable) => [
      variable.name,
      { description: describe(plan, variable), ...(variable.complex && { type: "complex" }) },
    ]),
  );
  for (const target of plan.targets) {
    const set = declared.filter((variable) => setsVariable(target, variable));
    const values = Object.fromEntries(
      set.map((variable) => [variable.name, variable.values[target]]),
    );
    if (set.length > 0) targets.settings[target]!.variables = values;
  }
  const bundle = files["databricks.yml"] as YamlFile;
  const { bundle: name, include, sync } = bundle.data;
  bundle.data = {
    bundle: name,
    include,
    sync,
    ...(declared.length > 0 && { variables }),
    targets: targets.settings,
  };
  return declared;
}

/** A deploy-time value's variable says which targets leave it to the pipeline. */
function describe(plan: Plan, variable: Variable): string {
  if (!variable.deploy || variable.supplied.size === plan.targets.length)
    return variable.description;
  const supplied = plan.targets.filter((target) => variable.supplied.has(target));
  return `Supplied when deploying to ${listOf(supplied)}, as BUNDLE_VAR_${variable.name} (${variable.deploy} in the definitions); the other targets set it.`;
}

/** Whether a target sets the variable, rather than leaving it to the deploying CI pipeline. */
function setsVariable(target: string, variable: Variable): boolean {
  return variable.values[target] !== undefined && !variable.supplied.has(target);
}

/** A file run by hand cannot take a value supplied when deploying: it names the variable to fill in. */
function placeholders(plan: Plan, target: string, text: string): string {
  return (plan.models[target]!.deployValues ?? []).reduce(
    (result, value) => result.replaceAll(value.text, `<value of ${value.name}>`),
    text,
  );
}
