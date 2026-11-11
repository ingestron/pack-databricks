// What the pack does with the quality and cleansing paths of intent (spec section 8.5): row
// checks as expectations, table checks after the refresh, cleansing in the table's SELECT,
// deduplicate in a materialised view and a quarantine table. Lakeflow Connect does none.
import type { FeatureStatus, IntentUse } from "@ingestron/definitions";

/** The page each entry's status comes from; all were read on 2026-11-10 unless one says. */
const pages = {
  expectations: "https://docs.databricks.com/aws/en/ldp/expectations",
  task: "https://docs.databricks.com/aws/en/jobs/configure-task",
  quarantine: "https://docs.databricks.com/aws/en/ldp/expectation-patterns",
  trim: "https://docs.databricks.com/aws/en/sql/language-manual/functions/trim",
  nullif: "https://docs.databricks.com/aws/en/sql/language-manual/functions/nullif",
  case: "https://docs.databricks.com/aws/en/sql/language-manual/functions/case",
  upper: "https://docs.databricks.com/aws/en/sql/language-manual/functions/upper",
  coalesce: "https://docs.databricks.com/aws/en/sql/language-manual/functions/coalesce",
  toUtc: "https://docs.databricks.com/aws/en/sql/language-manual/functions/to_utc_timestamp",
  qualify:
    "https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-qualify",
};

/** Generally available: the page carries no release label. */
const ga = (source: string, checked = "2026-11-10"): FeatureStatus => ({
  level: "ga",
  checked,
  source,
});
const used = (does: string, source: string, status = ga(source)): IntentUse => ({
  use: "used",
  does,
  status,
});

/** The quality and cleansing entries of the pack, for every method but Lakeflow Connect. */
export const qualityIntent: Record<string, IntentUse> = {
  "quality.rules": used(
    "A Lakeflow expectation on the table, from the check's SQL.",
    pages.expectations,
  ),
  "quality.actions=warn": used("EXPECT: a failing row is kept and counted.", pages.expectations),
  "quality.actions=drop": used(
    "ON VIOLATION DROP ROW: a failing row is not written.",
    pages.expectations,
  ),
  "quality.actions=fail": used(
    "ON VIOLATION FAIL UPDATE: a failing row stops the update.",
    pages.expectations,
  ),
  "quality.table-checks": used(
    "A count over all rows in the after-refresh task, when manage.checks is on.",
    pages.task,
    ga(pages.task, "2026-11-09"),
  ),
  "quality.quarantine": used(
    "A <table>_quarantine table of the rows a drop check removes, with _failed_checks.",
    pages.quarantine,
  ),
  "cleanse.trim": used("trim() in the table's SELECT.", pages.trim),
  "cleanse.empty": used("nullif(<column>, '') in the table's SELECT.", pages.nullif),
  "cleanse.map": used("A CASE expression in the table's SELECT.", pages.case),
  "cleanse.case": used("upper() or lower() in the table's SELECT.", pages.upper),
  "cleanse.default": used("coalesce() in the table's SELECT.", pages.coalesce),
  "cleanse.timezone": used(
    "to_utc_timestamp and from_utc_timestamp, or convert_timezone for TIMESTAMP_NTZ, in the table's SELECT.",
    pages.toUtc,
  ),
  deduplicate: {
    use: "not-applicable",
    reason:
      "A streaming table keeps one row per key through its history, latest or full; deduplicate in a materialised view.",
  },
};

/** What a materialised view does beyond the pack: it deduplicates. */
export const viewQualityIntent: Record<string, IntentUse> = {
  deduplicate: used("QUALIFY row_number() … = 1 after cleansing.", pages.qualify),
};

/** Why managed ingestion does not do it, and where to do it instead. */
const asTheSourceGives = (verb: string): IntentUse => ({
  use: "not-applicable",
  reason: `Managed ingestion writes the table as the source gives it; ${verb} it in a transform in the next layer.`,
});

/**
 * Lakeflow Connect writes the table itself: it checks no row, cleanses nothing and keeps one
 * row per key only through its own history. Table checks and results stay the pack's.
 */
export const connectQualityIntent: Record<string, IntentUse> = {
  "quality.rules": asTheSourceGives("check"),
  "quality.actions": asTheSourceGives("check"),
  "quality.quarantine": asTheSourceGives("check"),
  cleanse: asTheSourceGives("cleanse"),
  deduplicate: asTheSourceGives("deduplicate"),
};
