import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
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
    const { io } = pair("");
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

  it("all returns everything, none returns empty", async () => {
    const { io: io1 } = pair("all");
    expect(
      await checkbox("pick", [{ label: "a", value: "a" }, { label: "b", value: "b" }], io1)
    ).toEqual(["a", "b"]);
    const { io: io2 } = pair("none");
    expect(
      await checkbox("pick", [{ label: "a", value: "a" }, { label: "b", value: "b", checked: true }], io2)
    ).toEqual([]);
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
