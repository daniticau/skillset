import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RemoteSourceError,
  isRemoteSource,
  parseRemoteSource,
  resolveRemoteSkill,
} from "../src/core/remote.js";
import type { FetchLike } from "../src/core/remote.js";

const SKILL = "---\nname: unslop\ndescription: Use when writing.\n---\n\nunslop body\n";

/** A fake GitHub + fxtwitter that serves from a map of URL → body. */
function fakeFetch(routes: Record<string, unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (hit === undefined) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      text: async () => (typeof hit === "string" ? hit : JSON.stringify(hit)),
      json: async () => hit,
    };
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const repoInfo = { default_branch: "main" };
const tree = {
  tree: [
    { path: "README.md", type: "blob", size: 10 },
    { path: "pstack/skills/unslop/SKILL.md", type: "blob", size: 60 },
    { path: "pstack/skills/unslop/references/tells.md", type: "blob", size: 20 },
    { path: "pstack/skills/other/SKILL.md", type: "blob", size: 60 },
    { path: "node_modules/x/SKILL.md", type: "blob", size: 5 },
  ],
};
const GH = {
  "https://api.github.com/repos/cursor/plugins": repoInfo,
  "https://api.github.com/repos/cursor/plugins/git/trees/main?recursive=1": tree,
  "https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/unslop/SKILL.md": SKILL,
  "https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/unslop/references/tells.md": "tells",
  "https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/other/SKILL.md": SKILL.replace("unslop", "other"),
};

describe("remote source detection", () => {
  it("recognises URLs and owner/repo shorthand, but not local paths", () => {
    expect(isRemoteSource("https://github.com/a/b")).toBe(true);
    expect(isRemoteSource("cursor/plugins")).toBe(true);
    expect(isRemoteSource("./my-skill")).toBe(false);
    expect(isRemoteSource("src/core")).toBe(false); // exists on disk
  });

  it("parses every accepted form", () => {
    expect(parseRemoteSource("cursor/plugins")).toEqual({ kind: "github", owner: "cursor", repo: "plugins" });
    expect(parseRemoteSource("https://github.com/cursor/plugins")).toEqual({ kind: "github", owner: "cursor", repo: "plugins" });
    expect(parseRemoteSource("https://github.com/cursor/plugins/tree/main/pstack/skills/unslop")).toEqual({
      kind: "github", owner: "cursor", repo: "plugins", ref: "main", path: "pstack/skills/unslop",
    });
    expect(parseRemoteSource("https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md")).toEqual({
      kind: "github", owner: "cursor", repo: "plugins", ref: "main", path: "pstack/skills/unslop",
    });
    expect(parseRemoteSource("https://skills.sh/cursor/plugins/unslop")).toEqual({
      kind: "github", owner: "cursor", repo: "plugins", skill: "unslop",
    });
    expect(parseRemoteSource("https://x.com/juampitech/status/2090491139103064305?s=20")).toEqual({
      kind: "tweet", user: "juampitech", id: "2090491139103064305",
    });
    expect(parseRemoteSource("https://raw.githubusercontent.com/a/b/main/SKILL.md")).toEqual({
      kind: "raw", url: "https://raw.githubusercontent.com/a/b/main/SKILL.md",
    });
    expect(parseRemoteSource("https://example.com/notes/SKILL.md").kind).toBe("raw");
    expect(() => parseRemoteSource("https://example.com/page")).toThrow(RemoteSourceError);
  });
});

describe("remote skill resolution", () => {
  it("downloads one skill directory, siblings included, and skips ignored paths", async () => {
    const fetch = fakeFetch(GH);
    const resolved = await resolveRemoteSkill("https://skills.sh/cursor/plugins/unslop", { fetch });
    try {
      expect(readFileSync(join(resolved.dir, "SKILL.md"), "utf8")).toBe(SKILL);
      expect(readFileSync(join(resolved.dir, "references", "tells.md"), "utf8")).toBe("tells");
      expect(existsSync(join(resolved.dir, "README.md"))).toBe(false);
      expect(resolved.origin).toBe("github.com/cursor/plugins@main/pstack/skills/unslop");
    } finally {
      await resolved.cleanup();
    }
    expect(existsSync(resolved.dir)).toBe(false);
  });

  it("asks for --skill when a repo holds several", async () => {
    await expect(resolveRemoteSkill("cursor/plugins", { fetch: fakeFetch(GH) })).rejects.toThrow(/--skill <name>/);
    const picked = await resolveRemoteSkill("cursor/plugins", { fetch: fakeFetch(GH), skill: "other" });
    try {
      expect(readFileSync(join(picked.dir, "SKILL.md"), "utf8")).toContain("name: other");
    } finally {
      await picked.cleanup();
    }
  });

  it("narrows to a subtree from a /tree/ URL and honours the ref", async () => {
    const routes = {
      ...GH,
      "https://api.github.com/repos/cursor/plugins/git/trees/v2?recursive=1": tree,
      "https://raw.githubusercontent.com/cursor/plugins/v2/pstack/skills/unslop/SKILL.md": SKILL,
      "https://raw.githubusercontent.com/cursor/plugins/v2/pstack/skills/unslop/references/tells.md": "t",
    };
    const fetch = fakeFetch(routes);
    const resolved = await resolveRemoteSkill("https://github.com/cursor/plugins/tree/v2/pstack/skills/unslop", { fetch });
    await resolved.cleanup();
    expect(fetch.calls.some((u) => u.includes("/repos/cursor/plugins\n"))).toBe(false);
    expect(fetch.calls).toContain("https://api.github.com/repos/cursor/plugins/git/trees/v2?recursive=1");
  });

  it("follows the skill link inside a tweet", async () => {
    const fetch = fakeFetch({
      ...GH,
      "https://api.fxtwitter.com/juampitech/status/1": {
        tweet: { text: "best anti-slop skill. https://skills.sh/cursor/plugins/unslop" },
      },
    });
    const resolved = await resolveRemoteSkill("https://x.com/juampitech/status/1", { fetch });
    try {
      expect(readFileSync(join(resolved.dir, "SKILL.md"), "utf8")).toBe(SKILL);
      expect(resolved.origin).toContain("(via https://x.com/juampitech/status/1)");
    } finally {
      await resolved.cleanup();
    }
  });

  it("returns the tweet text when it links to no skill", async () => {
    const fetch = fakeFetch({
      "https://api.fxtwitter.com/benhylak/status/2": {
        tweet: { text: 'add "NEVER, EVER USE EYEBROWS" to your agents.md\n\nthank me later.' },
      },
    });
    const err = await resolveRemoteSkill("https://x.com/benhylak/status/2", { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(RemoteSourceError);
    expect(err.tweetText).toContain("NEVER, EVER USE EYEBROWS");
    expect(err.message).toContain("--build");
  });

  it("fetches a raw SKILL.md URL directly", async () => {
    const url = "https://raw.githubusercontent.com/a/b/main/SKILL.md";
    const resolved = await resolveRemoteSkill(url, { fetch: fakeFetch({ [url]: SKILL }) });
    try {
      expect(readFileSync(join(resolved.dir, "SKILL.md"), "utf8")).toBe(SKILL);
    } finally {
      await resolved.cleanup();
    }
  });

  it("explains a GitHub rate limit", async () => {
    const fetch = (async () => ({ ok: false, status: 403, text: async () => "", json: async () => ({}) })) as FetchLike;
    await expect(resolveRemoteSkill("a/b", { fetch })).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
