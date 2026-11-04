// The bundle variables of a fold: one per value that differs between targets,
// and one per deploy-time value. While folding, a variable stands in the files
// as a marker, which becomes `${var.<name>}` or `${ingestron.<name>}`.
import type { EnvironmentsProblem, ResolvedModel } from "@ingestron/definitions";

/** One bundle variable. */
export interface Variable {
  name: string;
  description: string;
  /** A list, declared `type: complex`. */
  complex?: boolean;
  /** Each target's value; a target not here leaves it to the deploying pipeline. */
  values: Record<string, unknown>;
  /** For a deploy-time value: its NAME, as in `${envvar:NAME}`. */
  deploy?: string;
  /** Targets in which the deploying pipeline must supply it. */
  supplied: Set<string>;
}

/** Every variable of a fold, in the order made. */
export interface Variables {
  list: Variable[];
  /** Variables for values that differ, by their values in target order. */
  byValues: Map<string, Variable>;
}

const open = "⟦";
const close = "⟧";

/** The marker that stands for a variable while folding. */
export function marker(name: string): string {
  return `${open}${name}${close}`;
}

/** Each marker in a text, with the variable's name. */
export const markers = /⟦([^⟦⟧]+)⟧/g;

/** True when a text holds a marker. */
export function hasMarker(text: string): boolean {
  return text.includes(open);
}

/** A variable's name from a deploy-time value's NAME: lower case, `_` for other characters. */
export function deployName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function unique(variables: Variables, name: string): string {
  const taken = new Set(variables.list.map((variable) => variable.name));
  let candidate = name;
  for (let count = 2; taken.has(candidate); count += 1) candidate = `${name}_${count}`;
  return candidate;
}

/** The variable for a value that differs: the same one for the same values in every target. */
export function placeVariable(
  variables: Variables,
  place: { name: string; description: string; complex?: boolean },
  values: Record<string, unknown>,
): Variable {
  const key = JSON.stringify(Object.values(values));
  const found = variables.byValues.get(key);
  if (found) return found;
  const variable = {
    ...place,
    name: unique(variables, place.name),
    values,
    supplied: new Set<string>(),
  };
  variables.list.push(variable);
  variables.byValues.set(key, variable);
  return variable;
}

/** The variable of each deploy-time value in the models, in the order they first appear. */
export function deployVariables(models: Readonly<Record<string, ResolvedModel>>): Variables {
  const variables: Variables = { list: [], byValues: new Map() };
  for (const model of Object.values(models))
    for (const value of model.deployValues ?? []) {
      if (variables.list.some((variable) => variable.deploy === value.name)) continue;
      const name = unique(variables, deployName(value.name));
      variables.list.push({
        name,
        description: `Supplied when deploying, as BUNDLE_VAR_${name} (${value.name} in the definitions).`,
        values: {},
        deploy: value.name,
        supplied: new Set(),
      });
    }
  return variables;
}

/** The variable of a deploy-time value. */
export function deployVariable(variables: Variables, name: string): Variable {
  return variables.list.find((variable) => variable.deploy === name)!;
}

/** Where a target's deploy-time value is used, for a problem's location. */
export function useOf(
  model: ResolvedModel | undefined,
  name: string,
): { file: string; line?: number } {
  const use = model?.deployValues?.find((value) => value.name === name)?.uses[0];
  return use
    ? { file: use.file, ...(use.line !== undefined && { line: use.line }) }
    : { file: "project.yaml" };
}

/** A `DEPLOY_VALUE` error at a deploy-time value's first use in a target. */
export function deployProblem(
  message: string,
  model: ResolvedModel | undefined,
  name: string,
): EnvironmentsProblem {
  return { code: "DEPLOY_VALUE", severity: "error", message, ...useOf(model, name) };
}

/** The deploying pipeline supplies the value in this target; a problem if the target sets it. */
export function supply(
  variable: Variable,
  target: string,
  model: ResolvedModel,
): EnvironmentsProblem[] {
  variable.supplied.add(target);
  if (variable.values[target] === undefined) return [];
  return [
    conflict(
      variable,
      target,
      model,
      `writes "${String(variable.values[target])}" for it elsewhere`,
    ),
  ];
}

/** The target sets the deploy-time value's variable to this text; a problem if it cannot. */
export function setIn(
  variable: Variable,
  target: string,
  text: string,
  model: ResolvedModel,
): EnvironmentsProblem[] {
  const current = variable.values[target];
  if (variable.supplied.has(target))
    return [conflict(variable, target, model, `writes "${text}" where other environments use it`)];
  if (current !== undefined && current !== text)
    return [conflict(variable, target, model, `writes "${String(current)}" and "${text}" for it`)];
  variable.values[target] = text;
  return [];
}

function conflict(variable: Variable, target: string, model: ResolvedModel, what: string) {
  const text = `\${envvar:${variable.deploy}}`;
  return deployProblem(
    `${text} stands for one value in each environment, but ${target} ${what}.`,
    model,
    variable.deploy!,
  );
}
