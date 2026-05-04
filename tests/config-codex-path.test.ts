import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-config-codex-${process.pid}`);
const STORE = join(ROOT, "store");
const CONFIG = join(STORE, "config.json");
const STATE = join(STORE, "state.json");
const CODEX_HOME = join(ROOT, ".codex");
const CODEX_SKILLS = join(CODEX_HOME, "skills");
const LEGACY_CODEX_SKILLS = join(homedir(), ".agents", "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: join(STORE, "skills"),
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: CONFIG,
  STATE_FILE: STATE,
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, ".claude", "skills"),
  DEFAULT_CODEX_SKILLS_DIR: CODEX_SKILLS,
}));

const { readConfig, writeConfig } = await import("../src/core/config.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

function rawConfig(): unknown {
  return JSON.parse(readFileSync(CONFIG, "utf8"));
}

describe("Codex config path migration", () => {
  it("migrates and persists the legacy ~/.agents/skills Codex link to ~/.codex/skills", async () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    writeFileSync(
      CONFIG,
      JSON.stringify({
        version: 1,
        links: [{ agent: "codex", path: LEGACY_CODEX_SKILLS }],
      }),
      "utf8"
    );

    const config = await readConfig();

    expect(config.links).toEqual([{ agent: "codex", path: CODEX_SKILLS }]);
    expect(rawConfig()).toEqual({
      version: 1,
      links: [{ agent: "codex", path: CODEX_SKILLS }],
    });
  });

  it("dedupes old and new Codex links during migration", async () => {
    mkdirSync(CODEX_HOME, { recursive: true });

    await writeConfig({
      version: 1,
      links: [
        { agent: "codex", path: LEGACY_CODEX_SKILLS },
        { agent: "codex", path: CODEX_SKILLS },
      ],
    });

    expect(rawConfig()).toEqual({
      version: 1,
      links: [{ agent: "codex", path: CODEX_SKILLS }],
    });
  });

  it("keeps explicit custom Codex mirror paths unchanged", async () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    const custom = join(ROOT, "custom-codex-skills");

    await writeConfig({
      version: 1,
      links: [{ agent: "codex", path: custom }],
    });

    expect((await readConfig()).links).toEqual([{ agent: "codex", path: custom }]);
    expect(rawConfig()).toEqual({
      version: 1,
      links: [{ agent: "codex", path: custom }],
    });
  });

  it("does not rewrite the legacy path on machines without a Codex home", async () => {
    await writeConfig({
      version: 1,
      links: [{ agent: "codex", path: LEGACY_CODEX_SKILLS }],
    });

    expect(existsSync(CODEX_HOME)).toBe(false);
    expect((await readConfig()).links).toEqual([
      { agent: "codex", path: LEGACY_CODEX_SKILLS },
    ]);
    expect(rawConfig()).toEqual({
      version: 1,
      links: [{ agent: "codex", path: LEGACY_CODEX_SKILLS }],
    });
  });
});
