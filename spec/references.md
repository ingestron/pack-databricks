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

Accessed 2026-11-09, except where an entry gives another date. The sources of the `used` entries in the pack's intent
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
- [Pipeline expectations](https://docs.databricks.com/aws/en/ldp/expectations),
  read 2026-11-10: `CONSTRAINT <name> EXPECT (<condition>)` keeps a failing
  row and records it (`quality.actions: warn`); `ON VIOLATION DROP ROW` drops
  it before it is written (`drop`); `ON VIOLATION FAIL UPDATE` stops the
  update (`fail`). Streaming tables and materialised views support
  expectations. Every rule kind of `quality.rules` is written as such a
  constraint. No release label.
- [Configure a task](https://docs.databricks.com/aws/en/jobs/configure-task):
  `max_retries` and `min_retry_interval_millis` on a task
  (`operations.retries`). The page's default is no retries. The after-refresh
  task also runs the table checks, counts over all rows, when `manage.checks`
  is on (`quality.table-checks`).
- [Configure a job](https://docs.databricks.com/aws/en/jobs/configure-job):
  `timeout_seconds` (`operations.timeout`), `max_concurrent_runs` and `queue`
  (`operations.concurrency`), and the run
  duration threshold of a job's health rules, which the page labels Public
  Preview (`operations.alerts: slow`).
- [Job notifications](https://docs.databricks.com/aws/en/jobs/notifications):
  email and webhook notifications, on failure and when a run passes its
  duration threshold (`operations.alerts`); at most three destinations per
  event.
- Bundle JSON schema, `databricks bundle schema` from Databricks CLI v1.23.0,
  read 2026-11-09: `jobs.JobsHealthOperator` allows only `GREATER_THAN` (the
  `op` of a health rule), and `jobs.JobsHealthMetric` has
  `RUN_DURATION_SECONDS`; `webhook_notifications.on_failure` and
  `on_duration_warning_threshold_exceeded` take a list of `{ id }`
  (`jobs.Webhook`), which the bundle resources page does not show;
  `queue` takes `{ enabled }`; a pipeline's `event_log` takes `catalog`,
  `schema` and `name`. The `standards` golden bundle validates against it.
- [Bundle resources](https://docs.databricks.com/aws/en/dev-tools/bundles/resources):
  the keys of the `jobs` and `pipelines` resources, checked against the bundle
  JSON schema of Databricks CLI v1.23.0.
- [SQL warehouses](https://docs.databricks.com/aws/en/compute/sql-warehouse/):
  a warehouse's connection details show its HTTP path, which ends with the
  warehouse ID (`databricks.warehouse_id`).

## Quality and cleansing

Accessed 2026-11-10. The sources of spec section 8.5. Function pages carry no
release label, so the pack records each as generally available. Each entry
gives the date the page says it was last updated.

- [Expectation recommendations and advanced patterns](https://docs.databricks.com/aws/en/ldp/expectation-patterns)
  (updated 2026-10-26), "Quarantine invalid records" (`quality.quarantine`).
  The source is read once, through a view. A `TEMPORARY` streaming table
  carries the rules as expectations and the flag
  `NOT ((<rule>) AND (<rule>)) AS is_quarantined`, and two views read it,
  one for the valid rows and one for the flagged ones. The pack keeps that
  shape with tables in place of the views, which a pipeline cannot stream
  from (below). An appending streaming table reads the files once into a
  `PRIVATE` streaming table, and the table and `<table>_quarantine` stream
  from it. The table keeps its own constraints, and the quarantine table
  keeps the flagged rows. No release label.
- [CREATE STREAMING TABLE (pipelines)](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-streaming-table)
  (updated 2026-10-02): `CREATE OR REFRESH [PRIVATE] STREAMING TABLE`;
  "Private streaming tables were previously created with the TEMPORARY
  parameter", are "only persisted across the lifetime of the pipeline", and
  within the pipeline a reference to their name resolves to them. A streaming
  table's query reads with `STREAM`, from `read_files` or another table
  (`STREAM(customers_bronze)`).
- [CREATE VIEW (pipelines)](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-view)
  (updated 2026-09-14): a pipeline's views take no `CONSTRAINT` clauses and
  "cannot have streaming queries, or be used as a streaming source". So the
  pattern's views cannot carry a streaming table's rows here; streaming tables
  read the private table instead.
- [Transform data with pipelines](https://docs.databricks.com/aws/en/ldp/transform)
  (updated 2026-10-09): streaming tables select from `STREAM(<table>)` with
  expressions and `WHERE`, as the quarantine of a change-data table does from
  its changes table.
- [CREATE MATERIALIZED VIEW (pipelines)](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-materialized-view)
  (updated 2026-10-09): a materialised view's query is any query, so it can
  wrap a transform's query in a subquery and end with `QUALIFY`.
- [Pipeline expectations](https://docs.databricks.com/aws/en/ldp/expectations)
  (updated 2026-10-26): a `DROP ROW` expectation drops the row before it is
  written and records it in the metrics, which is why the table keeps its
  constraints beside the quarantine table.
- [`to_utc_timestamp`](https://docs.databricks.com/aws/en/sql/language-manual/functions/to_utc_timestamp)
  and
  [`from_utc_timestamp`](https://docs.databricks.com/aws/en/sql/language-manual/functions/from_utc_timestamp)
  (both updated 2026-09-11): `to_utc_timestamp(expr, timeZone)` "returns the
  timestamp at UTC for a timestamp expr at timeZone", and
  `from_utc_timestamp(expr, timeZone)` the timestamp at `timeZone` for one at
  UTC; zones are tz database names (`cleanse.timezone`).
- [`convert_timezone`](https://docs.databricks.com/aws/en/sql/language-manual/functions/convert_timezone)
  (updated 2026-09-11): `convert_timezone([sourceTz, ]targetTz, sourceTs)`
  converts a `TIMESTAMP_NTZ`, from Databricks Runtime 13.3 LTS; the example
  names zones such as `'UTC'`. The pack always gives `sourceTz`.
- [`TIMESTAMP_NTZ` type](https://docs.databricks.com/aws/en/sql/language-manual/data-types/timestamp-ntz-type)
  (updated 2026-10-30): a timestamp without a time zone, and its
  `TIMESTAMP_NTZ '<text>'` literal.
- [`trim`](https://docs.databricks.com/aws/en/sql/language-manual/functions/trim),
  [`nullif`](https://docs.databricks.com/aws/en/sql/language-manual/functions/nullif),
  [`case`](https://docs.databricks.com/aws/en/sql/language-manual/functions/case),
  [`upper`](https://docs.databricks.com/aws/en/sql/language-manual/functions/upper),
  [`lower`](https://docs.databricks.com/aws/en/sql/language-manual/functions/lower)
  and
  [`coalesce`](https://docs.databricks.com/aws/en/sql/language-manual/functions/coalesce)
  (each updated 2026-09-11): the cleansing operations `trim`, `empty`, `map`
  (`CASE expr WHEN opt THEN res … ELSE def END`), `case` and `default`.
- [Star clause](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-star)
  (updated 2026-09-11): `* EXCEPT (<columns>)`, from Databricks Runtime 11.3
  LTS, which leaves out the columns a table selects again cleansed. Read again
  2026-11-11: "Each name must reference a column included in the set of
  columns that you can reference", so a cleansed table names the contract's
  columns first, in order, and the star after them adds only the others.
- [`QUALIFY`](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-qualify)
  and
  [`row_number`](https://docs.databricks.com/aws/en/sql/language-manual/functions/row_number)
  (both updated 2026-09-11): `QUALIFY` filters on a window function, from
  Databricks Runtime 10.4 LTS (`deduplicate`).
- The conditions of checks (`quality.rules`), each page updated 2026-09-11:
  [`rlike` operator](https://docs.databricks.com/aws/en/sql/language-manual/functions/rlike)
  (`str [NOT] rlike regex`, true when `str` matches; the pack writes it
  `RLIKE`, for `pattern`);
  [`length`](https://docs.databricks.com/aws/en/sql/language-manual/functions/length)
  (the character length of a string, for `length`);
  [`size`](https://docs.databricks.com/aws/en/sql/language-manual/functions/size)
  (the cardinality of an array, for `items`; with ANSI mode off `size(NULL)`
  is -1, which a check never reaches, as it tests `IS NULL` first) and
  [`array_distinct`](https://docs.databricks.com/aws/en/sql/language-manual/functions/array_distinct)
  (`unique`);
  [`%` operator](https://docs.databricks.com/aws/en/sql/language-manual/functions/percentsign)
  (the remainder, for `multipleOf`; a divisor of 0 raises
  `REMAINDER_BY_ZERO`, so a contract's `multipleOf: 0` stops the update when
  the check runs); and
  the [`in` predicate](https://docs.databricks.com/aws/en/sql/language-manual/functions/in)
  (`elem in (expr1, …)`, for `in`).
- [NULL semantics](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-null-semantics)
  (updated 2026-09-11, read 2026-11-10), "IN and NOT IN subqueries": `IN` is
  true when the value is in the list, false when it is not and the list holds
  no `NULL`, and unknown (`NULL`) when the value is `NULL`; `NOT IN` is its
  negation (`notIn`). A check therefore writes `<c> IS NULL OR …` or
  `<c> IS NOT NULL AND …` before `IN` and `NOT IN`, so it is never `NULL` for
  a null value; the lists the definitions package writes hold no `NULL`.
- Typed literals for cleansing values:
  [`DATE` type](https://docs.databricks.com/aws/en/sql/language-manual/data-types/date-type)
  (updated 2026-09-11, `DATE dateString`),
  [`TIMESTAMP` type](https://docs.databricks.com/aws/en/sql/language-manual/data-types/timestamp-type)
  (updated 2026-10-30, `TIMESTAMP timestampString`, with `T` or a space before
  the time),
  [`BOOLEAN` type](https://docs.databricks.com/aws/en/sql/language-manual/data-types/boolean-type)
  (updated 2026-09-11, `{ TRUE | FALSE }`) and the
  [literals](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-literals)
  page (updated 2026-10-28), which lists them; numbers are numeric literals
  as written.
- [`filter`](https://docs.databricks.com/aws/en/sql/language-manual/functions/filter),
  [`array`](https://docs.databricks.com/aws/en/sql/language-manual/functions/array)
  and [`if`](https://docs.databricks.com/aws/en/sql/language-manual/functions/if)
  (each updated 2026-09-11): `filter(array(…), x -> x IS NOT NULL)` keeps the
  names of the failed checks in `_failed_checks`; `IF(cond, NULL, '<name>')`
  takes the name when `cond` is false or null, and
  [`coalesce`](https://docs.databricks.com/aws/en/sql/language-manual/functions/coalesce)
  in `NOT coalesce(<conditions>, FALSE)` keeps such a row in the quarantine
  table too.
- PySpark 4.3.0 API reference,
  [`DataFrame.withColumns`](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.DataFrame.withColumns.html)
  ("adding multiple columns or replacing the existing columns that have the
  same names", from 3.3.0) and
  [`functions.expr`](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.functions.expr.html)
  (a SQL expression as a column): a PySpark transform's cleansing, deduplicate
  and quarantine use the same SQL expressions.

Clock changes: `to_utc_timestamp` and `from_utc_timestamp` read and write
wall-clock times, and the pages do not say how a time that a clock change
skips or repeats is resolved. The pack promises no result for those hours, and
its tests do not run Spark.

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
  a volume's files are at `/Volumes/<catalog>/<schema>/<volume>/…`. The files
  connector's `path` suggests `/Volumes/<catalog>/<schema>/<volume>`; a Unity
  Catalog connection's suggests `<connection name>`, the name the Connections
  list shows.

Accessed 2026-11-10. The `find` of each field of the Platform's `databricks`
section, which the editor shows on a `REPLACE_ME` beside the field's
description and `suggest`:

- [Declarative Automation Bundles deployment modes](https://docs.databricks.com/aws/en/dev-tools/bundles/deployment-modes):
  development mode for pre-production validation, production mode for
  validated deliverables (`mode`).
- [Get identifiers for workspace objects](https://docs.databricks.com/aws/en/workspace/workspace-details)
  and its Azure page,
  [Get identifiers for workspace objects](https://learn.microsoft.com/en-us/azure/databricks/workspace/workspace-details):
  the instance name is the first part of the URL you sign in at; on Azure the
  per-workspace URL is `adb-<workspace-id>.<random-number>.azuredatabricks.net`,
  also in the workspace's URL field in the Azure portal (`workspace.host`).
- [Configuration reference](https://docs.databricks.com/aws/en/dev-tools/bundles/reference):
  without `root_path`, a bundle deploys to
  `.bundle/${bundle.name}/${bundle.target}` in the deploying user's own
  workspace folder, named by `${workspace.current_user.userName}`
  (`workspace.root_path`); `run_as.service_principal_name` is the application
  ID of an active service principal and `run_as.user_name` the email of an
  active workspace user.
- [Specify a run identity](https://docs.databricks.com/aws/en/dev-tools/bundles/run-as):
  a service principal is given by its application ID, found on its page in the
  workspace admin settings, and a service principal is the most secure
  `run_as` for production.
- [Manage service principals](https://docs.databricks.com/aws/en/admin/users-groups/manage-service-principals),
  [Manage Databricks users](https://docs.databricks.com/aws/en/admin/users-groups/users)
  and [Manage Databricks groups](https://docs.databricks.com/aws/en/admin/users-groups/manage-groups):
  Settings, then Identity and access, then Manage next to Service principals,
  Users or Groups; a user is added by email address (`run_as`,
  `permissions.*`).
- [Authorize service principal access with OAuth](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m):
  "The client ID is the same as the service principal's application ID."
- [Configure a serverless pipeline](https://docs.databricks.com/aws/en/ldp/serverless):
  serverless pipelines need Unity Catalog, a serverless-enabled region and the
  serverless terms of use, and are the default for new pipelines
  (`compute.serverless`). Serverless usage policies are Public Preview there.
- [Attribute usage with serverless usage policies](https://docs.databricks.com/aws/en/admin/usage/budget-policies)
  and its [Azure page](https://learn.microsoft.com/en-us/azure/databricks/admin/usage/budget-policies):
  Settings, then Compute, then Manage next to Serverless usage policies lists
  the policies (`compute.budget_policy_id`). Public Preview. Neither page
  says where a policy's ID is shown, so the `find` names the list only.
- [Configure pipelines](https://docs.databricks.com/aws/en/ldp/configure-pipeline):
  new pipelines use the Current channel; the Preview channel tests a pipeline
  against pending runtime changes (`compute.channel`).
- [Set permissions for resources in bundles](https://docs.databricks.com/aws/en/dev-tools/bundles/permissions):
  the top-level levels are `CAN_VIEW`, `CAN_MANAGE` and `CAN_RUN`, for a
  `user_name`, `group_name` or `service_principal_name` (`permissions.*.level`).
- [What is Catalog Explorer?](https://docs.databricks.com/aws/en/catalog-explorer/):
  Catalog in the sidebar opens it (`manage.schemas`).
- [Unity Catalog privileges reference](https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/privileges):
  `CREATE SCHEMA` with `USE CATALOG` creates a schema in a catalog
  (`manage.schemas`); `SELECT` reads a table (`manage.checks`); the privileges
  a grant lists (`grants.*.*.privileges`).
- [Bundle resources](https://docs.databricks.com/aws/en/dev-tools/bundles/resources):
  a bundle's grants write privileges with underscores, such as `USE_CATALOG`
  and `CREATE_SCHEMA` (`grants.*.*.privileges`).
- [Manage privileges in Unity Catalog](https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/):
  an object's Permissions tab in Catalog Explorer; a principal is a user (by
  email address), a service principal (by application ID) or a group (by name)
  (`grants.*.*.principal`).
- [Apply tags to Unity Catalog securable objects](https://docs.databricks.com/aws/en/database-objects/tags):
  tagging needs ownership, or `APPLY TAG` with `USE SCHEMA` and `USE CATALOG`,
  and `ASSIGN` on a governed tag (`manage.tags`).
- [COMMENT ON](https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-comment):
  a comment on a table's column needs `MODIFY` on the table (`manage.comments`).
