import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  [
    "Supabase service-role JWT",
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  ],
];

export function detectSecrets(text) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export async function scanTrackedFiles() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const failures = [];

  for (const file of files) {
    let text;
    try {
      if ((await stat(file)).size > 1024 * 1024) continue;
      text = await readFile(file, "utf8");
      if (text.includes("\0")) continue;
    } catch {
      continue;
    }
    for (const label of detectSecrets(text)) {
      failures.push(`possible ${label} in tracked file: ${file}`);
    }
  }

  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = await scanTrackedFiles();
  if (failures.length) {
    console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
    process.exit(1);
  }
  console.log("No recognised secrets found in tracked files.");
}
