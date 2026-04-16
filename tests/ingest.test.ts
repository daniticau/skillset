import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractFolderIncremental,
  normalizeFolderCursor,
  FOLDER_CURSOR_VERSION,
} from "../src/ingest/index.js";
import { discoverClaudeCodeHistory } from "../src/ingest/discovery.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skillset-ingest-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("extractFolderIncremental", () => {
  it("extracts allowed text files and skips binaries and junk", () => {
    writeFileSync(join(tmp, "keep.md"), "# Hello\n");
    writeFileSync(join(tmp, "keep.jsonl"), '{"role":"user","content":"hi"}\n');
    writeFileSync(join(tmp, "skip.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfile: true\n");
    mkdirSync(join(tmp, "node_modules"));
    writeFileSync(join(tmp, "node_modules", "pkg.js"), "module.exports = 1;\n");

    const result = extractFolderIncremental(tmp);
    const paths = result.files.map((f) => f.path).sort();

    expect(paths).toContain("keep.md");
    expect(paths).toContain("keep.jsonl");
    expect(paths).not.toContain("skip.png");
    expect(paths).not.toContain("pnpm-lock.yaml");
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("includes .jsonl — the key delta from upstream nia-cli", () => {
    const convosDir = join(tmp, "project-a");
    mkdirSync(convosDir);
    writeFileSync(
      join(convosDir, "session.jsonl"),
      `{"type":"user","text":"hi"}\n{"type":"assistant","text":"hello"}\n`
    );

    const result = extractFolderIncremental(tmp);
    const jsonl = result.files.find((f) => f.path.endsWith("session.jsonl"));

    expect(jsonl).toBeDefined();
    expect(jsonl?.content).toContain('"role":"assistant"'.replace("role", "type"));
    expect(jsonl?.metadata?.extension).toBe(".jsonl");
  });

  it("returns a cursor that skips already-seen files on re-run", () => {
    writeFileSync(join(tmp, "a.md"), "alpha\n");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(tmp, "a.md"), past, past);

    const first = extractFolderIncremental(tmp);
    expect(first.files).toHaveLength(1);

    const second = extractFolderIncremental(tmp, first.cursor as Record<string, unknown>);
    expect(second.files).toHaveLength(0);
  });

  it("skips files with security-flagged names", () => {
    writeFileSync(join(tmp, "id_rsa.txt"), "fake key\n");
    writeFileSync(join(tmp, "my_private_key.md"), "fake key\n");
    writeFileSync(join(tmp, "safe.md"), "ok\n");

    const result = extractFolderIncremental(tmp);
    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual(["safe.md"]);
  });
});

describe("normalizeFolderCursor", () => {
  it("returns empty cursor when version mismatches", () => {
    const result = normalizeFolderCursor(tmp, { cursor_version: 99, root_path: tmp });
    expect(result.resetReason).toBe("version_mismatch");
    expect(result.cursor).toEqual({});
  });

  it("returns empty cursor when root_path changed", () => {
    const other = join(tmp, "other");
    mkdirSync(other);
    const result = normalizeFolderCursor(tmp, {
      cursor_version: FOLDER_CURSOR_VERSION,
      root_path: other,
    });
    expect(result.resetReason).toBe("root_path_changed");
  });

  it("accepts a valid cursor", () => {
    const result = normalizeFolderCursor(tmp, {
      cursor_version: FOLDER_CURSOR_VERSION,
      root_path: tmp,
      last_mtime: 123,
      last_path: "foo",
    });
    expect(result.resetReason).toBeUndefined();
    expect(result.cursor.last_mtime).toBe(123);
  });
});

describe("discoverClaudeCodeHistory", () => {
  it("returns null when the path doesn't exist", () => {
    const saved = process.env.USERPROFILE;
    const savedHome = process.env.HOME;
    const empty = mkdtempSync(join(tmpdir(), "skillset-home-"));
    process.env.USERPROFILE = empty;
    process.env.HOME = empty;
    try {
      expect(discoverClaudeCodeHistory()).toBe(null);
    } finally {
      if (saved !== undefined) process.env.USERPROFILE = saved;
      else delete process.env.USERPROFILE;
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("returns the path when ~/.claude/projects exists", () => {
    const saved = process.env.USERPROFILE;
    const savedHome = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), "skillset-home-"));
    mkdirSync(join(fakeHome, ".claude", "projects"), { recursive: true });
    process.env.USERPROFILE = fakeHome;
    process.env.HOME = fakeHome;
    try {
      const result = discoverClaudeCodeHistory();
      expect(result).toBe(join(fakeHome, ".claude", "projects"));
    } finally {
      if (saved !== undefined) process.env.USERPROFILE = saved;
      else delete process.env.USERPROFILE;
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
