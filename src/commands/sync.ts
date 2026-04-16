import pc from "picocolors";
import { sync } from "../core/mirror.js";
import { getAdapter } from "../core/adapters/index.js";

export async function syncCommand(): Promise<void> {
  const report = await sync();
  if (report.linkCount === 0) {
    console.log(pc.yellow("no mirrors linked yet — run `skillissue link claude-code`"));
    return;
  }

  const promoted = report.actions.filter((a) => a.kind === "promoted");
  const adopted = report.actions.filter((a) => a.kind === "adopted");
  const mirrored = report.actions.filter((a) => a.kind === "mirrored");

  for (const a of promoted) {
    if (a.kind !== "promoted") continue;
    console.log(
      pc.magenta(
        `↑ promoted user edit of "${a.skill}" from ${getAdapter(a.from.agent).displayName} → canonical`
      )
    );
  }
  for (const a of adopted) {
    if (a.kind !== "adopted") continue;
    console.log(
      pc.cyan(
        `+ adopted new skill "${a.skill}" from ${getAdapter(a.from.agent).displayName}`
      )
    );
  }
  console.log(
    pc.green(
      `✓ synced ${report.skillCount} skill(s) → ${report.linkCount} mirror(s) (${mirrored.length} writes)`
    )
  );
}
