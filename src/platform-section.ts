// The Databricks section of the Platform: the fields that belong to this pack. Each moved
// field has the schema it had at the top of the Platform, so the editor reads the same, with
// `find` and `suggest` added: where a team finds each value, and what it looks like.
import type { JsonSchema } from "@ingestron/definitions";
import { governance, manageGrants } from "./platform-access.js";
import { permissions, runAs } from "./platform-identity.js";

/** The Platform's `databricks:` section (spec section 8.4). */
export const platformSection: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      enum: ["development", "production"],
      description:
        "Default: development in an environment named dev, and production in every other, test and default included. A tool that resolves one environment at a time, without generating them together as the CLI does, gives production only to prod and production.",
      enumDescriptions: [
        "A copy for development: names carry the deploying user and schedules are paused.",
        "The shared resources, as they run in production.",
      ],
      find: "Your choice: development to try changes, production for work that is checked; the bundle deployment modes page explains both.",
      examples: ["production"],
    },
    workspace: {
      type: "object",
      additionalProperties: false,
      properties: {
        host: {
          type: "string",
          description: "Workspace URL. Leave out to use the deploying user's profile.",
          find: "The address bar when you are signed in to the workspace; on Azure, also the workspace's URL field in the Azure portal.",
          suggest: "https://<workspace instance name>",
          examples: ["https://adb-1111111111111111.1.azuredatabricks.net"],
        },
        root_path: {
          type: "string",
          description: "Folder in the workspace for deployed files.",
          find: "Your choice of workspace folder; without it, a bundle deploys to .bundle/<bundle>/<target> in the deploying user's own workspace folder.",
          suggest: "/Workspace/Shared/.bundle/<project>",
          examples: ["/Workspace/Shared/.bundle/sales"],
        },
      },
      description: "The Databricks workspace host and root path.",
    },
    run_as: runAs,
    compute: {
      type: "object",
      additionalProperties: false,
      properties: {
        serverless: {
          type: "boolean",
          description: "Default: true.",
          find: "Serverless pipelines need Unity Catalog, a region with serverless compute and the serverless terms accepted; new pipelines use serverless by default.",
          examples: [true],
        },
        budget_policy_id: {
          type: "string",
          description: "Serverless budget policy that pipelines are charged to.",
          find: "Settings, then Compute, then Manage next to Serverless usage policies: the policies you may use.",
          suggest: "<usage policy id>",
          examples: ["5b1e3f2a-0000-4000-8000-000000000002"],
        },
        channel: {
          enum: ["CURRENT", "PREVIEW"],
          description: "Lakeflow pipeline channel: CURRENT or PREVIEW.",
          enumDescriptions: [
            "The current Lakeflow runtime, for production.",
            "The next runtime, to try upcoming changes; some connectors need it.",
          ],
          find: "Your choice: new pipelines use CURRENT; PREVIEW tests the pipeline against runtime changes before they are released.",
          examples: ["CURRENT"],
        },
      },
      description: "Serverless or classic compute, budget policy and channel.",
    },
    permissions,
    manage: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemas: {
          type: "boolean",
          description:
            "Create the schemas (with grants) in the bundle. Default: false, because schemas are often shared infrastructure.",
          find: "Catalog Explorer (Catalog in the sidebar) shows whether the layers' schemas already exist; creating them needs USE CATALOG and CREATE SCHEMA on the catalog.",
          examples: [true],
        },
        tags: {
          type: "boolean",
          description:
            "Apply the contracts' tags and classification to tables and columns as Unity Catalog tags, after each refresh. Default: false.",
          find: "Ask your Unity Catalog administrator: tagging a table needs its ownership, or APPLY TAG with USE SCHEMA and USE CATALOG, and ASSIGN on each governed tag.",
          examples: [true],
        },
        comments: {
          type: "boolean",
          description:
            "Apply the contracts' column descriptions as column comments, after each refresh. Default: false.",
          find: "Ask your Unity Catalog administrator: a comment on a table's column needs MODIFY on the table.",
          examples: [true],
        },
        checks: {
          type: "boolean",
          description:
            "Run the contracts' rules that compare counts over all rows, such as row counts and duplicates, after each refresh. Default: false.",
          find: "Ask your Unity Catalog administrator: the checks read each table, which needs SELECT on it for the run_as identity.",
          examples: [true],
        },
        grants: manageGrants,
      },
      description:
        "Shared resources and metadata this bundle manages. Each needs privileges on the platform.",
    },
    governance,
    grants: {
      type: "object",
      description: "Grants per layer, used when `manage.schemas` is true.",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["principal", "privileges"],
          properties: {
            principal: {
              type: "string",
              description: "The user, group or service principal given the privileges.",
              find: "Catalog Explorer, then the schema's Permissions tab: a user's email address, a group's name or a service principal's application ID.",
              suggest: "<group name>",
              examples: ["data-engineers"],
            },
            privileges: {
              type: "array",
              items: {
                type: "string",
              },
              description: "Unity Catalog privileges, such as USE_SCHEMA, SELECT and MODIFY.",
              find: "The Unity Catalog privileges reference lists them; a bundle writes each with underscores, such as USE_SCHEMA.",
              examples: [["USE_SCHEMA", "SELECT"]],
            },
          },
        },
      },
      examples: [
        {
          bronze: [
            {
              principal: "data-engineers",
              privileges: ["USE_SCHEMA", "SELECT"],
            },
          ],
        },
      ],
    },

    warehouse_id: {
      type: "string",
      description: "SQL warehouse that runs the bundle's SQL tasks.",
      find: "SQL Warehouses: the warehouse, then Connection details; the ID is in its HTTP path.",
      suggest: "<warehouse id>",
    },
  },
};
