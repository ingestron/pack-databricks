// What the pack does with each intent path and value (spec section 8). Every other path
// and value is planned: the mapping table in the spec is the target, not what is built.
import {
  intentPaths,
  type FeatureStatus,
  type IntentUse,
  type SettingAlias,
} from "@ingestron/definitions";
import { connectQualityIntent, qualityIntent, viewQualityIntent } from "./quality-intent.js";

/** The page that gives a feature's release status; all were read on 2026-11-09. */
const pages = {
  autoLoader: "https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/auto-loader/",
  schema: "https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/auto-loader/schema",
  metadata: "https://docs.databricks.com/aws/en/ingestion/file-metadata-column",
  cdc: "https://docs.databricks.com/aws/en/ldp/cdc",
  view: "https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-materialized-view",
  connectScd: "https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/scd",
  clustering: "https://docs.databricks.com/aws/en/delta/clustering",
  eventLog: "https://docs.databricks.com/aws/en/ldp/monitor-event-logs",
  task: "https://docs.databricks.com/aws/en/jobs/configure-task",
  job: "https://docs.databricks.com/aws/en/jobs/configure-job",
  notifications: "https://docs.databricks.com/aws/en/jobs/notifications",
};

/** The pages that give grants', masks' and row filters' release status, read on 2026-11-11. */
const accessPages = {
  grant: "https://docs.databricks.com/aws/en/sql/language-manual/security-grant",
  revoke: "https://docs.databricks.com/aws/en/sql/language-manual/security-revoke",
  policy: "https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-policy",
};

/** A column mask or row filter policy, made after each refresh; generally available. */
const policy = (does: string) =>
  used(`${does}, after each refresh.`, accessPages.policy, ga(accessPages.policy, "2026-11-11"));

const ga = (source: string, checked = "2026-11-09"): FeatureStatus => ({
  level: "ga",
  checked,
  source,
});
const publicPreview = (source: string): FeatureStatus => ({
  level: "preview",
  label: "Public Preview",
  checked: "2026-11-09",
  source,
});
const used = (does: string, source: string, status = ga(source)): IntentUse => ({
  use: "used",
  does,
  status,
});
const notYet: IntentUse = { use: "not-yet", reason: "Planned." };
const landing: IntentUse = {
  use: "elsewhere",
  reason: "The ingest step that lands the files adds it.",
};
const landed: IntentUse = { use: "elsewhere", reason: "The landing pack keeps landed files." };

/** The audit values the pack's own reading of files adds. */
const fileAudit = ["loaded_at", "source_file", "source_modified_at"];

/** The audit values the ingest step adds, which the pack's own reading of files cannot. */
const ingestAudit = ["run_id", "window_start", "window_end", "source_object", "source_connection"];

/** Every path and value as planned, so each takes the entry below it, if any. */
function planned(): Record<string, IntentUse> {
  return Object.fromEntries(Object.keys(intentPaths).map((path) => [path, notYet]));
}

/** The pack's coverage: what it builds, `elsewhere` for the landing pack's work, the rest planned. */
export const intent: Record<string, IntentUse> = {
  ...planned(),
  "load.mode=files": used("Auto Loader, through read_files.", pages.autoLoader),
  "history=none": used("A streaming table that appends (APPEND ONLY).", pages.cdc),
  "history=latest": used("AUTO CDC stored as SCD type 1.", pages.cdc),
  "history=full": used("AUTO CDC stored as SCD type 2.", pages.cdc),
  sequence: used("AUTO CDC SEQUENCE BY.", pages.cdc),
  "load.deletes.when": used("AUTO CDC APPLY AS DELETE WHEN.", pages.cdc),
  "audit=loaded_at": used("A column of current_timestamp().", pages.metadata),
  "audit=source_file": used("A column of _metadata.file_path.", pages.metadata),
  "audit=source_modified_at": used("A column of _metadata.file_modification_time.", pages.metadata),
  ...Object.fromEntries(ingestAudit.map((value) => [`audit=${value}`, landing])),
  rescued: used("The _rescued_data column of read_files.", pages.schema),
  "retention.landed_files": landed,
  "storage.clustering=auto": used("CLUSTER BY AUTO.", pages.clustering),
  "storage.clustering=none": used("No CLUSTER BY clause.", pages.clustering),
  "quality.results": used("Publishes the pipeline's event log to a table.", pages.eventLog),
  ...qualityIntent,
  "operations.retries": used("The pipeline task's max_retries and retry interval.", pages.task),
  "operations.timeout": used("The job's timeout_seconds.", pages.job),
  "operations.concurrency": used("The job's max_concurrent_runs and queue.", pages.job),
  "operations.alerts=failure": used(
    "The job's email and webhook failure alerts.",
    pages.notifications,
  ),
  "operations.schedule=project": used(
    "One refresh job for the project, on the Platform's schedule.",
    pages.job,
  ),
  "operations.schedule=flow": notYet,
  // Duration thresholds are Public Preview on the configure-job page.
  "operations.alerts=slow": used(
    "A run duration health rule and warning alert.",
    pages.job,
    publicPreview(pages.job),
  ),
  "access.grants=read": used(
    "GRANT SELECT ON TABLE, after each refresh.",
    accessPages.grant,
    ga(accessPages.grant, "2026-11-11"),
  ),
  "access.grants=write": used(
    "GRANT SELECT, MODIFY ON TABLE, after each refresh.",
    accessPages.grant,
    ga(accessPages.grant, "2026-11-11"),
  ),
  "access.exact=true": used(
    "REVOKE of each privilege granted directly on the table that the access does not give, after each refresh.",
    accessPages.revoke,
    ga(accessPages.revoke, "2026-11-11"),
  ),
  "access.masks=null": policy("A column mask policy with the ingestron_mask_null function"),
  "access.masks=hash": policy("A column mask policy with the ingestron_mask_hash function"),
  "access.masks=redact": policy("A column mask policy with the ingestron_mask_redact function"),
  "access.masks=function": policy("A column mask policy with the team's function"),
  "access.filters=true": policy("A row filter policy with the team's function"),
};

/** Where the ingest step is the pack's own, the audit values that step adds are the pack's to build. */
const ownIngest: Record<string, IntentUse> = Object.fromEntries([
  ["retention.landed_files", notYet],
  ...ingestAudit.map((value) => [`audit=${value}`, notYet]),
]);

/** What differs for `files`, which reads the landed files in place. */
export const filesIntent: Record<string, IntentUse> = ownIngest;

/** What differs for Lakeflow Connect, which reads the source, not files. */
export const connectIntent: Record<string, IntentUse> = {
  ...ownIngest,
  ...connectQualityIntent,
  "load.mode=files": {
    use: "not-applicable",
    reason: "Managed ingestion reads the source, not files.",
  },
  "history=latest": used("The connector's scd_type 1.", pages.connectScd),
  "history=full": used("The connector's scd_type 2.", pages.connectScd),
  "history=none": used("The connector's append mode.", pages.connectScd),
  rescued: { use: "not-applicable", reason: "Managed ingestion has no rescued data column." },
  "storage.clustering": notYet,
  ...Object.fromEntries(
    fileAudit.map((value) => [
      `audit=${value}`,
      {
        use: "not-applicable",
        reason: "Managed ingestion writes the table; it adds no metadata columns.",
      },
    ]),
  ),
};

/** What differs for a materialised view, which is recomputed on each update. */
export const viewIntent: Record<string, IntentUse> = {
  "load.deletes": {
    use: "not-applicable",
    reason:
      "A materialised view is recomputed; a delete condition needs a streaming table with history.",
  },
  "history=latest": {
    use: "not-applicable",
    reason:
      "A materialised view is recomputed on each update; keep history with a streaming table.",
  },
  "history=full": {
    use: "not-applicable",
    reason:
      "A materialised view is recomputed on each update; keep history with a streaming table.",
  },
  "history=none": used("A materialised view keeps no more than its query gives.", pages.view),
  "access.grants=write": {
    use: "not-applicable",
    reason: "Unity Catalog has no MODIFY on a materialised view: only its query writes it.",
  },
  ...viewQualityIntent,
  ...Object.fromEntries(
    [...intentPaths.audit!.map((value) => `audit=${value}`), "rescued"].map((key) => [
      key,
      {
        use: "not-yet",
        reason: "Planned: audit columns and rescued data are added by streaming tables over files.",
      },
    ]),
  ),
};

/**
 * `cluster_by` of a store method: `auto` and `none` are other names for
 * `storage.clustering`; a column list stays a setting.
 */
export const clusterAlias: SettingAlias = {
  values: {
    auto: { storage: { clustering: "auto" } },
    none: { storage: { clustering: "none" } },
  },
};

/** The settings that are other names for intent: how rows are kept, their order, and deletions. */
export const changeAliases: Record<string, SettingAlias> = {
  mode: {
    values: {
      append: { history: "none" },
      upsert: { history: "latest" },
      history: { history: "full" },
    },
  },
  sequence_by: { path: "sequence" },
  delete_when: { path: "load.deletes.when" },
};
