// The sources this pack reads, described for the documentation site.
import type { Connector } from "@ingestron/definitions";

const lakeflow = "https://docs.databricks.com/aws/en/ingestion/lakeflow-connect";

/** One entry per connector an ingest method reads. */
export const connectors: Connector[] = [
  {
    id: "files",
    category: "Files and storage",
    title: "Files",
    method: "files",
    object: "a folder under the connection's path",
    settings: [
      { name: "path", description: "Where the files land, such as /Volumes/main/landing/shop." },
    ],
    generates: "a streaming table that reads new files with Auto Loader",
    docs: "https://docs.databricks.com/sql/language-manual/functions/read_files.html",
  },
  {
    id: "sqlserver",
    category: "Databases and analytics",
    title: "SQL Server",
    method: "lakeflow-connect",
    object: "database.schema.table",
    settings: [
      { name: "uc_connection", description: "The Unity Catalog connection to the source." },
    ],
    generates: "an ingestion gateway and an ingestion pipeline (Lakeflow Connect)",
    maturity: { status: "Public Preview", checked: "2026-10-25" },
    docs: `${lakeflow}/sql-server-pipeline`,
  },
  {
    id: "salesforce",
    category: "Business applications",
    title: "Salesforce",
    method: "lakeflow-connect",
    object: "the object name, such as Account",
    settings: [
      { name: "uc_connection", description: "The Unity Catalog connection to the source." },
    ],
    generates: "an ingestion pipeline (Lakeflow Connect)",
    maturity: { status: "Public Preview", checked: "2026-10-25" },
    docs: `${lakeflow}/salesforce-pipeline`,
  },
  {
    id: "kafka",
    category: "Streaming",
    title: "Kafka",
    method: "lakeflow-connect",
    object: "the topic",
    settings: [
      { name: "uc_connection", description: "The Unity Catalog connection to the source." },
    ],
    generates: "an ingestion pipeline on the PREVIEW channel (Lakeflow Connect)",
    maturity: { status: "Beta", checked: "2026-10-25" },
    docs: `${lakeflow}/kafka-pipeline`,
  },
];
