import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ExportBundleEmbeddedPlugin } from "../types.js";

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

function embeddedMaterializeBase(targetDir: string, entry: ExportBundleEmbeddedPlugin): string {
  if (entry.ref.startsWith("./") || entry.ref.startsWith(".\\")) {
    return join(targetDir, stripProjectRelativePrefix(entry.ref));
  }
  return join(targetDir, "plugins", entry.root);
}

/** Write inlined plugin trees from a bundle to disk under `targetDir`. */
export function writeEmbeddedPluginsOnImport(
  targetDir: string,
  embedded: ExportBundleEmbeddedPlugin[],
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
