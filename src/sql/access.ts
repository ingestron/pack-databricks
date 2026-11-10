// Who may use each table, as the after-refresh task grants it (spec section 8.6). The
// definitions package has judged each table's access and recorded what is not applied;
// this reads that judgement and the platform's switch, and never judges again.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { quoteName } from "./query.js";

/** One principal's privileges on a table, as SQL names them. */
export interface TableGrant {
  principal: string;
  privileges: ("SELECT" | "MODIFY")[];
}

/** One table's access, as the after-refresh task's `ACCESS` holds it. */
export interface AccessItem {
  /** The table's three-part name, quoted. */
  table: string;
  /** The table's three-part name as text, which `SHOW GRANTS` gives as `objectKey`. */
  name: string;
  grants: TableGrant[];
  /** True when the task revokes the direct grants that `grants` does not give. */
  exact: boolean;
}

const notApplied = (table: ResolvedTable, feature: string) =>
  (table.notApplied ?? []).some((item) => item.feature === feature);

/**
 * The grants the task makes on the table: one per principal, in the order first granted,
 * `SELECT` and, for write unless not applied there, `MODIFY`. Empty with `manage.grants`
 * off, without access, or when the table's grants are not applied.
 */
export function tableGrants(model: ResolvedModel, table: ResolvedTable): TableGrant[] {
  if (!model.platform.manage.grants || !table.access || notApplied(table, "grants")) return [];
  const write = !notApplied(table, "write");
  const joined = new Map<string, Set<"SELECT" | "MODIFY">>();
  for (const grant of table.access.grants) {
    const privileges = joined.get(grant.principal) ?? new Set();
    privileges.add("SELECT");
    if (write && grant.privileges.includes("write")) privileges.add("MODIFY");
    joined.set(grant.principal, privileges);
  }
  return [...joined].map(([principal, privileges]) => ({
    principal,
    privileges: (["SELECT", "MODIFY"] as const).filter((item) => privileges.has(item)),
  }));
}

/** True when the task revokes the table's direct grants that its access does not give. */
export function exactOn(model: ResolvedModel, table: ResolvedTable): boolean {
  if (!model.platform.manage.grants || !table.access?.exact) return false;
  return !notApplied(table, "grants") && !notApplied(table, "exact");
}

/** The task's `ACCESS`: each table with a grant or exact grants, in the model's order. */
export function accessItems(model: ResolvedModel): AccessItem[] {
  return model.tables.flatMap((table) => {
    const grants = tableGrants(model, table);
    const exact = exactOn(model, table);
    if (grants.length === 0 && !exact) return [];
    const { catalog, schema, table: name } = table.fullName;
    const full = `${catalog}.${schema}.${name}`;
    return [{ table: quoteName(full), name: full, grants, exact }];
  });
}

/** The principals exact grants never revoke, besides the task's own identity. */
export function keptPrincipals(model: ResolvedModel): string[] {
  const governance = model.platform.sections.databricks?.governance as
    { unmasked?: unknown } | undefined;
  const unmasked = governance?.unmasked;
  return Array.isArray(unmasked) ? unmasked.map(String) : [];
}
