import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessSurface {
  harness: string;
  path: string;
  category: string;
  message: string;
}

export interface MirrorSurfaceWarning {
  harness: string;
  path: string;
  category: string;
  message: string;
  alias_harnesses: string[];
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isOpencodeServerPluginFile(file: string): boolean {
  return file.endsWith(".mjs") || file.endsWith(".js");
}

function isOpencodePluginConfigEntry(entry: string): boolean {
  if (isOpencodeServerPluginFile(entry)) return true;
  return entry.includes("@") || entry.includes("git+") || entry.startsWith(".");
}

/**
 * Harness-specific surfaces that may exist on disk but are not emitted to every
 * alias harness when mirroring canonical resources.
 */
export function detectHarnessSurfaces(projectRoot: string): HarnessSurface[] {
  const surfaces: HarnessSurface[] = [];

  const opencodePluginsDir = join(projectRoot, ".opencode", "plugins");
  for (const file of listFiles(opencodePluginsDir)) {
    if (!isOpencodeServerPluginFile(file)) continue;
    surfaces.push({
      harness: "opencode",
      path: `.opencode/plugins/${file}`,
      category: "opencode-server-plugin",
      message:
        "OpenCode server plugins must stay registered in opencode.json on OpenCode.",
    });
  }

  const opencodeConfig = readJson(join(projectRoot, "opencode.json"));
  const pluginEntries = opencodeConfig?.["plugin"];
  if (Array.isArray(pluginEntries)) {
    for (const entry of pluginEntries) {
      if (typeof entry !== "string" || !isOpencodePluginConfigEntry(entry)) {
        continue;
      }
      const normalized = entry.replace(/^\.\//, "");
      if (surfaces.some((surface) => surface.path === normalized)) continue;
      surfaces.push({
        harness: "opencode",
        path: normalized,
        category: "opencode-server-plugin",
        message:
          "OpenCode server plugins must stay registered in opencode.json on OpenCode.",
      });
    }
  }

  if (existsSync(join(projectRoot, "pi-extension"))) {
    surfaces.push({
      harness: "pi",
      path: "pi-extension/",
      category: "pi-extension",
      message: "Pi extensions install through the Pi CLI, not mirror.",
    });
  }

  if (existsSync(join(projectRoot, "gemini-extension.json"))) {
    surfaces.push({
      harness: "gemini-cli",
      path: "gemini-extension.json",
      category: "gemini-extension",
      message:
        "Gemini extension manifests apply to Gemini CLI and Antigravity only.",
    });
  }

  const hooksDir = join(projectRoot, "hooks");
  for (const file of listFiles(hooksDir)) {
    if (!file.includes("statusline")) continue;
    surfaces.push({
      harness: "claude-code",
      path: `hooks/${file}`,
      category: "statusline-hook",
      message: "Statusline hooks are host-specific terminal integrations.",
    });
  }

  return surfaces;
}

export function mirrorSurfaceWarnings(
  surfaces: HarnessSurface[],
  aliasHarnesses: string[],
): MirrorSurfaceWarning[] {
  const warnings: MirrorSurfaceWarning[] = [];

  for (const surface of surfaces) {
    const missingAliases = aliasHarnesses.filter(
      (alias) => alias !== surface.harness,
    );
    if (missingAliases.length === 0) continue;

    warnings.push({
      harness: surface.harness,
      path: surface.path,
      category: surface.category,
      message: surface.message,
      alias_harnesses: missingAliases,
    });
  }

  return warnings;
}
