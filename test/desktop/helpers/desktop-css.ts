import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const stylesRoot = join(import.meta.dir, "../../../apps/desktop/src");
const indexPath = join(stylesRoot, "styles.css");

const relativeImportPattern = /^\s*@import\s+["'](\.{1,2}\/[^"']+)["']\s*;?\s*$/;

function inlineImports(filePath: string, seen: Set<string>): string {
  const absolute = resolve(filePath);
  if (seen.has(absolute)) return "";
  seen.add(absolute);
  const source = readFileSync(absolute, "utf8");
  return source
    .split("\n")
    .map((line) => {
      const match = relativeImportPattern.exec(line);
      if (!match?.[1]) return line;
      return inlineImports(join(dirname(absolute), match[1]), seen);
    })
    .join("\n");
}

/**
 * Reads `apps/desktop/src/styles.css` with every relative `@import` inlined
 * recursively, in import order. Bare package imports (`tailwindcss`,
 * `tw-animate-css`) are left as-is.
 */
export function readDesktopCss(): string {
  return inlineImports(indexPath, new Set());
}

/**
 * Reads a single stylesheet relative to `apps/desktop/src/styles/`,
 * e.g. `readDesktopCssFile("features/library.css")`.
 */
export function readDesktopCssFile(relPath: string): string {
  return readFileSync(join(stylesRoot, "styles", relPath), "utf8");
}
