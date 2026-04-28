import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-tailor-command-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
}));

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

vi.mock("../src/mine/llm/index.js", () => ({
  defaultLLMConfig: () => ({ provider: "ollama", model: "mock-model", baseUrl: "mock" }),
  isAvailable: async () => ({ reachable: true, modelPresent: true, models: ["mock-model"] }),
  chat: mocks.chat,
  parseLLMJson: (raw: string) => JSON.parse(raw),
  triageSystemPrompt: () => "triage-system",
  triageUserPrompt: () => "triage-user",
  synthesisSystemPrompt: () => "synthesis-system",
  synthesisUserPrompt: () => "synthesis-user",
  editRewriteSystemPrompt: () => "edit-system",
  editRewriteUserPrompt: () => "edit-user",
}));

const { tailorCommand } = await import("../src/commands/tailor.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  await mkdir(SKILLS, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.chat.mockReset();
  mocks.chat
    .mockResolvedValueOnce({
      content: JSON.stringify({
        kind: "create",
        name: "prefer-pnpm",
        description: "Prefer pnpm for package management.",
        tier: "low",
      }),
    })
    .mockResolvedValueOnce({
      content:
        "---\nname: prefer-pnpm\ndescription: Prefer pnpm for package management.\ntier: low\n---\n\nAlways use pnpm for package management.\n",
    });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("tailorCommand explicit capture", () => {
  it("creates low-tier skills directly in canonical and never writes drafts", async () => {
    await tailorCommand(["Always use pnpm for package management."], {});

    const skillPath = join(SKILLS, "prefer-pnpm", "SKILL.md");
    expect(readFileSync(skillPath, "utf8")).toContain("tier: low");
    expect(readFileSync(skillPath, "utf8")).toContain("origin: user-created");
    expect(existsSync(join(STORE, "drafts"))).toBe(false);
  });

  it("dry-run leaves canonical and drafts untouched", async () => {
    await tailorCommand(["Always use pnpm for package management."], { dryRun: true });

    expect(existsSync(join(SKILLS, "prefer-pnpm"))).toBe(false);
    expect(existsSync(join(STORE, "drafts"))).toBe(false);
  });

  it("removes stray opening fences from generated skill bodies", async () => {
    mocks.chat.mockReset();
    mocks.chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          kind: "create",
          name: "terminal-screen-recordings",
          description: "Apply when creating terminal recordings.",
          tier: "medium",
        }),
      })
      .mockResolvedValueOnce({
        content:
          "---\nname: terminal-screen-recordings\ndescription: Apply when creating terminal recordings.\ntier: medium\n---\n\n```\n\n# Real Terminal Screen Recordings\n\nKeep the crop still while typing.\n",
      });

    await tailorCommand(["Screen recording in terminal."], {});

    const raw = readFileSync(
      join(SKILLS, "terminal-screen-recordings", "SKILL.md"),
      "utf8"
    );
    expect(raw).toContain("# Real Terminal Screen Recordings");
    expect(raw).not.toContain("\n```\n\n# Real Terminal Screen Recordings");
  });
});
