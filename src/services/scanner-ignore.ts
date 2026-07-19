import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import picomatch from "picomatch";

export interface ScanIgnoreMatcher {
  ignores(source: string): boolean;
}

interface ScanIgnoreRule {
  include: boolean;
  match: (source: string) => boolean;
}

function candidatePaths(source: string): string[] {
  const paths = [source];
  let currentPath = source;
  let current = dirname(currentPath);

  while (current !== "." && current !== currentPath) {
    paths.push(current);
    currentPath = current;
    current = dirname(currentPath);
  }

  return paths;
}

export function loadScanIgnore(projectRoot: string): ScanIgnoreMatcher {
  const ignorePath = join(projectRoot, ".harnesstapignore");
  if (!existsSync(ignorePath)) {
    return { ignores: () => false };
  }

  const rules: ScanIgnoreRule[] = readFileSync(ignorePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => ({
      include: line.startsWith("!"),
      pattern: line.startsWith("!") ? line.slice(1) : line,
    }))
    .filter((rule) => rule.pattern.length > 0)
    .map((line) => {
      return {
        include: line.include,
        match: picomatch(line.pattern, { dot: true }),
      };
    });

  return {
    ignores(source: string): boolean {
      let ignored = false;
      const paths = candidatePaths(source);

      for (const rule of rules) {
        if (!paths.some((path) => rule.match(path))) continue;
        ignored = !rule.include;
      }

      return ignored;
    },
  };
}
