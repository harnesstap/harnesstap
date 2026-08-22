import { isAbsolute } from "node:path";

export function isInvalidPreviewPath(path: string): boolean {
  if (path.includes("\0")) return true;
  if (isAbsolute(path)) return true;
  return path.split(/[/\\]/).includes("..");
}
