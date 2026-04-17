/**
 * Tiny readline-backed prompt helpers. Kept minimal on purpose — init's
 * interactive flow only needs yes/no, multi-select, and a single text input.
 *
 * Designed to be easy to mock in tests: each helper reads from a readline
 * Interface or a provided iterator/string source. No TTY raw-mode tricks.
 */

import { createInterface } from "node:readline/promises";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export interface PromptIO {
  input: Readable;
  output: Writable;
}

function defaultIO(): PromptIO {
  return { input: process.stdin, output: process.stdout };
}

function makeRl(io: PromptIO): ReadlineInterface {
  return createInterface({ input: io.input, output: io.output, terminal: false });
}

export async function confirm(
  message: string,
  defaultValue = true,
  io: PromptIO = defaultIO()
): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const rl = makeRl(io);
  try {
    const answer = (await rl.question(`${message} ${suffix} `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer.startsWith("y");
  } finally {
    rl.close();
  }
}

export interface CheckboxItem<T = string> {
  label: string;
  value: T;
  checked?: boolean;
}

/**
 * Present a numbered list and accept a comma-separated selection (1,3,4) or
 * "all" / "none". Pre-checked items are the default when the user hits enter.
 */
export async function checkbox<T = string>(
  message: string,
  items: CheckboxItem<T>[],
  io: PromptIO = defaultIO()
): Promise<T[]> {
  if (items.length === 0) return [];
  const rl = makeRl(io);
  try {
    io.output.write(`${message}\n`);
    items.forEach((it, idx) => {
      const mark = it.checked ? "[x]" : "[ ]";
      io.output.write(`  ${idx + 1}. ${mark} ${it.label}\n`);
    });
    const defaults = items
      .map((it, idx) => (it.checked ? String(idx + 1) : null))
      .filter((x): x is string => !!x)
      .join(",");
    const raw = (
      await rl.question(
        `  selection (comma-separated, "all", "none", or enter for defaults${
          defaults ? ` [${defaults}]` : ""
        }): `
      )
    )
      .trim()
      .toLowerCase();
    if (!raw) {
      return items.filter((it) => it.checked).map((it) => it.value);
    }
    if (raw === "all") return items.map((it) => it.value);
    if (raw === "none") return [];
    const picks = new Set(
      raw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= items.length)
    );
    return items.filter((_, idx) => picks.has(idx + 1)).map((it) => it.value);
  } finally {
    rl.close();
  }
}

export async function textInput(
  message: string,
  defaultValue?: string,
  io: PromptIO = defaultIO()
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const rl = makeRl(io);
  try {
    const ans = (await rl.question(`${message}${suffix}: `)).trim();
    return ans || defaultValue || "";
  } finally {
    rl.close();
  }
}
