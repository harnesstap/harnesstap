import { lstatSync, unlinkSync } from "node:fs";

/**
 * Remove one file or link, never what a link points to. Node's `rmSync`
 * follows links: on a link to a folder it throws, and on a link whose target
 * is gone it does nothing, so links HarnessTap reported removed stayed on
 * disk. Folders are refused: callers that remove folders do it on purpose.
 * Returns false when nothing was there.
 */
export function removeFileOrLink(fullPath: string): boolean {
  let isDirectory: boolean;
  try {
    isDirectory = lstatSync(fullPath).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (isDirectory) {
    throw new Error(`Refusing to remove ${fullPath}: it is a folder, not a file or link`);
  }
  unlinkSync(fullPath);
  return true;
}
