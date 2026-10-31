// The repository holds only what its purpose needs. A new top-level file or
// folder is a deliberate change to this list.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const allowed = [
  ".github",
  ".gitignore",
  ".prettierignore",
  ".prettierrc",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "api",
  "api-extractor.json",
  "eslint.config.js",
  "package.json",
  "pnpm-lock.yaml",
  "scripts",
  "src",
  "templates",
  "test",
  "tsconfig.build.json",
  "tsconfig.json",
  "vitest.config.ts",
];

test("every tracked top-level entry is on the list", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
  });
  const entries = [
    ...new Set(
      files
        .split("\0")
        .filter(Boolean)
        .map((path) => path.split("/")[0]),
    ),
  ];
  assert.deepEqual(
    entries.filter((entry) => !allowed.includes(entry)),
    [],
  );
});
