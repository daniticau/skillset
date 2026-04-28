import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSkillMd } from "./skill.js";
import { STORE_SKILLS_DIR } from "./paths.js";

export const SKILL_THIS_NAME = "skill-this";

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

export async function ensureBuiltinSkills(): Promise<Array<{ name: string; path: string }>> {
  const installed: Array<{ name: string; path: string }> = [];
  const dir = join(STORE_SKILLS_DIR, SKILL_THIS_NAME);
  const file = join(dir, "SKILL.md");
  let shouldWrite = !existsSync(file);
  if (!shouldWrite) {
    const current = await readFile(file, "utf8").catch(() => "");
    shouldWrite =
      current.includes("sks skill") ||
      current.includes("sks promote") ||
      current.includes("left a draft");
  }
  if (shouldWrite) {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      renderSkillMd(
        {
          name: SKILL_THIS_NAME,
          description:
            "Use Skillset when the user says \"skill this\" or asks to turn an instruction into a reusable skill.",
          tier: "medium",
          origin: "user-created",
          license: "MIT",
        },
        SKILL_THIS_BODY
      ),
      "utf8"
    );
    installed.push({ name: SKILL_THIS_NAME, path: dir });
  }
  return installed;
}
