// Values that differ in a PySpark transform's file: Python reads the pipeline's
// configuration with spark.conf.get (spec/behaviour.md, 3.3). Decorator arguments
// are evaluated when the file is loaded, so each value they need is read once
// into a module-level constant and put in an f-string, as Databricks' "Create
// tables in a for loop" example builds `name=`. Reads for the transform's
// inputs stay inside the bodies of the functions the pack writes.

/** A double-quoted Python text on one line, as the pack writes them with JSON. */
const quoted = /"(?:[^"\\\n]|\\.)*"/g;
/** A marker, with the variable's name. */
const marker = /⟦([^⟦⟧]+)⟧/;
/** A function the pack writes: its body runs when the pipeline reads the table. */
const wrapper = /^def ingestron_/;
/** The comment above the module-level constants. */
const header = "# Values that differ between environments, from the pipeline's configuration.";

/** The configuration key a variable is read under. */
export function configurationKey(name: string): string {
  return `ingestron.${name}`;
}

/** The module-level constant a variable is read into. */
function constantOf(name: string): string {
  return `ingestron_${name}`;
}

/**
 * The file with each marker inside a double-quoted text read from the configuration:
 * outside the bodies of the functions the pack writes, `"⟦schema_silver⟧.totals"` becomes
 * `f"{ingestron_schema_silver}.totals"` with
 * `ingestron_schema_silver = spark.conf.get("ingestron.schema_silver")` above the
 * decorators; inside a body, `spark.conf.get("ingestron.schema_bronze") + ".orders"`.
 * Undefined when a marker is anywhere else, which no Python expression can stand for.
 */
export function pythonValues(text: string): string | undefined {
  const names: string[] = [];
  let inBody = false;
  const folded = text
    .split("\n")
    .map((line) => {
      if (wrapper.test(line)) inBody = true;
      else if (/^\S/.test(line)) inBody = false;
      const inside = inBody && !wrapper.test(line);
      return line.replace(quoted, (found) =>
        !marker.test(found) ? found : inside ? joined(found) : formatted(found, names),
      );
    })
    .join("\n");
  if (marker.test(folded)) return undefined;
  if (names.length === 0) return folded;
  const reads = [...new Set(names)].map(
    (name) => `${constantOf(name)} = spark.conf.get("${configurationKey(name)}")`,
  );
  return folded.replace(/^@dp\./m, `${[header, ...reads].join("\n")}\n\n\n@dp.`);
}

/** A text as an f-string, each marker as its constant, braces in the text doubled. */
function formatted(found: string, names: string[]): string {
  const parts = found.slice(1, -1).split(new RegExp(marker.source));
  const inner = parts.map((part, index) => {
    if (index % 2 === 0) return part.replaceAll("{", "{{").replaceAll("}", "}}");
    names.push(part);
    return `{${constantOf(part)}}`;
  });
  return `f"${inner.join("")}"`;
}

function joined(found: string): string {
  const parts = found.slice(1, -1).split(new RegExp(marker.source));
  return parts
    .map((part, index) =>
      index % 2 === 1 ? `spark.conf.get("${configurationKey(part)}")` : part && `"${part}"`,
    )
    .filter(Boolean)
    .join(" + ");
}

/**
 * The file as the pipeline runs it, as the pack would have written it with the values:
 * the module-level reads removed and each f-string that uses them a plain text, then
 * each spark.conf.get of an `ingestron.*` key in the body joined into the texts around it.
 */
export function pythonWithValues(text: string, values: Record<string, string>): string {
  const constants: Record<string, string> = {};
  const block = new RegExp(
    `^${header.replace(/[.()]/g, "\\$&")}\\n((?:\\w+ = spark\\.conf\\.get\\("[^"]+"\\)\\n)+)\\n\\n`,
    "m",
  );
  const unread = text.replace(block, (found, lines: string) => {
    for (const [, constant, key] of lines.matchAll(/^(\w+) = spark\.conf\.get\("([^"]+)"\)$/gm))
      if (values[key!] !== undefined) constants[constant!] = values[key!]!;
    return lines.trim().split("\n").length === Object.keys(constants).length ? "" : found;
  });
  const plain = unread.replace(/f"((?:[^"\\\n]|\\.)*)"/g, (found, inner: string) =>
    Object.keys(constants).some((name) => inner.includes(`{${name}}`))
      ? `"${unformatted(inner, constants)}"`
      : found,
  );
  return plain
    .split("\n")
    .map((line) => withReads(line, values))
    .join("\n");
}

function unformatted(inner: string, constants: Record<string, string>): string {
  return inner.replace(/\{\{|\}\}|\{(\w+)\}/g, (found, name?: string) => {
    if (found === "{{") return "{";
    if (found === "}}") return "}";
    const value = name === undefined ? undefined : constants[name];
    return value === undefined ? found : JSON.stringify(value).slice(1, -1);
  });
}

/** A body line's spark.conf.get reads as their values, joined into the texts beside them. */
function withReads(line: string, values: Record<string, string>): string {
  if (!line.includes('spark.conf.get("ingestron.')) return line;
  let merged = line.replace(/spark\.conf\.get\("([^"]+)"\)/g, (found, key: string) =>
    values[key] === undefined ? found : JSON.stringify(values[key]),
  );
  for (let previous = ""; previous !== merged;) {
    previous = merged;
    merged = merged.replace(/"((?:[^"\\]|\\.)*)" \+ "((?:[^"\\]|\\.)*)"/, '"$1$2"');
  }
  return merged;
}
