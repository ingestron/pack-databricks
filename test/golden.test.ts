// The retail-shaped project folded for dev and prod, and for dev, test and prod,
// against the files in test/golden. UPDATE_GOLDEN=1 writes them again.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fold, foldFailures, folderFiles, resolveAll, retail } from "./fold-helpers.js";

const threeEnvironments = [
  "id: retail",
  "name: Retail sales",
  "values:",
  "  host: https://adb-1111111111111111.1.azuredatabricks.net",
  "  storage: abfss://landing@retaildev.dfs.core.windows.net",
  "environments:",
  "  dev: {}",
  "  test:",
  "    values:",
  "      host: https://adb-2222222222222222.2.azuredatabricks.net",
  "  prod:",
  "    values:",
  "      host: https://adb-2222222222222222.2.azuredatabricks.net",
  "      storage: abfss://landing@retailprod.dfs.core.windows.net",
  "imports:",
  "  - standard.yaml",
  "  - platform.yaml",
  "  - connections/*.yaml",
  "  - flows/*.yaml",
  "  - transforms/*.yaml",
  "  - contracts/*.yaml",
  "",
].join("\n");

const cases = {
  retail: { files: retail, environments: ["dev", "prod"] },
  "retail-three": {
    files: { ...retail, "project.yaml": threeEnvironments },
    environments: ["dev", "test", "prod"],
  },
};

describe("golden bundles", () => {
  for (const [name, { files, environments }] of Object.entries(cases)) {
    it(`folds ${name} (${environments.join(", ")}) into the files in test/golden/${name}`, () => {
      const models = resolveAll(files, environments);
      const folded = fold(models);
      expect(folded.problems).toEqual([]);
      expect(foldFailures(models)).toEqual([]);
      const folder = join(import.meta.dirname, "golden", name);
      if (process.env.UPDATE_GOLDEN === "1") write(folder, folded.files);
      expect(existsSync(folder)).toBe(true);
      expect(folded.files).toEqual(folderFiles(folder));
    });
  }
});

function write(folder: string, files: Record<string, string>): void {
  rmSync(folder, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}
