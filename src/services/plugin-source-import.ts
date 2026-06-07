import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import matter from "gray-matter";
import type {
  ResourceCreateInput,
  AgentMetadata,
  ImportedResourceProvenance,
  ImportedSourceKind,
  ImportedSnapshotMetadata,
  PluginSourceScanResult,
  RuleMetadata,
} from "../types.js";

interface PluginManifest {
  name?: string;
  version?: string;
}

interface MarketplacePluginEntry {
  path?: string;
}

interface MarketplaceManifest {
  name?: string;
  plugins?: MarketplacePluginEntry[];
}

interface ValidatedPluginManifest {
  name: string;
  version?: string;
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
  return version ? { name, version } : { name };
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
    if (typeof entry?.path !== "string") {
      throw new Error(`Marketplace entry path must be a string: ${manifestPath}`);
    }
    const path = normalizeMarketplaceEntryPath(entry.path);
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

function resolvePluginRoot(sourcePath: string): {
  rootPath: string;
  manifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
  manifest: ValidatedPluginManifest;
} {
  const cursorManifestPath = join(sourcePath, ".cursor-plugin", "plugin.json");
  const claudeManifestPath = join(sourcePath, ".claude-plugin", "plugin.json");

  if (existsSync(cursorManifestPath)) {
    const manifest = validatePluginManifest(
      readRequiredJson<PluginManifest>(cursorManifestPath, "plugin manifest"),
      cursorManifestPath,
    );
    return {
      rootPath: sourcePath,
      manifestPath: cursorManifestPath,
      sourcePluginKind: "cursor-plugin",
      manifest,
    };
  }

  if (existsSync(claudeManifestPath)) {
    const manifest = validatePluginManifest(
      readRequiredJson<PluginManifest>(claudeManifestPath, "plugin manifest"),
      claudeManifestPath,
    );
    return {
      rootPath: sourcePath,
      manifestPath: claudeManifestPath,
      sourcePluginKind: "claude-plugin",
      manifest,
    };
  }

  throw new Error(`Unsupported plugin source layout: ${sourcePath}`);
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

function scanSkills(rootPath: string, metadata: {
  importedAt: string;
  sourceKind: ImportedSourceKind;
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  sourcePluginKind: PluginSourceRootKind;
}): ResourceInput[] {
  const skillsDir = join(rootPath, "skills");
  if (!isDirectory(skillsDir)) return [];

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
        scripts: [],
        references: [],
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
    if (!entry.endsWith(".md")) continue;
    const agentPath = join(agentsDir, entry);
    const raw = readText(agentPath);
    if (!raw) continue;

    const parsed = parseFrontmatter(agentPath, raw);
    const provenance = buildProvenance({
      ...metadata,
      relativePath: relativePath(rootPath, agentPath),
    });
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

function scanPluginRoot(
  sourcePath: string,
  opts?: {
    sourceKind?: ImportedSourceKind;
    sourceLabel?: string;
    marketplaceName?: string;
    marketplaceManifestPath?: string;
  },
): PluginSourceScanResult {
  const { rootPath, manifestPath, sourcePluginKind, manifest } =
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
    ...scanSkills(rootPath, {
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
