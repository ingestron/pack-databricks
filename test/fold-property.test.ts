// The fold property catches a fold that changes what an environment gets: a
// deliberately wrong bundle fails checkFold.
import { checkFold, type Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { databricks } from "../src/index.js";
import { bundleFold, fold, resolveAll, retail } from "./fold-helpers.js";

const models = resolveAll(retail, ["dev", "prod"]);

// Parsed YAML is untyped; the changes only set and delete keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bundle = Record<string, any>;

/** The pack, with its folded databricks.yml changed by `change`. */
function wrong(change: (bundle: Bundle) => void): Pack {
  return {
    ...databricks,
    buildEnvironments(targets) {
      const built = databricks.buildEnvironments!(targets);
      const bundle = parse(built.files["databricks.yml"]!);
      change(bundle);
      return { ...built, files: { ...built.files, "databricks.yml": stringify(bundle) } };
    },
  };
}

describe("the fold property", () => {
  const view = bundleFold(models, fold(models).deployValues);

  it("holds for the pack's own fold", () => {
    expect(checkFold(databricks, models, view)).toEqual([]);
  });

  it("fails when a target's variable has another environment's value", () => {
    const pack = wrong((bundle) => {
      if (bundle.targets.prod) bundle.targets.prod.variables.catalog = "dev_sales";
    });
    expect(checkFold(pack, models, view)).toContain(
      "With dev, prod, for prod: resources/retail.pipeline.yml differs from the render.",
    );
  });

  it("fails when a preset is dropped", () => {
    const pack = wrong((bundle) => {
      if (bundle.targets.prod) delete bundle.targets.prod.presets;
    });
    expect(checkFold(pack, models, view)).toContain(
      "With dev, prod, for prod: resources/retail_refresh.job.yml differs from the render.",
    );
  });
});
