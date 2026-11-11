// The methods module: what the rest of the package uses.
export { capabilities, prerequisites, tagProblems } from "./capabilities.js";
export { gatewayConnectors, lakeflowConnect } from "./connect-method.js";
export { connectors } from "./connectors.js";
export { contract } from "./contract.js";
export { maskNameProblems } from "./governance-needs.js";
export { files, materialisedView, sql, streamingTable } from "./methods.js";
export { intent } from "./intent.js";
export { pyspark } from "./pyspark-method.js";
export { request } from "./request.js";
