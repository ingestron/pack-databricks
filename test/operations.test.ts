// The standard's operations policy and quality results, and the Platform's alerts, in the bundle.
import { describe, expect, it } from "vitest";
import { connection, contract, flow, generate } from "./connect-helpers.js";
import { fold, foldFailures, resolveAll, retail, yamlOf } from "./fold-helpers.js";

/** The retail project with more lines in its standard and Platform. */
function retailWith(standard: string[], platform: string[] = []): Record<string, string> {
  return {
    ...retail,
    "standard.yaml": [retail["standard.yaml"]!.trimEnd(), ...standard, ""].join("\n"),
    "platform.yaml": [retail["platform.yaml"]!.trimEnd(), ...platform, ""].join("\n"),
  };
}

/** The folded bundle for dev and prod, checked to fold without problems. */
function folded(files: Record<string, string>) {
  const models = resolveAll(files, ["dev", "prod"]);
  const result = fold(models);
  expect(result.problems).toEqual([]);
  expect(foldFailures(models)).toEqual([]);
  return result.files;
}

const jobPath = "resources/retail_refresh.job.yml";
const pipelinePath = "resources/retail.pipeline.yml";

function jobOf(files: Record<string, string>) {
  return yamlOf(files, jobPath).resources.jobs.retail_refresh;
}

function pipelineOf(files: Record<string, string>) {
  return yamlOf(files, pipelinePath).resources.pipelines.retail;
}

describe("operations", () => {
  it("retries each pipeline task, times it out and queues the job's runs", () => {
    const files = folded(
      retailWith([
        "operations:",
        "  retries: { count: 2, interval: 5m }",
        "  concurrency: { max_runs: 1, queue: true }",
        "  timeout: 2h",
      ]),
    );
    const job = jobOf(files);
    const refresh = job.tasks.find((task: { task_key: string }) => task.task_key === "refresh");
    expect(refresh).toMatchObject({
      max_retries: 2,
      min_retry_interval_millis: 300000,
      timeout_seconds: 7200,
    });
    expect(job.max_concurrent_runs).toBe(1);
    expect(job.queue).toEqual({ enabled: true });
  });

  it("sets nothing for operations the standard leaves out", () => {
    const job = jobOf(folded(retail));
    expect(job.max_concurrent_runs).toBeUndefined();
    expect(job.queue).toBeUndefined();
    expect(job.health).toBeUndefined();
    expect(job.tasks[0].max_retries).toBeUndefined();
    expect(job.tasks[0].timeout_seconds).toBeUndefined();
  });
});

describe("quality results", () => {
  it("publishes the pipeline's event log to a table in its catalog and schema", () => {
    const files = {
      ...retail,
      "standard.yaml": retail["standard.yaml"]!.replace(
        "  required: drop\n",
        "  required: drop\n  results: true\n",
      ),
    };
    const pipeline = pipelineOf(folded(files));
    expect(pipeline.event_log).toEqual({
      catalog: "${var.catalog}",
      schema: "bronze",
      name: "retail_event_log",
    });
  });

  it("publishes no event log without quality results", () => {
    expect(pipelineOf(folded(retail)).event_log).toBeUndefined();
  });
});

describe("alerts", () => {
  it("calls a destination on failure, beside the email alert", () => {
    const job = jobOf(
      folded(retailWith([], ["alerts:", "  - { kind: destination, id: abc, on: [failure] }"])),
    );
    expect(job.webhook_notifications).toEqual({ on_failure: [{ id: "abc" }] });
    expect(job.email_notifications).toEqual({ on_failure: ["sales-data@example.com"] });
  });

  it("warns when a run is slow, with a run duration health rule", () => {
    const files = folded(
      retailWith(
        ["operations:", "  alerts: { on: [failure, slow], slow_after: 1h }"],
        [
          "alerts:",
          "  - { kind: email, to: [ops@example.com], on: [slow] }",
          "  - { kind: destination, id: abc, on: [failure, slow] }",
        ],
      ),
    );
    const job = jobOf(files);
    expect(job.health).toEqual({
      rules: [{ metric: "RUN_DURATION_SECONDS", op: "GREATER_THAN", value: 3600 }],
    });
    expect(job.email_notifications).toEqual({
      on_failure: ["sales-data@example.com"],
      on_duration_warning_threshold_exceeded: ["ops@example.com"],
    });
    expect(job.webhook_notifications).toEqual({
      on_failure: [{ id: "abc" }],
      on_duration_warning_threshold_exceeded: [{ id: "abc" }],
    });
    expect(pipelineOf(files).notifications[0].email_recipients).toEqual(["sales-data@example.com"]);
  });

  it("raises no failure alert when the standard's alerts leave failure out", () => {
    const files = folded(retailWith(["operations:", "  alerts: { on: [slow], slow_after: 30m }"]));
    expect(jobOf(files).email_notifications).toBeUndefined();
    expect(jobOf(files).health.rules[0].value).toBe(1800);
    expect(pipelineOf(files).notifications).toBeUndefined();
  });

  it("makes a destination that differs between environments a variable", () => {
    const files = folded({
      ...retailWith([], ["alerts:", "  - { kind: destination, id: '${values.teams}' }"]),
      "project.yaml": retail["project.yaml"]!.replace(
        "  dev: {}\n",
        "  dev:\n    values:\n      teams: dev-teams\n",
      ).replace("  prod:\n    values:\n", "  prod:\n    values:\n      teams: prod-teams\n"),
    });
    expect(jobOf(files).webhook_notifications).toEqual({
      on_failure: [{ id: "${var.alerts_id}" }],
    });
    const bundle = yamlOf(files, "databricks.yml");
    expect(bundle.targets.dev.variables.alerts_id).toBe("dev-teams");
    expect(bundle.targets.prod.variables.alerts_id).toBe("prod-teams");
  });
});

describe("with Lakeflow Connect", () => {
  it("retries the ingestion task too, and publishes the ingestion pipeline's event log", () => {
    const standard = [
      "apiVersion: ingestron.io/v1",
      "kind: Standard",
      "id: acme",
      "packs: [databricks@2]",
      "quality: { results: true }",
      "operations: { retries: { count: 3, interval: 30s } }",
      "",
    ].join("\n");
    const { yaml } = generate({
      "standard.yaml": standard,
      "erp.yaml": connection("erp", "sqlserver"),
      "orders.flow.yaml": flow("erp", "erp", "orders", "sales.dbo.orders"),
      "orders.yaml": contract("orders"),
      "platform.yaml":
        "apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nschedule: { cron: 0 0 5 * * ? }\n",
    });
    const tasks = yaml("resources/shop_refresh.job.yml").resources.jobs.shop_refresh.tasks;
    expect(tasks[0]).toMatchObject({
      task_key: "ingest_erp",
      max_retries: 3,
      min_retry_interval_millis: 30000,
    });
    const pipelines = yaml("resources/shop_erp_ingestion.pipeline.yml").resources.pipelines;
    expect(pipelines.shop_erp_ingestion.event_log).toEqual({
      catalog: "dev",
      schema: "bronze",
      name: "shop_erp_ingestion_event_log",
    });
    const gateway = yaml("resources/shop_erp_gateway.pipeline.yml").resources.pipelines;
    expect(gateway.shop_erp_gateway.event_log).toBeUndefined();
  });
});

describe("alerts that differ between environments in number", () => {
  it("are refused, as the job cannot be generated once for every environment", () => {
    const withDestination = retailWith([], ["alerts:", "  - { kind: destination, id: abc }"]);
    const models = {
      ...resolveAll(retail, ["dev"]),
      ...resolveAll(withDestination, ["prod"]),
    };
    const result = fold(models);
    expect(result.files).toEqual({});
    expect(result.problems).toEqual([
      expect.objectContaining({
        code: "ENVIRONMENTS_DIFFER",
        message: expect.stringContaining(jobPath),
      }),
    ]);
  });
});
