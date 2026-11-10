// The sql module: what the rest of the package uses.
export { accessItems, keptPrincipals, tableGrants, exactOn } from "./access.js";
export type { AccessItem, TableGrant } from "./access.js";
export { applyContract, tagParts } from "./apply-contract.js";
export {
  appliedFilters,
  appliedMasks,
  functionsSchema,
  governanceOf,
  maskFunctionsUsed,
  policiesApplied,
  projectSchemas,
  teamFunctions,
} from "./governance.js";
export type { Governance } from "./governance.js";
export { quoteName, renderQuery } from "./query.js";
export { renderApply, renderSql, sqlFile } from "./sql.js";
