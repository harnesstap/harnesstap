import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import matter from "gray-matter";
import { parse as parseToml } from "smol-toml";
import { normalizeAgentInput } from "./agent-bridge.js";
import { collectHookEntries } from "./hook-serialization.js";
import { listSkillAuxiliaryFiles } from "./skill-auxiliary.js";
import type {
  ResourceCreateInput,
  AgentMetadata,
  HookMetadata,
  ImportedResourceProvenance,
  ImportedSourceKind,
  ImportedSnapshotMetadata,
  PluginSourceScanResult,
  RuleMetadata,
} from "../types.js";

interface PluginManifest {
  name?: string;
  version?: string;
  commands?: string;
  hooks?: string;
  skills?: string;
}

interface MarketplacePluginEntry {
  path?: string;
  source?: string;
}

interface MarketplaceManifest {
  name?: string;
  plugins?: MarketplacePluginEntry[];
}

interface ValidatedPluginManifest {
  name: string;
  version?: string;
  commands?: string;
  hooks?: string;
  skills?: string;
}

interface PluginHooksConfig {
  hooks?: Record<string, unknown[]>;
}

interface PluginHookEntry {
  type?: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  matcher?: string;
  statusMessage?: string;
  hooks?: PluginHookEntry[];
}

interface PluginCommandToml {
  description?: string;
  prompt?: string;
}

interface ValidatedMarketplacePluginEntry {
  path: string;
}

interface ValidatedMarketplaceManifest {
  name: string;
  plugins: ValidatedMarketplacePluginEntry[];
}

type ResourceInput = ResourceCreateInput;
type PluginSourceRootKind = Exclude<ImportedSourceKind, "marketplace">;

interface PluginManifestCandidate {
  relativeManifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
}

interface ListedPluginManifest {
  manifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
  manifest: ValidatedPluginManifest;
}

const PLUGIN_MANIFEST_CANDIDATES: PluginManifestCandidate[] = [
  {
    relativeManifestPath: ".cursor-plugin/plugin.json",
    sourcePluginKind: "cursor-plugin",
  },
  {
    relativeManifestPath: ".claude-plugin/plugin.json",
    sourcePluginKind: "claude-plugin",
  },
  {
    relativeManifestPath: ".codex-plugin/plugin.json",
    sourcePluginKind: "codex-plugin",
  },
  {
    relativeManifestPath: ".github/plugin/plugin.json",
    sourcePluginKind: "copilot-plugin",
  },
];

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function relativePath(rootPath: string, filePath: string): string {
  return normalizePath(relative(rootPath, filePath));
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readRequiredJson<T>(filePath: string, label: string): T {
  const value = readJson<T>(filePath);
  if (value !== null) return value;
  throw new Error(`Malformed ${label}: ${filePath}`);
}

function normalizeMarketplaceEntryPath(path: string): string {
  return path.trim().replaceAll("\\", "/");
}

function validatePluginManifest(
  manifest: PluginManifest,
  manifestPath: string,
): ValidatedPluginManifest {
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new Error(`Invalid plugin manifest: ${manifestPath}`);
  }
  if (
    manifest.version !== undefined &&
    typeof manifest.version !== "string"
  ) {
    throw new Error(`Invalid plugin manifest: ${manifestPath}`);
  }

  const name = manifest.name.trim();
  const version = manifest.version?.trim();
  const commands =
    typeof manifest.commands === "string" && manifest.commands.trim().length > 0
      ? manifest.commands.trim()
      : undefined;
  const hooks =
    typeof manifest.hooks === "string" && manifest.hooks.trim().length > 0
      ? manifest.hooks.trim()
      : undefined;
  const skills =
    typeof manifest.skills === "string" && manifest.skills.trim().length > 0
      ? manifest.skills.trim()
      : undefined;
  return version
    ? { name, version, commands, hooks, skills }
    : { name, commands, hooks, skills };
}

function validateMarketplaceManifest(
  manifest: MarketplaceManifest,
  manifestPath: string,
): ValidatedMarketplaceManifest {
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new Error(`Invalid marketplace manifest: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    throw new Error(`Invalid marketplace manifest: ${manifestPath}`);
  }

  const plugins = manifest.plugins.map((entry) => {
    const rawPath = entry?.path ?? entry?.source;
    if (typeof rawPath !== "string") {
      throw new Error(`Marketplace entry path must be a string: ${manifestPath}`);
    }
    const path = normalizeMarketplaceEntryPath(rawPath);
    if (path.length === 0) {
      throw new Error(`Marketplace entry path must be a string: ${manifestPath}`);
    }
    return { path };
  });

  return {
    name: manifest.name.trim(),
    plugins,
  };
}

function readText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function listDir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function parseFrontmatter(filePath: string, content: string): {
  data: Record<string, unknown>;
  content: string;
} {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    throw new Error(`Malformed resource frontmatter: ${filePath}`);
  }
  if (content.startsWith("---") && parsed.content === content) {
    throw new Error(`Malformed resource frontmatter: ${filePath}`);
  }
  return {
    data: parsed.data as Record<string, unknown>,
    content: parsed.content.trim(),
  };
}

function assertSafeImportedResourceName(name: string, filePath: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    isAbsolute(trimmed)
  ) {
    throw new Error(`Invalid imported resource name in ${filePath}: ${name}`);
  }
  return trimmed;
}

function listPluginManifests(sourcePath: string): ListedPluginManifest[] {
  const manifests: ListedPluginManifest[] = [];

  for (const candidate of PLUGIN_MANIFEST_CANDIDATES) {
    const manifestPath = join(sourcePath, candidate.relativeManifestPath);
    if (!existsSync(manifestPath)) continue;

    const manifest = validatePluginManifest(
      readRequiredJson<PluginManifest>(manifestPath, "plugin manifest"),
      manifestPath,
    );
    manifests.push({
      manifestPath,
      sourcePluginKind: candidate.sourcePluginKind,
      manifest,
    });
  }

  return manifests;
}

function resolvePluginRoot(sourcePath: string): {
  rootPath: string;
  manifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
  manifest: ValidatedPluginManifest;
  allManifests: ListedPluginManifest[];
} {
  const allManifests = listPluginManifests(sourcePath);
  if (allManifests.length === 0) {
    throw new Error(`Unsupported plugin source layout: ${sourcePath}`);
  }

  const primary = allManifests[0];
  if (!primary) {
    throw new Error(`Unsupported plugin source layout: ${sourcePath}`);
  }
  return {
    rootPath: sourcePath,
    manifestPath: primary.manifestPath,
    sourcePluginKind: primary.sourcePluginKind,
    manifest: primary.manifest,
    allManifests,
  };
}

export function readPluginVersionFromInstallRoot(
  installRoot: string,
): string | undefined {
  try {
    return resolvePluginRoot(installRoot).manifest.version;
  } catch {
    return undefined;
  }
}

function buildProvenance(input: {
  importedAt: string;
  relativePath: string;
  sourceKind: ImportedSourceKind;
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  sourcePluginKind: PluginSourceRootKind;
}): ImportedResourceProvenance {
  return {
    source_kind: input.sourceKind,
    source_label: input.sourceLabel,
    plugin_name: input.pluginName,
    plugin_version: input.pluginVersion,
    source_plugin_kind: input.sourcePluginKind,
    relative_path: input.relativePath,
    imported_at: input.importedAt,
  };
}

function scanSkills(
  rootPath: string,
  skillsDir: string | null,
  metadata: {
  importedAt: string;
  sourceKind: ImportedSourceKind;
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  sourcePluginKind: PluginSourceRootKind;
},
): ResourceInput[] {
  if (!skillsDir) return [];

  const resources: ResourceInput[] = [];
  for (const entry of listDir(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    const skillPath = join(skillDir, "SKILL.md");
    const raw = readText(skillPath);
    if (!isDirectory(skillDir) || !raw) continue;

    const parsed = parseFrontmatter(skillPath, raw);
    const provenance = buildProvenance({
      ...metadata,
      relativePath: relativePath(rootPath, skillPath),
    });
    const { scripts, references } = listSkillAuxiliaryFiles(skillDir);

    resources.push({
      type: "skill",
      name: assertSafeImportedResourceName(
        (parsed.data["name"] as string) || entry,
        skillPath,
      ),
      description: (parsed.data["description"] as string) || "",
      content: parsed.content,
      source: provenance.relative_path,
      metadata: {
        scripts,
        references,
        imported_from: provenance,
      },
    });
  }

  return resources;
}

function scanAgents(rootPath: string, metadata: {
  importedAt: string;
  sourceKind: ImportedSourceKind;
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  sourcePluginKind: PluginSourceRootKind;
}): ResourceInput[] {
  const agentsDir = join(rootPath, "agents");
  if (!isDirectory(agentsDir)) return [];

  const resources: ResourceInput[] = [];
  for (const entry of listDir(agentsDir)) {
    if (!entry.endsWith(".md") && !entry.endsWith(".toml")) continue;
    const agentPath = join(agentsDir, entry);
    const raw = readText(agentPath);
    if (!raw) continue;

    const provenance = buildProvenance({
      ...metadata,
      relativePath: relativePath(rootPath, agentPath),
    });

    const normalized = normalizeAgentInput({
      name: entry.replace(/\.(md|toml)$/, ""),
      content: raw,
      source: provenance.relative_path,
    });

    if (normalized) {
      const agentMetadata: AgentMetadata & { imported_from: ImportedResourceProvenance } = {
        ...normalized.metadata,
        imported_from: provenance,
      };
      resources.push({
        type: "agent",
        name: assertSafeImportedResourceName(normalized.name, agentPath),
        description: normalized.description,
        content: normalized.content,
        source: provenance.relative_path,
        metadata: agentMetadata,
      });
      continue;
    }

    if (!entry.endsWith(".md")) continue;

    const parsed = parseFrontmatter(agentPath, raw);
    const agentMetadata: AgentMetadata & { imported_from: ImportedResourceProvenance } = {
      imported_from: provenance,
    };

    if (typeof parsed.data["model"] === "string") {
      agentMetadata.model = parsed.data["model"];
    }
    if (typeof parsed.data["reasoning_effort"] === "string") {
      agentMetadata.reasoning_effort = parsed.data["reasoning_effort"];
    }
    if (typeof parsed.data["sandbox_mode"] === "string") {
      agentMetadata.sandbox_mode = parsed.data["sandbox_mode"];
    }

    resources.push({
      type: "agent",
      name: assertSafeImportedResourceName(
        (parsed.data["name"] as string) || entry.replace(/\.md$/, ""),
        agentPath,
      ),
      description: (parsed.data["description"] as string) || "",
      content: parsed.content,
      source: provenance.relative_path,
      metadata: agentMetadata,
    });
  }

  return resources;
}

function scanRules(rootPath: string, metadata: {
  importedAt: string;
  sourceKind: ImportedSourceKind;
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  sourcePluginKind: PluginSourceRootKind;
}): ResourceInput[] {
  const rulesDir = join(rootPath, "rules");
  if (!isDirectory(rulesDir)) return [];

  const resources: ResourceInput[] = [];
  for (const entry of listDir(rulesDir)) {
    if (!entry.endsWith(".md") && !entry.endsWith(".mdc")) continue;
    const rulePath = join(rulesDir, entry);
    const raw = readText(rulePath);
    if (!raw) continue;

    const parsed = parseFrontmatter(rulePath, raw);
    const provenance = buildProvenance({
      ...metadata,
      relativePath: relativePath(rootPath, rulePath),
    });
    const alwaysApply = parsed.data["alwaysApply"] === true;
    const globs = Array.isArray(parsed.data["paths"])
      ? (parsed.data["paths"] as string[])
      : parsed.data["globs"]
        ? typeof parsed.data["globs"] === "string"
          ? (parsed.data["globs"] as string)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : (parsed.data["globs"] as string[])
        : [];
    const defaultAlwaysApply =
      metadata.sourcePluginKind === "claude-plugin" && globs.length === 0;
    const ruleMetadata: RuleMetadata & { imported_from: ImportedResourceProvenance } = {
      globs,
      always_apply: alwaysApply || defaultAlwaysApply,
      imported_from: provenance,
    };

    resources.push({
      type: "rule",
      name: assertSafeImportedResourceName(
        entry.replace(/\.(md|mdc)$/, ""),
        rulePath,
      ),
      description: (parsed.data["description"] as string) || "",
      content: parsed.content,
      source: provenance.relative_path,
      metadata: ruleMetadata,
    });
  }

  return resources;
}

function resolveCommandsDir(
  rootPath: string,
  manifest: ValidatedPluginManifest,
): string | null {
  const commandsDir = manifest.commands
    ? join(rootPath, manifest.commands)
    : join(rootPath, "commands");
  return isDirectory(commandsDir) ? commandsDir : null;
}

function resolveSkillsDir(
  rootPath: string,
  manifest: ValidatedPluginManifest,
): string | null {
  const skillsDir = manifest.skills
    ? join(rootPath, manifest.skills)
    : join(rootPath, "skills");
  return isDirectory(skillsDir) ? skillsDir : null;
}

function resolveHooksPath(
  rootPath: string,
  manifest: ValidatedPluginManifest,
): string | null {
  if (manifest.hooks) {
    const candidate = join(rootPath, manifest.hooks);
    if (existsSync(candidate)) {
      if (isDirectory(candidate)) {
        const hooksJson = join(candidate, "hooks.json");
        if (existsSync(hooksJson)) return hooksJson;
        const copilotHooks = join(candidate, "copilot-hooks.json");
        if (existsSync(copilotHooks)) return copilotHooks;
      } else {
        return candidate;
      }
    }
  }

  const defaultHooks = join(rootPath, "hooks/hooks.json");
  if (existsSync(defaultHooks)) return defaultHooks;

  const copilotHooks = join(rootPath, "hooks/copilot-hooks.json");
  if (existsSync(copilotHooks)) return copilotHooks;

  return null;
}

function scanCommands(
  rootPath: string,
  manifest: ValidatedPluginManifest,
  metadata: {
    importedAt: string;
    sourceKind: ImportedSourceKind;
    sourceLabel: string;
    pluginName: string;
    pluginVersion?: string;
    sourcePluginKind: PluginSourceRootKind;
  },
): ResourceInput[] {
  const commandsDir = resolveCommandsDir(rootPath, manifest);
  if (!commandsDir) return [];

  const resources: ResourceInput[] = [];
  for (const entry of listDir(commandsDir)) {
    const commandPath = join(commandsDir, entry);
    const name = entry.replace(/\.(md|toml)$/, "");
    if (name === entry) continue;

    const provenance = buildProvenance({
      ...metadata,
      relativePath: relativePath(rootPath, commandPath),
    });

    if (entry.endsWith(".md")) {
      const raw = readText(commandPath);
      if (!raw) continue;

      resources.push({
        type: "command",
        name: assertSafeImportedResourceName(name, commandPath),
        description: "",
        content: raw.trim(),
        source: provenance.relative_path,
        metadata: {
          imported_from: provenance,
        },
      });
      continue;
    }

    if (!entry.endsWith(".toml")) continue;

    const raw = readText(commandPath);
    if (!raw) continue;

    let parsed: PluginCommandToml;
    try {
      parsed = parseToml(raw) as PluginCommandToml;
    } catch {
      throw new Error(`Malformed command TOML: ${commandPath}`);
    }

    const description =
      typeof parsed.description === "string" ? parsed.description : "";
    const content =
      typeof parsed.prompt === "string"
        ? parsed.prompt
        : raw.trim();

    resources.push({
      type: "command",
      name: assertSafeImportedResourceName(name, commandPath),
      description,
      content,
      source: provenance.relative_path,
      metadata: {
        format: "toml",
        imported_from: provenance,
      },
    });
  }

  return resources;
}

function scanHooks(
  rootPath: string,
  manifest: ValidatedPluginManifest,
  metadata: {
    importedAt: string;
    sourceKind: ImportedSourceKind;
    sourceLabel: string;
    pluginName: string;
    pluginVersion?: string;
    sourcePluginKind: PluginSourceRootKind;
  },
): ResourceInput[] {
  const hooksPath = resolveHooksPath(rootPath, manifest);
  if (!hooksPath) return [];

  const config = readJson<PluginHooksConfig>(hooksPath);
  if (!config?.hooks) return [];

  const resources: ResourceInput[] = [];
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;

    const hookEntries: Array<{ entry: PluginHookEntry; matcher?: string }> = [];
    collectHookEntries(entries, undefined, hookEntries);

    hookEntries.forEach(({ entry, matcher }, index) => {
      const provenance = buildProvenance({
        ...metadata,
        relativePath: relativePath(rootPath, hooksPath),
      });
      const hookMetadata: HookMetadata & {
        imported_from: ImportedResourceProvenance;
      } = {
        event,
        script: entry.command ?? "",
        imported_from: provenance,
        hook_entry: entry as Record<string, unknown>,
      };

      if (typeof entry.commandWindows === "string") {
        hookMetadata.commandWindows = entry.commandWindows;
      }
      if (typeof entry.timeout === "number") {
        hookMetadata.timeout = entry.timeout;
      }
      if (typeof matcher === "string" && matcher.length > 0) {
        hookMetadata.matcher = matcher;
      }

      const hookName =
        typeof matcher === "string" && matcher.length > 0
          ? `${event}-${matcher.replace(/[^a-zA-Z0-9_-]+/g, "-")}`
          : `${event}-${index + 1}`;

      resources.push({
        type: "hook",
        name: assertSafeImportedResourceName(hookName, hooksPath),
        description: typeof entry.statusMessage === "string" ? entry.statusMessage : "",
        content: entry.command ?? "",
        source: provenance.relative_path,
        metadata: hookMetadata,
      });
    });
  }

  return resources;
}

function scanAllManifestHooks(
  rootPath: string,
  manifests: ListedPluginManifest[],
  metadata: {
    importedAt: string;
    sourceKind: ImportedSourceKind;
    sourceLabel: string;
    pluginName: string;
    pluginVersion?: string;
    sourcePluginKind: PluginSourceRootKind;
  },
): ResourceInput[] {
  const seenSources = new Set<string>();
  const resources: ResourceInput[] = [];

  for (const { manifest } of manifests) {
    for (const hook of scanHooks(rootPath, manifest, metadata)) {
      if (seenSources.has(hook.source)) continue;
      seenSources.add(hook.source);
      resources.push(hook);
    }
  }

  return resources;
}

function scanPluginRoot(
  sourcePath: string,
  opts?: {
    sourceKind?: ImportedSourceKind;
    sourceLabel?: string;
    marketplaceName?: string;
    marketplaceManifestPath?: string;
  },
): PluginSourceScanResult {
  const { rootPath, manifestPath, sourcePluginKind, manifest, allManifests } =
    resolvePluginRoot(sourcePath);
  const importedAt = new Date().toISOString();
  const pluginName = manifest.name;
  const sourceKind = opts?.sourceKind ?? sourcePluginKind;
  const sourceLabel = opts?.sourceLabel ?? pluginName;
  const pluginVersion = manifest.version;
  const metadata: ImportedSnapshotMetadata = {
    manifest_path: manifestPath,
    root_path: rootPath,
    source_plugin_kind: sourcePluginKind,
  };

  if (opts?.marketplaceName) {
    metadata["marketplace_name"] = opts.marketplaceName;
  }
  if (opts?.marketplaceManifestPath) {
    metadata["marketplace_manifest_path"] = opts.marketplaceManifestPath;
  }

  const resources = [
    ...scanSkills(rootPath, resolveSkillsDir(rootPath, manifest), {
      importedAt,
      sourceKind,
      sourceLabel,
      pluginName,
      pluginVersion,
      sourcePluginKind,
    }),
    ...scanAgents(rootPath, {
      importedAt,
      sourceKind,
      sourceLabel,
      pluginName,
      pluginVersion,
      sourcePluginKind,
    }),
    ...scanRules(rootPath, {
      importedAt,
      sourceKind,
      sourceLabel,
      pluginName,
      pluginVersion,
      sourcePluginKind,
    }),
    ...scanCommands(rootPath, manifest, {
      importedAt,
      sourceKind,
      sourceLabel,
      pluginName,
      pluginVersion,
      sourcePluginKind,
    }),
    ...scanAllManifestHooks(rootPath, allManifests, {
      importedAt,
      sourceKind,
      sourceLabel,
      pluginName,
      pluginVersion,
      sourcePluginKind,
    }),
  ];

  if (resources.length === 0) {
    throw new Error(`No supported plugin resources found in ${rootPath}`);
  }

  return {
    source_kind: sourceKind,
    source_label: sourceLabel,
    plugin_name: pluginName,
    plugin_version: pluginVersion,
    metadata,
    resources,
  };
}

export async function scanPluginSourceForMerge(
  sourcePath: string,
): Promise<PluginSourceScanResult[]> {
  try {
    return await scanPluginSource(sourcePath);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("No supported plugin resources found in")
    ) {
      return [];
    }
    throw error;
  }
}

export async function scanPluginSource(
  sourcePath: string,
): Promise<PluginSourceScanResult[]> {
  if (existsSync(sourcePath) && isDirectory(sourcePath)) {
    return [scanPluginRoot(sourcePath)];
  }

  if (basename(sourcePath) !== "marketplace.json") {
    throw new Error(`Unsupported plugin source layout: ${sourcePath}`);
  }

  const manifest = validateMarketplaceManifest(
    readRequiredJson<MarketplaceManifest>(sourcePath, "marketplace manifest"),
    sourcePath,
  );

  const marketplaceName = manifest.name;
  const manifestDir = dirname(sourcePath);

  return manifest.plugins.map((entry) => {
    return scanPluginRoot(join(manifestDir, entry.path), {
      sourceKind: "marketplace",
      sourceLabel: marketplaceName,
      marketplaceName,
      marketplaceManifestPath: sourcePath,
    });
  });
}
