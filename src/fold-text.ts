// Folding one text that differs between targets: a variable for the whole
// value, or, where a target supplies part of it when deploying, a variable for
// that part with the rest literal. Code is folded token by token.
import {
  splitDeployText,
  type EnvironmentsProblem,
  type ResolvedModel,
} from "@ingestron/definitions";
import {
  deployProblem,
  deployVariable,
  marker,
  placeVariable,
  setIn,
  supply,
  type Variables,
} from "./fold-values.js";
import type { Place } from "./fold-names.js";

/** What folding a text needs, and where it reports problems. */
export interface TextFold {
  targets: string[];
  models: Readonly<Record<string, ResolvedModel>>;
  variables: Variables;
  problems: EnvironmentsProblem[];
}

type Parts = ReturnType<typeof splitDeployText>;

/** The folded text for one place, given each target's text; `place` names a new variable. */
export function foldText(fold: TextFold, values: Record<string, string>, place: Place): string {
  const parts = (target: string): Parts =>
    splitDeployText(values[target]!, fold.models[target]!.deployValues ?? []);
  const supplying = fold.targets.filter((target) =>
    parts(target).some((part) => typeof part !== "string"),
  );
  if (supplying.length === 0) return marker(placeVariable(fold.variables, place, values).name);
  const [first, ...others] = supplying as [string, ...string[]];
  const model = fold.models[first]!;
  const pattern = parts(first);
  const names = pattern.flatMap((part) => (typeof part === "string" ? [] : [part.name]));
  const other = others.find((target) => values[target] !== values[first]);
  if (other) {
    fold.problems.push(
      deployProblem(
        `This value is "${values[first]}" in ${first} and "${values[other]}" in ${other}; a value supplied when deploying must be written the same way in every environment that supplies it.`,
        model,
        names[0]!,
      ),
    );
    return values[first]!;
  }
  for (const target of supplying)
    for (const name of names)
      fold.problems.push(
        ...supply(deployVariable(fold.variables, name), target, fold.models[target]!),
      );
  const literal = fold.targets.filter((target) => !supplying.includes(target));
  for (const target of literal)
    fold.problems.push(...capture(fold, values, target, pattern, first));
  return pattern
    .map((part) =>
      typeof part === "string" ? part : marker(deployVariable(fold.variables, part.name).name),
    )
    .join("");
}

/** A literal target sets the one deploy-time value to its text between the literal parts. */
function capture(
  fold: TextFold,
  values: Record<string, string>,
  target: string,
  pattern: Parts,
  supplier: string,
): EnvironmentsProblem[] {
  const text = values[target]!;
  const at = pattern.findIndex((part) => typeof part !== "string");
  const name = (pattern[at] as { name: string }).name;
  const model = fold.models[supplier];
  if (pattern.filter((part) => typeof part !== "string").length > 1)
    return [
      deployProblem(
        `This value is "${text}" in ${target} and "${values[supplier]}" in ${supplier}, which holds more than one value supplied when deploying; write it the same way in every environment.`,
        model,
        name,
      ),
    ];
  const before = pattern.slice(0, at).join("");
  const after = pattern.slice(at + 1).join("");
  const fits =
    text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after);
  if (!fits)
    return [
      deployProblem(
        `This value is "${text}" in ${target}, which does not have the form "${values[supplier]}" of ${supplier}, so \${envvar:${name}} cannot stand for part of it.`,
        model,
        name,
      ),
    ];
  const middle = text.slice(before.length, text.length - after.length);
  return setIn(deployVariable(fold.variables, name), target, middle, fold.models[target]!);
}

/** Words, runs of space, and single other characters; a deploy-time value is one token. */
function tokens(text: string, model: ResolvedModel): string[] {
  return splitDeployText(text, model.deployValues ?? []).flatMap((part) =>
    typeof part === "string"
      ? (part.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [])
      : [part.text],
  );
}

/**
 * Code folded token by token: each run of tokens that differs is one value. Undefined when
 * the targets' code does not have the same number of tokens, so differs in more than values.
 */
export function foldCode(
  fold: TextFold,
  values: Record<string, string>,
  place: (count: number) => Place,
): string | undefined {
  const lists = fold.targets.map((target) => tokens(values[target]!, fold.models[target]!));
  if (new Set(lists.map((list) => list.length)).size > 1) return undefined;
  const parts: string[] = [];
  let run: string[][] = [];
  let count = 0;
  const flush = () => {
    if (run.length === 0) return;
    const texts = Object.fromEntries(
      fold.targets.map((target, index) => [target, run.map((tokens) => tokens[index]).join("")]),
    );
    count += 1;
    parts.push(foldText(fold, texts, place(count)));
    run = [];
  };
  lists[0]!.forEach((token, position) => {
    const column = lists.map((list) => list[position]!);
    if (new Set(column).size === 1) {
      flush();
      parts.push(token);
    } else run.push(column);
  });
  flush();
  return parts.join("");
}
