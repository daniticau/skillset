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
    const marker = sk.userModified ? pc.magenta("✎") : pc.green("•");
    console.log(`  ${marker} ${sk.name}`);
  }
  console.log(
    pc.dim(`\n${pc.magenta("✎")} = user-modified (edits in a mirror were promoted)`)
  );
}
