import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSkillMd } from "./skill.js";
import { STORE_SKILLS_DIR } from "./paths.js";

export const SKILL_THIS_NAME = "skill-this";
export const SKILLSET_CLI_NAME = "skillset-cli";

const SKILL_THIS_BODY = `# Skill Explicit Requests

When the user says "skill this", "skill that", "make this a skill", or "skill <instruction>", treat it as an explicit request to create or update a Skillset skill.

## How to Capture

- If the user supplied the rule after "skill", pass that rule through directly.
- If the user said "this" or "that", summarize the current correction, preference, workflow, or anti-pattern as one concise instruction.
- Include enough context that the future agent can act without seeing the original conversation.
- Run Skillset instead of editing mirrored skill files by hand.

## Command

Use the direct Skillset command:

\`\`\`sh
sks tailor --stdin
\`\`\`

Pass the instruction on stdin. For short one-line requests, \`sks tailor "<instruction>"\` is also fine.

After the command finishes, tell the user whether Skillset edited an existing skill, installed a new skill, or skipped the request.

## Do NOT

- Do not write \`SKILL.md\` files directly in agent mirror directories.
- Do not bypass Skillset's canonical store, tiering, sync, or user-edit detection.
- Do not capture one-off task details unless the user clearly asks to preserve them as a future preference.`;

const SKILLSET_CLI_BODY = `# Manage Skills with Skillset

Use the \`sks\` CLI so canonical skills stay synchronized across Claude Code and Codex.

## Inspect

Run the smallest command that answers the question:

\`\`\`sh
sks list
sks show <skill>
sks show <skill> --json
sks check [skill]
sks doctor
\`\`\`

Use \`sks catalog\` when categories, ownership, tiers, or usage history help decide what to change.

## Capture or Improve

- For a natural-language correction, preference, or workflow, pass a self-contained instruction to \`sks tailor --stdin\`.
- For a complete new skill directory or \`SKILL.md\`, use \`sks add <path>\` or pipe it to \`sks add --stdin\`.
- For an exact non-interactive update, inspect first, then pipe a complete replacement to \`sks edit <skill> --stdin\`.
- When revising supporting files too, stage the complete skill directory and use \`sks edit <skill> --source <path>\`.
- Use \`sks tailor\` with no text only when the user asks to learn from session history.
- Use \`sks tailor --local\` when transcript contents must stay on the machine; review ranked candidates and apply only durable changes with deterministic add/edit commands.
- Run \`sks check\` after direct additions or edits.

Mutating commands reconcile and mirror automatically. Report whether Skillset added, edited, skipped, adopted, repaired, or mirrored skills.

## Guardrails

- Treat \`~/.skillset/skills/\` as canonical; never write directly to \`~/.claude/skills\` or \`~/.codex/skills\`.
- Preserve supporting \`scripts/\`, \`references/\`, and \`assets/\` when a skill uses them.
- Do not remove a skill unless the user explicitly asked to remove it.
- Use \`sks doctor --repair\` only when repair or reconciliation is intended.`;

async function ensureBuiltinSkill(
  name: string,
  description: string,
  body: string,
  shouldRefresh?: (current: string) => boolean
): Promise<{ name: string; path: string } | null> {
  const dir = join(STORE_SKILLS_DIR, name);
  const file = join(dir, "SKILL.md");
  let shouldWrite = !existsSync(file);
  if (!shouldWrite && shouldRefresh) {
    const current = await readFile(file, "utf8").catch(() => "");
    shouldWrite = shouldRefresh(current);
  }
  if (!shouldWrite) return null;
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    renderSkillMd(
      {
        name,
        description,
        tier: "medium",
        origin: "user-created",
        license: "MIT",
      },
      body
    ),
    "utf8"
  );
  return { name, path: dir };
}

export async function ensureBuiltinSkills(): Promise<Array<{ name: string; path: string }>> {
  const installed: Array<{ name: string; path: string }> = [];
  const skillThis = await ensureBuiltinSkill(
    SKILL_THIS_NAME,
    "Use Skillset when the user says \"skill this\" or asks to capture a durable instruction, workflow, correction, or preference as a reusable coding-agent skill.",
    SKILL_THIS_BODY,
    (current) =>
      current.includes("sks skill") ||
      current.includes("sks promote") ||
      current.includes("left a draft")
  );
  if (skillThis) installed.push(skillThis);

  const skillsetCli = await ensureBuiltinSkill(
    SKILLSET_CLI_NAME,
    "Use when Claude Code or Codex needs to inspect, validate, add, edit, tailor, repair, or otherwise manage the user's portable Skillset skill library through the sks CLI.",
    SKILLSET_CLI_BODY
  );
  if (skillsetCli) installed.push(skillsetCli);
  return installed;
}
