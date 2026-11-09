# Databricks pack: references

The Databricks syntax and behaviour the pack relies on, with where each comes
from. All were accessed on 2026-11-04 unless a date is given.

## Bundles and targets

- [Bundle configuration and targets](https://docs.databricks.com/aws/en/dev-tools/bundles/settings):
  the keys a target takes (`mode`, `default`, `workspace`, `run_as`,
  `permissions`, `presets`, `variables`), and that exactly one target is
  `default: true`. The page does not say how a target's lists merge with
  top-level lists, which is why the pack writes no per-target resource
  overrides (spec, section 3.4).
- [Bundle variables](https://docs.databricks.com/aws/en/dev-tools/bundles/variables):
  `variables` with `description` and `default`, `type: complex` for lists,
  values per target, `BUNDLE_VAR_<name>` environment variables, the order in
  which values are taken (`--var`, `BUNDLE_VAR_`, `variable-overrides.json`,
  the target, the default), and that a variable without a default must be set.
- [Deployment modes and presets](https://docs.databricks.com/aws/en/dev-tools/bundles/deployment-modes):
  what `development` mode does (name prefix, paused schedules, no deployment
  lock), the presets `tags` and `trigger_pause_status`, and that a resource's
  own `pause_status` wins over the preset.
- Databricks CLI source at tag v1.23.0 (released 2026-10-29, the latest on
  2026-11-04):
  [`bundle/config/mutator/resourcemutator/apply_presets.go`](https://github.com/databricks/cli/blob/v1.23.0/bundle/config/mutator/resourcemutator/apply_presets.go)
  and
  [`apply_target_mode.go`](https://github.com/databricks/cli/blob/v1.23.0/bundle/config/mutator/resourcemutator/apply_target_mode.go).
  Preset tags are added to jobs and pipelines only for keys the resource leaves
  unset or empty; `trigger_pause_status` sets a schedule's pause only where the
  job leaves it unset; a `PAUSED` preset sets `continuous: false` on every
  pipeline; `development` mode makes `trigger_pause_status` `PAUSED` unless the
  target sets it. The documentation does not say these; the spec's view
  (section 4) and the pack's tests of it (`test/view.test.ts`) follow this
  source.
- Databricks CLI pull request
  [#3086](https://github.com/databricks/cli/pull/3086), "Add support for
  pipeline tagging", merged 2025-08-07 and first released in v0.264.0: preset
  tags reach pipelines from that version. The pack needs v0.264.0 or later.
- Databricks CLI source at v1.23.0,
  [`bundle/config/validate/interpolation_in_auth_config.go`](https://github.com/databricks/cli/blob/v1.23.0/bundle/config/validate/interpolation_in_auth_config.go),
  from pull request [#2399](https://github.com/databricks/cli/pull/2399), "Add
  warning when variable interpolation is used for auth fields": `workspace.host`
  takes no variable; set `DATABRICKS_HOST` to supply it at deploy time (spec,
  section 3.5).
- [CI/CD with bundles](https://docs.databricks.com/aws/en/dev-tools/bundles/ci-cd-bundles):
  one bundle deployed to each environment with `databricks bundle deploy -t <target>`.
- Templates with variables set per target,
  [`databricks/bundle-examples`](https://github.com/databricks/bundle-examples):
  `default_python/databricks.yml` and `lakeflow_pipelines_sql/databricks.yml`
  declare `catalog` and `schema` with a description and no default, and set
  them in each target.
- Bundle JSON schema: `databricks bundle schema` from Databricks CLI v1.23.0.
  The golden bundles in `test/golden` validate against it.

## Pipelines

- [Pipeline parameters and configuration](https://docs.databricks.com/aws/en/ldp/parameters):
  a pipeline's `configuration` values are read in SQL as `${key}`, including
  inside a string literal, and in Python with `spark.conf.get`. The page calls
  configuration "the legacy parameterization mechanism", which "continues to
  work" beside pipeline parameters; parameters (`:key`) are SQL only. The pack
  uses configuration, with keys `ingestron.<name>`, so one mechanism serves SQL
  and Python.
- Python reads of configuration values, inferred from
  [Configure a pipeline](https://docs.databricks.com/aws/en/ldp/configure-pipeline)
  ("For Python pipelines that need parameterization, the Configuration field
  also exposes values to `spark.conf.get()`") and
  [Develop pipeline code with Python](https://docs.databricks.com/aws/en/ldp/developer/python-dev),
  whose "Create tables in a `for` loop" example computes a value at module level
  and builds `@dp.materialized_view(name=f"…")` from it. A PySpark file reads each
  value a decorator needs into a module-level constant in that pattern, and the
  values for a table's inputs inside the function. No page shows
  `spark.conf.get` in a decorator argument, so the pack never puts it there.
- [Develop pipeline code with SQL](https://docs.databricks.com/aws/en/ldp/developer/sql-dev):
  "To read a configuration value in a query, use the string interpolation
  syntax `${}`." Interpolation is of text, so it reaches a `read_files` path,
  which is a string literal.
- [Bundle commands](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands):
  `databricks bundle deployment bind KEY RESOURCE_ID` links a bundle resource
  to an existing one (a schema's id is `catalog.schema`), and
  `databricks bundle deployment unbind KEY` removes that link. Spec section 6
  uses them to move an existing schema to its `databricks@2` key.
- Databricks CLI source at v1.23.0,
  [`bundle/phases/deploy.go`](https://github.com/databricks/cli/blob/v1.23.0/bundle/phases/deploy.go)
  and `messages.go`: a deploy that would delete or recreate a Unity Catalog
  schema asks for approval ("This action will result in the deletion or
  recreation of the following UC schemas. Any underlying data may be lost"),
  and without a terminal fails unless `--auto-approve` is given.

## Intent

Accessed 2026-11-09. The sources of the `used` entries in the pack's intent
(spec, section 8). Where a page carries no release label, the pack records the
feature as generally available.

- [Auto Loader](https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/auto-loader/)
  and [read_files](https://docs.databricks.com/aws/en/sql/language-manual/functions/read_files):
  `STREAM read_files(path, format => …)` reads each new file once
  (`load.mode: files`). The pages carry no release label.
- [Auto Loader schema](https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/auto-loader/schema):
  inference adds `_rescued_data`, which holds values that do not parse
  (`rescued`). No release label.
- [File metadata column](https://docs.databricks.com/aws/en/ingestion/file-metadata-column):
  `_metadata.file_path` and `_metadata.file_modification_time` (`audit:
source_file` and `source_modified_at`); `current_timestamp()` gives
  `loaded_at`. Select the fields, not the whole struct. No release label.
- [AUTO CDC](https://docs.databricks.com/aws/en/ldp/cdc): `KEYS`,
  `SEQUENCE BY`, `APPLY AS DELETE WHEN` and `STORED AS SCD TYPE 1 | 2` (`history:
latest | full`, `sequence`, `load.deletes.when`); no release label. `STORED AS
BITEMPORAL` is Beta, so `history: bitemporal` is not used.
- [Lakeflow Connect SCD](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/scd):
  the connector's `scd_type`, the same history for managed ingestion.
- [Streaming table](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-streaming-table)
  and
  [materialised view](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-materialized-view):
  a materialised view is recomputed on each update, so it keeps no history; a
  streaming table appends. `CLUSTER BY AUTO` is generally available.
- [Liquid clustering](https://docs.databricks.com/aws/en/delta/clustering):
  `CLUSTER BY AUTO` and `CLUSTER BY (…)` (`storage.clustering`). Generally
  available.
- [Pipeline event log](https://docs.databricks.com/aws/en/ldp/monitor-event-logs):
  `event_log: {catalog, schema, name}` publishes the log to a table, where the
  expectation metrics are (`quality.results`). No release label.
- [Configure a task](https://docs.databricks.com/aws/en/jobs/configure-task):
  `max_retries`, `min_retry_interval_millis` and `timeout_seconds` on a task
  (`operations.retries`). The page's default is no retries.
- [Configure a job](https://docs.databricks.com/aws/en/jobs/configure-job):
  `max_concurrent_runs`, `queue` and `timeout_seconds`
  (`operations.concurrency`, `operations.timeout`).
- [Job notifications](https://docs.databricks.com/aws/en/jobs/notifications):
  email and webhook notifications, and the run duration warning
  (`operations.alerts`). The page labels only SQL conditions for triggers as
  Beta; the duration warning has no label.
- [Bundle resources](https://docs.databricks.com/aws/en/dev-tools/bundles/resources):
  the keys of the `jobs` and `pipelines` resources, checked against the bundle
  JSON schema of Databricks CLI v1.23.0.
- [SQL warehouses](https://docs.databricks.com/aws/en/compute/sql-warehouse/):
  a warehouse's connection details show its HTTP path, which ends with the
  warehouse ID (`databricks.warehouse_id`).

## Earlier sources

The SQL, Python and Lakeflow Connect syntax are recorded in the package
README's sources (accessed 2026-10-24).

## Where to find a value (`find`)

Accessed 2026-11-05. A new project's README.md shows these beside each value
`ingestron init` writes as `REPLACE_ME`:

- [Manage connections for Lakehouse Federation](https://docs.databricks.com/aws/en/query-federation/connections):
  in Catalog Explorer, the gear icon at the top of the Catalog pane, then
  Connections, lists a workspace's Unity Catalog connections.
- [Work with files in Unity Catalog volumes](https://docs.databricks.com/aws/en/volumes/volume-files):
  a volume's files are at `/Volumes/<catalog>/<schema>/<volume>/…`.
