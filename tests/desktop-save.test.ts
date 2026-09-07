import { describe, expect, it } from "vitest";
import { parseDesktopSave } from "../src/commands/desktop.js";

describe("desktop save payload", () => {
  it("keeps only the fields the app sent", () => {
    expect(parseDesktopSave('{"name":"a","body":"# A"}')).toEqual({
      name: "a",
      rename: undefined,
      description: undefined,
      body: "# A",
    });
  });

  it("rejects a payload without a name or with a non-string field", () => {
    expect(() => parseDesktopSave('{"body":"x"}')).toThrow("missing name");
    expect(() => parseDesktopSave('{"name":"a","rename":3}')).toThrow("rename must be a string");
    expect(() => parseDesktopSave("[]")).toThrow();
  });
});
