import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProgram, isCliEntrypoint } from "../src/cli.js";

describe("public CLI", () => {
  it("exposes only the simplified command surface", () => {
    const commands = createProgram().commands.map((c) => c.name()).sort();
    expect(commands).toEqual([
      "add",
      "always",
      "build",
      "catalog",
      "check",
      "connect",
      "desktop",
      "disconnect",
      "doctor",
      "edit",
      "init",
      "list",
      "remove",
      "rename",
      "show",
      "status",
    ]);
  });

});

describe("CLI entrypoint detection", () => {
  it("returns true for direct file execution", () => {
    const root = mkdtempSync(join(tmpdir(), "skillset-cli-entry-"));
    try {
      const cliPath = join(root, "cli.js");
      writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf8");

      expect(isCliEntrypoint(pathToFileURL(cliPath).href, cliPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns true when argv points at an npm-style bin symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "skillset-cli-entry-"));
    try {
      const cliPath = join(root, "dist", "cli.js");
      const binPath = join(root, ".bin", "skillset-cli");
      mkdirSync(join(root, "dist"), { recursive: true });
      mkdirSync(join(root, ".bin"), { recursive: true });
      writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf8");
      symlinkSync(cliPath, binPath);

      expect(isCliEntrypoint(pathToFileURL(cliPath).href, binPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false when imported as a normal module", () => {
    const root = mkdtempSync(join(tmpdir(), "skillset-cli-entry-"));
    try {
      const cliPath = join(root, "cli.js");
      const otherPath = join(root, "other.js");
      writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf8");
      writeFileSync(otherPath, "", "utf8");

      expect(isCliEntrypoint(pathToFileURL(cliPath).href, otherPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
