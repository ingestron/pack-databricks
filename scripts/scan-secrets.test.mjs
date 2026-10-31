import assert from "node:assert/strict";
import test from "node:test";

import { detectSecrets } from "./scan-secrets.mjs";

test("allows documented secret placeholders", () => {
  assert.deepEqual(
    detectSecrets("SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key"),
    [],
  );
});

test("detects representative committed credentials", () => {
  assert.deepEqual(detectSecrets(["token=ghp_", "abcdefghijklmnopqrstuvwxyz123456"].join("")), [
    "GitHub token",
  ]);
  assert.deepEqual(detectSecrets(["-----BEGIN ", "PRIVATE KEY-----"].join("")), ["private key"]);
  assert.deepEqual(detectSecrets(["github_pat_", "A".repeat(82)].join("")), [
    "GitHub fine-grained token",
  ]);
});
