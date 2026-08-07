/**
 * `sks build` — decomposition-first skill authoring.
 *
 * Takes a raw idea, splits it into the smallest reusable units, validates each
 * proposed skill against the same rules `sks check` enforces, and only then
 * writes. A skill that would fail `check` is never installed: the whole point of
 * the builder is that authoring and quality are one step, not two.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { readState, writeState, initialSkillState } from "../core/config.js";
import { renderSkillMd } from "../core/skill.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";
import { confirm } from "../core/ux/prompt.js";
import { decomposeIdea, parseDecomposeResponse } from "../build/decompose.js";
import type { ProposedSkill } from "../build/decompose.js";
import { appendHistoryEvent, sharedSkillAgents } from "../core/history.js";
import { syncCommand } from "./sync.js";
import { validateProposedSkill } from "./check.js";

export interface BuildOptions {
  stdin?: boolean;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  /**
   * Install a proposal that was already reviewed, read as JSON from stdin.
   *
   * Lets a caller (the desktop Builder, an agent) preview with `--json` and
   * then install exactly what it showed. Re-running the decomposition to
   * install would call the model again and could produce different skills than
   * the ones the user approved.
   */
  fromJson?: boolean;
  /** Test/programmatic injection; bypasses the LLM call. */
  proposals?: ProposedSkill[];
}

/** Re-validate externally supplied proposals through the same coercion path. */
function parseProposals(list: unknown): ProposedSkill[] {
  if (!Array.isArray(list)) return [];
  return parseDecomposeResponse(JSON.stringify({ skills: list })).skills;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function existingSkillSummaries(): Promise<
  Array<{ name: string; description: string }>
> {
  const out: Array<{ name: string; description: string }> = [];
  for (const name of await listStoreSkills()) {
    try {
      const parsed = await readSkillMd(storeSkillDir(name));
      out.push({ name, description: parsed.frontmatter.description });
    } catch {
      // A malformed existing skill should not block authoring a new one.
    }
  }
  return out;
}

function renderProposal(skill: ProposedSkill, issues: string[]): void {
  const head = `${pc.bold(skill.name)} ${pc.dim(`(${skill.kind}, tier ${skill.tier})`)}`;
  console.log(`\n  ${head}`);
  console.log(`    ${pc.dim("triggers when")}  ${skill.trigger || pc.dim("—")}`);
  console.log(`    ${pc.dim("prevents")}       ${skill.prevents || pc.dim("—")}`);
  if (skill.links.length > 0) {
    console.log(`    ${pc.dim("links")}          ${skill.links.map((l) => `[[${l}]]`).join(" ")}`);
  }
  const words = skill.body.trim().split(/\s+/).length;
  console.log(`    ${pc.dim("body")}           ${words} words`);
  for (const issue of issues) {
    console.log(`    ${pc.yellow("⚠")} ${issue}`);
  }
}

export async function buildCommand(
  text: string[],
  options: BuildOptions = {}
): Promise<void> {
  let injected = options.proposals;
  if (options.fromJson && !injected) {
    const raw = (await readStdin()).trim();
    try {
      const parsed = JSON.parse(raw) as { skills?: unknown };
      const list = Array.isArray(parsed) ? parsed : parsed.skills;
      injected = parseProposals(list);
    } catch {
      console.error(pc.red("could not parse proposal JSON from stdin"));
      process.exitCode = 1;
      return;
    }
    if (injected.length === 0) {
      console.error(pc.red("no valid skills in the supplied proposal"));
      process.exitCode = 1;
      return;
    }
  }

  const idea =
    options.stdin && !options.fromJson
      ? (await readStdin()).trim()
      : text.join(" ").trim();
  if (!idea && !injected) {
    console.error(
      pc.red("nothing to build — pass an idea, or use --stdin to read one")
    );
    process.exitCode = 1;
    return;
  }

  const existing = await existingSkillSummaries();
  const existingNames = new Set(existing.map((s) => s.name));

  let result;
  if (injected) {
    result = { skills: injected, rationale: "reviewed proposal" };
  } else {
    try {
      result = await decomposeIdea(idea, existing);
    } catch (err) {
      console.error(
        pc.red(`could not reach the model: ${err instanceof Error ? err.message : String(err)}`)
      );
      process.exitCode = 1;
      return;
    }
  }

  // Validate before showing anything, so the proposal and its problems appear
  // together and a blocking issue never reaches the write step.
  const evaluated = result.skills.map((skill) => {
    const issues = validateProposedSkill(skill.name, skill.description, skill.body);
    const blocking = issues.filter((i) => i.severity === "error");
    return { skill, issues, blocking, collides: existingNames.has(skill.name) };
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          rationale: result.rationale,
          skills: evaluated.map((e) => ({
            ...e.skill,
            issues: e.issues,
            collidesWithExisting: e.collides,
            installable: e.blocking.length === 0 && !e.collides,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (result.skills.length === 0) {
    console.log(pc.yellow("no new skill proposed"));
    if (result.rationale) console.log(pc.dim(`  ${result.rationale}`));
    return;
  }

  console.log(
    pc.bold(
      `\n${result.skills.length} atomic skill${result.skills.length === 1 ? "" : "s"} proposed`
    )
  );
  if (result.rationale) console.log(pc.dim(`${result.rationale}`));

  for (const e of evaluated) {
    const notes = [
      ...e.issues.map((i) => `${i.severity}: ${i.message}`),
      ...(e.collides ? ["error: a skill with this name already exists — use `sks edit` instead"] : []),
    ];
    renderProposal(e.skill, notes);
  }

  const installable = evaluated.filter((e) => e.blocking.length === 0 && !e.collides);
  const rejected = evaluated.length - installable.length;
  if (rejected > 0) {
    console.log(
      pc.yellow(`\n${rejected} proposal(s) will not be installed — they fail validation`)
    );
  }
  if (installable.length === 0) {
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(pc.dim("\ndry run — nothing written"));
    return;
  }

  if (!options.yes) {
    const ok = await confirm(
      `\ninstall ${installable.length} skill(s) into the canonical store?`,
      true
    );
    if (!ok) {
      console.log(pc.dim("cancelled"));
      return;
    }
  }

  const state = await readState();
  for (const { skill } of installable) {
    const dir = storeSkillDir(skill.name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      renderSkillMd(
        {
          name: skill.name,
          description: skill.description,
          tier: skill.tier,
          origin: "user-created",
        },
        skill.body
      ),
      "utf8"
    );
    state.skills[skill.name] = initialSkillState("user-created", { createdBy: "manual" });
    console.log(pc.green(`✓ built ${pc.bold(skill.name)}`));
  }
  await writeState(state);

  await syncCommand();
  await appendHistoryEvent({
    kind: "created",
    title: `${installable.length} skill(s) built`,
    detail: `Decomposed one instruction into ${installable.length} atomic skill(s).`,
    skillNames: installable.map((e) => e.skill.name),
    agents: sharedSkillAgents(),
    source: "manual",
  });
}

export { existsSync };
