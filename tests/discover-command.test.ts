import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-discover-command-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

const { discoverCommand } = await import("../src/commands/discover.js");

const SEARCH_RESPONSE = {
  success: true,
  results: [
    {
      name: "Apollo.io",
      slug: "apollo",
      endpoints: [
        {
          path: "/v1/people/match",
          method: "POST",
          description: "Enrich a person by email",
          price: "0.03",
          verified: true,
          score: 0.95,
        },
      ],
    },
  ],
};

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.ORTHOGONAL_API_KEY = "test-key";
  delete process.env.ORTHOGONAL_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ORTHOGONAL_API_KEY;
  delete process.env.ORTHOGONAL_BASE_URL;
  rmSync(ROOT, { recursive: true, force: true });
});

describe("discoverCommand", () => {
  it("prints setup guidance and writes nothing without an API key", async () => {
    delete process.env.ORTHOGONAL_API_KEY;

    await discoverCommand({ query: "find lead emails" });

    const output = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => args.join(" "))
      .join("\n");
    expect(output).toContain("ORTHOGONAL_API_KEY");
    expect(existsSync(join(STORE, "drafts"))).toBe(false);
  });

  it("dry-runs candidates without writing drafts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => SEARCH_RESPONSE,
      }))
    );

    await discoverCommand({ query: "find lead emails", dryRun: true });

    expect(existsSync(join(STORE, "drafts"))).toBe(false);
    const output = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => args.join(" "))
      .join("\n");
    expect(output).toContain("orthogonal-apollo-post-v1-people-match");
  });

  it("writes draft skills with Orthogonal provenance metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => SEARCH_RESPONSE,
      }))
    );

    await discoverCommand({ query: "find lead emails" });

    const draftDir = join(STORE, "drafts", "orthogonal-apollo-post-v1-people-match");
    expect(readFileSync(join(draftDir, "SKILL.md"), "utf8")).toContain("tier: low");
    const meta = JSON.parse(readFileSync(join(draftDir, "meta.json"), "utf8"));
    expect(meta).toMatchObject({
      source: "orthogonal",
      query: "find lead emails",
      apiSlug: "apollo",
      endpointPath: "/v1/people/match",
      endpointMethod: "POST",
      price: "0.03",
      verified: true,
      score: 0.95,
    });
    expect(typeof meta.discoveredAt).toBe("string");
  });

  it("skips draft names that already exist in canonical skills", async () => {
    const existing = join(SKILLS, "orthogonal-apollo-post-v1-people-match");
    mkdirSync(existing, { recursive: true });
    writeFileSync(
      join(existing, "SKILL.md"),
      "---\nname: orthogonal-apollo-post-v1-people-match\ndescription: existing\n---\n\nexisting\n"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => SEARCH_RESPONSE,
      }))
    );

    await discoverCommand({ query: "find lead emails" });

    expect(existsSync(join(STORE, "drafts", "orthogonal-apollo-post-v1-people-match"))).toBe(false);
    const output = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => args.join(" "))
      .join("\n");
    expect(output).toContain("already exists");
  });
});
