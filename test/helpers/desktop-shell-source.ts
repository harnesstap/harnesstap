import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP_SRC = join(import.meta.dir, "../../apps/desktop/src");

function readDir(dir: string): string {
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

/**
 * The desktop shell is `App.tsx` plus the shell components and state hooks it
 * was decomposed into. Source-text tests that used to lock `App.tsx` alone
 * read this combined text so they keep covering the same behavior.
 */
export function readDesktopShellSource(): string {
  return [
    readFileSync(join(DESKTOP_SRC, "App.tsx"), "utf8"),
    readDir(join(DESKTOP_SRC, "components/shell")),
    readDir(join(DESKTOP_SRC, "state")),
  ].join("\n");
}
