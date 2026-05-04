import { describe, it, expect, vi } from "vitest";
import { PassThrough, Readable, Writable } from "node:stream";
import { confirm, checkbox, textInput } from "../src/core/ux/prompt.js";

function pair(userInput: string) {
  const lines = userInput.endsWith("\n") ? userInput : userInput + "\n";
  const input = Readable.from([lines]);
  let captured = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  return { io: { input, output }, getCaptured: () => captured };
}

function ttyPair() {
  const input = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  input.isTTY = true;
  input.isRaw = false;
  let inputPaused = true;
  input.setRawMode = vi.fn((mode: boolean) => {
    input.isRaw = mode;
  });
  input.isPaused = vi.fn(() => inputPaused);
  input.resume = vi.fn(() => {
    inputPaused = false;
    return input;
  });
  input.pause = vi.fn(() => {
    inputPaused = true;
    return input;
  });

  let captured = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  }) as Writable & { isTTY?: boolean };
  output.isTTY = true;

  return { io: { input, output }, getCaptured: () => captured };
}

describe("confirm", () => {
  it("returns true on 'y'", async () => {
    const { io } = pair("y");
    expect(await confirm("go?", true, io)).toBe(true);
  });

  it("returns false on 'n'", async () => {
    const { io } = pair("n");
    expect(await confirm("go?", true, io)).toBe(false);
  });

  it("uses default on empty input", async () => {
    const { io } = pair("");
    expect(await confirm("go?", true, io)).toBe(true);
    const { io: io2 } = pair("");
    expect(await confirm("go?", false, io2)).toBe(false);
  });
});

describe("checkbox", () => {
  it("returns defaults when user hits enter", async () => {
    const { io, getCaptured } = pair("");
    const result = await checkbox(
      "pick",
      [
        { label: "a", value: "a", checked: true },
        { label: "b", value: "b", checked: false },
        { label: "c", value: "c", checked: true },
      ],
      io
    );
    expect(result).toEqual(["a", "c"]);
    expect(getCaptured()).not.toContain("all");
    expect(getCaptured()).not.toContain("none");
  });

  it("parses comma-separated selection", async () => {
    const { io } = pair("1,3");
    const result = await checkbox(
      "pick",
      [
        { label: "a", value: "a" },
        { label: "b", value: "b" },
        { label: "c", value: "c" },
      ],
      io
    );
    expect(result).toEqual(["a", "c"]);
  });

  it("ignores out-of-range numbers", async () => {
    const { io } = pair("1,5,abc,2");
    const result = await checkbox(
      "pick",
      [{ label: "a", value: "a" }, { label: "b", value: "b" }],
      io
    );
    expect(result).toEqual(["a", "b"]);
  });

  it("toggles with enter and finishes on Done in interactive mode", async () => {
    const { io, getCaptured } = ttyPair();
    expect(io.input.isPaused()).toBe(true);
    const resultPromise = checkbox(
      "pick",
      [
        { label: "a", value: "a" },
        { label: "b", value: "b", checked: true },
      ],
      io
    );

    io.input.emit("keypress", undefined, { name: "escape" });
    io.input.emit("keypress", "\r", { name: "return" });
    io.input.emit("keypress", undefined, { name: "down" });
    io.input.emit("keypress", undefined, { name: "down" });
    io.input.emit("keypress", "\r", { name: "return" });

    await expect(resultPromise).resolves.toEqual(["a", "b"]);
    expect(getCaptured()).not.toContain("Use ↑/↓");
    expect(getCaptured()).not.toContain("a: all");
    expect(getCaptured()).toContain("Done");
    expect(io.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(io.input.isPaused()).toBe(true);
  });
});

describe("textInput", () => {
  it("returns the user's input", async () => {
    const { io } = pair("hello world");
    expect(await textInput("name", undefined, io)).toBe("hello world");
  });

  it("falls back to default on empty input", async () => {
    const { io } = pair("");
    expect(await textInput("name", "anon", io)).toBe("anon");
  });
});
