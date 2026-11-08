// The templates folder is found from the compiled file's own location, so it
// must name the folder the pack ships, wherever the source files live.
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { templatesFolder } from "../src/folders.js";

describe("templatesFolder", () => {
  it("names an existing folder with the SQL templates", () => {
    expect(existsSync(templatesFolder)).toBe(true);
    expect(readdirSync(templatesFolder)).toContain("table.liquid");
  });
});
