# Phase 1 — scrape report

## Current state (what shipped)

New command `skillset scrape` dumps raw coding-session transcripts from Claude Code, Codex CLI, and Cursor IDE into `~/.skillset/sessions/` as JSONL. Each line is a thin envelope around the native record:

```json
{ "source": "claude-code|codex|cursor", "sessionId": "...", "scrapedAt": "ISO", "raw": { ...native... } }
```

**Layout**: `~/.skillset/sessions/<source>/<stem>.jsonl`, one file per session. Writes are atomic (tmp + rename). Default is incremental; `--full` ignores cursors; `--source=<name>` runs one source.

**Real-disk extraction (first run, 14.5s)**:

| source      | sessions | records | size  | notes |
|-------------|----------|---------|-------|-------|
| claude-code | 731      | 60,805  | 167 MB | 333 non-jsonl sidecars skipped (metadata files, expected) |
| codex       | 10       | 4,493   | 12 MB  | 8 index entries had no matching rollout file (old/purged sessions) |
| cursor      | 582      | 30,982  | 272 MB | read from globalStorage `state.vscdb` (composer + bubble keys) |
| **total**   | **1,323**| **96,280** | **454 MB** | |

Second run: 0.3s, 1 new session (Claude Code session touched during the first run). Incremental cursors work.

**Tests**: 23/23 passing (`pnpm test`). Typecheck clean (`pnpm typecheck`). Build clean (`pnpm build`).

### Files added
- `src/ingest/sessions/types.ts` — envelope + cursor shapes
- `src/ingest/sessions/writer.ts` — atomic JSONL writer
- `src/ingest/sessions/sqlite.ts` — `better-sqlite3` wrapper with `locked` / `unavailable` classification
- `src/ingest/sessions/claudeCode.ts` — reuses `extractFolderIncremental` + `FolderCursor`
- `src/ingest/sessions/codex.ts` — reads `session_index.jsonl` manifest, filters by `updated_at`
- `src/ingest/sessions/cursor.ts` — enumerates `composerData:*` + `bubbleId:*` from globalStorage
- `src/ingest/sessions/index.ts` — dispatcher (`scrapeAll`)
- `src/commands/scrape.ts` — CLI handler
- `tests/scrape.test.ts` — 8 tests (writer, per-source extractors, incremental behaviour)
- `PHASE1_REPORT.md` — this file

### Files modified
- `src/core/paths.ts` — adds `SESSIONS_DIR`
- `src/core/config.ts` — extends `State` with `scrape: ScrapeCursors`
- `src/ingest/discovery.ts` — adds `discoverCodexHistory`, `discoverCursorGlobalStorage`; extends `SessionSource["kind"]`
- `src/ingest/index.ts` — re-exports session types
- `src/cli.ts` — registers `scrape` command
- `package.json` — adds `better-sqlite3` + `@types/better-sqlite3`

---

## Decisions you should make

1. **454 MB under a git-tracked store.** You picked `sessions/` inside `~/.skillset/` which is versioned. 30k+ Cursor bubbles will balloon git history every run. Options:
   - Add `sessions/` to the store's `.gitignore` (keep the path, drop the tracking).
   - Move to `~/.skillset/cache/sessions/` and update `SESSIONS_DIR` in `paths.ts`.
   - Keep it tracked (git LFS eventually, or just live with it during phase-2 prototyping).
   - **My recommendation:** gitignore it. Sessions are reproducible from source-of-truth (`.claude/`, `.codex/`, Cursor DBs) — no need to version them. The canonical store exists to version *skills*, not raw corpus.

2. **Secret scrubbing.** `raw` fields contain whatever was pasted into your sessions — API keys, tokens, `.env` contents. Today's scraper does no redaction. Options:
   - Defer entirely to phase 2 (mining).
   - Add a minimal regex scrub at `writer.ts` now (OpenAI keys, Anthropic keys, GitHub PATs, generic high-entropy lines).
   - **My recommendation:** add a basic scrub now, even if imperfect — pragmatic, low-risk, and means the on-disk corpus is shareable sooner (e.g., if you want to push it across machines or mount it from another agent).

3. **Cursor filename collisions.** I only read `globalStorage/state.vscdb` (not per-workspace DBs), because reverse-engineering showed bubble data lives globally. If you ever enable workspace DBs later, filenames (`<composerId>.jsonl`) could collide. Prefix with a db-hash? Not urgent — flag for phase 2.

4. **`skipped` counters are opaque.** The CLI prints `N skipped` without breakdown. If you care about diagnosing why (parse error vs too-large vs non-jsonl), we'd add a `--verbose` flag. Minor.

5. **Cursor "skipped" on re-run = 582.** That's the count of unchanged composers (correct behaviour — their `lastUpdatedAt` hasn't moved). The word "skipped" reads wrong next to claude-code's "skipped" (which means "extraction error"). Worth splitting into `up-to-date` vs `errored` in the summary line.

---

## Future scope (phase 2 and beyond)

### Phase 2 — data engineering (the "make it useful" pass)

Now that we have a flat corpus of 96k+ raw records across three native formats, phase 2 can stream `sessions/**/*.jsonl` and build:

- **Unified schema**: `Session → Turn → Message{role, content, toolUse[]}` — one parser per source, dropped into a common shape.
- **Signal extraction**:
  - *plan-rejection* (user replies "no", "redo", "that's wrong" inside N turns of a tool call) → skill candidate: "don't do X"
  - *tool-use retries* (same bash command failing then succeeding with small edits) → skill candidate: "when X, use Y"
  - *error → fix pairs* (stack trace → successful next edit) → debugging skill candidate
  - *verbatim corrections* ("stop doing X" / "always Y") — direct promotion to a feedback memory
- **Dedup**: content-hash across sessions. Many useful turns repeat.
- **Index/search layer**: SQLite or sqlite+FTS5 over `sessions/**`, driven by a `skillset search` command.

### Phase 3 — scoring / skill candidates

- Rank extracted signals by: frequency × recency × user-agreement × non-obviousness.
- LLM-in-the-loop synthesis: feed top-K raw turns into Claude/Gemini → draft SKILL.md.
- Write candidates to `~/.skillset/candidates/`; user promotes to `skills/` manually (or via a new `skillset promote <id>` command).

### Phase 4 — close the loop with sync

Once candidate skills enter the canonical store, the existing mirror/sync engine distributes them to every linked agent automatically. That's the payoff: **you paste something into Cursor, a pattern emerges across sessions, a skill materializes in Claude Code's `.claude/skills/` next sync.**

### Smaller follow-ups

- Cursor workspace DBs (workspaceStorage/*/state.vscdb) — probably redundant with globalStorage, but confirm.
- Codex: also scrape `~/.codex/history.jsonl` (global prompt history) and the SQLite log.
- `cursor` Windows path is hardcoded to `AppData/Roaming` — need `Library/Application Support` on macOS and `~/.config` on Linux before this ships cross-platform.
- Real `session_index.jsonl` has 8 entries pointing at missing files → once you fix up the Codex archive rotation, that gap closes.

---

## How to poke at what was built

```bash
# see it run
node dist/cli.js scrape

# isolate a source
node dist/cli.js scrape --source=cursor

# force re-scrape
node dist/cli.js scrape --full

# look at one raw record
head -n 1 ~/.skillset/sessions/claude-code/*.jsonl | head -c 400

# stats
python -c "import os, glob; d='C:/Users/danit/.skillset/sessions'; [print(s, len(glob.glob(f'{d}/{s}/*.jsonl'))) for s in ['claude-code','codex','cursor']]"
```

Plan file: `C:\Users\danit\.claude\plans\glimmering-exploring-cookie.md`
