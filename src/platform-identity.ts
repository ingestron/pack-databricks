// The Platform's databricks fields that name people: who the pipelines and jobs run as, and
// who may use them. Each has a `find`, where a team finds the value in the workspace.
import type { JsonSchema } from "@ingestron/definitions";

/** `databricks.run_as`: the identity the pipelines and jobs run as. */
export const runAs: JsonSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1,
  properties: {
    service_principal_name: {
      type: "string",
      description: "Application id of the service principal the pipelines and jobs run as.",
      find: "Settings, then Identity and access, then Manage next to Service principals: the service principal's application ID.",
      suggest: "<application id>",
      examples: ["7f3c2a10-0000-4000-8000-000000000001"],
    },
    user_name: {
      type: "string",
      description: "The user the pipelines and jobs run as.",
      find: "Settings, then Identity and access, then Manage next to Users: the user's email address.",
      suggest: "<user>@<domain>",
      examples: ["ingest@example.com"],
    },
  },
  description: "The identity the pipelines and jobs run as.",
};

/** `databricks.permissions`: who can view, run or manage the bundle's resources. */
export const permissions: JsonSchema = {
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
        find: "Your choice for each group or person; the bundle permissions page lists the levels CAN_VIEW, CAN_RUN and CAN_MANAGE.",
        examples: ["CAN_VIEW"],
      },
      group_name: {
        type: "string",
        description: "A group, or use user_name or service_principal_name instead.",
        find: "Settings, then Identity and access, then Manage next to Groups: the group's name.",
        suggest: "<group name>",
        examples: ["data-engineers"],
      },
      user_name: {
        type: "string",
        description: "A user, or use group_name or service_principal_name instead.",
        find: "Settings, then Identity and access, then Manage next to Users: the user's email address.",
        suggest: "<user>@<domain>",
        examples: ["ana@example.com"],
      },
      service_principal_name: {
        type: "string",
        description:
          "A service principal's application id, or use group_name or user_name instead.",
        find: "Settings, then Identity and access, then Manage next to Service principals: the service principal's application ID.",
        suggest: "<application id>",
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
};
