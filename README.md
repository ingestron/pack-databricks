# @ingestron/pack-databricks

The Databricks pack: from resolved Ingestron definitions it generates a
[Declarative Automation Bundle](https://docs.databricks.com/aws/en/dev-tools/bundles/)
(formerly Databricks Asset Bundle) with one
[Lakeflow Spark Declarative Pipeline](https://docs.databricks.com/aws/en/ldp/concepts/)
per project. Name it in your standard: `packs: [databricks@2]`.

What it uses on Databricks:

- **Lakeflow Connect:** SQL Server (through an ingestion gateway), Salesforce
  and Kafka, through Unity Catalog connections; only the contract's columns,
  SCD type 1 or 2.
- **Ingestion with Auto Loader:** streaming tables over
  `STREAM read_files(…)`, with schema hints from the contract and a schema
  evolution mode.
- **Change data with AUTO CDC:** `mode: upsert` (SCD type 1) or
  `mode: history` (SCD type 2), keyed by the contract's primary key.
- **Expectations:** from required columns and your own checks, with
  `warn`, `drop` or `fail` per check.
- **Liquid clustering:** `CLUSTER BY AUTO` by default, or named columns.
- **Materialised views** for transforms, in SQL or PySpark.
- **Serverless pipelines**, a scheduled refresh job, Unity Catalog schemas
  and grants when you ask for them, permissions, tags and notifications.

One bundle covers every environment, with a target per environment, as
Databricks teams lay out bundles by hand. A value is a bundle variable only
where environments differ; everything the same in every environment is written
as it is. Each target sets its own variables, so the `targets` block shows
exactly what changes between dev and prod.

## Example

Most people use this through the [`ingestron`](https://www.npmjs.com/package/ingestron) command, which writes the bundle to `build/databricks/`. In code:

```ts
import { loadDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { databricks } from "@ingestron/pack-databricks";

const models: Record<string, ResolvedModel> = {};
for (const environment of ["dev", "prod"]) {
  const result = loadDefinitions("definitions", {
    packs: [databricks],
    environment,
    deployTime: true,
    environmentsTogether: true,
  });
  if (result.model) models[environment] = result.model;
}
const { files, problems } = databricks.buildEnvironments!(models);
for (const problem of problems) console.log(problem.code, problem.message);
for (const path of Object.keys(files)) console.log(path);
```

For the retail example this prints:

```text
databricks.yml
resources/retail.pipeline.yml
src/retail/bronze/orders.sql
src/retail/bronze/customers.sql
src/retail/silver/daily_sales.sql
resources/retail_refresh.job.yml
```

The values that differ between dev and prod are in `databricks.yml`:

```yaml
variables:
  catalog:
    description: Catalog of the retail tables.
  shop_path:
    description: Folder the shop files are read from (connection shop).
targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://adb-1111111111111111.1.azuredatabricks.net
    presets:
      tags:
        environment: dev
    variables:
      catalog: dev_sales
      shop_path: abfss://landing@retaildev.dfs.core.windows.net/shop
  prod:
    mode: production
    # …
```

The pipeline reads them as `catalog: ${var.catalog}` and as the configuration
value `ingestron.shop_path`, which its SQL uses as `${ingestron.shop_path}`.
Tables in the pipeline's catalog are named with two parts, such as
`bronze.orders`.

## Deploy

From the bundle folder, deploy one environment at a time, the same files each
time:

```sh
cd build/databricks
databricks bundle validate -t prod
databricks bundle deploy -t prod
```

A value written as `${envvar:NAME}` in the definitions is supplied when
deploying: the bundle declares it as a variable that the targets leave unset,
and the pipeline sets `BUNDLE_VAR_<name>` (`name` is NAME in lower case). A
workspace host supplied this way is `DATABRICKS_HOST`.

`prerequisites/<environment>.sql` holds the grants an administrator runs once
in that environment. It is not deployed.

## What changed in 2.0

- One bundle in `build/databricks/` for every environment, in place of a
  bundle per environment in `build/<environment>/`. Change the standard to
  `databricks@2`.
- The bundle name, pipeline and job keys, target names and `root_path` are the
  same as in 1.x, so the first `bundle deploy -t <environment>` updates that
  environment's resources in place. Run `bundle validate` and `bundle summary`
  first.
- Managed schemas are keyed by layer (`bronze`), not `<catalog>_<schema>`.
  With `manage.schemas`, bind each existing schema to its new key with
  `databricks bundle deployment bind` before the first deploy.
- Pipeline code names tables in the pipeline's catalog with two parts.
- `prerequisites.sql` is `prerequisites/<environment>.sql`.
- The mode is `production` for every environment except `dev`, unless the
  platform sets it.
- Environments may differ only in values. A table built in some environments
  only, or code that differs in more than a value, is `ENVIRONMENTS_DIFFER`.
  PySpark transforms cannot take values that differ yet.
- Needs `@ingestron/definitions` 1.8 or later.

The rules are in [spec/behaviour.md](spec/behaviour.md).

## With the ADF pack

Used with the [ADF pack](https://github.com/ingestron/pack-adf)
(`packs: [databricks@2, adf@2]`), streaming tables read the files ADF lands,
from its `landing` folder.

Columns ADF adds to the landed rows (`audit_columns` in ADF 1.4) are read
with the files; timestamps, which ADF writes as text, are cast to `TIMESTAMP`.

## Dependencies

- [`@ingestron/definitions`](https://www.npmjs.com/package/@ingestron/definitions), a peer dependency: the resolved model.
- [`liquidjs`](https://liquidjs.com/): renders the SQL templates in
  `templates/` and the transforms' SQL.
- [`yaml`](https://eemeli.org/yaml/): writes the bundle's YAML files.

## Sources (accessed 2026-10-24)

Bundle variables, targets and presets: [spec/references.md](spec/references.md)
(accessed 2026-11-04).

Bundle fields from Databricks CLI v1.22.1 `databricks bundle schema` and
`databricks/bundle-examples` (`lakeflow_pipelines_sql`). SQL from
[CREATE STREAMING TABLE](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-streaming-table.html),
[CREATE MATERIALIZED VIEW](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-create-materialized-view),
[AUTO CDC INTO](https://docs.databricks.com/aws/en/dlt-ref/dlt-sql-ref-apply-changes-into),
[expectations](https://docs.databricks.com/aws/en/ldp/expectations) and
[read_files](https://docs.databricks.com/sql/language-manual/functions/read_files.html),
[Python API](https://docs.databricks.com/aws/en/ldp/developer/python-ref),
[materialized_view](https://docs.databricks.com/aws/en/ldp/developer/ldp-python-ref-materialized-view),
[Python expectations](https://docs.databricks.com/aws/en/ldp/developer/ldp-python-ref-expectations),
[SQL Server ingestion](https://docs.databricks.com/gcp/ingestion/lakeflow-connect/sql-server-pipeline),
[Salesforce ingestion](https://docs.databricks.com/aws/ingestion/lakeflow-connect/salesforce-pipeline)
and [Kafka ingestion](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/kafka-pipeline).

## Working on this pack

```sh
pnpm install
pnpm validate   # format, licences, lint, types, tests, README code and API report
```

Requires Node 22.13 or later and pnpm 10. How code is written here:
[CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## Contact

Questions and feedback: hello@ingestron.io. Security reports: security@ingestron.io
(see [SECURITY.md](SECURITY.md)).

## Documentation

User documentation: https://docs.ingestron.io.

## Licence

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE). Made by
[IntentLabs](https://intentlabs.dev).
