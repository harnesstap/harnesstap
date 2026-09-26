import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PluginResourceMode } from "./plugin-resource-mode.js";

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function replaceExisting(dest: string): void {
  if (existsSync(dest) || isSymlink(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
}

function cloneTree(source: string, dest: string): void {
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(source)) {
      cloneTree(join(source, entry), join(dest, entry));
    }
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  try {
    copyFileSync(source, dest, constants.COPYFILE_FICLONE);
  } catch {
    copyFileSync(source, dest);
  }
}

/**
 * Materialize `source` at `dest` as a symlink, independent copy, or
 * copy-on-write clone (`fs.copyFile` `COPYFILE_FICLONE`, falling back to copy).
 */
export function materializeFromSource(
  dest: string,
  source: string,
  mode: PluginResourceMode,
): void {
  mkdirSync(dirname(dest), { recursive: true });
  replaceExisting(dest);
  switch (mode) {
    case "copy":
      cpSync(source, dest, { recursive: true });
      return;
    case "symlink":
      symlinkSync(resolve(source), dest);
      return;
    case "clone":
      cloneTree(source, dest);
      return;
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unsupported plugin resource mode: ${exhaustive}`);
    }
  }
}

export function replaceWithRelativeSymlink(dest: string, target: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  replaceExisting(dest);
  symlinkSync(target, dest);
}
