// The features that change shared Unity Catalog objects, each turned on with
// `manage.<id>` in the platform, and what the platform needs for them. The
// documentation, the editor and prerequisites.sql all read this list.
import type { Capability, ResolvedModel } from "@ingestron/definitions";
import { tagParts } from "./apply-contract.js";
import { quoteName } from "./query.js";

const owner =
  "The run_as identity owns the tables the pipelines create, so it may change them; any other identity needs MODIFY on each table";

/** The Databricks pack's capabilities. */
export const capabilities: Capability[] = [
  {
    id: "schemas",
    title: "Managed schemas",
    does: "Creates each layer's schema in the bundle and applies the platform's grants to it.",
    needs: [
      "USE CATALOG and CREATE SCHEMA on each catalog for the identity that deploys",
      "MANAGE on the schemas, or ownership, to apply grants",
    ],
  },
  {
    id: "tags",
    title: "Tags",
    does: "Sets the contract's tags and classifications on tables and columns after each refresh.",
    needs: [
      "Databricks Runtime 16.3 or later (serverless jobs have it)",
      `${owner}, or APPLY TAG with USE SCHEMA and USE CATALOG`,
      "ASSIGN on each governed tag the contract uses",
    ],
  },
  {
    id: "comments",
    title: "Column comments",
    does: "Sets each column's description as its comment after each refresh.",
    needs: ["Databricks Runtime 16.3 or later (serverless jobs have it)", owner],
  },
  {
    id: "checks",
    title: "Table checks",
    does: "Counts the contract's rules over all rows after each refresh, then warns or fails the run.",
    needs: ["SELECT on each table for the run_as identity (an owner has it)", "Serverless jobs"],
  },
];

/** Tag keys Unity Catalog refuses: `. , - = / :` or longer than 255 characters. */
export function tagProblems(model: ResolvedModel): string[] {
  if (!model.platform.manage.tags) return [];
  const tags = model.tables.flatMap((table) => [
    ...table.contract.tags,
    ...table.contract.columns.flatMap((column) => column.tags ?? []),
  ]);
  return [...new Set(tags)]
    .filter((tag) => /[.,\-=/:]/.test(tagParts(tag)[0]) || tagParts(tag)[0].length > 255)
    .map(
      (tag) =>
        `the tag "${tag}" has a key Unity Catalog does not allow: keys have no . , - = / : and at most 255 characters; write key:value for a value`,
    );
}

/** SQL an administrator runs once, so the run_as identity may do what is turned on. */
export function prerequisites(model: ResolvedModel, header: string): string | undefined {
  const { manage, run_as: runAs } = model.platform;
  const on = capabilities.filter((capability) => manage[capability.id]);
  if (on.length === 0) return undefined;
  const principal = runAs
    ? quoteName(Object.values(runAs)[0] ?? "")
    : "`<the identity that deploys>`";
  const catalogs = [...new Set(model.tables.map((table) => table.fullName.catalog))];
  const lines = [
    `-- ${header}`,
    "-- Run once as an administrator; review before running.",
    runAs
      ? "-- The grants go to run_as; give the same to the identity that deploys when it differs."
      : "-- Set run_as in the platform, or replace the principal below with the identity that deploys.",
    "",
  ];
  for (const capability of on) {
    lines.push(
      `-- ${capability.title} needs:`,
      ...capability.needs.map((need) => `--   - ${need}.`),
    );
    if (capability.id === "schemas")
      lines.push(
        ...catalogs.map(
          (catalog) =>
            `GRANT USE CATALOG, CREATE SCHEMA ON CATALOG ${quoteName(catalog)} TO ${principal};`,
        ),
      );
    if (capability.id === "tags")
      lines.push(
        "-- Governed tags: an account administrator grants ASSIGN on each governed tag in the tag policy.",
      );
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
