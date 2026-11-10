// The Platform's databricks fields for access: the switch that grants the contracts' roles,
// and the governance settings that masks and exact grants read. Each has a `find`, where a
// team finds the value.
import type { JsonSchema } from "@ingestron/definitions";

/** `databricks.manage.grants`: grant each table's roles after each refresh. */
export const manageGrants: JsonSchema = {
  type: "boolean",
  description:
    "Grant each table's access to the principals its contract's roles and its layer name, after each refresh: SELECT to read, and MODIFY too to write. Default: false.",
  find: "Ask your Unity Catalog administrator: the run_as identity owns the tables the pipelines create, so it may grant on them; each principal also needs USE CATALOG and USE SCHEMA, which ingestron request lists.",
  examples: [true],
};

/** `databricks.governance`: where mask functions live, and who sees real values. */
export const governance: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    functions: {
      type: "string",
      pattern: "^[^.\\s]+\\.[^.\\s]+$",
      description:
        "The schema, as catalog.schema, that holds the mask functions Ingestron creates, and the team's functions named with one part.",
      find: "Ask your Unity Catalog administrator for a schema the run_as identity may create functions in; Catalog Explorer lists the schemas.",
      suggest: "<catalog>.<schema>",
      examples: ["main.governance"],
    },
    unmasked: {
      type: "array",
      items: { type: "string" },
      description:
        "Principals, as the platform names them, that see real values in masked columns besides run_as. Exact grants never revoke their privileges.",
      find: "Settings, then Identity and access, then Manage next to Groups: the name of the group that looks after the data.",
      examples: [["data-stewards"]],
    },
  },
  description: "Where mask functions are, and who sees real values.",
};
