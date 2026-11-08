// Data folders the pack ships beside dist/. This file stays at the top of src/:
// compiled, it sits in dist/, and in a bundle every file is the bundle, which
// has the same folders copied beside it, so "../templates/" holds for both.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The SQL and Python templates shipped in ../templates. */
export const templatesFolder: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "../templates/",
);
