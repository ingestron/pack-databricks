// The masked project: the governed project with masks and row filters, on managed schemas,
// with a functions schema that differs between environments.
import { join } from "node:path";
import { folderFiles } from "./fold-helpers.js";

export const masked = folderFiles(join(import.meta.dirname, "fixtures/masked"));

/** The masked project with a file's text changed. */
export function maskedWith(path: string, change: (text: string) => string): Record<string, string> {
  return { ...masked, [path]: change(masked[path]!) };
}

/** The masked project without managed schemas, so its policies are on its tables. */
export const maskedTables = maskedWith("platform.yaml", (text) =>
  text.replace("schemas: true, ", ""),
);

/** The task's GOVERNANCE, read back from its JSON. */
export function governanceOf(text: string | undefined): Governance | undefined {
  const found = /^GOVERNANCE = json\.loads\(r"""([\s\S]*?)"""\)$/m.exec(text ?? "");
  return found ? (JSON.parse(found[1]!) as Governance) : undefined;
}

/** The after-refresh task's masks and filters, as its JSON holds them. */
export interface Governance {
  functions: { name: string; returns: string }[];
  policies: { name: string; on: string; kind: string; function: string; match: string }[];
  places: { on: string; policies: string[] }[];
  owned: string[];
  unmasked: string[];
}
