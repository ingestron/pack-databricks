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

## Earlier sources

The SQL, Python and Lakeflow Connect syntax are recorded in the package
README's sources (accessed 2026-10-24).
