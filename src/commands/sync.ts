import pc from "picocolors";
import { sync } from "../core/mirror.js";
import type { SyncReport } from "../core/mirror.js";
import { getAdapter } from "../core/adapters/index.js";
import type { AgentKind } from "../core/config.js";
import { count } from "../core/ux/count.js";

function displaySourceLabel(label: string): string {
  if (label === "canonical") return "canonical";
  return getAdapter(label as AgentKind).displayName;
}

export function printSyncReport(report: SyncReport): void {
  if (report.linkCount === 0) {
    console.log(pc.yellow("no mirrors connected yet — run `sks connect claude-code` or `sks connect codex`"));
    return;
  }

  const promoted = report.actions.filter((a) => a.kind === "promoted");
  const adopted = report.actions.filter((a) => a.kind === "adopted");
  const conflicts = report.actions.filter((a) => a.kind === "conflict");
  const mirrored = report.actions.filter((a) => a.kind === "mirrored");

  for (const a of conflicts) {
    if (a.kind !== "conflict") continue;
    const winnerName = a.winnerLabel
      ? a.winnerLabel === "canonical"
        ? "canonical"
        : getAdapter(a.winner.agent).displayName
      : getAdapter(a.winner.agent).displayName;
    const loserNames = a.loserLabels
      ? a.loserLabels
          .map(displaySourceLabel)
          .join(", ")
      : a.losers.map((l) => getAdapter(l.agent).displayName).join(", ");
    const loserCount = a.archivedLoserCount ?? a.losers.length;
    console.log(
      pc.yellow(
        `⚠ conflict on "${a.skill}" — ${winnerName} won (newest mtime); archived ${count(loserCount, "version")} [${loserNames}] to ${a.archive}`
      )
    );
  }
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
  for (const a of report.actions) {
    if (a.kind !== "always-written") continue;
    const who = getAdapter(a.to.agent).displayName;
    console.log(
      a.removed
        ? pc.dim(`− always-on block removed from ${who} ${a.file}`)
        : pc.blue(`∞ always-on: ${count(a.skills.length, "rule")} → ${who} ${a.file}`)
    );
  }
  for (const f of report.failures ?? []) {
    console.log(pc.red(`✗ could not reconcile "${f.skill}": ${f.error}`));
  }

  const failed = report.failures?.length ?? 0;
  const ok = report.skillCount - failed;
  console.log(
    pc.green(
      `✓ synced ${count(ok, "skill")} → ${count(report.linkCount, "mirror")} (${count(mirrored.length, "write")})` +
        (failed > 0 ? pc.red(` — ${failed} failed`) : "")
    )
  );
}

export async function syncCommand(
  options: { importExisting?: boolean; adoptUntracked?: boolean } = {}
): Promise<void> {
  printSyncReport(
    await sync({
      importExisting: options.importExisting,
      adoptUntracked: options.adoptUntracked,
    })
  );
}
