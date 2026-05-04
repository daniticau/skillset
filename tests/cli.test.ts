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
      "connect",
      "disconnect",
      "doctor",
      "dream",
      "edit",
      "init",
      "list",
      "remove",
      "status",
      "tailor",
      "usage",
    ]);
  });

  it("exposes usage options and subcommands", () => {
    const program = createProgram();
    const dream = program.commands.find((c) => c.name() === "dream");
    const status = program.commands.find((c) => c.name() === "status");
    const usage = program.commands.find((c) => c.name() === "usage");

    expect(status?.options.map((o) => o.long)).toContain("--usage");
    expect(dream?.options.map((o) => o.long).sort()).toEqual([
      "--at",
      "--force",
      "--off",
      "--run-now",
      "--scheduled",
      "--status",
    ]);
    expect(usage?.commands.map((c) => c.name()).sort()).toEqual(["record", "scan"]);
    expect(
      usage?.commands
        .find((c) => c.name() === "scan")
        ?.options.map((o) => o.long)
        .sort()
    ).toEqual(["--force", "--full-scrape", "--project", "--scrape"]);
    expect(
      usage?.commands
        .find((c) => c.name() === "record")
        ?.options.map((o) => o.long)
        .sort()
    ).toEqual(["--agent", "--at", "--evidence", "--project"]);
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
