// The one-table project the pack tests change: a files connection, a flow and a contract.

export const base: Record<string, string> = {
  "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [databricks@2]\n",
  "files.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: files\nconnector: files\nconnectivity: public\nsettings: { path: /Volumes/dev/landing/shop/ }\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: files\ntables:\n  orders: { object: /orders, contract: orders }\n",
  "orders.yaml": [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: orders",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: orders",
    "    logicalType: object",
    "    description: It's every order.",
    "    properties:",
    "      - { name: id, logicalType: integer, required: true, primaryKey: true }",
    "      - { name: updated_at, logicalType: timestamp }",
    "",
  ].join("\n"),
};
