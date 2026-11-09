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

| Path                                 | What it is                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `databricks.yml`                     | The bundle: name, `include`, `sync`, `variables` and one target per environment   |
| `resources/<pipeline>.pipeline.yml`  | The pipeline that builds the tables, when any table has a store step              |
| `resources/<gateway>.pipeline.yml`   | A Lakeflow Connect ingestion gateway, one per database connection                 |
| `resources/<ingestion>.pipeline.yml` | A Lakeflow Connect ingestion pipeline, one per managed connection                 |
| `resources/<job>.job.yml`            | The refresh job, when there is a schedule or an after-refresh task                |
| `resources/schemas.yml`              | Managed schemas, with `manage.schemas`                                            |
| `src/<pipeline>/<layer>/<table>.sql` | A table's SQL (`.py` for a PySpark transform)                                     |
| `tasks/<pipeline>/apply_contract.py` | The after-refresh task: tags, column comments and table checks, when any is on    |
| `prerequisites/<environment>.sql`    | Grants an administrator runs once in that environment, when a capability needs it |

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
and audit and rescued columns in a table's SQL (section 2).

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
- **Grants** are in `prerequisites/<environment>.sql`.
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
- **Event log.** With quality results (the model's `qualityResults`), the
  pipeline that builds the tables and each Lakeflow Connect ingestion pipeline
  have `event_log: { catalog, schema, name: <pipeline>_event_log }`, in the
  pipeline's own catalog and schema. A gateway has none.
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
  `notifications.on_failure` and `alerts`; `grants`, as the grants of a managed schema; and the
  four `manage` settings (`schemas`, `tags`, `comments`, `checks`). Definitions
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
  (section 2).
- **In a PySpark transform's file** (`src/<pipeline>/**/*.py`), a variable
  inside a double-quoted text the pack writes, such as the table's `name` or an
  input's name, is read with `spark.conf.get("ingestron.<name>")`:
  - before the table's function (the decorators, evaluated when the file
    loads), each value is read once into a module-level constant
    `ingestron_<name>`, under the comment
    `# Values that differ between environments, from the pipeline's configuration.`
    above the first decorator, and the text becomes an f-string, with braces in
    the rest of the text doubled: `"⟦schema_silver⟧.totals"` becomes
    `f"{ingestron_schema_silver}.totals"`;
  - inside the function, which builds the transform's inputs, the read stays in
    the body, joined to the rest of the text:
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
  differ by environment, and the retail project under a kit's standard
  (`standards`: audit and rescued columns, the event log, retries, a timeout,
  queueing, and failure and slow alerts, with dev, test and prod).

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
| `operations.retries`                    | The pipeline task's `max_retries` and `min_retry_interval_millis`           | used      |
| `operations.timeout`                    | The job's `timeout_seconds`                                                 | used      |
| `operations.concurrency`                | The job's `max_concurrent_runs` and `queue`                                 | used      |
| `operations.alerts: failure`            | The job's `email_notifications` and `webhook_notifications`; pipeline email | used      |
| `operations.alerts: slow`               | The job's `health` rule and duration warning notifications (Public Preview) | used      |
| `operations.trigger`                    | File arrival, table update and continuous triggers                          | not yet   |

Every `used` feature is generally available on the page the pack checked on
2026-11-09 (references.md), except the run duration threshold behind
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
- `not-yet` with the reason "Planned.", for every other path and value: the
  table above is the target, not what the pack builds today.

A method declares only what differs from the pack:

- `materialised-view`: `history: latest` and `history: full` are
  `not-applicable` ("A materialised view is recomputed on each update; keep
  history with a streaming table."); `history: none` is used; every `audit`
  value and `rescued` are `not-yet` ("Planned: audit columns and rescued data
  are added by streaming tables over files.");
- `lakeflow-connect`: `load.mode: files` is `not-applicable` ("Managed
  ingestion reads the source, not files."); `history: none`, `latest` and `full`
  are used, as the connector's append mode and `scd_type`; `rescued` is
  `not-applicable` ("Managed ingestion has no rescued data column."), as are
  `audit: loaded_at`, `source_file` and `source_modified_at` ("Managed
  ingestion writes the table; it adds no metadata columns."); and
  `storage.clustering` is `not-yet` ("Planned.").

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
the SQL warehouse that runs the bundle's SQL tasks. The section allows no other
field. A project that still writes a moved field at the top gets
`PLATFORM_FIELD_MOVED` (a warning), and the output is the same. The pack reads
each field from either place; `databricks.warehouse_id` is listed with the
other Platform settings the pack reads.
