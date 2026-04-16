/**
 * Minimal .env loader. Reads ./.env from process.cwd().
 * Shell env takes precedence — file is fallback.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(): void {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
  }
}
