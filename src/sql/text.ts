// SQL text that every file of the sql module writes.

/** A SQL string literal. */
export function sqlString(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
