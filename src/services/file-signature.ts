import { statSync } from "node:fs";

/** mtime and size token. `missing` when the path cannot be stat'd. */
export function fileSignature(path: string): string {
  try {
    const stat = statSync(path);
    const kind = stat.isDirectory() ? "d" : "f";
    return `${stat.mtimeMs}:${stat.size}:${kind}`;
  } catch {
    return "missing";
  }
}
