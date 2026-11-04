// The names of the bundle variables for values that differ between targets,
// derived from where the value is in the resolved model, so that they are
// stable from one generation to the next (spec/behaviour.md, section 3).
import type { ResolvedModel } from "@ingestron/definitions";

/** A variable's name and description, before it is made unique. */
export interface Place {
  name: string;
  description: string;
}

/** The segments of a JSON Pointer. */
export function segments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Lower case, with `_` for anything that is not a letter, digit or `_`; list positions left out. */
export function variableName(...parts: string[]): string {
  return parts
    .filter((part) => !/^\d+$/.test(part))
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * The variable for the value at `pointer` in the first target's model. `pipeline` is
 * true when the value is, in every target, the catalog of the pipeline that builds
 * the tables.
 */
export function placeOf(pointer: string, model: ResolvedModel, pipeline: boolean): Place {
  const [area, index, ...rest] = segments(pointer);
  if (area === "tables") return tablePlace(model, Number(index), rest, pipeline);
  const path = [index ?? "", ...rest].filter(Boolean);
  const setting = path.filter((part) => !/^\d+$/.test(part)).join(".");
  if (area === "platform")
    return { name: variableName(...path), description: `Platform setting ${setting}.` };
  return {
    name: variableName(area ?? "", ...path),
    description: `The value at ${pointer} of the resolved definitions.`,
  };
}

function tablePlace(model: ResolvedModel, index: number, rest: string[], pipeline: boolean): Place {
  const table = model.tables[index]!;
  const [part, key, ...more] = rest;
  if (part === "fullName") return namePlace(model, table.layer, table.name, key!, pipeline);
  if (part === "ingest" && key === "connection" && more[0] === "settings") {
    const id = table.ingest!.connection.id;
    const setting = more.slice(1);
    const description =
      setting.join(".") === "path"
        ? `Folder the files of connection "${id}" are read from.`
        : `Setting ${setting.join(".")} of connection "${id}".`;
    return { name: variableName(id, ...setting), description };
  }
  if (key === "settings" && (more[0] === "landing" || more[0] === "published") && more.length === 1)
    return { name: more[0], description: folderOf(more[0], part!) };
  const path = [part, key, ...more].filter((item): item is string => Boolean(item));
  return {
    name: variableName(table.name, ...path.filter((item) => item !== "settings")),
    description: `The value of ${path.join(".")} for table ${table.name}.`,
  };
}

function folderOf(setting: string, step: string): string {
  return setting === "landing"
    ? `Folder the landed files are read from (${step} setting landing).`
    : `Folder the tables are published to (${step} setting published).`;
}

function namePlace(
  model: ResolvedModel,
  layer: string,
  table: string,
  key: string,
  pipeline: boolean,
): Place {
  if (key === "catalog" && pipeline)
    return { name: "catalog", description: `Catalog of the ${model.project.id} tables.` };
  if (key === "catalog")
    return {
      name: `catalog_${variableName(layer)}`,
      description: `Catalog of the ${layer} tables.`,
    };
  if (key === "schema")
    return { name: `schema_${variableName(layer)}`, description: `Schema of the ${layer} tables.` };
  return { name: variableName("table", table), description: `Name of the ${table} table.` };
}
