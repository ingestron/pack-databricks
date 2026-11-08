// Hand-written folded files for the view's tests.
import { parse, stringify } from "yaml";
import { bundleView, type Supplied } from "../src/output/view.js";

// Parsed YAML is untyped; the assertions check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Yaml = Record<string, any>;

/** Nothing supplied when deploying. */
export const none: Supplied = { variables: {}, values: {} };

/** A databricks.yml with one target, `dev`. */
export function bundle(target: Yaml, variables: Yaml = {}): string {
  return stringify({
    bundle: { name: "shop" },
    include: ["resources/*.yml"],
    variables,
    targets: { dev: { mode: "production", ...target } },
  });
}

export const pipeline = (settings: Yaml) =>
  stringify({
    resources: { pipelines: { shop: { name: "shop", root_path: "../src/shop", ...settings } } },
  });
export const job = (settings: Yaml) =>
  stringify({ resources: { jobs: { shop_refresh: { name: "shop_refresh", ...settings } } } });

/** The view of `dev`, read path by path as YAML. */
export function view(files: Record<string, string>, supplied = none) {
  const viewed = bundleView(files, "dev", supplied);
  return (path: string) => parse(viewed[path] ?? "null") as Yaml;
}
