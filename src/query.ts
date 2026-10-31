// Renders a transform's SQL: `{{ tables.<input> }}` becomes the input's full name.
import { Liquid } from "liquidjs";

// Strict, so an input that the transform did not declare is an error.
const engine = new Liquid({ strictVariables: true, strictFilters: true });

/** The SQL with inputs replaced, or a problem to report. A trailing `;` is removed. */
export function renderQuery(
  code: string,
  inputs: Record<string, string>,
): { sql: string } | { problem: string } {
  const quoted = Object.fromEntries(
    Object.entries(inputs).map(([name, full]) => [name, quoteName(full)]),
  );
  try {
    const sql = engine.parseAndRenderSync(code, { tables: quoted }) as string;
    return { sql: sql.trim().replace(/;\s*$/, "") };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
    return {
      problem: `the SQL cannot be rendered (${reason}); inputs are written {{ tables.<name> }} and must be listed in inputs`,
    };
  }
}

/** `a.b.c` → `` `a`.`b`.`c` ``, so any valid name is safe in SQL. */
export function quoteName(fullName: string): string {
  return fullName
    .split(".")
    .map((part) => `\`${part.replaceAll("`", "``")}\``)
    .join(".");
}
