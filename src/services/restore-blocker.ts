import { lstatSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * What stops `relativePath` (under `rootPath`) from being written back as a
 * file or link: a file, or a link that leads nowhere, where a folder has to
 * be, or a folder where the file goes. Returns the blocking path, relative to
 * `rootPath`, or undefined when the path is free.
 *
 * Nothing in the way is ever removed to make room: the caller skips the path
 * and says so. A link to a folder is fine, like any folder.
 */
export function restoreBlocker(rootPath: string, relativePath: string): string | undefined {
  const root = resolve(rootPath);
  const target = resolve(root, relativePath);
  const parts = relative(root, dirname(target)).split(sep).filter((part) => part.length > 0);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      lstatSync(current);
    } catch {
      // Nothing here, so nothing deeper is in the way either.
      return undefined;
    }
    try {
      if (!statSync(current).isDirectory()) return relative(root, current).split(sep).join("/");
    } catch {
      return relative(root, current).split(sep).join("/");
    }
  }
  try {
    if (lstatSync(target).isDirectory()) return relative(root, target).split(sep).join("/");
  } catch {
    // Free.
  }
  return undefined;
}

/** The skip message for a path that cannot be restored, naming what is in the way. */
export function restoreBlockedMessage(path: string, blocker: string, kind: "file" | "link" = "file"): string {
  const what = kind === "link" ? `the link ${path}` : path;
  const where = blocker === path ? "a folder is at that path" : `${blocker} is in the way`;
  return `Skipped restoring ${what} (${where}). HarnessTap never removes it. Move it away, then run the command again.`;
}

/** One message for several paths held up by the same file. */
export function restoreBlockedGroupMessage(blocker: string, paths: readonly string[]): string {
  return `Skipped restoring ${paths.length} files (${blocker} is in the way): ${paths.join(", ")}. HarnessTap never removes it. Move it away, then run the command again.`;
}
