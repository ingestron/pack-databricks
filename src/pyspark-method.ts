// The pyspark method: the transform's own Python, called with a DataFrame per input.
import type { Method } from "@ingestron/definitions";

/** A PySpark transform: the code defines a function that gets a DataFrame per input. */
export const pyspark: Method = {
  action: "transform",
  description:
    "Calls a function in the transform's Python code with a dict of input DataFrames; it returns one DataFrame.",
  accepts: ["table"],
  produces: "query",
  defaults: { function: "transform" },
  settings: {
    type: "object",
    additionalProperties: false,
    properties: {
      function: {
        type: "string",
        pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
        description: "The function to call. Default: transform.",
        examples: ["build_daily_sales"],
      },
    },
  },
  check: (table) => {
    const code = table.transform?.code ?? "";
    const name = String(table.transform?.settings.function);
    const defined = new RegExp(`^def ${name}\\(`, "m").test(code);
    return [
      ...(defined ? [] : [`the code has no function "def ${name}(tables)"`]),
      ...unknownInputs(code, Object.keys(table.transform?.inputs ?? {})),
    ];
  },
};

/**
 * Each `tables["x"]` in the code whose `x` is not an input: the function gets
 * a dict with one DataFrame per input, so reading another key fails.
 */
function unknownInputs(code: string, inputs: string[]): string[] {
  const lines = code.split("\n").map((line) => line.replace(/#.*/, ""));
  const read = [...lines.join("\n").matchAll(/\btables\[\s*["']([^"']+)["']\s*\]/g)].map(
    (match) => match[1]!,
  );
  return [...new Set(read)]
    .filter((key) => !inputs.includes(key))
    .map(
      (key) =>
        `the code reads tables["${key}"], which is not an input; the inputs are ${inputs.map((input) => `"${input}"`).join(", ") || "none"}`,
    );
}
