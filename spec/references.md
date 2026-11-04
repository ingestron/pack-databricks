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
- Databricks CLI source,
  [`bundle/config/mutator/resourcemutator/apply_presets.go`](https://github.com/databricks/cli/blob/main/bundle/config/mutator/resourcemutator/apply_presets.go)
  and `apply_target_mode.go` (main branch): preset tags are added to jobs and
  pipelines only for keys the resource does not set; `trigger_pause_status`
  sets a schedule's pause only where the job leaves it unset; a `PAUSED`
  preset sets `continuous: false` on every pipeline; `development` mode makes
  `trigger_pause_status` `PAUSED` unless the target sets it. The documentation
  does not say these; the spec's view (section 4) follows the source.
- Databricks CLI pull request
  [#2399](https://github.com/databricks/cli/pull/2399), "Add warning when
  variable interpolation is used for auth fields": `workspace.host` takes no variable;
  set `DATABRICKS_HOST` to supply it at deploy time (spec, section 3.5).
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
  configuration the legacy mechanism, which still works beside pipeline
  parameters; parameters (`:key`) are SQL only. The pack uses configuration,
  with keys `ingestron.<name>`, so one mechanism serves SQL now and Python later.

## Earlier sources

The SQL, Python and Lakeflow Connect syntax are recorded in the package
README's sources (accessed 2026-10-24).
