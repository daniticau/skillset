import pc from "picocolors";
import { status } from "../core/mirror.js";
import { getAdapter } from "../core/adapters/index.js";

export async function statusCommand(): Promise<void> {
  const s = await status();

  if (s.links.length === 0) {
    console.log(pc.yellow("no mirrors linked"));
  } else {
    console.log(pc.bold("mirrors:"));
    for (const l of s.links) {
      let displayName: string;
      try {
        displayName = getAdapter(l.agent).displayName;
      } catch {
        displayName = `${l.agent} (unsupported)`;
      }
      const name = displayName.padEnd(14);
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
    console.log(`  ${marker} ${sk.name}${conflict}`);
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
