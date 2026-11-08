// The problems a fold reports, and the checks on the targets that need more
// than a comparison of values (spec/behaviour.md, section 5).
import type { EnvironmentsProblem, ResolvedModel, TargetDifference } from "@ingestron/definitions";
import { placeOf } from "./fold-names.js";
import { connectGroups } from "./connect.js";
import { deployProblem, type Models, type Variables } from "./fold-values.js";

/** An `ENVIRONMENTS_DIFFER` error at a definition. */
export function differ(message: string, file: string, hint?: string): EnvironmentsProblem {
  return {
    code: "ENVIRONMENTS_DIFFER",
    severity: "error",
    message,
    file,
    ...(hint && { hint }),
  };
}

/** Target names joined with `, `, the last two with ` and `. */
export function listOf(targets: string[]): string {
  if (targets.length < 2) return targets.join("");
  return `${targets.slice(0, -1).join(", ")} and ${targets[targets.length - 1]}`;
}

/** Each problem once. */
export function once(problems: EnvironmentsProblem[]): EnvironmentsProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify([problem.code, problem.message, problem.file, problem.line]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The targets in which `test` holds, and those in which it does not. */
function split(targets: string[], test: (target: string) => boolean): [string[], string[]] {
  const yes = targets.filter(test);
  return [yes, targets.filter((target) => !yes.includes(target))];
}

/**
 * A table the pipeline names `schema.table` in some targets, because it is in the
 * pipeline's catalog there, and with three parts in others.
 */
export function catalogProblems(
  models: Models,
  catalog: (model: ResolvedModel) => string | undefined,
): EnvironmentsProblem[] {
  const targets = Object.keys(models);
  const first = models[targets[0]!]!;
  return first.tables
    .filter((table) => table.store)
    .flatMap((table) => {
      const inPipeline = (target: string) => {
        const model = models[target]!;
        const same = model.tables.find((other) => other.name === table.name);
        return same?.fullName.catalog === catalog(model);
      };
      const [yes, no] = split(targets, inPipeline);
      if (yes.length === 0 || no.length === 0) return [];
      return [
        differ(
          `Table "${table.name}" is in the pipeline's catalog in ${listOf(yes)} but not in ${listOf(no)}, so the pipeline's code cannot name it the same way in every environment.`,
          table.origin.file,
          "Put the table in the pipeline's catalog in every environment, or in another catalog in every environment.",
        ),
      ];
    });
}

/** A Kafka connection read continuously in some targets and by the refresh job in others. */
export function continuousProblems(models: Models): EnvironmentsProblem[] {
  const targets = Object.keys(models);
  const groups = targets.map((target) => connectGroups(models[target]!));
  return groups[0]!.flatMap((group) => {
    const continuous = (target: string) =>
      groups[targets.indexOf(target)]!.find((other) => other.connection.id === group.connection.id)
        ?.continuous === true;
    const [yes, no] = split(targets, continuous);
    if (yes.length === 0 || no.length === 0) return [];
    return [
      differ(
        `Connection "${group.connection.id}" is read continuously in ${listOf(yes)} and by the refresh job in ${listOf(no)}.`,
        group.tables[0]!.origin.file,
        "Set continuous in the flow's ingest settings, so that it is the same in every environment.",
      ),
    ];
  });
}

/**
 * A PySpark transform whose own code would need values that differ between targets, or
 * that are supplied when deploying: the pack copies that code as it is.
 */
export function codeProblem(
  fold: { variables: Variables; models: Models; targets: string[] },
  path: string,
  names: string[],
  file: string,
): EnvironmentsProblem {
  const table = path.replace(/^.*\//, "").replace(/\.py$/, "");
  const variables = fold.variables.list.filter((variable) => names.includes(variable.name));
  const deploy = variables.find((variable) => variable.deploy);
  if (deploy)
    return deployProblem(
      `The code of PySpark transform "${table}" would need \${envvar:${deploy.deploy}}, which is supplied when deploying; a PySpark transform's own code cannot take it yet.`,
      fold.models[[...deploy.supplied][0] ?? fold.targets[0]!],
      deploy.deploy!,
    );
  return differ(
    `The code of PySpark transform "${table}" would need values that differ between environments (${variables.map((variable) => variable.name).join(", ")}); a PySpark transform's own code cannot take them yet.`,
    file,
    "Make these values the same in every environment, or write the transform in SQL.",
  );
}

/**
 * A file whose view in some targets is not that target's own file. When values that are
 * not text differ, the message names each, with its value in every target.
 */
export function unlikeProblem(
  models: Models,
  path: string,
  targets: string[],
  unfolded: TargetDifference[],
): EnvironmentsProblem {
  const start = `${path} cannot be generated once for every environment: in ${listOf(targets)} it would not be what that environment gets on its own`;
  if (unfolded.length === 0)
    return differ(
      `${start}, because the environments differ there in more than values.`,
      "project.yaml",
    );
  const first = Object.values(models)[0]!;
  const settings = unfolded.map((difference) => settingOf(difference.pointer, first));
  const values = unfolded.map(
    (difference, index) => `${settings[index]} is ${valuesOf(models, difference.values)}`,
  );
  return differ(
    `${start}, because a value that is not text differs between environments: ${values.join("; ")}.`,
    "project.yaml",
    `Make ${listOf(settings)} the same in every environment; only text values, such as names, paths and hosts, and lists can differ.`,
  );
}

/** What a place in the model is, in words, such as "platform setting manage.schemas". */
function settingOf(pointer: string, model: ResolvedModel): string {
  const { description } = placeOf(pointer, model, false);
  return `${description.charAt(0).toLowerCase()}${description.slice(1)}`.replace(/\.$/, "");
}

/** Each value with the targets that have it, such as "false in dev, true in test and prod". */
function valuesOf(models: Models, values: Record<string, unknown>): string {
  const groups = new Map<string, string[]>();
  for (const target of Object.keys(models)) {
    const value = values[target];
    const text = value === undefined ? "not set" : JSON.stringify(value);
    groups.set(text, [...(groups.get(text) ?? []), target]);
  }
  return [...groups].map(([value, targets]) => `${value} in ${listOf(targets)}`).join(", ");
}
