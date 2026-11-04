// Values that differ in a PySpark transform's file: Python reads the pipeline's
// configuration with spark.conf.get, so each marker inside a text the pack
// writes becomes a call joined to the rest of that text (spec/behaviour.md, 3.3).

/** A double-quoted Python text on one line, as the pack writes them with JSON. */
const quoted = /"(?:[^"\\\n]|\\.)*"/g;
/** A marker, with the variable's name. */
const marker = /⟦([^⟦⟧]+)⟧/;

/** The configuration key a variable is read under. */
export function configurationKey(name: string): string {
  return `ingestron.${name}`;
}

/**
 * The file with each marker inside a double-quoted text read with spark.conf.get:
 * `"⟦schema_silver⟧.totals"` becomes `spark.conf.get("ingestron.schema_silver") + ".totals"`.
 * Undefined when a marker is anywhere else, which no Python expression can stand for.
 */
export function pythonValues(text: string): string | undefined {
  const replaced = text.replace(quoted, (found) => (marker.test(found) ? joined(found) : found));
  return marker.test(replaced) ? undefined : replaced;
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
 * The file as the pipeline runs it: each spark.conf.get of an `ingestron.*` key as its
 * value, joined into the texts around it as the pack would have written them.
 */
export function pythonWithValues(text: string, values: Record<string, string>): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes('spark.conf.get("ingestron.')) return line;
      const read = line.replace(/spark\.conf\.get\("([^"]+)"\)/g, (found, key: string) =>
        values[key] === undefined ? found : JSON.stringify(values[key]),
      );
      let merged = read;
      for (let previous = ""; previous !== merged;) {
        previous = merged;
        merged = merged.replace(/"((?:[^"\\]|\\.)*)" \+ "((?:[^"\\]|\\.)*)"/, '"$1$2"');
      }
      return merged;
    })
    .join("\n");
}
