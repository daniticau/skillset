#!/usr/bin/env node
// Write a shell shim that runs this checkout's dist/cli.js.
//
// Default target is ~/.local/bin/sks; pass a path to write elsewhere. If the
// repo moves the shim fails with a clear message; run `pnpm cli:link` again.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repo, "dist", "cli.js");

// Pin the node the user's login shell resolves, not whichever one ran this
// script. Under `pnpm run` that is pnpm's own bundled node, which may vanish.
function userNode() {
  try {
    const shell = process.env.SHELL || "/bin/sh";
    const found = execFileSync(shell, ["-lc", "command -v node"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (found) return found;
  } catch {
    // fall through
  }
  return process.execPath;
}
const node = userNode();
const target = process.argv[2] ?? join(homedir(), ".local", "bin", "sks");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  [
    "#!/bin/sh",
    `if [ ! -f "${cli}" ]; then`,
    `  echo "sks: ${cli} is missing. Did the skillset checkout move? Run \`pnpm cli:link\` from the repo." >&2`,
    "  exit 1",
    "fi",
    `exec "${node}" "${cli}" "$@"`,
    "",
  ].join("\n")
);
chmodSync(target, 0o755);
console.log(`linked ${target} -> ${cli}`);
