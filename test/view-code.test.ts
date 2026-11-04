// The view of values in code, and of the grants files (spec/behaviour.md, section 4).
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { bundleView } from "../src/view.js";
import { bundle, job, none, pipeline, type Yaml } from "./view-helpers.js";

describe("values in code", () => {
  it("come from the pipeline's ingestron.* configuration in the SQL under its root_path", () => {
    const files = {
      "databricks.yml": bundle({ variables: { landing: "/Volumes/dev" } }, { landing: {} }),
      "resources/shop.pipeline.yml": pipeline({
        configuration: { "ingestron.landing": "${var.landing}", other: "kept" },
      }),
      "src/shop/bronze/orders.sql": "SELECT * FROM read_files('${ingestron.landing}/orders')\n",
      "src/other/orders.sql": "SELECT '${ingestron.landing}'\n",
    };
    const viewed = bundleView(files, "dev", none);
    expect(viewed["src/shop/bronze/orders.sql"]).toBe(
      "SELECT * FROM read_files('/Volumes/dev/orders')\n",
    );
    expect(viewed["src/other/orders.sql"]).toBe("SELECT '${ingestron.landing}'\n");
    const shop = (parse(viewed["resources/shop.pipeline.yml"]!) as Yaml).resources.pipelines.shop;
    expect(shop.configuration).toEqual({ other: "kept" });
  });

  it("come from the task's ingestron.* parameters in its script, written as JSON writes text", () => {
    const files = {
      "databricks.yml": bundle({ variables: { catalog: 'a"b' } }, { catalog: {} }),
      "resources/shop_refresh.job.yml": job({
        tasks: [
          {
            task_key: "apply_contract",
            spark_python_task: {
              python_file: "../tasks/shop/apply_contract.py",
              parameters: ["ingestron.catalog=${var.catalog}"],
            },
          },
        ],
      }),
      "tasks/shop/apply_contract.py": 'STATEMENTS = ["ALTER `${ingestron.catalog}`"]\n',
    };
    const viewed = bundleView(files, "dev", none);
    expect(viewed["tasks/shop/apply_contract.py"]).toBe('STATEMENTS = ["ALTER `a\\"b`"]\n');
    const task = (parse(viewed["resources/shop_refresh.job.yml"]!) as Yaml).resources.jobs
      .shop_refresh.tasks[0];
    expect(task.spark_python_task.parameters).toBeUndefined();
  });

  it("keep only the target's grants file, with each placeholder as its deploy-time value", () => {
    const files = {
      "databricks.yml": bundle({}),
      "prerequisites/dev.sql": "GRANT USE CATALOG ON CATALOG `dev` TO `<value of DEPLOYER>`;\n",
      "prerequisites/prod.sql": "GRANT USE CATALOG ON CATALOG `prod` TO `x`;\n",
    };
    const supplied = { ...none, values: { DEPLOYER: "${envvar:DEPLOYER}" } };
    const viewed = bundleView(files, "dev", supplied);
    expect(Object.keys(viewed).sort()).toEqual(["databricks.yml", "prerequisites/dev.sql"]);
    expect(viewed["prerequisites/dev.sql"]).toContain("TO `${envvar:DEPLOYER}`;");
  });
});
