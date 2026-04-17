import pc from "picocolors";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";
import type { SkillTier } from "../core/skill.js";

function tierBadge(tier: SkillTier | undefined): string {
  if (tier === "high") return pc.green("[high]  ");
  if (tier === "medium") return pc.cyan("[medium]");
  if (tier === "low") return pc.yellow("[low]   ");
  return pc.dim("[—]     ");
}

export async function listCommand(): Promise<void> {
  const names = await listStoreSkills();
  if (names.length === 0) {
    console.log(pc.dim("no skills in canonical store"));
    return;
  }
  for (const name of names) {
    const parsed = await readSkillMd(storeSkillDir(name));
    console.log(`${tierBadge(parsed.frontmatter.tier)} ${pc.bold(name)}`);
    console.log(`           ${pc.dim(parsed.frontmatter.description)}`);
  }
}
