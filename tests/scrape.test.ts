import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrapeClaudeCode } from "../src/ingest/sessions/claudeCode.js";
import { scrapeCodex } from "../src/ingest/sessions/codex.js";
import { writeSessionJsonl } from "../src/ingest/sessions/writer.js";

let tmp: string;
let outDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skillset-scrape-"));
  outDir = join(tmp, "out");
  mkdirSync(outDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function readJsonlLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("writeSessionJsonl", () => {
  it("writes envelope-wrapped records atomically", async () => {
    const res = await writeSessionJsonl(
      outDir,
      "claude-code",
      "session-1",
      "proj__session-1",
      [{ a: 1 }, { a: 2 }],
      "2026-04-15T00:00:00.000Z"
    );
    const lines = readJsonlLines(res.path);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      source: "claude-code",
      sessionId: "session-1",
      scrapedAt: "2026-04-15T00:00:00.000Z",
      raw: { a: 1 },
    });
  });

  it("sanitizes filenames", async () => {
    const res = await writeSessionJsonl(
      outDir, "codex", "s1", "weird/../name with spaces", [{}], "2026-04-15T00:00:00.000Z"
    );
    expect(res.path).not.toContain("..");
    expect(res.path).not.toContain(" ");
  });
});

describe("scrapeClaudeCode", () => {
  it("wraps each line of each .jsonl in an envelope, one file per session", async () => {
    const root = join(tmp, "projects");
    const proj = join(root, "C--Users-danit");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "11111111-1111-1111-1111-111111111111.jsonl"),
      `{"type":"user","text":"hi"}\n{"type":"assistant","text":"hello"}\n`
    );

    const { result } = await scrapeClaudeCode(
      root, {}, outDir, "2026-04-15T00:00:00.000Z", false
    );
    expect(result.sessionsWritten).toBe(1);

    const files = readdirSync(join(outDir, "claude-code"));
    expect(files).toHaveLength(1);
    const lines = readJsonlLines(join(outDir, "claude-code", files[0]!));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.source).toBe("claude-code");
    expect(lines[0]!.raw).toEqual({ type: "user", text: "hi" });
  });

  it("advances cursor so a second run writes 0", async () => {
    const root = join(tmp, "projects");
    const proj = join(root, "p1");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "abc.jsonl"),
      `{"type":"user"}\n`
    );
    const past = new Date(Date.now() - 60_000);
    // intentionally age the file so cursor comparison is stable
    const { utimesSync } = await import("node:fs");
    utimesSync(join(proj, "abc.jsonl"), past, past);

    const first = await scrapeClaudeCode(root, {}, outDir, "t", false);
    expect(first.result.sessionsWritten).toBe(1);

    const second = await scrapeClaudeCode(
      root, first.cursorNext, outDir, "t", false
    );
    expect(second.result.sessionsWritten).toBe(0);
  });
});

describe("scrapeCodex", () => {
  it("reads session_index.jsonl and writes one envelope per line", async () => {
    const root = join(tmp, "codex");
    mkdirSync(join(root, "sessions", "2026", "04", "15"), { recursive: true });
    const id = "019ccc12-7079-7b31-a050-7c462c3aa71e";
    writeFileSync(
      join(root, "session_index.jsonl"),
      JSON.stringify({ id, thread_name: "test", updated_at: "2026-04-15T06:11:39Z" }) + "\n"
    );
    writeFileSync(
      join(root, "sessions", "2026", "04", "15", `rollout-2026-04-15T06-00-00-${id}.jsonl`),
      `{"timestamp":"x","type":"session_meta","payload":{"id":"${id}"}}\n{"type":"turn","text":"hi"}\n`
    );

    const { result, cursorNext } = await scrapeCodex(
      root, {}, outDir, "now", false
    );
    expect(result.sessionsWritten).toBe(1);
    expect(cursorNext.lastUpdatedAt).toBe("2026-04-15T06:11:39Z");

    const files = readdirSync(join(outDir, "codex"));
    expect(files).toHaveLength(1);
    const lines = readJsonlLines(join(outDir, "codex", files[0]!));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.source).toBe("codex");

    // Second run with same cursor — nothing new.
    const second = await scrapeCodex(root, cursorNext, outDir, "now", false);
    expect(second.result.sessionsWritten).toBe(0);
  });

  it("reports unavailable when index is missing", async () => {
    mkdirSync(join(tmp, "codex"));
    const { result } = await scrapeCodex(join(tmp, "codex"), {}, outDir, "now", false);
    expect(result.available).toBe(false);
  });

  it("does not advance the cursor past skipped index entries", async () => {
    const root = join(tmp, "codex");
    mkdirSync(join(root, "sessions", "2026", "04", "15"), { recursive: true });
    const missing = "019ccc12-0000-7000-a050-7c462c3aa71e";
    const present = "019ccc12-9999-7000-a050-7c462c3aa71e";
    writeFileSync(
      join(root, "session_index.jsonl"),
      [
        JSON.stringify({ id: missing, updated_at: "2026-04-15T06:00:00Z" }),
        JSON.stringify({ id: present, updated_at: "2026-04-15T07:00:00Z" }),
      ].join("\n") + "\n"
    );
    writeFileSync(
      join(root, "sessions", "2026", "04", "15", `rollout-2026-04-15T07-00-00-${present}.jsonl`),
      `{"type":"turn","text":"hi"}\n`
    );

    const { result, cursorNext } = await scrapeCodex(
      root,
      {},
      outDir,
      "now",
      false
    );

    expect(result.sessionsWritten).toBe(1);
    expect(result.sessionsSkipped).toBe(1);
    expect(cursorNext.lastUpdatedAt).toBeUndefined();
  });
});
