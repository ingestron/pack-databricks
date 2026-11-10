# Databricks pack: specification

Version: 2 (`databricks@2`). Status: implemented by `@ingestron/pack-databricks`
2.0.0. It follows the
[definitions specification](https://github.com/ingestron/ingestron/blob/main/spec/definitions/model.md),
section 2.1 (building files and building environments together), and section 7
(platform defaults). Sources for the Databricks syntax are in
[references.md](references.md).

The key words MUST, MUST NOT and MAY are used as in RFC 2119.

## 1. Output

The pack builds environments together: `buildEnvironments(models)` gives one
[Declarative Automation Bundle](https://docs.databricks.com/aws/en/dev-tools/bundles/)
with a target per environment, which a tool writes to one folder (the CLI writes
`build/databricks/`). It is deployed from that folder with
`databricks bundle deploy -t <environment>`.

| Path                                 | What it is                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `databricks.yml`                     | The bundle: name, `include`, `sync`, `variables` and one target per environment                  |
| `resources/<pipeline>.pipeline.yml`  | The pipeline that builds the tables, when any table has a store step                             |
| `resources/<gateway>.pipeline.yml`   | A Lakeflow Connect ingestion gateway, one per database connection                                |
| `resources/<ingestion>.pipeline.yml` | A Lakeflow Connect ingestion pipeline, one per managed connection                                |
| `resources/<job>.job.yml`            | The refresh job, when there is a schedule or an after-refresh task                               |
| `resources/schemas.yml`              | Managed schemas, with `manage.schemas`                                                           |
| `src/<pipeline>/<layer>/<table>.sql` | A table's SQL (`.py` for a PySpark transform)                                                    |
| `tasks/<pipeline>/apply_contract.py` | The after-refresh task: tags, column comments, grants, policies and table checks, when any is on |
| `prerequisites/<environment>.sql`    | Grants an administrator runs once in that environment, when a capability needs it                |

`<pipeline>` and `<job>` are the model's `names.pipeline` and `names.job`;
`<gateway>` and `<ingestion>` are `<pipeline>_<connection>_gateway` and
`<pipeline>_<connection>_ingestion`. Each generated file starts with a comment
naming the definitions it comes from and saying not to edit it; the comment
names no environment.

`databricks.yml` has
`sync: { exclude: [.generated.json, .generated.lock, prerequisites/**] }`: the
generation manifest, its lock and the grants files are in the bundle folder but
are not deployed. The lock is there only while files are written, or after
writing stopped part way. The grants files are run by hand.

The standard's intent adds to these files, never adds a file: retries,
timeouts, concurrency and alerts in the job, the event log in the pipelines,
audit and rescued columns, cleansing, deduplicating and a quarantine table in
a table's SQL or Python file (sections 2 and 8.5).

`build(model)` gives the same layout for one environment, with one target and
every value as the model resolves it. It is the fold property's render
(section 4).

## 2. Building one environment

What `build` writes, which the folded bundle also follows:

- **The target** is named after the environment and is the default. It has the
  platform's `mode`, its `workspace` (`host`, `root_path`), `run_as` and
  `permissions`, each only when set.
- **Two-part table names.** In a pipeline's SQL and Python files, a table in the
  pipeline's own catalog is named `schema.table`, as the pipeline reads names in
  its `catalog`. The pipeline's catalog is the catalog of the first table it
  builds. A table in another catalog is named with three parts. This includes
  the AUTO CDC changes table and a transform's `{{ tables.<input> }}`. The
  after-refresh task runs in a job, not a pipeline, so it names every table with
  three parts.
- **Managed schemas** (`manage.schemas`) are keyed so that the key is the same
  in every environment where only the catalog differs: by their layer, such as
  `bronze`, when the layer has one schema, else by the schema's name, such as
  `bronze_shop`. When two catalogs hold a schema of the same name, or the key is
  already taken, the key is `<catalog>_<schema>`.
- **Tags.** The platform's `tags` are on every pipeline, the gateway included,
  and on the refresh job.
- **The after-refresh task** is `tasks/<pipeline>/apply_contract.py`, which the
  refresh job runs as `../tasks/<pipeline>/apply_contract.py`. It is outside
  `src/`: a pipeline loads every Python and SQL file its library glob
  `../src/<pipeline>/**` matches as its own code, and this script must run only
  in the job, after the refresh. The bundle deploys it, as it deploys every file
  that `sync` does not exclude. No Python file but a pipeline's own transforms
  is under a pipeline's glob, whatever the naming standard. The task replaces each
  `${ingestron.<name>}` in its statements and checks with the value of a task
  parameter `ingestron.<name>=<value>`. Built for one environment it has no
  parameters, so nothing is replaced.
- **Grants** that the run_as identity needs once are in
  `prerequisites/<environment>.sql`. Grants of the tables to the contracts'
  roles are made by the after-refresh task (section 8.6).
- **Operations.** The standard's operations policy (the model's `operations`)
  sets, only for what it gives: on each pipeline task of the refresh job (the
  refresh and each ingestion task, not the after-refresh task) `max_retries`
  and `min_retry_interval_millis` from `retries`; on the job `timeout_seconds`
  from `timeout`, how long a run may take, and `max_concurrent_runs` and
  `queue: { enabled }` from `concurrency`. A duration (`30s`, `5m`, `2h`, `1d`) is written in seconds,
  and the retry interval in milliseconds.
- **Alerts.** Each of the Platform's alerts (definitions adds
  `notifications.on_failure` as an email alert) is raised for each event in
  its `on` that the standard's `operations.alerts.on` also lists; `slow` only
  when the standard gives `slow_after`. For a failure, the email addresses,
  each once in the order written, go to the job's
  `email_notifications.on_failure` and to every pipeline's `notifications`, as
  `notifications.on_failure` always has; each destination goes to the job's
  `webhook_notifications.on_failure` as `{ id }`. For a slow run, the job's
  `health.rules` is one rule, `metric: RUN_DURATION_SECONDS`,
  `op: GREATER_THAN` and `value` the `slow_after` in seconds, and its email
  addresses and destinations go to `on_duration_warning_threshold_exceeded` of
  `email_notifications` and `webhook_notifications`. The pack keeps the failure addresses as the
  model's `notifications.on_failure` before it builds or folds, so addresses
  that differ between environments become the variable
  `notifications_on_failure` (a list variable when their number differs), as
  before. A destination id that differs becomes a variable named from its
  place, such as `alerts_id`. Other alerts whose number differs between
  environments cannot be folded: the job file is `ENVIRONMENTS_DIFFER`.
- **Event log.** A pipeline publishes its event log, where the expectation
  metrics are, when the standard keeps quality results (the model's
  `qualityResults`) or any table the pipeline builds resolves
  `quality.results: true` (from its layer or itself). The pipeline that builds
  the tables and each Lakeflow Connect ingestion pipeline then have
  `event_log: { catalog, schema, name: <pipeline>_event_log }`, in the
  pipeline's own catalog and schema. A gateway has none. A project that sets
  `quality.results` only in the standard gets what it got before tables could
  set it.
- **Audit and rescued columns.** Only a streaming table that reads files with
  `read_files` adds them (the changes table of a change-data table included);
  a materialised view adds none, whether it reads files or other tables
  (section 8.2). The streaming table selects after the columns read, in
  the order the table's intent gives them, `current_timestamp() AS <as>` for
  `audit: loaded_at`, `_metadata.file_path AS <as>` for `source_file` and
  `_metadata.file_modification_time AS <as>` for `source_modified_at`.
  Definitions has checked that each `<as>` is a plain lower-case name, so it is
  not quoted. The other audit values are added by the step that lands the
  files and are among the columns read. `rescued: true` adds
  `rescuedDataColumn => '_rescued_data'` after `schemaEvolutionMode` and before
  the method's own options, unless those options name `rescuedDataColumn`
  (in any case), whose column is then used. AUTO CDC keeps these columns: its
  `COLUMNS * EXCEPT (…)` leaves out only `except_columns`.
- **Platform fields.** The pack lists as `platformFields` every Platform
  setting it reads: `mode`; `workspace.host` and `workspace.root_path`;
  `run_as`, `permissions` and `tags`, which it writes as they are;
  `compute.serverless`, `compute.budget_policy_id` and `compute.channel`;
  `schedule.cron`, `schedule.timezone` and `schedule.paused`;
  `notifications.on_failure` and `alerts`; `grants`, as the grants of a managed schema; the
  seven `manage` settings (`schemas`, `tags`, `comments`, `checks`, `grants`,
  `masks`, `filters`); `principals`, through each table's grants; and
  `databricks.governance.unmasked` and `databricks.governance.functions`
  (sections 8.6 and 8.7). Definitions
  checks each against the Platform's field reference, so tools can show them with
  their defaults.

## 3. Building environments together

`buildEnvironments(models)` takes each target's model, resolved with
`deployTime` and `environmentsTogether`, in project.yaml's order.

### 3.1 Folding

1. The models are compared with the definitions package's `compareTargets`.
   Any `structural` problem is returned, and nothing else is checked.
2. Tables named with two parts in some targets only, and Kafka connections
   read continuously in some targets only, are refused next (section 5).
3. A **template** model is made from the first target's model: each value that
   differs between targets is replaced by a marker for a bundle variable
   (section 3.2), each deploy-time value by a marker for its variable
   (section 3.5), and each tag that differs is removed. The template is built
   as one environment's bundle (section 2).
4. Each marker becomes a reference to its variable where the value is used
   (section 3.3).
5. Each target gets its own settings (section 3.4), and every variable the
   files use is declared and set in each target that sets it.
6. The folded files are checked against each target's own bundle (section 4).

A value that is the same in every target, and holds no deploy-time value, is
written as it is (minimality). A value becomes a variable only where it differs
between targets or is supplied when deploying.

These values are not folded into variables: Databricks takes them per target
(section 3.4), or they follow from other values:

- `project.environment`;
- the platform's `mode`, `workspace`, `run_as`, `permissions`, `tags` and
  `schedule.paused`;
- a transform's `inputs`, which are the full names of other tables and follow
  those tables' names.

A text that differs is one variable for the whole text. A list whose length
differs is one variable declared `type: complex`, unless it holds a
deploy-time value. A transform's code that differs is folded token by token
(words, runs of white space, and each other character; a deploy-time value is
one token): each run of tokens that differs is a variable. Code whose targets
have a different number of tokens is refused (section 5). Any other value that
differs, such as a number or a flag, or a key that some targets do not have,
stays as the first target has it. Such values are not made variables: the
check in section 4 refuses one that changes a file, naming each such value and
its value in every target, and one that changes no file is harmless.

### 3.2 Variables

Every variable is declared once in `databricks.yml` with a `description` and
no `default`, so that no target can take another environment's value. Each
target sets every variable in its `variables`, except one the deploying CI pipeline
supplies (section 3.5). Two places whose values are the same in every target
share one variable.

A variable's name comes from where the value is in the first target's model:

| Value                                                                | Variable                                        |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| A table's catalog, when it is the pipeline's catalog in every target | `catalog`                                       |
| A table's catalog otherwise                                          | `catalog_<layer>`                               |
| A table's schema                                                     | `schema_<layer>`                                |
| A table's name                                                       | `table_<table>`                                 |
| The `path` of a table's connection                                   | `<connection>_path`                             |
| Another setting of a table's connection                              | `<connection>_<setting>`                        |
| A step's `landing` or `published` setting                            | `landing`, `published`                          |
| Another value of a table                                             | `<table>_<step>_<setting>`, `<table>_<field>`   |
| A part of a transform's code                                         | `<table>_value`                                 |
| A platform setting                                                   | `<setting>`, such as `notifications_on_failure` |
| A role's principal, in `principals` and in each table's grants       | `principal_<role>`                              |
| The Platform's `databricks.governance.functions`                     | `governance_functions`                          |
| The schedule's pause, in the case of section 3.4                     | `pause_status`                                  |
| A deploy-time value `${envvar:NAME}`                                 | NAME in lower case (section 3.5)                |

Names are in lower case, with `_` for any character other than a letter, a
digit or `_`, and without list positions. Deploy-time values are named first;
a name already taken gets `_2`, `_3` and so on, in the order the values are
found: deploy-time values in the order the models first hold them, then the
places where values differ in the order `compareTargets` gives them.

### 3.3 Where a variable is used

- **In YAML** a marker becomes `${var.<name>}`, whole or within a longer text.
- **In a pipeline's SQL** (`src/<pipeline>/**/*.sql`) it becomes
  `${ingestron.<name>}`, and the pipeline gets the configuration
  `ingestron.<name>: ${var.<name>}`. Databricks replaces `${ingestron.<name>}`
  with the configuration value when the pipeline runs, inside string literals
  such as a `read_files` path too.
- **In the after-refresh task** it becomes `${ingestron.<name>}`, and the
  job's `spark_python_task` gets the parameter `ingestron.<name>=${var.<name>}`
  (section 2). A principal is quoted after its value is replaced
  (section 8.6), so a principal that differs between environments is quoted
  as each environment gives it. So is a function's name (section 8.7), so the
  schema of `governance.functions` may differ between environments.
- **In a PySpark transform's file** (`src/<pipeline>/**/*.py`), a variable
  inside a double-quoted text the pack writes, such as the table's `name` or an
  input's name, is read with `spark.conf.get("ingestron.<name>")`:
  - outside the functions the pack writes (`def ingestron_…`: the table's
    function, and with cleansing or quarantine the functions of section 8.5),
    as in the decorators, which are evaluated when the file loads, each value
    is read once into a module-level constant
    `ingestron_<name>`, under the comment
    `# Values that differ between environments, from the pipeline's configuration.`
    above the first decorator, and the text becomes an f-string, with braces in
    the rest of the text doubled: `"⟦schema_silver⟧.totals"` becomes
    `f"{ingestron_schema_silver}.totals"`;
  - inside such a function, which builds the transform's inputs, the read
    stays in the body, joined to the rest of the text:
    `spark.conf.get("ingestron.schema_bronze") + ".orders"`. The pipeline gets the
    configuration `ingestron.<name>: ${var.<name>}`, as for SQL. A variable in
    the transform's own code, which the pack copies as it is, is refused
    (section 5).
- **In a path or a YAML key**, a variable is refused (section 5): file names
  and resource keys must be the same in every target.

### 3.4 Targets

Each target, named after its environment, has:

- `mode`, then `default: true` for the first target only;
- `workspace` (`host`, `root_path`), `run_as` and `permissions`, as each
  target's model has them; a deploy-time value in them is its variable
  (section 3.5), except a host;
- `presets.tags`: the platform's tags that are not the same in every target,
  with that target's values. The tags that are the same stay on the resources.
  Databricks adds a preset tag to every job and pipeline that does not set it;
- `presets.trigger_pause_status`, when `schedule.paused` differs between
  targets: the refresh job's schedule then has no `pause_status`, and a target
  gets `PAUSED` when its mode is `production` and its schedule is paused, or
  `UNPAUSED` when its mode is `development` and its schedule is not paused.
  Otherwise the mode gives the right state by itself: `development` pauses
  schedules, and an unset `pause_status` is `UNPAUSED`. A `PAUSED` preset also
  stops every continuous pipeline, such as a gateway, and an `UNPAUSED` preset in
  a `development` target lets them run where the mode alone would stop them. So
  when a target with a continuous pipeline would get either preset, the job's
  `pause_status` is `${var.pause_status}` instead, set to `PAUSED` or
  `UNPAUSED` in every target;
- `variables`: every declared variable the target sets.

The mode is the model's: with `environmentsTogether`, `development` for the
environment named `dev` and `production` for every other environment, unless
the platform sets `mode`. Section 6 says what that changes for an environment
that `databricks@1` deployed in `development` mode.

### 3.5 Deploy-time values

A deploy-time value `${envvar:NAME}` (definitions specification, section 1.1)
is a bundle variable named NAME in lower case, with `_` for other characters,
described `Supplied when deploying, as BUNDLE_VAR_<name> (<NAME> in the definitions).`
A target in which the value is supplied leaves the variable unset, and the
deploying CI pipeline supplies it as the environment variable `BUNDLE_VAR_<name>`.
The files never hold the text `${envvar:NAME}`.

- **The same in every target.** Each deploy-time value in the text becomes its
  variable, with the rest of the text literal:
  `abfss://landing@${envvar:ACCOUNT}.dfs.core.windows.net` is
  `abfss://landing@${var.account}.dfs.core.windows.net` in YAML, and
  `abfss://landing@${ingestron.account}.dfs.core.windows.net` in pipeline SQL.
  Databricks puts a variable inside a text.
- **Literal in some targets.** Where a value holds a deploy-time value in some
  targets and is literal in others, the targets that hold it MUST write the same
  text, with one deploy-time value. A literal target sets the variable to its
  text between the literal parts before and after the value; with
  `${envvar:LANDING}` alone, that is its whole text. The variable's description
  then names the targets that supply it.
- **One value per target.** A deploy-time value's variable has one value in
  each target: a target cannot supply it in one place and set it in another, nor
  set it to two different texts.
- **The workspace host** cannot be a bundle variable, so a target whose host is
  a deploy-time value leaves `workspace.host` out, and the CI pipeline supplies the
  host as `DATABRICKS_HOST`. A host with a deploy-time value inside a longer text
  is refused.
- **Grants files** are run by hand, so `prerequisites/<environment>.sql` writes
  a deploy-time value as `<value of NAME>`.

`deployValues` lists each deploy-time value the files take, in the order the
models first hold it, taken in target order, with `suppliedAs`:
`BUNDLE_VAR_<name>` when a declared variable stands for it and some target
leaves that unset, and `DATABRICKS_HOST` when it is a target's host.

## 4. The fold property

For a target `e`:

- `render(e)` is `build(models[e])`;
- `view(files, e)` is what Databricks deploys for target `e`, laid out as
  `build` lays out one target:
  - `databricks.yml` with only target `e`, marked `default`, without its
    `variables` and `presets`, and with no top-level `variables`; when the
    pipeline supplies the host, the target's `workspace.host` is the host's
    deploy-time value text;
  - each `${var.<name>}` in the YAML replaced by `e`'s value: a whole value by
    the variable's value (a list for a complex variable), a part of a text by its
    text. A variable `e` leaves unset is replaced by the text of the deploy-time
    value supplied for it;
  - `e`'s presets applied to every job and pipeline: each preset tag the
    resource does not set; a schedule without `pause_status` gets the preset's,
    else `PAUSED` in `development` mode, else `UNPAUSED`; a `PAUSED` preset
    removes `continuous` from every pipeline. Development mode's own default
    `PAUSED` stops them in the target's own bundle too, whose files keep
    `continuous: true`, so the view keeps it. Development mode stops continuous
    pipelines through its own default `PAUSED` preset, unless an `UNPAUSED`
    preset replaces it, and no resource setting can say that: so in a
    `development` target with an `UNPAUSED` preset and a continuous pipeline,
    the view's target keeps `presets: { trigger_pause_status: UNPAUSED }`;
  - each pipeline's `ingestron.*` configuration replaces `${ingestron.<name>}`
    in the SQL files under its `root_path`; in the Python files there, the
    module-level constants are removed, each f-string that uses them becomes a
    JSON text with their values, and each `spark.conf.get("ingestron.<name>")` in
    the body becomes its value as a JSON text, joined with the texts it was
    joined to with `+`. The configuration is then removed from the pipeline. Each `ingestron.*` task parameter replaces `${ingestron.<name>}`
    in its Python file, written as JSON writes the text inside a string, and is
    removed from the task;
  - only `prerequisites/e.sql`, with each `<value of NAME>` written
    `${envvar:NAME}`.

YAML files are compared as data; other files as text. `view(files, e)` MUST
equal `render(e)` for every target, and for the models of the first one, two
and more targets.

`buildEnvironments` checks this itself before it returns the files. A file
whose view differs from the render in any target is `ENVIRONMENTS_DIFFER`
(section 5), so a fold never changes what an environment gets.

## 5. Problems

`buildEnvironments` reports only `ENVIRONMENTS_DIFFER` and `DEPLOY_VALUE`, all
errors. With any of them, `files` and `deployValues` are empty. Besides the
`structural` problems of `compareTargets`:

| Code                  | Message                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Location               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `ENVIRONMENTS_DIFFER` | `Table "<table>" is in the pipeline's catalog in <targets> but not in <targets>, so the pipeline's code cannot name it the same way in every environment.`, hint `Put the table in the pipeline's catalog in every environment, or in another catalog in every environment.`                                                                                                                                                                                      | The table's file       |
| `ENVIRONMENTS_DIFFER` | `Connection "<connection>" is read continuously in <targets> and by the refresh job in <targets>.`, hint `Set continuous in the flow's ingest settings, so that it is the same in every environment.`                                                                                                                                                                                                                                                             | The first table's file |
| `ENVIRONMENTS_DIFFER` | `The <pipeline or job> is named "<name>" in <target> and "<name>" in <target>; resource keys and folders are named after it, so it must be the same in every environment.`                                                                                                                                                                                                                                                                                        | `project.yaml`         |
| `ENVIRONMENTS_DIFFER` | `The code of table "<table>" differs between <targets> in more than values.`                                                                                                                                                                                                                                                                                                                                                                                      | The table's file       |
| `ENVIRONMENTS_DIFFER` | `The generated file <path> would be named after a value that differs between environments; names that decide files and resource keys must be the same in every environment.`                                                                                                                                                                                                                                                                                      | `project.yaml`         |
| `ENVIRONMENTS_DIFFER` | `The resource key <key> in <path> would be named after a value that differs between environments; names that decide files and resource keys must be the same in every environment.`                                                                                                                                                                                                                                                                               | `project.yaml`         |
| `ENVIRONMENTS_DIFFER` | `The code of PySpark transform "<table>" would need values that differ between environments (<variables>); a PySpark transform's own code cannot take them yet.`, hint `Make these values the same in every environment, or write the transform in SQL.`                                                                                                                                                                                                          | The table's file       |
| `ENVIRONMENTS_DIFFER` | `<path> cannot be generated once for every environment: in <targets> it would not be what that environment gets on its own, because the environments differ there in more than values.`, when no value that is not text differs                                                                                                                                                                                                                                   | `project.yaml`         |
| `ENVIRONMENTS_DIFFER` | `<path> cannot be generated once for every environment: in <targets> it would not be what that environment gets on its own, because a value that is not text differs between environments: <setting> is <value> in <targets>, <value> in <targets>.` (each such value, joined with `; `), hint `Make <settings> the same in every environment; only text values, such as names, paths and hosts, and lists can differ.` A value is written as JSON, or `not set`. | `project.yaml`         |
| `DEPLOY_VALUE`        | `This value is "<text>" in <target> and "<text>" in <target>; a value supplied when deploying must be written the same way in every environment that supplies it.`                                                                                                                                                                                                                                                                                                | The value's first use  |
| `DEPLOY_VALUE`        | `This value is "<text>" in <target> and "<text>" in <target>, which holds more than one value supplied when deploying; write it the same way in every environment.`                                                                                                                                                                                                                                                                                               | The value's first use  |
| `DEPLOY_VALUE`        | `This value is "<text>" in <target>, which does not have the form "<text>" of <target>, so ${envvar:<NAME>} cannot stand for part of it.`                                                                                                                                                                                                                                                                                                                         | The value's first use  |
| `DEPLOY_VALUE`        | `${envvar:<NAME>} stands for one value in each environment, but <target> writes …`                                                                                                                                                                                                                                                                                                                                                                                | The value's first use  |
| `DEPLOY_VALUE`        | `The workspace host in <target> holds ${envvar:<NAME>} within other text; Databricks takes a host supplied when deploying only as a whole, from DATABRICKS_HOST.`                                                                                                                                                                                                                                                                                                 | The value's first use  |
| `DEPLOY_VALUE`        | `The code of PySpark transform "<table>" would need ${envvar:<NAME>}, which is supplied when deploying; a PySpark transform's own code cannot take it yet.`                                                                                                                                                                                                                                                                                                       | The value's first use  |

In a path or a key, a variable is shown as `<name>`. Target lists are joined
with `, `, the last two with `and`. A problem the same
as one already given is given once. The hint, where none is given, is the
code's (definitions specification, section 2.1).

## 6. Deployment state

The bundle's `name` (the project id), the resource keys of pipelines and jobs,
the target names (the environment names) and each target's `root_path` are what
`databricks@1` wrote for each environment's own bundle. So the first
`databricks bundle deploy -t <environment>` of a `databricks@2` bundle reuses
that environment's deployment state, and for `dev` and `prod` updates its
resources in place. There are two exceptions.

**Managed schemas.** `databricks@1` keyed them `<catalog>_<schema>`, which
differs between environments; `databricks@2` keys them as section 2 says. Each
environment's deployment state still holds the old key, which is no longer in
the configuration, so the next deploy would delete the schema under that key:
the Databricks CLI asks for approval before deleting a Unity Catalog schema,
which fails in CI, and with `--auto-approve` it deletes the schema. So for each
environment, and each managed schema, before the first `databricks@2` deploy:

1. In the `databricks@1` folder (`build/<environment>/`), run
   `databricks bundle deployment unbind <catalog>_<schema> -t <environment>`.
   `unbind` finds the key in the configuration it is run with, so it must run
   against the `databricks@1` bundle.
2. In `build/databricks/`, run
   `databricks bundle deployment bind <key> <catalog>.<schema> -t <environment>`,
   where `<key>` is the schema's key in `resources/schemas.yml`.
3. Run `databricks bundle validate -t <environment>` and
   `databricks bundle summary -t <environment>`, and confirm that the deploy
   plans no schema deletion.

**Environments other than `dev` and `prod`.** With `databricks@1`, an
environment not named `prod` or `production`, such as `test`, `uat` or
`staging`, was in `development` mode unless the platform set `mode`. With
`databricks@2` it is in `production` mode (section 3.4). On its first deploy:

- resource names lose the `[dev <identity>]` prefix, so jobs and pipelines are
  renamed;
- pipelines get `development: false`;
- a managed schema, which development mode named `dev_<identity>_<schema>`,
  becomes `<schema>`: the deploy plans to delete the old schema, with the same
  approval as above, and the pipelines write to the new one;
- the deployment lock is on, and schedules are no longer paused by the mode
  (a paused schedule gets the `PAUSED` preset instead);
- production mode checks the deploying identity: without a service principal
  in `run_as`, `run_as` and `permissions` must be set, and `root_path` must not
  be a user's folder.

To keep `development` mode for such an environment, set it in the platform
per environment, for example `mode: ${values.mode}` in the platform and
`values: { mode: development }` for that environment in project.yaml (with
`mode: production` in the top-level `values`).

## 7. Conformance

The pack's tests check, on synthetic projects:

- the fold property (section 4) with the definitions package's `checkFold`, on
  one, two and three targets, including a value that differs in some targets
  only, a deploy-time value supplied in one target and literal in another, a
  deploy-time value inside a longer text, values in a transform's SQL code, a
  PySpark transform's names, the after-refresh task, managed schemas (one and
  several per layer), tags and the schedule's pause;
- that a deliberately wrong fold, with another environment's value or a preset
  dropped, fails `checkFold`;
- the view itself (section 4) on hand-written bundles, following the
  Databricks CLI's presets and development mode at v1.23.0;
- that no Python file but a pipeline's own transforms is under a pipeline's
  library glob;
- each problem of section 5 that a project can cause, and `ENVIRONMENTS_DIFFER`
  for a table in one environment only;
- minimality: a value the same in every target stays literal;
- the golden files in `test/golden`: a retail-shaped project with dev and
  prod, and with dev, test and prod, a PySpark transform whose schemas
  differ by environment, the retail project under a kit's standard
  (`standards`: audit and rescued columns, the event log, retries, a timeout,
  queueing, and failure and slow alerts, with dev, test and prod), and a
  synthetic project for quality and cleansing (`quality`, with dev and prod:
  every rule kind and action, every cleansing operation, a time zone
  conversion from `Europe/London`, deduplicate, quarantine and per-table
  results, on a bronze table and the silver tables that read it, in SQL and in
  PySpark), and a synthetic project for access (`governed`, with dev and
  prod: exact grants, a role whose principal differs between environments, a
  principal with a backtick, a write role on a streaming table and on a
  materialised view, layer access, a table that grants no role, managed
  schemas and a custom classification tag key), and `grants`, the same project
  with additive grants and without managed schemas; `masked`, the governed
  project with masks and row filters (dev and prod: policies on the managed
  schemas; the built-in `hash` and `null` masks, a team's mask function named
  with one part and one named with three; a filter matched by tag and one by
  classification; a `governance.functions` that differs between environments;
  and the places whose stale policies are dropped), and `masked-tables`, the
  same project without managed schemas, so its policies are on the tables;
- `exact-revokes-only-direct-extras`: the task's `revokes` function, run with
  Python over synthetic `SHOW GRANTS` rows (section 8.6). The test skips,
  saying why, when `python3` is not installed;
- the task's policy functions, run with Python in the same way (section 8.7):
  every policy of the `masked` goldens, made with `unmasked` empty, has `EXCEPT`
  with the identity the task runs as; `stale_drops` over synthetic
  `SHOW POLICIES` rows drops only the Ingestron policies a place no longer
  has, of the switches that are on; names are quoted;
- that every bundle file of every golden is valid for the bundle
  schema that `databricks bundle schema` prints with the Databricks CLI
  v1.23.0 or later. The test skips, saying why, when that CLI is not
  installed.

## 8. Intent

A standard can say what a table keeps and how its data is loaded as intent: a
vocabulary the definitions specification (section 11) defines for every
engine, such as `history: latest` or `load: files`. The pack declares what it
does with each value. The sources of the Databricks features are in
[references.md](references.md), under "Intent".

### 8.1 Mapping

| Intent                                  | Databricks                                                                  | Status    |
| --------------------------------------- | --------------------------------------------------------------------------- | --------- |
| `load.mode: files`                      | Auto Loader, through `read_files`                                           | used      |
| `load.mode: incremental`                | Query-based Lakeflow Connect (`cursor_columns`)                             | not yet   |
| `load.mode: changes`                    | Lakeflow Connect change capture; AUTO CDC from a change feed                | not yet   |
| `load.mode: full`                       | AUTO CDC from a snapshot; a materialised view over `read_files`             | not yet   |
| `history: none`                         | A streaming table that appends                                              | used      |
| `history: latest`                       | AUTO CDC `STORED AS SCD TYPE 1`; the connector's `scd_type` 1               | used      |
| `history: full`                         | AUTO CDC `STORED AS SCD TYPE 2`; the connector's `scd_type` 2               | used      |
| `history: bitemporal`                   | AUTO CDC `STORED AS BITEMPORAL` (Beta)                                      | not yet   |
| `sequence`                              | AUTO CDC `SEQUENCE BY`                                                      | used      |
| `load.deletes.when`                     | AUTO CDC `APPLY AS DELETE WHEN`                                             | used      |
| `load.deletes.mode`, `load.cursor`      | `deletion_condition`, `cursor_columns`                                      | not yet   |
| `audit: loaded_at`                      | `current_timestamp()`, in a streaming table over files                      | used      |
| `audit: source_file`                    | `_metadata.file_path`, in a streaming table over files                      | used      |
| `audit: source_modified_at`             | `_metadata.file_modification_time`, in a streaming table over files         | used      |
| `audit: run_id`, `window_*`, `source_*` | Added by the step that lands the files                                      | elsewhere |
| `audit: row_hash`                       | A hash column                                                               | not yet   |
| `rescued`                               | The `_rescued_data` column of `read_files`, in a streaming table            | used      |
| `storage.clustering: auto`, `none`      | `CLUSTER BY AUTO`; no `CLUSTER BY`                                          | used      |
| `storage.clustering: keys`, `features`  | `CLUSTER BY (…)`; table properties                                          | not yet   |
| `retention.time_travel`, `log`          | `delta.deletedFileRetentionDuration`, `delta.logRetentionDuration`          | not yet   |
| `retention.landed_files`                | Kept by the landing pack                                                    | elsewhere |
| `quality.results`                       | The pipeline's `event_log`, published to a table                            | used      |
| `quality.rules` (every kind)            | A Lakeflow expectation, `CONSTRAINT … EXPECT (…)`, written from the rule    | used      |
| `quality.actions: warn`                 | `EXPECT` alone: the row is kept and counted                                 | used      |
| `quality.actions: drop`                 | `ON VIOLATION DROP ROW`                                                     | used      |
| `quality.actions: fail`                 | `ON VIOLATION FAIL UPDATE`                                                  | used      |
| `quality.table-checks`                  | Counts in the after-refresh task, when `manage.checks` is on                | used      |
| `quality.quarantine`                    | `<table>_quarantine`, after the documented quarantine pattern               | used      |
| `cleanse.trim`, `empty`, `map`, `case`  | `trim`, `nullif`, `CASE`, `upper` or `lower`, in the table's `SELECT`       | used      |
| `cleanse.default`                       | `coalesce`, in the table's `SELECT`                                         | used      |
| `cleanse.timezone`                      | `to_utc_timestamp` and `from_utc_timestamp`; `convert_timezone` for NTZ     | used      |
| `deduplicate`                           | `QUALIFY row_number() … = 1`, in a materialised view                        | used      |
| `operations.retries`                    | The pipeline task's `max_retries` and `min_retry_interval_millis`           | used      |
| `operations.timeout`                    | The job's `timeout_seconds`                                                 | used      |
| `operations.concurrency`                | The job's `max_concurrent_runs` and `queue`                                 | used      |
| `operations.alerts: failure`            | The job's `email_notifications` and `webhook_notifications`; pipeline email | used      |
| `operations.alerts: slow`               | The job's `health` rule and duration warning notifications (Public Preview) | used      |
| `operations.trigger`                    | File arrival, table update and continuous triggers                          | not yet   |
| `operations.schedule: project`          | One refresh job for the project, on the Platform's schedule                 | used      |
| `operations.schedule: flow`             | A refresh job for each flow                                                 | not yet   |
| `access.grants: read`                   | `GRANT SELECT ON TABLE`, after each refresh, with `manage.grants`           | used      |
| `access.grants: write`                  | `GRANT SELECT, MODIFY ON TABLE`; not on a materialised view                 | used      |
| `access.exact`                          | `REVOKE` of the direct grants no role gives, after each refresh             | used      |
| `access.masks: null`, `hash`, `redact`  | `CREATE POLICY … COLUMN MASK` with the pack's mask function, `manage.masks` | used      |
| `access.masks: function`                | `CREATE POLICY … COLUMN MASK` with the team's function                      | used      |
| `access.filters`                        | `CREATE POLICY … ROW FILTER` with the team's function, `manage.filters`     | used      |

Every `used` feature is generally available on the page the pack checked on
2026-11-09, or for expectations, quarantine, cleansing, time zones and
deduplicate on 2026-11-10, or for grants, masks and row filters on 2026-11-11 (references.md), except the run duration threshold behind
`operations.alerts: slow`, which the job configuration page labels Public
Preview: a standard with `features: ga` that raises slow alerts gets
`PREVIEW_FEATURE`. `history: bitemporal` is Beta, which is why it is not yet.

### 8.2 Coverage

The pack's `intent` covers every intent path and value, and a test fails when
one is missing. An entry is one of:

- `used`, with what it does and the feature's release status (level, the page
  and the date checked), for every `used` row of section 8.1;
- `elsewhere`, for `retention.landed_files` and the audit values `run_id`,
  `window_start`, `window_end`, `source_object` and `source_connection`: the
  step that lands the files keeps or adds them. Where this pack reads the
  files in place (the `files` method) or the source (`lakeflow-connect`),
  nothing lands them, so they are `not-yet` for those methods;
- `not-applicable` with the reason, where the pack's platform cannot do it
  (`deduplicate` on a streaming table, below);
- `not-yet` with the reason "Planned.", for every other path and value: the
  table above is the target, not what the pack builds today.

The quality and cleansing entries (`quality.rules`, `quality.actions`,
`quality.table-checks`, `quality.quarantine`, `quality.results` and every
`cleanse` path) are the pack's, for every method but `lakeflow-connect`, all
`used` with no `onlyWhere`: the pack checks, cleanses and quarantines whatever
the layer's `does` says, as the model gives it. Table checks still need
`manage.checks`: with it off, the definitions package reports
`CAPABILITY_OFF`, not `NOT_APPLIED`. `deduplicate` is the pack's only as
`not-applicable` ("A streaming table keeps one row per key through its
history, latest or full; deduplicate in a materialised view."), and `used` by
`materialised-view`. A streaming table that deduplicates is judged by the
definitions package first (`DEDUPLICATE_MODE`: an error when it appends,
redundant when it keeps history), so this entry is a fallback.

A method declares only what differs from the pack:

- `materialised-view`: `history: latest` and `history: full` are
  `not-applicable` ("A materialised view is recomputed on each update; keep
  history with a streaming table."); `history: none` is used; every `audit`
  value and `rescued` are `not-yet` ("Planned: audit columns and rescued data
  are added by streaming tables over files."); `load.deletes` is
  `not-applicable` ("A materialised view is recomputed; a delete condition
  needs a streaming table with history.");
- `materialised-view`: also `deduplicate`, used (section 8.5), and
  `access.grants: write`, `not-applicable` ("Unity Catalog has no MODIFY on a
  materialised view: only its query writes it."), so a write role gets
  `SELECT` alone there;
- `lakeflow-connect`: `load.mode: files` is `not-applicable` ("Managed
  ingestion reads the source, not files."); `history: none`, `latest` and `full`
  are used, as the connector's append mode and `scd_type`; `rescued` is
  `not-applicable` ("Managed ingestion has no rescued data column."), as are
  `audit: loaded_at`, `source_file` and `source_modified_at` ("Managed
  ingestion writes the table; it adds no metadata columns."); and
  `storage.clustering` is `not-yet` ("Planned."). Managed ingestion writes
  the table as the source gives it, so it cannot check rows, cleanse or
  deduplicate: `quality.rules`, `quality.actions` and `quality.quarantine`
  are `not-applicable` ("Managed ingestion writes the table as the source
  gives it; check it in a transform in the next layer."), every `cleanse`
  path is too ("…; cleanse it in a transform in the next layer."), and so is
  `deduplicate` ("…; deduplicate it in a transform in the next layer."). The
  definitions package reports each rule, action and operation as
  `NOT_APPLIED`; the pack reports no problem of its own for an expectation
  on such a table, and generates no expectation there. `quality.table-checks`
  and `quality.results` stay the pack's: the after-refresh task counts table
  checks over every table, and the ingestion pipeline publishes its event
  log.

The access entries (`access.grants: read` and `write`, and `access.exact`)
are the pack's, `used`, for every method that keeps a table in Unity Catalog:
`streaming-table`, `materialised-view` (but `write`, above) and
`lakeflow-connect`, whose ingestion pipeline publishes streaming tables that
the after-refresh task already tags by their three-part names. They still need
`manage.grants`: with it off, the definitions package reports
`CAPABILITY_OFF`.

The mask and filter entries (`access.masks: null`, `hash`, `redact` and
`function`, and `access.filters`) are the pack's too, `used`, for the same
methods: Unity Catalog applies row filter and column mask policies to
streaming tables and materialised views, which is what each of these
methods keeps, Lakeflow Connect's included, and the after-refresh task sets
the classification tags the policies match on all of them (section 8.7).
They need `manage.masks` and `manage.filters`.

The step that writes the table judges `load.deletes` (definitions
specification, section 11.5): the store step, or `lakeflow-connect`, which
writes the table itself. A `streaming-table` keeps `load.deletes.when` as
`used`, but a delete condition declared as intent (not the `delete_when`
setting) on a table whose history is `none` is a problem of the table: `a
delete condition needs history latest or full`, since an appending table
applies no deletes. The `delete_when` setting with `mode: append` builds what
it built before intent existed.

The definitions package reports `NOT_APPLIED` for a value the judging method
declares `not-yet` or `not-applicable`, and `PREVIEW_FEATURE` for a `used` value
whose status is preview when the standard says `features: ga`.

### 8.3 Aliases and defaults

The `mode`, `sequence_by`, `delete_when` and `cluster_by` settings of
`streaming-table` are other names for intent, `cluster_by` of
`materialised-view` is too, and `mode` of `lakeflow-connect` is the same alias
as `streaming-table`'s:

| Setting            | Intent                     |
| ------------------ | -------------------------- |
| `mode: append`     | `history: none`            |
| `mode: upsert`     | `history: latest`          |
| `mode: history`    | `history: full`            |
| `sequence_by`      | `sequence`                 |
| `delete_when`      | `load.deletes.when`        |
| `cluster_by: auto` | `storage.clustering: auto` |
| `cluster_by: none` | `storage.clustering: none` |

A `cluster_by` list of columns stays a setting the alias does not map, so
`storage.clustering: none` in the standard gives a table no `CLUSTER BY`.

A table built from the intent gives the files a table built from the setting
gives. The methods fill in intent that nothing declares: `streaming-table`
`history: none`, `lakeflow-connect` `history: latest` and `files`
`load.mode: files`, which are what they did before intent existed.

### 8.4 The Platform's `databricks` section

The Platform fields that belong to Databricks are written under `databricks`:
`mode`, `workspace`, `run_as`, `compute`, `permissions`, `manage` and `grants`,
each with the schema it had at the top of the Platform, and `warehouse_id`,
the SQL warehouse that runs the bundle's SQL tasks. `manage` also takes
`grants` (section 8.6), and `masks` and `filters` (section 8.7). `governance`
takes `functions`, the `catalog.schema` for mask functions and for the team's
functions named with one part, and `unmasked`, the principals, as the platform
names them, that see real values and whose privileges exact grants never
revoke. The section allows no other
field. A project that still writes a moved field at the top gets
`PLATFORM_FIELD_MOVED` (a warning), and the output is the same. The pack reads
each field from either place; `databricks.warehouse_id` is listed with the
other Platform settings the pack reads.

### 8.5 Quality and cleansing

The model says what each table checks, cleanses, deduplicates and quarantines
(definitions specification, sections 6 and 11.7). The pack writes it in the
table's own SQL or Python file, as plain Spark SQL. The sources are in
[references.md](references.md), under "Quality and cleansing".

**Checks.** Each expectation is a constraint, as before:
`CONSTRAINT <name> EXPECT (<condition>)`, then nothing for `warn`,
`ON VIOLATION DROP ROW` for `drop` and `ON VIOLATION FAIL UPDATE` for `fail`.
The condition is written from the expectation's `rule` when it has one, else
it is the expectation's `check` text. With `<c>` the column in backticks and
`<v>` a value (a number as it is, any other value as SQL text):

| `kind`       | Condition                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `notNull`    | `<c> IS NOT NULL`                                                                                  |
| `in`         | `<c> IS NULL OR <c> IN (<v>, …)`; `<c> IS NOT NULL AND <c> IN (<v>, …)` without `allowNull`        |
| `notIn`      | as `in`, with `NOT IN`                                                                             |
| `pattern`    | `<c> IS NULL OR <c> RLIKE <v>`                                                                     |
| `length`     | `<c> IS NULL OR length(<c>) >= <min>`, and `length(<c>) <= <max>`                                  |
| `range`      | `<c> IS NULL OR <c> >= <min>`, and `<c> <= <max>`; `>` and `<` when `exclusive`                    |
| `multipleOf` | `<c> IS NULL OR <c> % <value> = 0`                                                                 |
| `items`      | `<c> IS NULL OR size(<c>) >= <min>`, `size(<c>) <= <max>`, `size(array_distinct(<c>)) = size(<c>)` |

A rule with more than one limit joins them with `AND` after `<c> IS NULL OR`.
These are the texts the definitions package writes in `check`, so a table
gets the same file whichever is read. A PySpark transform's decorators and
the quarantine table use the same conditions.

**Cleansing.** Each column in `cleanse.columns` is selected as an expression
of the column, each operation applied to the result of the one before, in
the model's order:

| Operation  | Expression                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `timezone` | `to_utc_timestamp(<x>, '<from>')` to `UTC`; else `from_utc_timestamp(to_utc_timestamp(<x>, '<from>'), '<to>')` |
|            | `convert_timezone('<from>', '<to>', <x>)` when the column's type is `TIMESTAMP_NTZ`                            |
| `trim`     | `trim(<x>)`                                                                                                    |
| `empty`    | `nullif(<x>, '')`                                                                                              |
| `map`      | `CASE <x> WHEN <key> THEN <value> … ELSE <x> END`, the keys in the order written; a null value is `NULL`       |
| `case`     | `upper(<x>)` or `lower(<x>)`                                                                                   |
| `default`  | `coalesce(<x>, <value>)`                                                                                       |

`<x>` starts as the column. A value is written for the column's
`logicalType`: a number as it is for `integer` and `number` (a `map` key,
which is text, too); `TRUE` or `FALSE` for `boolean`; `DATE '<text>'` for
`date`; `TIMESTAMP '<text>'` for `timestamp` (`TIMESTAMP_NTZ '<text>'` when the
column's type is `TIMESTAMP_NTZ`); any other value as SQL text. A column's
type is its contract `physicalType`, else the standard's type for its
`logicalType`.

The expressions go in the `SELECT` that builds the table's rows:

- **A table that reads files** (a streaming table, the changes table of a
  change-data table, or a materialised view over `read_files`) and cleanses a
  column: the select list names the contract's columns first, in the
  contract's order, as the DuckDB and Synapse packs select them: a cleansed
  column as `<expression> AS <c>`, a renamed one as `<source> AS <c>` (its
  expression starting from its source name when it is cleansed too, so it is
  selected once), and any other as `<c>`. Then come the other columns read,
  `* EXCEPT (<the contract's columns as read>, <text timestamps>)`, then each
  text timestamp as `CAST(<t> AS TIMESTAMP) AS <t>` (section 2). A table that
  cleanses no column keeps the select list of section 2. A change-data table
  cleanses its changes, so AUTO CDC keeps cleansed rows.
- **A transform's materialised view** wraps the transform's query, its
  contract's columns first, in the contract's order, then the query's other
  columns:
  `SELECT <c or expression AS c>, …, * EXCEPT (<the contract's columns>) FROM (<query>) AS source`,
  the query on lines of its own. On this pack a transform's table is always a
  materialised view, and a materialised view reads no `STREAM()`, so no
  wrapped query carries one; cleansing never goes in the transform's own
  `SELECT`.
- **A PySpark transform** calls the transform in a function
  `ingestron_<table>_rows()`, then sets each cleansed column with
  `rows.withColumns({"<c>": ingestron_expr("<expression>"), …})`, which
  replaces the columns of those names. `ingestron_expr` is `pyspark.sql.functions.expr`,
  imported under that name so it does not clash with the transform's code.
  The table's function returns `ingestron_<table>_rows()`.

**Deduplicate** happens only in a materialised view: after cleansing,
`QUALIFY row_number() OVER (PARTITION BY <primary key> ORDER BY <c> DESC, …) = 1`,
each `order_by` column in the order written. The window must read the columns
as selected, cleansed or renamed, and a name that is both a column read and a
column selected could be read either way. So `QUALIFY` follows `read_files(…)`
only when the select list is `*`; otherwise, and for a transform's query, it
ends a `SELECT` of its own: `SELECT * FROM (<the rows>) AS cleansed QUALIFY …`,
or `AS source` around a transform's query that cleanses no column. A PySpark
transform adds the same window as a column `_ingestron_row`, keeps the rows
where it is `1` and drops the column. A streaming table writes nothing for
`deduplicate`: the definitions package has reported `DEDUPLICATE_MODE`, an
error when the table appends and redundant when AUTO CDC already keeps one row
per key.

**Quarantine.** A table with `quarantine` in the model keeps its own
constraints, so its `drop` checks still drop the failing rows and count them
in the event log. The same file also builds `<table>_quarantine`
(`quarantine.fullName`, named as the table is), the same kind of table, from
the same rows, read once:

```sql
-- Rows that a check with the action drop removed from customers, with the checks they failed.
CREATE OR REFRESH MATERIALIZED VIEW `silver`.`customers_quarantine`
COMMENT 'Rows of customers that failed a check that drops rows; _failed_checks names the checks.'
AS SELECT *, filter(array(IF(<condition>, NULL, '<name>'), …), name -> name IS NOT NULL) AS _failed_checks
FROM <the rows>
WHERE NOT coalesce((<condition>) AND …, FALSE);
```

The conditions are those of the table's `drop` checks, in the table's order;
one is written `NOT coalesce(<condition>, FALSE)`. A condition that is null
counts as failed: `IF` names its check, and `coalesce` keeps the row, so every
row whose `_failed_checks` names a check is in the quarantine table. (The
conditions the definitions package writes are never null; a flow's or
transform's own check can be.) `_failed_checks` is an array of the names of
the checks the row failed.

This is Databricks' quarantine pattern ("Quarantine invalid records",
references.md): the source is read once, its rows are flagged with
`NOT ((<rule>) AND …)` in a table that every reader then reads, and the
flagged rows are kept apart from the valid ones. The pattern splits that table
with views; a pipeline's views cannot be read as a stream, so here the readers
are tables:

- **A streaming table that appends** reads the files once, into a private
  streaming table that only the pipeline sees (`PRIVATE`, which the pattern's
  `TEMPORARY` is now called). The table and its quarantine both stream from
  it:

  ```sql
  CREATE OR REFRESH PRIVATE STREAMING TABLE `<table>_checked`
  AS SELECT … FROM STREAM read_files(…);

  CREATE OR REFRESH STREAMING TABLE `bronze`.`<table>` (<its constraints>)
  …
  AS SELECT * FROM STREAM(`<table>_checked`);
  ```

  and `<the rows>` is ``STREAM(`<table>_checked`)``. The private table holds the
  cleansed rows with their audit and rescued columns, so both tables see the
  same rows, read by one Auto Loader stream. Its name is the table's name with
  `_checked`, in no schema; table names are unique in a project. Without
  quarantine the table reads the files itself, as before.

- **A change-data table's** quarantine reads its changes table,
  `STREAM(<changes>)`, which already holds each change once, cleansed.
- **A materialised view's** reads `(<the view's query>) AS checked`, with its
  cleansing and `QUALIFY`, or `read_files(…)` as the view does. A
  materialised view is recomputed from its inputs on each update, so reading
  them twice reads the same rows.
- **A PySpark transform's** is a second `@dp.materialized_view` with the name
  and comment above, whose function `ingestron_<table>_quarantine()` returns
  `ingestron_<table>_rows()` with the column `_failed_checks` added by
  `withColumn` and the rows kept by
  `filter("NOT coalesce((<condition>) AND …, FALSE)")`.

The quarantine table has its comment and no constraints, clustering or table
properties.

### 8.6 Access

The model gives each table's access (definitions specification, section
8.2): its grants, each a principal with `read`, or `read` and `write`, and
whether grants are exact. The definitions package judges them against the
pack's coverage and the platform's `manage.grants`, and records in the
table's `notApplied` what is not applied. The pack builds only what is
applied, and never judges it again:

- With `manage.grants` off, nothing below is built, and the files are what
  they were before grants existed.
- A table's grants, unless its `notApplied` lists `grants`. Each principal
  gets `SELECT`, and `MODIFY` for `write` unless `notApplied` lists `write`
  (a materialised view). The grants of one principal on one table are joined:
  one statement per principal, `SELECT` before `MODIFY`, the principals in
  the order first granted.
- Exact grants, for a table whose `access.exact` is true, whose grants are
  applied, and whose `notApplied` does not list `exact`. With exact grants,
  the definitions package gives a table that grants no role an `access` with
  no grants, so its direct grants are taken away too.

**The after-refresh task.** When any table has a grant or exact grants, the
task holds `ACCESS`, a list with, for each such table in the model's order,
`table`, its three-part name quoted as SQL names it; `name`, its three-part
name as text; `grants`, a list of `{ principal, privileges }`; and `exact`.
It also holds `KEEP`, the Platform's `databricks.governance.unmasked`. After
the tags and column comments, and before the table checks, the task runs for
each table in turn:

1. `GRANT <privileges> ON TABLE <table> TO <principal>`, for each grant;
2. with `exact`, `SHOW GRANTS ON TABLE <table>`, then each statement that
   `revokes` gives for its rows.

Revokes follow grants, so a principal the table keeps is never left without
access between the two. The values that differ between environments
(section 3.3) are replaced in `table`, `name`, each principal and `KEEP`
before anything is quoted or compared.

**Quoting.** A principal is always written in backticks, with each backtick
in it doubled: ``team`s analysts`` is ``` `team``s analysts` ```. The task
quotes each principal itself, at run time; no principal is put into SQL any
other way.

**Revokes.** `revokes(rows, item, keep)` is a function of the task that reads
nothing else: given the rows of `SHOW GRANTS ON TABLE` for one `ACCESS` item,
and the principals to keep, it returns the `REVOKE` statements, in the rows'
order, each once. The task passes `KEEP` and its own identity
(`current_user()`), which is the run_as identity that owns the tables. A row
is revoked only when all of these hold:

- it is on the table itself: its `objectKey`, without backticks, is the
  item's `name`, in any letter case. A row on the schema, catalog or
  metastore, which the table inherits, is kept;
- its `actionType` is a privilege name, of letters, spaces and `_` only, and
  is not ownership (`OWN`, `OWNERSHIP`) or a denial (any action that starts
  with `DEN`, such as `DENY SELECT` or `DENIED_SELECT`);
- its principal is not one to keep;
- its principal is not named by the item's grants, or is named and the grant
  does not give that privilege.

Principals compare in any letter case, so a principal written in another case
is never revoked as a stranger. The statement is
`REVOKE <privilege> ON TABLE <table> FROM <principal>`, with the privilege in
upper case and `_` written as a space, and the principal as the row gives
it, quoted. `ALL PRIVILEGES` held by a named principal is revoked, then the
principal's grant is made again: `SHOW GRANTS` shows `ALL PRIVILEGES` alone,
not the privileges it implies.

**Managed schemas.** With `manage.grants` and `manage.schemas` on, each
managed schema's grants in `resources/schemas.yml` also give `USE_SCHEMA` to
each principal granted on a table in that schema: added to the platform's
grant for that principal, when it has one without `USE_SCHEMA`, else as a
grant of its own after the platform's. The principals come in the order they
are first granted.

**`prerequisites/<environment>.sql`** is unchanged by grants: the run_as
identity owns the tables its pipelines create, so it may grant and revoke on
them. The grants capability is not listed there.

**Tags.** A column's classification is set as the tag whose key is the
standard's `governance.classification.tag` (the definitions package's
`classificationTag`, default `classification`). When the column has a
classification, a tag of its own with that key is left out, so the key is
set once, to the classification.

**Tag keys.** With `manage.tags`, the pack refuses a tag key, and a
classification tag key, that Unity Catalog does not allow: one with
`. , - = / : * < > % & ? \`, a control character, a space at either end, or
more than 256 characters. This joins the rules of the tags page and the
governed tags page (references.md), so a key passes both. `:` is also
Ingestron's separator: `key:value` sets the key to the value.

**Request.** `ingestron request` adds, under "Must exist before deploying":

- each principal of an applied grant: it must exist, and needs `USE CATALOG`
  on each catalog of its tables, and `USE SCHEMA` on each of their schemas
  unless the bundle manages the schemas;
- with `manage.masks` or `manage.filters` on and a classified column, the
  governed tag: an account administrator creates it with the standard's
  classification values (or the classifications the contracts use, when the
  standard lists none), and the run_as identity needs `ASSIGN` on it. Masks
  and filters are policies that match governed tags; plain tags, which
  `manage.tags` alone sets, need no administrator, so a project without masks
  or filters asks for nothing new.

With exact grants on any table, a section "Exact grants" says what the task
removes and keeps, and lists the tables, each as Markdown code (in double
backticks when the name has a backtick).

### 8.7 Masks and row filters

The model gives each table's masks, each a column, its classification and its
mask (`null`, `hash`, `redact` or a function), and its row filters, each a
name, a column and a function (definitions specification, section 8.2). The
definitions package judges them against the pack's coverage and the
platform's `manage.masks` and `manage.filters`, records in the table's
`notApplied` what is not applied, and reports `MASK_NEEDS_RUN_AS`,
`MASK_FUNCTIONS`, `POLICY_LIMIT` and `POLICY_PRINCIPALS`. The pack builds
only what is applied, and never judges it again:

- With `manage.masks` and `manage.filters` both off, nothing below is built,
  and the files are what they were before masks existed.
- A mask, with `manage.masks` on, unless the table's `notApplied` has
  `masks` for its column.
- A row filter, with `manage.filters` on, unless the table's `notApplied`
  has `filters`.

Unity Catalog applies masks and filters as attribute-based policies that match
columns by their governed tags. The after-refresh task makes them, so they
are plain SQL that runs as the run_as identity after each refresh.

**Functions.** A one-part function name, of a mask or a filter, is in the
Platform's `databricks.governance.functions`: `region_filter` with
`functions: main.governance` is `main.governance.region_filter`. A three-part
name is used as written. So one standard serves environments whose catalogs
differ. The built-in masks are functions the task creates in
`governance.functions`, only those a table applies, in the order first applied:

| Mask     | Function                | Returns                                         |
| -------- | ----------------------- | ----------------------------------------------- |
| `null`   | `ingestron_mask_null`   | `NULL`, for a column of any type                |
| `hash`   | `ingestron_mask_hash`   | the SHA-256 of a text, as 64 hexadecimal digits |
| `redact` | `ingestron_mask_redact` | `****` in place of a text                       |

Each is `CREATE OR REPLACE FUNCTION <name>(val VARIANT) RETURNS VARIANT
DETERMINISTIC RETURN <expression>`, the documented pattern for one mask over
columns of several types (references.md): Databricks casts the column's value
to `VARIANT` and the result back to the column's type. `hash` and `redact` work
on text: the definitions package refuses them for a column whose
`logicalType` is not `string` (`MASK_TYPE`), and for a value that is not text,
such as on a column whose type the contract does not give, they return
`NULL`, which casts to any type, rather than a text that would fail the cast:

- `null`: `NULL::VARIANT`;
- `hash`: `CASE WHEN schema_of_variant(val) = 'STRING' THEN sha2(try_cast(val AS STRING), 256)::VARIANT ELSE NULL::VARIANT END`;
- `redact`: `CASE WHEN schema_of_variant(val) = 'STRING' THEN '****'::VARIANT ELSE NULL::VARIANT END`.

**Policies.** Where the policies go depends on who owns the schemas:

- with `manage.schemas` on, the bundle creates the project's schemas, so the
  policies are `ON SCHEMA <catalog>.<schema>`, once for each schema;
- otherwise the schemas may be shared, so the policies are
  `ON TABLE <catalog>.<schema>.<table>`, on the project's own tables only.

On each schema or table, in the order of the model's tables:

- one policy for each masked classification, in the order its tables' masks
  give them: `ingestron_mask_<classification>`, `COLUMN MASK <function>`,
  matching `has_tag_value('<tag>', '<classification>')`, where `<tag>` is the
  standard's `governance.classification.tag`, the key the task sets the
  classification as;
- then one policy for each filter, in the order its tables' filters give
  them: `ingestron_filter_<name>`, `ROW FILTER <function>`, matching
  `has_tag_value('<tag>', '<classification>')` for a `{ classification }`
  match, `has_tag('<key>')` for `{ tag }`, and
  `has_tag_value('<key>', '<value>')` for `{ tag, value }`.

Each is:

```sql
CREATE OR REPLACE POLICY `ingestron_mask_confidential` ON SCHEMA `main`.`bronze`
  COLUMN MASK `main`.`governance`.`ingestron_mask_hash`
  TO `account users` EXCEPT `<run_as>`, `data-stewards`
  FOR TABLES MATCH COLUMNS has_tag_value('classification', 'confidential') AS c ON COLUMN c
```

with `USING COLUMNS (c)` in place of `ON COLUMN c` for a row filter, all on
one line. A policy applies to every account user except the principals in
`EXCEPT`: first the identity the task runs as, which is the run_as identity
that refreshes the pipelines, then the Platform's `databricks.governance.unmasked`,
each once in any letter case. So `EXCEPT` always names run_as, even when
`unmasked` is empty: a pipeline that read masked or filtered values would keep
them in the tables it writes for good (references.md). The task asks for its
identity with `current_user()` when it runs, as for exact grants (section
8.6): run_as is set per target and is not a variable, so a run_as that differs
between environments is exempt in each.

Policy names, the schema or table, function names and principals are quoted
as identifiers: in backticks, each backtick doubled. A function's name is
quoted after the values that differ between environments are replaced
(section 3.3), each of its dot-separated parts on its own. Tag keys and values
are SQL strings.

**Stale policies.** After the policies, the task drops the policies it made
before and makes no more. It lists the policies with `SHOW POLICIES ON
<securable>`, which lists only those attached to it directly, on each of the
project's own places: each schema of its tables when the policies are on
schemas, and each of its tables in either case, so policies left on the
tables from before the schemas were managed go too. A table that ends at the
landed files has no place. A policy is dropped, with `DROP POLICY <name> ON
<securable>`, only when all of these hold:

- its name (the row's `policy_name`) starts with `ingestron_mask_` and
  `manage.masks` is on, or with `ingestron_filter_` and `manage.filters` is
  on, in any letter case;
- it is not one of the policies the task made on that place.

Every other policy is kept: another team's, and the task's own of a switch
that is off. `stale_drops(rows, place, owned)` is a function of the task that
reads nothing else, so it is tested over synthetic rows.

**The after-refresh task.** With `manage.masks` or `manage.filters` on, the
task holds `GOVERNANCE`: `functions`, each `{ name, returns }`; `policies`,
each `{ name, on, kind, function, match }`; `places`, each `{ on, policies }`
with the names of the policies made there; `owned`, the name prefixes of the
switches that are on; and `unmasked`. The task runs, in this order: the tags
and column comments; the mask functions; the grants and exact revokes
(section 8.6); the policies; the drops of stale policies; and the table checks.
Tags come before policies, which match them, and functions before the
policies that use them. The file's header comment says what the task does
beyond tags, comments and checks: two lines for grants, and two for masks and
filters, each only when the task does it.

**`prerequisites/<environment>.sql`**, with `manage.masks` or
`manage.filters` on, gives the run_as identity once:

- `USE CATALOG` on the catalog of `governance.functions` and of each of the
  team's functions in another schema;
- `USE SCHEMA, CREATE FUNCTION` on `governance.functions`, where the task
  creates the built-in masks;
- `USE SCHEMA` on each other schema of the team's functions, and `EXECUTE` on
  each of the team's functions that an applied mask or filter names: a policy
  needs `EXECUTE` on its function;
- with policies on schemas, `MANAGE` on each of the project's schemas, which
  making and dropping a policy there needs. The bundle creates those schemas,
  so these lines are run after the first deployment, unless run_as deploys and
  so owns them already.

The policies on tables need nothing more: run_as owns the tables its
pipelines create. Run_as is quoted as one identifier.

**Request.** `ingestron request` adds, under "Must exist before deploying",
when any mask or filter is applied:

- the schema of `governance.functions`, when the task creates a built-in
  mask there;
- each of the team's functions that an applied mask or filter names;
- that everyone who reads the tables uses serverless compute or Databricks
  Runtime 16.4 or later, since older runtimes cannot read a table with a
  policy;
- the governed tag, as in section 8.6.
