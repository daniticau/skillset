/**
 * Tiny readline-backed prompt helpers. Kept minimal on purpose — init's
 * interactive flow only needs yes/no, multi-select, and a single text input.
 *
 * Designed to be easy to mock in tests: each helper reads from a readline
 * Interface or a provided iterator/string source. No TTY raw-mode tricks.
 */

import { emitKeypressEvents } from "node:readline";
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

type TtyReadable = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
  resume?: () => void;
  pause?: () => void;
};

type TtyWritable = Writable & {
  isTTY?: boolean;
};

function supportsInteractiveChecklist(io: PromptIO): io is {
  input: TtyReadable;
  output: TtyWritable;
} {
  return (
    (io.input as TtyReadable).isTTY === true &&
    (io.output as TtyWritable).isTTY === true &&
    typeof (io.input as TtyReadable).setRawMode === "function"
  );
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
 * Present a numbered list and accept a comma-separated selection (1,3,4).
 * Pre-checked items are the default when the user hits enter.
 */
export async function checkbox<T = string>(
  message: string,
  items: CheckboxItem<T>[],
  io: PromptIO = defaultIO()
): Promise<T[]> {
  if (items.length === 0) return [];
  if (supportsInteractiveChecklist(io)) {
    return interactiveCheckbox(message, items, io);
  }

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
        `  selection (comma-separated, or enter for defaults${
          defaults ? ` [${defaults}]` : ""
        }): `
      )
    )
      .trim()
      .toLowerCase();
    if (!raw) {
      return items.filter((it) => it.checked).map((it) => it.value);
    }
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

async function interactiveCheckbox<T>(
  message: string,
  items: CheckboxItem<T>[],
  io: { input: TtyReadable; output: TtyWritable }
): Promise<T[]> {
  const checked = new Set(
    items
      .map((it, idx) => (it.checked ? idx : null))
      .filter((idx): idx is number => idx !== null)
  );
  let cursor = 0;
  let renderedLines = 0;
  const doneCursor = items.length;

  const render = () => {
    if (renderedLines > 0) io.output.write(`\x1b[${renderedLines}F`);
    const lines = [
      `${message}`,
      ...items.map((it, idx) => {
        const pointer = idx === cursor ? "❯" : " ";
        const mark = checked.has(idx) ? "◉" : "○";
        return `  ${pointer} ${mark} ${it.label}`;
      }),
      `  ${cursor === doneCursor ? "❯" : " "} Done`,
    ];
    for (const line of lines) {
      io.output.write(`\x1b[2K${line}\n`);
    }
    renderedLines = lines.length;
  };

  return new Promise<T[]>((resolve, reject) => {
    const wasRaw = io.input.isRaw === true;

    const cleanup = () => {
      io.input.off("keypress", onKeypress);
      io.input.setRawMode?.(wasRaw);
      io.input.pause?.();
      io.output.write("\n");
    };

    const finish = () => {
      cleanup();
      resolve(items.filter((_, idx) => checked.has(idx)).map((it) => it.value));
    };

    const onKeypress = (str?: string, key?: { name?: string; ctrl?: boolean; sequence?: string }) => {
      const char = typeof str === "string" ? str.toLowerCase() : "";

      if ((key?.ctrl && key.name === "c") || key?.sequence === "\u0003" || char === "\u0003") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }
      if (key?.name === "up") {
        cursor = (cursor - 1 + items.length + 1) % (items.length + 1);
        render();
        return;
      }
      if (key?.name === "down") {
        cursor = (cursor + 1) % (items.length + 1);
        render();
        return;
      }
      if (key?.name === "space") {
        if (cursor === doneCursor) return;
        if (checked.has(cursor)) checked.delete(cursor);
        else checked.add(cursor);
        render();
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        if (cursor === doneCursor) {
          finish();
          return;
        }
        if (checked.has(cursor)) checked.delete(cursor);
        else checked.add(cursor);
        render();
        return;
      }
    };

    emitKeypressEvents(io.input);
    io.input.on("keypress", onKeypress);
    io.input.setRawMode?.(true);
    io.input.resume?.();
    render();
  });
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
