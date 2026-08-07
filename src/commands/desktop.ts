import { createDesktopSnapshot } from "../desktop/snapshot.js";

export async function desktopSnapshotCommand(): Promise<void> {
  console.log(JSON.stringify(await createDesktopSnapshot()));
}

