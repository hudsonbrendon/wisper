import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/** Returns the pending Update if a newer signed release exists, else null.
 *  `check()` does the semver comparison against the endpoint's latest.json. */
export async function checkForUpdate(): Promise<Update | null> {
  return await check();
}

/** Download + install `update`, reporting bytes progress, then relaunch. */
export async function installUpdate(
  update: Update,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress(0, total);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress(downloaded, total);
        break;
      case "Finished":
        onProgress(total, total);
        break;
    }
  });
  await relaunch();
}
