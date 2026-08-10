import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** Plugin tree inlined for Claude marketplace materialization. */
export interface EmbeddedPluginTree {
  ref: string;
  version_constraint: string;
  /** Logical directory key for imports that are not `./...` project-relative refs. */
  root: string;
  /** Paths relative to the plugin root, POSIX-style separators. */
  files: Record<string, string>;
}

/** Relative path under plugin root (`./`-style prefixes stripped). */
function stripProjectRelativePrefix(ref: string): string {
  if (ref.startsWith("./")) return ref.slice(2);
  if (ref.startsWith(".\\")) return ref.slice(2).replace(/\\/g, "/");
  return ref;
}

/**
 * Recursively read text files under a plugin install directory into a flat map keyed by POSIX paths
 * relative to `pluginRootAbs`.
 */
export function collectEmbeddedPluginFiles(pluginRootAbs: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(absDir: string): void {
    if (!existsSync(absDir)) return;
    for (const name of readdirSync(absDir)) {
      const fp = join(absDir, name);
      const st = statSync(fp);
      if (st.isDirectory()) {
        walk(fp);
      } else if (st.isFile()) {
        const relRaw = relative(pluginRootAbs, fp);
        if (relRaw.startsWith("..") || relRaw === "") continue;
        const relPosix = relRaw.split("\\").join("/");
        out[relPosix] = readFileSync(fp, "utf-8");
      }
    }
  }
  walk(pluginRootAbs);
  return out;
}

function embeddedMaterializeBase(targetDir: string, entry: EmbeddedPluginTree): string {
  if (entry.ref.startsWith("./") || entry.ref.startsWith(".\\")) {
    return join(targetDir, stripProjectRelativePrefix(entry.ref));
  }
  return join(targetDir, "plugins", entry.root);
}

/** Write inlined plugin trees from a package to disk under `targetDir`. */
export function writeEmbeddedPluginsOnImport(
  targetDir: string,
  embedded: EmbeddedPluginTree[],
): void {
  for (const entry of embedded) {
    const base = embeddedMaterializeBase(targetDir, entry);
    for (const [rel, content] of Object.entries(entry.files)) {
      const parts = rel.split(/[/\\]/).filter(Boolean);
      const fp = join(base, ...parts);
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, content, "utf-8");
    }
  }
}
