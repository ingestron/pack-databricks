// The view: what Databricks deploys for one target of a folded bundle. Each
// expectation follows the Databricks CLI at tag v1.23.0:
// bundle/config/mutator/resourcemutator/apply_presets.go (presets) and
// apply_target_mode.go (development mode), and the variables documentation.
import { describe, expect, it } from "vitest";
import { bundle, job, none, pipeline, view } from "./view-helpers.js";

describe("variables", () => {
  it("replace a whole value with its value, keeping a list a list, and a part of a text with its text", () => {
    const files = {
      "databricks.yml": bundle(
        { variables: { catalog: "dev_sales", recipients: ["a@example.com"] } },
        { catalog: {}, recipients: { type: "complex" } },
      ),
      "resources/shop.pipeline.yml": pipeline({
        catalog: "${var.catalog}",
        notifications: [{ email_recipients: "${var.recipients}" }],
        name: "shop_${var.catalog}",
      }),
    };
    const shop = view(files)("resources/shop.pipeline.yml").resources.pipelines.shop;
    expect(shop.catalog).toBe("dev_sales");
    expect(shop.notifications[0].email_recipients).toEqual(["a@example.com"]);
    expect(shop.name).toBe("shop_dev_sales");
  });

  it("left unset in the target take the text of the value the deploying CI pipeline supplies", () => {
    const files = {
      "databricks.yml": bundle({}, { landing: {} }),
      "resources/shop.pipeline.yml": pipeline({ configuration: { other: "${var.landing}" } }),
    };
    const supplied = { ...none, variables: { landing: "${envvar:LANDING}" } };
    const shop = view(files, supplied)("resources/shop.pipeline.yml").resources.pipelines.shop;
    expect(shop.configuration).toEqual({ other: "${envvar:LANDING}" });
  });

  it("leave only the target, as the default, with no variables or presets", () => {
    const files = {
      "databricks.yml": bundle({ variables: { a: "x" }, presets: { tags: { t: "v" } } }, { a: {} }),
    };
    expect(view(files)("databricks.yml")).toEqual({
      bundle: { name: "shop" },
      include: ["resources/*.yml"],
      targets: { dev: { mode: "production", default: true } },
    });
  });

  it("put a host the pipeline supplies as DATABRICKS_HOST in the target's workspace", () => {
    const files = { "databricks.yml": bundle({ workspace: { root_path: "/Shared/shop" } }) };
    const viewed = view(files, { ...none, host: "${envvar:HOST}" })("databricks.yml");
    expect(viewed.targets.dev.workspace).toEqual({
      root_path: "/Shared/shop",
      host: "${envvar:HOST}",
    });
  });
});

describe("presets (apply_presets.go)", () => {
  it("add tags to jobs and pipelines only where the resource leaves the key unset or empty", () => {
    const files = {
      "databricks.yml": bundle({ presets: { tags: { environment: "dev", team: "data" } } }),
      "resources/shop.pipeline.yml": pipeline({ tags: { team: "sales", owner: "" } }),
      "resources/shop_refresh.job.yml": job({}),
    };
    const read = view(files);
    expect(read("resources/shop.pipeline.yml").resources.pipelines.shop.tags).toEqual({
      environment: "dev",
      team: "sales",
    });
    expect(read("resources/shop_refresh.job.yml").resources.jobs.shop_refresh.tags).toEqual({
      environment: "dev",
      team: "data",
    });
  });

  it("set trigger_pause_status only on schedules that do not set pause_status", () => {
    const files = {
      "databricks.yml": bundle({ presets: { trigger_pause_status: "PAUSED" } }),
      "resources/a.job.yml": job({ schedule: { quartz_cron_expression: "0 0 5 * * ?" } }),
      "resources/b.job.yml": job({
        schedule: { quartz_cron_expression: "0 0 5 * * ?", pause_status: "UNPAUSED" },
      }),
    };
    const read = view(files);
    expect(read("resources/a.job.yml").resources.jobs.shop_refresh.schedule.pause_status).toBe(
      "PAUSED",
    );
    expect(read("resources/b.job.yml").resources.jobs.shop_refresh.schedule.pause_status).toBe(
      "UNPAUSED",
    );
  });

  it("stop every continuous pipeline under a PAUSED preset", () => {
    const files = {
      "databricks.yml": bundle({ presets: { trigger_pause_status: "PAUSED" } }),
      "resources/shop.pipeline.yml": pipeline({ continuous: true }),
    };
    expect(view(files)("resources/shop.pipeline.yml").resources.pipelines.shop.continuous).toBe(
      undefined,
    );
  });

  it("leave an unset pause UNPAUSED in production mode", () => {
    const files = {
      "databricks.yml": bundle({}),
      "resources/shop_refresh.job.yml": job({
        schedule: { quartz_cron_expression: "0 0 5 * * ?" },
      }),
    };
    const schedule = view(files)("resources/shop_refresh.job.yml").resources.jobs.shop_refresh
      .schedule;
    expect(schedule.pause_status).toBe("UNPAUSED");
  });
});

describe("development mode (apply_target_mode.go)", () => {
  it("pauses schedules that do not set pause_status, as its default PAUSED preset", () => {
    const files = {
      "databricks.yml": bundle({ mode: "development" }),
      "resources/shop_refresh.job.yml": job({
        schedule: { quartz_cron_expression: "0 0 5 * * ?" },
      }),
    };
    const schedule = view(files)("resources/shop_refresh.job.yml").resources.jobs.shop_refresh
      .schedule;
    expect(schedule.pause_status).toBe("PAUSED");
  });

  it("keeps an UNPAUSED preset that lets a continuous pipeline run, which the mode alone would stop", () => {
    const files = {
      "databricks.yml": bundle({
        mode: "development",
        presets: { trigger_pause_status: "UNPAUSED" },
      }),
      "resources/shop.pipeline.yml": pipeline({ continuous: true }),
    };
    expect(view(files)("databricks.yml").targets.dev.presets).toEqual({
      trigger_pause_status: "UNPAUSED",
    });
  });

  it("drops an UNPAUSED preset when no pipeline runs continuously", () => {
    const files = {
      "databricks.yml": bundle({
        mode: "development",
        presets: { trigger_pause_status: "UNPAUSED" },
      }),
      "resources/shop.pipeline.yml": pipeline({}),
    };
    expect(view(files)("databricks.yml").targets.dev.presets).toBeUndefined();
  });
});
