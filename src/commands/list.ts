import pc from "picocolors";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";

/** Always-on skills carry the same mark the sync output uses. */
function alwaysMark(always: boolean | undefined): string {
  return always ? pc.cyan("∞") : " ";
}

export async function listCommand(): Promise<void> {
  const names = await listStoreSkills();
  if (names.length === 0) {
    console.log(pc.dim("no skills in canonical store"));
    return;
  }
  for (const name of names) {
    const parsed = await readSkillMd(storeSkillDir(name));
    console.log(`${alwaysMark(parsed.frontmatter.always)} ${pc.bold(name)}`);
    console.log(`  ${pc.dim(parsed.frontmatter.description)}`);
  }
}
