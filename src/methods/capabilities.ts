// The features that change shared Unity Catalog objects, each turned on with
// `manage.<id>` in the platform, and what the platform needs for them. The
// documentation, the editor and prerequisites.sql all read this list.
import { classificationTag, type Capability, type ResolvedModel } from "@ingestron/definitions";
import { tagParts } from "../sql/index.js";
import { quoteName } from "../sql/index.js";
import { governanceGrants } from "./governance-needs.js";

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
  {
    id: "grants",
    title: "Grants",
    does: "Grants each table to the principals of its contract's roles and its layer's after each refresh; with exact grants, revokes what they do not give.",
    needs: [
      "The run_as identity owns the tables the pipelines create, so it may grant and revoke on them",
      "Each principal needs USE CATALOG, and USE SCHEMA unless the bundle manages the schemas; ingestron request lists them",
    ],
  },
  {
    id: "masks",
    title: "Column masks",
    does: "Masks each classified column the standard names with a Unity Catalog column mask policy after each refresh, for everyone but run_as and the unmasked principals.",
    needs: [
      "Databricks Runtime 16.4 or later to make and to read tables with policies (serverless jobs have it)",
      "USE CATALOG and USE SCHEMA on governance.functions for run_as, CREATE FUNCTION there for the built-in masks, and EXECUTE on each of the team's functions a mask names",
      "MANAGE on the schemas when the bundle manages them, since the policies are on the schemas; run_as owns its tables, so policies on tables need nothing more",
      "The classification as a governed tag, which an account administrator creates; ingestron request lists it",
    ],
  },
  {
    id: "filters",
    title: "Row filters",
    does: "Filters the rows of each table with a column a filter of the standard matches, with a Unity Catalog row filter policy after each refresh, for everyone but run_as and the unmasked principals.",
    needs: [
      "Databricks Runtime 16.4 or later to make and to read tables with policies (serverless jobs have it)",
      "EXECUTE on each filter's function for run_as, with USE CATALOG and USE SCHEMA on its schema",
      "MANAGE on the schemas when the bundle manages them, since the policies are on the schemas; run_as owns its tables, so policies on tables need nothing more",
      "Each tag the filters match as a governed tag, which an account administrator creates",
    ],
  },
];

/**
 * Capabilities whose needs an administrator grants once in prerequisites.sql; grants need
 * nothing there, since the run_as identity owns its tables.
 */
const granted = new Set<Capability["id"]>([
  "schemas",
  "tags",
  "comments",
  "checks",
  "masks",
  "filters",
]);

/**
 * Characters a tag key may not hold: those the tags page or the governed tags page refuses
 * (spec section 8.6), and control characters. `:` is also Ingestron's key:value separator.
 */
const refusedInKey = /[.,\-=/:*<>%&?\\\u0000-\u001f]/;

/** The longest tag key Unity Catalog allows. */
const longestKey = 256;

/** The rules a refused key breaks, as the problems say them. */
const keyRules = `keys have no . , - = / : * < > % & ? \\ or control characters, no space at either end, and at most ${longestKey} characters`;

/** True when Unity Catalog allows the tag key. */
function allowedKey(key: string): boolean {
  return !refusedInKey.test(key) && key.trim() === key && key.length <= longestKey;
}

/** Tag keys Unity Catalog refuses, the classification tag key among them, when tags are on. */
export function tagProblems(model: ResolvedModel): string[] {
  if (!model.platform.manage.tags) return [];
  const tags = model.tables.flatMap((table) => [
    ...table.contract.tags,
    ...table.contract.columns.flatMap((column) => column.tags ?? []),
  ]);
  const classified = model.tables.some((table) =>
    table.contract.columns.some((column) => column.classification),
  );
  const key = classificationTag(model);
  return [
    ...[...new Set(tags)]
      .filter((tag) => !allowedKey(tagParts(tag)[0]))
      .map(
        (tag) =>
          `the tag "${tag}" has a key Unity Catalog does not allow: ${keyRules}; write key:value for a value`,
      ),
    ...(classified && !allowedKey(key)
      ? [`the classification tag key "${key}" is a key Unity Catalog does not allow: ${keyRules}`]
      : []),
  ];
}

/** The capabilities whose policies share one set of grants, written after the last that is on. */
const policyIds = new Set<Capability["id"]>(["masks", "filters"]);

/** A principal as one quoted name: in backticks, each backtick doubled; dots stay inside. */
function quotedPrincipal(principal: string): string {
  return `\`${principal.replaceAll("`", "``")}\``;
}

/** SQL an administrator runs once, so the run_as identity may do what is turned on. */
export function prerequisites(model: ResolvedModel, header: string): string | undefined {
  const { manage, run_as: runAs } = model.platform;
  const on = capabilities.filter(
    (capability) => granted.has(capability.id) && manage[capability.id],
  );
  if (on.length === 0) return undefined;
  const principal = runAs
    ? quotedPrincipal(Object.values(runAs)[0] ?? "")
    : "`<the identity that deploys>`";
  const lastPolicy = on.filter((capability) => policyIds.has(capability.id)).at(-1);
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
    if (capability === lastPolicy) lines.push(...governanceGrants(model, principal));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
