// Every environment in one bundle, with a target per environment: the values
// that differ become bundle variables, set in each target, and the result is
// checked against each environment's own bundle (spec/behaviour.md).
import {
  compareTargets,
  type EnvironmentsBuild,
  type EnvironmentsProblem,
  type SuppliedValue,
  type TargetDifference,
} from "@ingestron/definitions";
import { build } from "../output/build.js";
import { foldFiles, type Folded } from "./fold-files.js";
import { pipelineCatalog, planFold } from "./fold-plan.js";
import { catalogProblems, continuousProblems, once, unlikeProblem } from "./fold-problems.js";
import type { Models, Variable } from "./fold-values.js";
import { bundleView, sameFile, suppliedFor } from "../output/view.js";

/**
 * One bundle for every target. With an error among the problems, the files are empty.
 * @example
 * const { files, deployValues, problems } = buildEnvironments({ dev: devModel, prod: prodModel });
 */
export function buildEnvironments(models: Models): EnvironmentsBuild {
  const { structural, differing } = compareTargets(models);
  if (structural.length > 0) return failed(structural);
  const early = [...catalogProblems(models, pipelineCatalog), ...continuousProblems(models)];
  if (early.length > 0) return failed(early);
  const plan = planFold(models, differing);
  const folded = foldFiles(plan);
  const problems = once(plan.problems);
  if (problems.some((problem) => problem.severity === "error")) return failed(problems);
  const deployValues = supplied(models, folded);
  const unlike = viewProblems(models, folded.files, deployValues, plan.unfolded);
  if (unlike.length > 0) return failed(unlike);
  return { files: folded.files, deployValues, problems };
}

function failed(problems: EnvironmentsProblem[]): EnvironmentsBuild {
  return { files: {}, deployValues: [], problems: once(problems) };
}

/** Each deploy-time value the files take, in the order the models first hold them. */
function supplied(models: Models, folded: Folded): SuppliedValue[] {
  const names = [
    ...new Set(
      Object.values(models).flatMap((model) =>
        (model.deployValues ?? []).map((value) => value.name),
      ),
    ),
  ];
  return names.flatMap((name) => {
    const variable = folded.declared.find((item) => item.deploy === name) as Variable | undefined;
    const suppliedAs = [
      ...(variable && variable.supplied.size > 0 ? [`BUNDLE_VAR_${variable.name}`] : []),
      ...(Object.values(folded.hosts).includes(name) ? ["DATABRICKS_HOST"] : []),
    ];
    return suppliedAs.length > 0 ? [{ name, suppliedAs }] : [];
  });
}

/**
 * The fold property, checked when generating: each target's view of the folded files is
 * what `build` gives for that target alone. What differs is ENVIRONMENTS_DIFFER.
 */
function viewProblems(
  models: Models,
  files: Record<string, string>,
  values: SuppliedValue[],
  unfolded: TargetDifference[],
) {
  const unlike = new Map<string, string[]>();
  for (const [target, model] of Object.entries(models)) {
    const viewed = bundleView(files, target, suppliedFor(model, values));
    const rendered = build(model);
    const paths = [...new Set([...Object.keys(viewed), ...Object.keys(rendered)])];
    for (const path of paths) {
      const same =
        viewed[path] !== undefined &&
        rendered[path] !== undefined &&
        sameFile(path, viewed[path], rendered[path]);
      if (!same) unlike.set(path, [...(unlike.get(path) ?? []), target]);
    }
  }
  return [...unlike].map(([path, targets]) => unlikeProblem(models, path, targets, unfolded));
}
