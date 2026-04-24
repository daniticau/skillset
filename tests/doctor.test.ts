import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-doctor-fixed");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const CLAUDE_MIRROR = join(TEST_ROOT, "claude-mirror");
const CURSOR_MIRROR = join(TEST_ROOT, "cursor-mirror");
const CODEX_FILE = join(TEST_ROOT, "AGENTS.md");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: CLAUDE_MIRROR,
}));

vi.mock("../src/mine/llm/index.js", () => ({
  defaultLLMConfig: () => ({
    provider: "ollama",
    model: "mock-model",
    baseUrl: "http://127.0.0.1:11434/v1",
    embeddingModel: undefined,
  }),
  isAvailable: async () => ({
    reachable: false,
    reason: "mocked",
    modelPresent: false,
    models: [],
  }),
}));

vi.mock("../src/mine/index.js", () => ({
  getSessionStats: () => ({
    userSessions: 0,
    projects: 0,
    totalSizeBytes: 0,
    bySource: {
      "claude-code": { sessions: 0, bytes: 0 },
      codex: { sessions: 0, bytes: 0 },
      cursor: { sessions: 0, bytes: 0 },
    },
  }),
}));

const { writeConfig, writeState } = await import("../src/core/config.js");
const { doctorCommand } = await import("../src/commands/doctor.js");

describe("doctorCommand", () => {
  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(SKILLS, { recursive: true });
    mkdirSync(CLAUDE_MIRROR, { recursive: true });
    mkdirSync(CURSOR_MIRROR, { recursive: true });

    mkdirSync(join(CLAUDE_MIRROR, "alpha"), { recursive: true });
    writeFileSync(
      join(CLAUDE_MIRROR, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: alpha\n---\n\nalpha body\n"
    );

    writeFileSync(
      join(CURSOR_MIRROR, "beta.mdc"),
      "---\ndescription: \"beta\"\nglobs: []\nalwaysApply: false\nskillset-name: beta\n---\n\nbeta body\n"
    );

    writeFileSync(
      CODEX_FILE,
      [
        "<!-- skillset:begin — do not edit this block -->",
        "",
        "# Skills (managed by skillset)",
        "",
        "## gamma",
        "",
        "gamma body",
        "",
        "<!-- skillset:end -->",
        "",
      ].join("\n")
    );

    await writeConfig({
      version: 1,
      links: [
        { agent: "claude-code", path: CLAUDE_MIRROR },
        { agent: "cursor", path: CURSOR_MIRROR },
        { agent: "codex", path: CODEX_FILE },
      ],
    });
    await writeState({ version: 2, skills: {}, reviewedDates: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("reports mirror layouts without crashing on aggregate-file links", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(doctorCommand()).resolves.toBeUndefined();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Claude Code");
    expect(output).toContain("Cursor");
    expect(output).toContain("Codex");
    expect(output).toContain("(1 skill)");
    expect(output).toContain("(managed aggregate file)");
  });
});
