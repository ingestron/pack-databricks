// Planning a fold: a template model, the first target's model with a marker
// for each value that differs between targets or is supplied when deploying,
// and the variables those markers stand for (spec/behaviour.md, section 2).
import {
  fullNameText,
  splitDeployText,
  type DeployValue,
  type EnvironmentsProblem,
  type ResolvedModel,
  type TargetDifference,
} from "@ingestron/definitions";
import { placeOf, segments, variableName } from "./fold-names.js";
import { foldCode, foldText, type TextFold } from "./fold-text.js";
import {
  deployVariable,
  deployVariables,
  marker,
  placeVariable,
  supply,
  type Models,
} from "./fold-values.js";
import { differ, listOf } from "./fold-problems.js";
import { mapStrings } from "../bundle/walk.js";

/** A fold's template, variables and the problems found while planning it. */
export interface Plan extends TextFold {
  template: ResolvedModel;
  /** The tags that are not the same in every target, by target. */
  tags: Record<string, Record<string, string>>;
  /** Values that differ but are not text or lists, left as the first target has them. */
  unfolded: TargetDifference[];
}

/** Values Databricks sets per target, written in each target as they are. */
const perTarget =
  /^\/(project\/environment|platform\/(mode|workspace|run_as|permissions|tags|schedule\/paused))(\/|$)/;
/** Transform inputs are full names, folded with the tables they name. */
const inputs = /^\/tables\/\d+\/transform\/inputs\//;

/** The template and variables for the targets' models, given where their values differ. */
export function planFold(models: Models, differing: readonly TargetDifference[]): Plan {
  const targets = Object.keys(models);
  const first = models[targets[0]!]!;
  const catalogs = targets.map((target) => pipelineCatalog(models[target]!));
  const plan: Plan = {
    targets,
    models,
    variables: deployVariables(models),
    problems: [],
    template: structuredClone(first),
    tags: splitTags(models, targets),
    unfolded: [],
  };
  for (const difference of differing) foldPlace(plan, difference, catalogs);
  for (const [index, table] of plan.template.tables.entries())
    if (table.transform) table.transform.inputs = retarget(first, plan.template, index);
  plan.template.platform.tags = commonTags(first, plan.tags);
  markDeployValues(plan);
  return plan;
}

/** The catalog of the pipeline that builds tables: that of its first table. */
export function pipelineCatalog(model: ResolvedModel): string | undefined {
  return (model.tables.find((table) => table.store) ?? model.tables[0])?.fullName.catalog;
}

function foldPlace(plan: Plan, difference: TargetDifference, catalogs: (string | undefined)[]) {
  const { pointer, values } = difference;
  if (perTarget.test(pointer) || inputs.test(pointer)) return;
  const path = segments(pointer);
  if (path[0] === "names") return plan.problems.push(renamed(plan, path[1]!, values));
  if (!plan.targets.every((target) => values[target] !== undefined))
    return plan.unfolded.push(difference);
  if (path[2] === "transform" && path[3] === "code" && path.length === 4)
    return foldTableCode(plan, Number(path[1]), values as Record<string, string>);
  const pipeline = JSON.stringify(Object.values(values)) === JSON.stringify(catalogs);
  if (!foldValue(plan, pointer, values, pipeline)) plan.unfolded.push(difference);
}

/**
 * A text becomes a variable, or a variable for its deploy-time part; a list whose
 * length differs becomes a complex variable. Other values stay as the first target
 * has them, and the check against each target's own bundle finds what that changes.
 */
function foldValue(
  plan: Plan,
  pointer: string,
  values: Record<string, unknown>,
  pipeline: boolean,
): boolean {
  const all = Object.values(values);
  const first = plan.models[plan.targets[0]!]!;
  const path = segments(pointer);
  if (all.every((value) => typeof value === "string")) {
    const place = placeOf(pointer, first, pipeline);
    setAt(plan.template, path, foldText(plan, values as Record<string, string>, place));
    return true;
  }
  if (all.every((value) => Array.isArray(value)) && !JSON.stringify(all).includes("${envvar:")) {
    const place = { ...placeOf(pointer, first, false), complex: true };
    setAt(plan.template, path, marker(placeVariable(plan.variables, place, values).name));
    return true;
  }
  return false;
}

function renamed(plan: Plan, what: string, values: Record<string, unknown>): EnvironmentsProblem {
  const [first, other] = plan.targets.filter((target) => values[target] !== undefined);
  return differ(
    `The ${what} is named "${String(values[first!])}" in ${first} and "${String(values[other!])}" in ${other}; resource keys and folders are named after it, so it must be the same in every environment.`,
    "project.yaml",
  );
}

function foldTableCode(plan: Plan, index: number, values: Record<string, string>) {
  const table = plan.template.tables[index]!;
  const code = foldCode(plan, values, (count) => ({
    name: variableName(table.name, "value"),
    description: `Part ${count} of the code of table ${table.name} that differs between environments.`,
  }));
  if (code === undefined) {
    const message = `The code of table "${table.name}" differs between ${listOf(plan.targets)} in more than values.`;
    plan.problems.push(differ(message, table.origin.file));
  } else table.transform!.code = code;
}

/** Sets the value at a path of segments. */
function setAt(model: ResolvedModel, path: string[], value: unknown): void {
  let node = model as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path[path.length - 1]!] = value;
}

/** A transform's inputs, named as the template names the tables they are. */
function retarget(first: ResolvedModel, template: ResolvedModel, index: number) {
  const entries = Object.entries(first.tables[index]!.transform!.inputs).map(([name, full]) => {
    const input = first.tables.findIndex((table) => fullNameText(table.fullName) === full);
    return [name, input < 0 ? full : fullNameText(template.tables[input]!.fullName)] as const;
  });
  return Object.fromEntries(entries);
}

/** The tags each target has that are not the same in every target. */
function splitTags(models: Models, targets: string[]): Record<string, Record<string, string>> {
  const keys = [
    ...new Set(targets.flatMap((target) => Object.keys(models[target]!.platform.tags))),
  ];
  const same = (key: string) =>
    new Set(targets.map((target) => models[target]!.platform.tags[key])).size === 1;
  return Object.fromEntries(
    targets.map((target) => {
      const tags = models[target]!.platform.tags;
      return [
        target,
        Object.fromEntries(
          Object.entries(tags).filter(([key]) => !same(key) && keys.includes(key)),
        ),
      ];
    }),
  );
}

function commonTags(first: ResolvedModel, differing: Plan["tags"]): Record<string, string> {
  const other = new Set(Object.values(differing).flatMap((tags) => Object.keys(tags)));
  return Object.fromEntries(Object.entries(first.platform.tags).filter(([key]) => !other.has(key)));
}

/** Values Databricks takes per target, and the model's list of deploy-time values. */
const notWalked = new Set([
  "/platform/workspace",
  "/platform/run_as",
  "/platform/permissions",
  "/deployValues",
]);

/** Each deploy-time value left in the template: the same in every target, so each supplies it. */
function markDeployValues(plan: Plan): void {
  const values = [
    ...new Map(
      Object.values(plan.models).flatMap((model) =>
        (model.deployValues ?? []).map((value) => [value.name, value] as const),
      ),
    ).values(),
  ];
  const mark = (text: string) => marked(plan, text, values);
  plan.template = mapStrings(plan.template, mark, (pointer) =>
    notWalked.has(pointer),
  ) as ResolvedModel;
}

function marked(plan: Plan, text: string, values: DeployValue[]): string {
  const parts = splitDeployText(text, values);
  if (parts.every((part) => typeof part === "string")) return text;
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      const variable = deployVariable(plan.variables, part.name);
      for (const target of plan.targets)
        plan.problems.push(...supply(variable, target, plan.models[target]!));
      return marker(variable.name);
    })
    .join("");
}
