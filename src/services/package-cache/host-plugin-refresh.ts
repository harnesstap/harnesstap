import {
  type Dirent,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parsePluginRef } from "../../plugins/claude-installed.js";
import { isSymlinkPath } from "../safe-file-removal.js";
import { isPluginInstallRoot } from "../plugin-source-import.js";
import { hostPluginPackageDir } from "./paths.js";

function skipped(rel: string): boolean {
  return rel === ".git" || rel.startsWith(".git/")
    || rel === "node_modules" || rel.startsWith("node_modules/");
}

function treeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (skipped(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(rel);
    }
  };
  walk(root);
  return files.sort();
}

function sameEntry(left: string, right: string): boolean {
  const leftLink = isSymlinkPath(left);
  if (leftLink || isSymlinkPath(right)) {
    try {
      return leftLink && isSymlinkPath(right) && readlinkSync(left) === readlinkSync(right);
    } catch {
      return false;
    }
  }
  try {
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

function sameTree(left: string, right: string): boolean {
  const leftFiles = treeFiles(left);
  const rightFiles = treeFiles(right);
  if (leftFiles.length !== rightFiles.length) return false;
  return leftFiles.every(
    (path, index) => path === rightFiles[index] && sameEntry(join(left, path), join(right, path)),
  );
}

/**
 * A marketplace can change a plugin without bumping its version. The package
 * cache keys plugins by version, so an update from the marketplace refreshes
 * the cached copy of that same version; the next apply then brings the new
 * content into the host plugin folder (keeping files the user added or edited
 * there). Only HarnessTap's own package cache is replaced here.
 *
 * Returns true when the cached copy was refreshed.
 */
export function refreshCachedHostPluginVersion(input: {
  harnesstapDir: string;
  originRef: string;
  version: string;
  sourceInstallRoot: string;
}): boolean {
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace || !input.version.trim()) return false;
  const canonical = hostPluginPackageDir(input.harnesstapDir, marketplace, name, input.version);
  if (canonical === input.sourceInstallRoot) return false;
  if (!existsSync(canonical) || !isPluginInstallRoot(canonical)) return false;
  if (!isPluginInstallRoot(input.sourceInstallRoot)) return false;
  if (sameTree(input.sourceInstallRoot, canonical)) return false;
  const staging = join(dirname(canonical), `.refresh-${process.pid}-${Date.now()}`);
  rmSync(staging, { recursive: true, force: true });
  cpSync(input.sourceInstallRoot, staging, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    filter: (path) => !skipped(relative(input.sourceInstallRoot, path).split(sep).join("/")),
  });
  const previous = `${staging}-old`;
  renameSync(canonical, previous);
  renameSync(staging, canonical);
  rmSync(previous, { recursive: true, force: true });
  return true;
}
