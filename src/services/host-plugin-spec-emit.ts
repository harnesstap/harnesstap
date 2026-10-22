import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupApSchema } from "./agent-plugins/schema-registry.js";
import { ensurePluginDataDir } from "./plugin-data-dir.js";
import {
  type PluginVarTarget,
  translatePluginVars,
} from "./agent-plugins/plugin-vars.js";

export interface EmittedPluginFile {
  relativePath: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface TranslateEmittedSpecTreeInput {
  layout: "cursor" | "claude-code";
  /** Library plugin name, used when the manifest name is not a safe data-dir name. */
  pluginName: string;
}

const HT_COMMANDS = "com.harnesstap/commands/";
const HT_AGENTS = "com.harnesstap/agents/";
const HT_HOOKS = "com.harnesstap/hooks/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function specManifest(files: readonly EmittedPluginFile[]): Record<string, unknown> | undefined {
  const manifest = files.find(
    (file) => file.relativePath === "plugin.json" && file.encoding !== "base64",
  );
  if (!manifest) return undefined;
  try {
    const parsed = JSON.parse(manifest.content) as unknown;
    if (!isRecord(parsed) || typeof parsed.$schema !== "string") return undefined;
    if (lookupApSchema(parsed.$schema).kind !== "current") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function translateJson(value: unknown, target: PluginVarTarget, dataDir: string): unknown {
  if (typeof value === "string") {
    return translatePluginVars(value, target, { root: "", dataDir });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => translateJson(entry, target, dataDir));
  }
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      target === "claude-code" &&
      key === "type" &&
      (entry === "streamable-http" || entry === "sse")
    ) {
      next[key] = "http";
      continue;
    }
    next[key] = translateJson(entry, target, dataDir);
  }
  return next;
}

function claudeManifest(spec: Record<string, unknown>): string {
  const author = isRecord(spec.author)
    ? {
        ...(typeof spec.author.name === "string" ? { name: spec.author.name } : {}),
        ...(typeof spec.author.email === "string" ? { email: spec.author.email } : {}),
        ...(typeof spec.author.url === "string" ? { url: spec.author.url } : {}),
      }
    : undefined;
  const keywords = Array.isArray(spec.keywords)
    ? spec.keywords.filter((keyword): keyword is string => typeof keyword === "string")
    : undefined;
  const manifest = {
    ...(typeof spec.name === "string" ? { name: spec.name } : {}),
    ...(typeof spec.version === "string" ? { version: spec.version } : {}),
    ...(typeof spec.description === "string" ? { description: spec.description } : {}),
    ...(author && Object.keys(author).length > 0 ? { author } : {}),
    ...(typeof spec.homepage === "string" ? { homepage: spec.homepage } : {}),
    ...(typeof spec.repository === "string" ? { repository: spec.repository } : {}),
    ...(typeof spec.license === "string" ? { license: spec.license } : {}),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function mirrorPrefix(
  files: EmittedPluginFile[],
  fromPrefix: string,
  toPrefix: string,
): void {
  const additions: EmittedPluginFile[] = [];
  for (const file of files) {
    if (!file.relativePath.startsWith(fromPrefix)) continue;
    const target = `${toPrefix}${file.relativePath.slice(fromPrefix.length)}`;
    if (files.some((existing) => existing.relativePath === target)) continue;
    additions.push({ ...file, relativePath: target });
  }
  files.push(...additions);
}

function dataDirFor(pluginName: string, warnings: string[]): string {
  try {
    const result = ensurePluginDataDir(pluginName);
    if (result.warning) warnings.push(result.warning);
    return result.path;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(message);
    return "";
  }
}

/**
 * Paths a Claude Code emit of an Agent Plugins package writes with bytes of
 * its own (the Claude manifest, `.mcp.json`, mirrored command, agent and hook
 * folders). Empty when the package has no current Agent Plugins manifest.
 */
export function claudeEmitDerivedPaths(
  packageDir: string,
  packageFiles: readonly string[],
): Set<string> {
  const paths = new Set<string>();
  let content: string;
  try {
    content = readFileSync(join(packageDir, "plugin.json"), "utf8");
  } catch {
    return paths;
  }
  if (!specManifest([{ relativePath: "plugin.json", content }])) return paths;
  paths.add(".claude-plugin/plugin.json");
  if (packageFiles.includes("mcp.json")) paths.add(".mcp.json");
  for (const [fromPrefix, toPrefix] of [
    [HT_COMMANDS, "commands/"],
    [HT_AGENTS, "agents/"],
    [HT_HOOKS, "hooks/"],
  ] as const) {
    for (const path of packageFiles) {
      if (path.startsWith(fromPrefix)) paths.add(`${toPrefix}${path.slice(fromPrefix.length)}`);
    }
  }
  return paths;
}

/**
 * Rewrite only the emitted host copy of an Agent Plugins package.
 * The canonical tree on disk is not modified.
 */
export function translateEmittedSpecTree(
  collected: readonly EmittedPluginFile[],
  input: TranslateEmittedSpecTreeInput,
): { files: EmittedPluginFile[]; warnings: string[] } {
  const spec = specManifest(collected);
  if (!spec) {
    return { files: [...collected], warnings: [] };
  }

  const warnings: string[] = [];
  const needsData = collected.some(
    (file) => file.encoding !== "base64" && file.content.includes("${PLUGIN_DATA}"),
  );
  const manifestName = typeof spec.name === "string" ? spec.name : input.pluginName;
  const dataDir = needsData ? dataDirFor(manifestName, warnings) : "";
  const target: PluginVarTarget = input.layout === "cursor" ? "cursor" : "claude-code";
  const files = collected.map((file) => ({ ...file }));

  const mcpIndex = files.findIndex(
    (file) => file.relativePath === "mcp.json" && file.encoding !== "base64",
  );
  if (mcpIndex >= 0) {
    const mcp = files[mcpIndex];
    if (mcp) {
      try {
        const parsed = JSON.parse(mcp.content) as unknown;
        const translated = translateJson(parsed, target, dataDir);
        const content = `${JSON.stringify(translated, null, 2)}\n`;
        if (input.layout === "claude-code") {
          files.splice(mcpIndex, 1);
          const existing = files.findIndex((file) => file.relativePath === ".mcp.json");
          const next = { relativePath: ".mcp.json", content };
          if (existing >= 0) {
            files[existing] = next;
          } else {
            files.push(next);
          }
          if (JSON.stringify(parsed).includes('"sse"')) {
            warnings.push(
              "sse MCP servers are written as Claude HTTP in the emitted .mcp.json.",
            );
          }
        } else {
          files[mcpIndex] = { ...mcp, content };
        }
      } catch {
        warnings.push("mcp.json could not be translated for this harness and was copied as-is.");
      }
    }
  }

  if (input.layout === "claude-code") {
    const synthesized = {
      relativePath: ".claude-plugin/plugin.json",
      content: claudeManifest(spec),
    };
    const overlay = files.findIndex((file) => file.relativePath === synthesized.relativePath);
    if (overlay >= 0) {
      files[overlay] = synthesized;
    } else {
      files.push(synthesized);
    }
    mirrorPrefix(files, HT_COMMANDS, "commands/");
    mirrorPrefix(files, HT_AGENTS, "agents/");
    mirrorPrefix(files, HT_HOOKS, "hooks/");
  }

  return { files, warnings };
}
