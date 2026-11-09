// The Databricks section of the Platform: the fields that belong to this pack. Each moved
// field has the schema it had at the top of the Platform, so the editor reads the same.
import type { JsonSchema } from "@ingestron/definitions";

/** The Platform's `databricks:` section (spec section 8.3). */
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
    },
    workspace: {
      type: "object",
      additionalProperties: false,
      properties: {
        host: {
          type: "string",
          description: "Workspace URL. Leave out to use the deploying user's profile.",
          examples: ["https://adb-1111111111111111.1.azuredatabricks.net"],
        },
        root_path: {
          type: "string",
          description: "Folder in the workspace for deployed files.",
          examples: ["/Workspace/Shared/.bundle/sales"],
        },
      },
      description: "The Databricks workspace host and root path.",
    },
    run_as: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 1,
      properties: {
        service_principal_name: {
          type: "string",
          description: "Application id of the service principal the pipelines and jobs run as.",
          examples: ["7f3c2a10-0000-4000-8000-000000000001"],
        },
        user_name: {
          type: "string",
          description: "The user the pipelines and jobs run as.",
          examples: ["ingest@example.com"],
        },
      },
      description: "The identity the pipelines and jobs run as.",
    },
    compute: {
      type: "object",
      additionalProperties: false,
      properties: {
        serverless: {
          type: "boolean",
          description: "Default: true.",
        },
        budget_policy_id: {
          type: "string",
          description: "Serverless budget policy that pipelines are charged to.",
          examples: ["5b1e3f2a-0000-4000-8000-000000000002"],
        },
        channel: {
          enum: ["CURRENT", "PREVIEW"],
          description: "Lakeflow pipeline channel: CURRENT or PREVIEW.",
          enumDescriptions: [
            "The current Lakeflow runtime, for production.",
            "The next runtime, to try upcoming changes; some connectors need it.",
          ],
        },
      },
      description: "Serverless or classic compute, budget policy and channel.",
    },
    permissions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level"],
        minProperties: 2,
        maxProperties: 2,
        properties: {
          level: {
            enum: ["CAN_VIEW", "CAN_RUN", "CAN_MANAGE"],
            description: "CAN_VIEW, CAN_RUN or CAN_MANAGE.",
            enumDescriptions: [
              "See the pipelines and jobs and their runs.",
              "Also start and stop runs.",
              "Also change and delete them, and their permissions.",
            ],
          },
          group_name: {
            type: "string",
            description: "A group, or use user_name or service_principal_name instead.",
            examples: ["data-engineers"],
          },
          user_name: {
            type: "string",
            description: "A user, or use group_name or service_principal_name instead.",
            examples: ["ana@example.com"],
          },
          service_principal_name: {
            type: "string",
            description:
              "A service principal's application id, or use group_name or user_name instead.",
            examples: ["7f3c2a10-0000-4000-8000-000000000001"],
          },
        },
      },
      description: "Who can view, run or manage the bundle's resources.",
      examples: [
        [
          {
            group_name: "data-engineers",
            level: "CAN_MANAGE",
          },
          {
            group_name: "analysts",
            level: "CAN_VIEW",
          },
        ],
      ],
    },
    manage: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemas: {
          type: "boolean",
          description:
            "Create the schemas (with grants) in the bundle. Default: false, because schemas are often shared infrastructure.",
        },
        tags: {
          type: "boolean",
          description:
            "Apply the contracts' tags and classification to tables and columns as Unity Catalog tags, after each refresh. Default: false.",
        },
        comments: {
          type: "boolean",
          description:
            "Apply the contracts' column descriptions as column comments, after each refresh. Default: false.",
        },
        checks: {
          type: "boolean",
          description:
            "Run the contracts' rules that compare counts over all rows, such as row counts and duplicates, after each refresh. Default: false.",
        },
      },
      description:
        "Shared resources and metadata this bundle manages. Each needs privileges on the platform.",
    },
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
              examples: ["data-engineers"],
            },
            privileges: {
              type: "array",
              items: {
                type: "string",
              },
              description: "Unity Catalog privileges, such as USE_SCHEMA, SELECT and MODIFY.",
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
