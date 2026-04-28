import pc from "picocolors";
import { status } from "../core/mirror.js";
import { getAdapter } from "../core/adapters/index.js";
import { readUsageEvents, summarizeUsage } from "../usage/events.js";

export interface StatusCmdOptions {
  usage?: boolean;
}

function usageLabel(count: number): string {
  return `${count} ${count === 1 ? "use" : "uses"}`;
}

export async function statusCommand(options: StatusCmdOptions = {}): Promise<void> {
  const s = await status();
  const usage = options.usage
    ? summarizeUsage(await readUsageEvents())
    : new Map();

  if (s.links.length === 0) {
    console.log(pc.yellow("no mirrors linked"));
  } else {
    console.log(pc.bold("mirrors:"));
    for (const l of s.links) {
      const name = getAdapter(l.agent).displayName.padEnd(14);
      const layout = pc.dim(`[${l.layout}]`);
      console.log(`  ${name} ${layout} ${pc.dim(l.path)}`);
    }
  }

  if (s.skills.length === 0) {
    console.log(pc.dim("\nno skills in canonical store yet"));
    return;
  }
  console.log(pc.bold("\nskills:"));
  for (const sk of s.skills) {
    const marker = sk.userEdited
      ? pc.magenta("✎")
      : sk.origin === "user-created"
        ? pc.cyan("◆")
        : pc.green("•");
    const conflict =
      sk.conflicts > 0
        ? ` ${pc.yellow(`⚠ ${sk.conflicts} conflict(s), last ${sk.lastConflictAt}`)}`
        : "";
    const use = usage.get(sk.name);
    const usageText = options.usage
      ? use
        ? ` ${pc.dim(`${usageLabel(use.count)}, last ${use.lastUsedAt?.slice(0, 10)}`)}`
        : ` ${pc.dim("0 uses")}`
      : "";
    console.log(`  ${marker} ${sk.name}${usageText}${conflict}`);
  }
  console.log(
    pc.dim(
      `\n${pc.cyan("◆")} = user-authored (never touched by automation)    ${pc.magenta("✎")} = user-edited (your edits to an auto-skill are preserved)    ${pc.green("•")} = auto-managed`
    )
  );
  const hasConflicts = s.skills.some((sk) => sk.conflicts > 0);
  if (hasConflicts) {
    console.log(
      pc.dim(`${pc.yellow("⚠")} = multi-mirror conflict resolved; see ~/.skillset/conflicts/ for archived edits`)
    );
  }
}
