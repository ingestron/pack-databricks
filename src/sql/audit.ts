// The audit and rescued columns that a streaming table reading files with `read_files`
// adds (spec/behaviour.md, section 2). Other audit values are added by the step that
// lands the files, so they are among the columns read.
import type { AuditValue, ResolvedTable } from "@ingestron/definitions";

/** What each audit value the pack's own reading of files adds is selected as. */
const fileAudit: Partial<Record<AuditValue, string>> = {
  loaded_at: "current_timestamp()",
  source_file: "_metadata.file_path",
  source_modified_at: "_metadata.file_modification_time",
};

/**
 * `<expression> AS <name>` for each audit column the table's intent asks for that reading
 * files adds, in the order given. Definitions has checked that each name is a plain one.
 */
export function auditColumns(table: ResolvedTable): string[] {
  return (table.intent.audit ?? []).flatMap(({ value, as }) => {
    const expression = fileAudit[value];
    return expression ? [`${expression} AS ${as}`] : [];
  });
}

/**
 * The column that keeps data that does not fit, when the table's intent keeps it and the
 * method's own `read_files` options do not already name one, so it is not given twice.
 */
export function rescuedColumn(
  table: ResolvedTable,
  options: Record<string, unknown>,
): string | undefined {
  const named = Object.keys(options).some((key) => key.toLowerCase() === "rescueddatacolumn");
  if (table.intent.rescued !== true || named) return undefined;
  return "_rescued_data";
}
