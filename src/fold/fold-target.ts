// Each target's own settings in the folded bundle: what Databricks takes per
// target (mode, workspace, run_as, permissions) as each target's values, and
// presets for the tags and schedule pause that differ (spec/behaviour.md, 2.3).
import { splitDeployText, type ResolvedModel } from "@ingestron/definitions";
import { targetOf, type Data } from "../bundle/index.js";
import { hasContinuous } from "../connect/index.js";
import { mapStrings } from "../bundle/index.js";
import type { Plan } from "./fold-plan.js";
import {
  deployProblem,
  deployVariable,
  placeVariable,
  supply,
  type Variable,
} from "./fold-values.js";

/** Each target's settings, and the deploy-time value each target's host is, if any. */
export interface Targets {
  settings: Record<string, Data>;
  /** NAME of the deploy-time value that is a target's whole host, by target. */
  hosts: Record<string, string>;
}

/** The settings of every target, before the variables are set. */
export function targetSettings(plan: Plan): Targets {
  const hosts: Record<string, string> = {};
  const settings = Object.fromEntries(
    plan.targets.map((target, index) => {
      const model = plan.models[target]!;
      const own = targetOf(model);
      const host = hostOf(plan, target, own);
      if (host) hosts[target] = host;
      const tags = plan.tags[target]!;
      const data: Data = {
        mode: own.mode,
        ...(index === 0 && { default: true }),
        ...(withVariables(plan, target, own) as Data),
        ...(Object.keys(tags).length > 0 && {
          presets: { tags: withVariables(plan, target, tags) },
        }),
      };
      return [target, data];
    }),
  );
  return { settings, hosts };
}

/**
 * A host supplied when deploying: Databricks takes no variable there, so the target
 * leaves the host out and the pipeline sets DATABRICKS_HOST.
 */
function hostOf(plan: Plan, target: string, settings: Data): string | undefined {
  const workspace = settings.workspace as Record<string, string> | undefined;
  const model = plan.models[target]!;
  const parts = splitDeployText(workspace?.host ?? "", model.deployValues ?? []);
  const value = parts.find((part) => typeof part !== "string");
  if (!value || typeof value === "string") return undefined;
  delete workspace!.host;
  if (Object.keys(workspace!).length === 0) delete settings.workspace;
  if (parts.length === 1) return value.name;
  plan.problems.push(
    deployProblem(
      `The workspace host in ${target} holds \${envvar:${value.name}} within other text; Databricks takes a host supplied when deploying only as a whole, from DATABRICKS_HOST.`,
      model,
      value.name,
    ),
  );
  return undefined;
}

/** Each deploy-time value in a target's own settings becomes its variable, which the target leaves unset. */
function withVariables(plan: Plan, target: string, node: unknown): unknown {
  return mapStrings(node, (text) => replaced(plan, target, plan.models[target]!, text));
}

function replaced(plan: Plan, target: string, model: ResolvedModel, text: string): string {
  return splitDeployText(text, model.deployValues ?? [])
    .map((part) => {
      if (typeof part === "string") return part;
      const variable = deployVariable(plan.variables, part.name);
      plan.problems.push(...supply(variable, target, model));
      return `\${var.${variable.name}}`;
    })
    .join("");
}

/** How the refresh job's schedule is paused in each target. */
export type Pause =
  | { kind: "same" }
  | { kind: "presets"; presets: Record<string, "PAUSED" | "UNPAUSED"> }
  | { kind: "variable"; variable: Variable };

/**
 * When the schedule's pause differs: a preset only where the target's mode does not
 * pause it by itself, or a variable when a preset would also change a continuous
 * pipeline. Databricks sets `continuous: false` on every pipeline under a PAUSED
 * preset, and development mode does the same unless an UNPAUSED preset replaces its
 * own PAUSED one.
 */
export function pauseOf(plan: Plan): Pause {
  const schedules = plan.targets.map((target) => plan.models[target]!.platform.schedule);
  if (schedules.some((schedule) => !schedule)) return { kind: "same" };
  if (new Set(schedules.map((schedule) => schedule!.paused)).size === 1) return { kind: "same" };
  const presets: Record<string, "PAUSED" | "UNPAUSED"> = {};
  for (const target of plan.targets) {
    const { mode, schedule } = plan.models[target]!.platform;
    if (mode === "production" && schedule!.paused) presets[target] = "PAUSED";
    if (mode === "development" && !schedule!.paused) presets[target] = "UNPAUSED";
  }
  if (!Object.keys(presets).some((target) => hasContinuous(plan.models[target]!)))
    return { kind: "presets", presets };
  const values = Object.fromEntries(
    plan.targets.map((target) => [
      target,
      plan.models[target]!.platform.schedule!.paused ? "PAUSED" : "UNPAUSED",
    ]),
  );
  const place = {
    name: "pause_status",
    description: "Whether the refresh job's schedule is paused.",
  };
  return { kind: "variable", variable: placeVariable(plan.variables, place, values) };
}
