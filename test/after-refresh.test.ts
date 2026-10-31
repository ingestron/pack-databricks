// Tags, column comments and table checks: applied by a job task after each
// refresh, only when the platform turns them on.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { databricks } from "../src/index.js";

const contract = [
  "apiVersion: v3.1.0",
  "kind: DataContract",
  "id: orders",
  "version: 1.0.0",
  "status: active",
  "schema:",
  "  - name: orders",
  "    tags: [sales, 'domain:retail']",
  "    quality:",
  "      - { name: some_rows, metric: rowCount, mustBeGreaterThan: 0 }",
  "    properties:",
  "      - { name: id, logicalType: integer, unique: true }",
  "      - name: email",
  "        logicalType: string",
  "        description: Where receipts go.",
  "        tags: [pii]",
  "        classification: restricted",
  "        quality:",
  "          - { metric: nullValues, mustBeLessThan: 5, unit: percent }",
  "",
].join("\n");

const files: Record<string, string> = {
  "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@1]\n",
  "files.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: files\nconnector: files\nconnectivity: public\nsettings: { path: /Volumes/dev/landing/shop/ }\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: files\ntables:\n  orders: { object: /orders, contract: orders }\n",
  "orders.yaml": contract,
};

const platform = (manage: string, more = "") =>
  `apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\nmanage: ${manage}\n${more}`;

function generate(manage: string, more = "") {
  const result = resolveDefinitions(
    memoryFiles({ ...files, "platform.yaml": platform(manage, more) }),
    { packs: [databricks], environment: "dev" },
  );
  return { result, out: result.model ? databricks.build(result.model) : {} };
}

const script = "src/shop/apply_contract.py";
const job = "resources/shop_refresh.job.yml";

describe("after each refresh", () => {
  it("does nothing more when every capability is off", () => {
    const { out } = generate("{}");
    expect(out[script]).toBeUndefined();
    expect(out[job]).toBeUndefined();
    expect(out["prerequisites.sql"]).toBeUndefined();
  });

  it("tags the table and its columns, with classification as a tag", () => {
    const { out } = generate("{ tags: true }");
    const text = out[script] ?? "";
    expect(text).toContain(
      "ALTER STREAMING TABLE `dev`.`bronze`.`orders` SET TAGS ('sales' = '', 'domain' = 'retail')",
    );
    expect(text).toContain(
      "ALTER STREAMING TABLE `dev`.`bronze`.`orders` ALTER COLUMN `email` SET TAGS ('pii' = '', 'classification' = 'restricted')",
    );
    expect(text).not.toContain("COMMENT ON COLUMN");
  });

  it("comments columns when comments are on", () => {
    const text = generate("{ comments: true }").out[script] ?? "";
    expect(text).toContain(
      "COMMENT ON COLUMN `dev`.`bronze`.`orders`.`email` IS 'Where receipts go.'",
    );
  });

  it("counts table checks and compares them, in rows or percent", () => {
    const text = generate("{ checks: true }").out[script] ?? "";
    expect(text).toContain('"name": "some_rows"');
    expect(text).toContain(
      "SELECT count(*) AS counted, count(*) AS total FROM `dev`.`bronze`.`orders`",
    );
    expect(text).toContain(
      "SELECT count(*) - count(DISTINCT `id`) AS counted, count(*) AS total FROM `dev`.`bronze`.`orders`",
    );
    expect(text).toContain(
      "SELECT count_if(`email` IS NULL) AS counted, count(*) AS total FROM `dev`.`bronze`.`orders`",
    );
    expect(text).toContain('"unit": "percent"');
  });

  it("runs as a serverless task after the refresh, in a job even without a schedule", () => {
    const text = generate("{ tags: true }").out[job] ?? "";
    expect(text).toContain("task_key: apply_contract");
    expect(text).toContain("depends_on:\n            - task_key: refresh");
    expect(text).toContain("python_file: ../src/shop/apply_contract.py");
    expect(text).toContain("environment_key: ingestron");
    expect(text).toContain('environment_version: "6"');
    expect(text).not.toContain("schedule:");
  });
});

describe("prerequisites.sql", () => {
  it("lists what the run_as principal needs for each capability that is on", () => {
    const sql =
      generate(
        "{ schemas: true, tags: true }",
        "run_as: { service_principal_name: 0b6c3d2e-0000-4000-8000-000000000007 }\n",
      ).out["prerequisites.sql"] ?? "";
    expect(sql).toContain(
      "GRANT USE CATALOG, CREATE SCHEMA ON CATALOG `dev` TO `0b6c3d2e-0000-4000-8000-000000000007`;",
    );
    expect(sql).toMatch(/-- Tags needs:\n--   - .*\n--   - The run_as identity owns/);
    expect(sql).toContain("ASSIGN");
  });
});

describe("capabilities", () => {
  it("declares each with what it needs on the platform", () => {
    const ids = databricks.capabilities?.map((capability) => capability.id);
    expect(ids).toEqual(["schemas", "tags", "comments", "checks"]);
    expect(databricks.capabilities?.every((capability) => capability.needs.length > 0)).toBe(true);
  });

  it("refuses a tag key Unity Catalog does not allow", () => {
    const { result } = generate("{ tags: true }");
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const bad = resolveDefinitions(
      memoryFiles({
        ...files,
        "platform.yaml": platform("{ tags: true }"),
        "orders.yaml": contract.replace("[pii]", "['pii/strict']"),
      }),
      { packs: [databricks], environment: "dev" },
    );
    expect(bad.diagnostics.map((item) => item.message).join("\n")).toMatch(/pii\/strict/);
  });

  it("warns when the contract uses tags while they are off", () => {
    const { result } = generate("{}");
    expect(result.diagnostics.map((item) => item.code)).toContain("CAPABILITY_OFF");
  });
});
