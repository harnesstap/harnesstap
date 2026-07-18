import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import { scanPluginSource } from "../services/plugin-source-import.js";
import type {
  HookMetadata,
  McpServerMetadata,
  PlatformDefinition,
  Resource,
  ResourceCreateInput,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

const GOOSE_CONFIG_FILES = ["config.yaml", "profiles.yaml"] as const;
const GOOSE_LAYER_PLUGIN_NAME = "harnesstap-layer";
const SKIP_WALK_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
]);

interface GooseExtensionEntry {
  type?: string;
  name?: string;
  cmd?: string;
  args?: string[];
  uri?: string;
  envs?: Record<string, string>;
  env_keys?: string[];
  enabled?: boolean;
  timeout?: number;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGooseYaml(content: string): Record<string, unknown> {
  try {
    const doc = parse(content);
    return isRecord(doc) ? doc : {};
  } catch {
    return {};
  }
}

function extensionToMcpMetadata(
  _name: string,
  entry: GooseExtensionEntry,
): McpServerMetadata | null {
  const type = entry.type ?? "stdio";
  if (type === "builtin" || type === "platform") {
    return null;
  }
  if (type === "stdio") {
    return {
      transport: "stdio",
      command: entry.cmd,
      args: Array.isArray(entry.args) ? entry.args : undefined,
      env: isRecord(entry.envs) ? (entry.envs as Record<string, string>) : undefined,
    };
  }
  if (type === "sse" || type === "streamable_http") {
    return {
      transport: "http",
      url: typeof entry.uri === "string" ? entry.uri : undefined,
    };
  }
  if (entry.cmd) {
    return {
      transport: "stdio",
      command: entry.cmd,
      args: Array.isArray(entry.args) ? entry.args : undefined,
      env: isRecord(entry.envs) ? (entry.envs as Record<string, string>) : undefined,
    };
  }
  if (entry.uri) {
    return {
      transport: "http",
      url: entry.uri,
    };
  }
  return null;
}

function mcpToExtension(name: string, meta: McpServerMetadata): GooseExtensionEntry {
  if (meta.transport === "http") {
    return {
      name,
      type: "streamable_http",
      uri: meta.url,
      enabled: true,
      description: "",
      timeout: 300,
    };
  }
  const env = meta.env ?? {};
  return {
    name,
    type: "stdio",
    cmd: meta.command ?? "",
    args: meta.args ?? [],
    envs: env,
    env_keys: Object.keys(env),
    enabled: true,
    description: "",
    timeout: 300,
  };
}

function mergeGooseExtensions(
  existing: Record<string, unknown>,
  overlay: Record<string, GooseExtensionEntry>,
): Record<string, unknown> {
  const merged = { ...existing };
  const currentExtensions = isRecord(existing.extensions)
    ? { ...(existing.extensions as Record<string, GooseExtensionEntry>) }
    : {};
  for (const [name, entry] of Object.entries(overlay)) {
    currentExtensions[name] = entry;
  }
  merged.extensions = currentExtensions;
  return merged;
}

function instructionNameForPath(relativePath: string): string {
  if (relativePath === "AGENTS.md") return "agents-instructions";
  if (relativePath === ".goosehints") return "goosehints";
  if (relativePath.endsWith("/.goosehints")) {
    const dir = relativePath.slice(0, -"/.goosehints".length);
    return `goosehints:${dir.replace(/\//g, "-")}`;
  }
  return `goose-instructions:${relativePath}`;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkGoosehints(
  projectRoot: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: string }>,
): void {
  if (!isDirectory(currentDir)) return;

  const hintsPath = join(currentDir, ".goosehints");
  if (existsSync(hintsPath)) {
    try {
      const content = readFileSync(hintsPath, "utf-8");
      const relativePath =
        currentDir === projectRoot
          ? ".goosehints"
          : `${relative(projectRoot, currentDir).split("\\").join("/")}/.goosehints`;
      results.push({ relativePath, content });
    } catch {
      // skip unreadable hints
    }
  }

  for (const entry of readdirSync(currentDir)) {
    if (entry.startsWith(".") && entry !== ".goosehints") continue;
    if (SKIP_WALK_DIRS.has(entry)) continue;
    walkGoosehints(projectRoot, join(currentDir, entry), results);
  }
}

export class GooseSerializer extends BaseSerializer {
  readonly platformId = "goose";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const platform = getPlatform("goose");
    if (!platform) throw new Error("goose platform not found in registry");
    this.platform = platform;
  }

  private scanConfigExtensionsAt(
    configPath: string,
    displayPath: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    let content: string | undefined;
    try {
      content = readFileSync(configPath, "utf-8");
    } catch {
      return resources;
    }

    const doc = parseGooseYaml(content);
    const extensions = doc.extensions;
    if (!isRecord(extensions)) return resources;

    for (const [name, entryValue] of Object.entries(extensions)) {
      if (!isRecord(entryValue)) continue;
      const metadata = extensionToMcpMetadata(name, entryValue as GooseExtensionEntry);
      if (!metadata) continue;
      resources.push(
        this.makeResource("mcp_server", name, "", displayPath, metadata),
      );
    }
    return resources;
  }

  private scanGooseConfigDir(
    configDir: string,
    pathPrefix: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    for (const fileName of GOOSE_CONFIG_FILES) {
      const configPath = join(configDir, fileName);
      if (!existsSync(configPath)) continue;
      resources.push(
        ...this.scanConfigExtensionsAt(configPath, `${pathPrefix}${fileName}`),
      );
    }
    return resources;
  }

  private scanInstructionsAt(
    rootPath: string,
    relativePath: string,
  ): ResourceCreateInput[] {
    const fullPath = join(rootPath, relativePath);
    if (!existsSync(fullPath)) return [];
    try {
      const content = readFileSync(fullPath, "utf-8");
      return [
        this.makeResource(
          "instruction",
          instructionNameForPath(relativePath),
          content,
          relativePath,
        ),
      ];
    } catch {
      return [];
    }
  }

  private scanSkillsAt(rootPath: string, skillsPath: string): ResourceCreateInput[] {
    return this.scanSkillsDir(rootPath, skillsPath);
  }

  private scanRecipesAt(projectRoot: string): ResourceCreateInput[] {
    const recipesDir = join(projectRoot, "recipes");
    if (!isDirectory(recipesDir)) return [];

    const resources: ResourceCreateInput[] = [];
    for (const entry of this.listDir(recipesDir)) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
      const recipePath = join(recipesDir, entry);
      const content = this.readFile(recipePath);
      if (!content) continue;
      const name = entry.replace(/\.(yaml|yml)$/, "");
      resources.push(
        this.makeResource("command", name, content.trim(), `recipes/${entry}`, {
          recipe: true,
        }),
      );
    }
    return resources;
  }

  private async scanPluginsAt(
    pluginsDir: string,
    displayPrefix: string,
  ): Promise<ResourceCreateInput[]> {
    if (!isDirectory(pluginsDir)) return [];

    const resources: ResourceCreateInput[] = [];
    for (const entry of readdirSync(pluginsDir)) {
      if (entry.startsWith(".")) continue;
      const pluginRoot = join(pluginsDir, entry);
      if (!isDirectory(pluginRoot)) continue;

      try {
        const imports = await scanPluginSource(pluginRoot);
        for (const resource of imports[0]?.resources ?? []) {
          resources.push({
            ...resource,
            source: resource.source.startsWith(displayPrefix)
              ? resource.source
              : `${displayPrefix}${entry}/${resource.source}`,
          });
        }
      } catch {
        const hooksPath = join(pluginRoot, "hooks", "hooks.json");
        if (existsSync(hooksPath)) {
          resources.push(
            ...scanHooksFile(hooksPath, `${displayPrefix}${entry}/hooks/hooks.json`),
          );
        }
      }
    }
    return resources;
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    resources.push(...this.scanInstructionsAt(projectRoot, "AGENTS.md"));

    const goosehints: Array<{ relativePath: string; content: string }> = [];
    walkGoosehints(projectRoot, projectRoot, goosehints);
    for (const hint of goosehints) {
      resources.push(
        this.makeResource(
          "instruction",
          instructionNameForPath(hint.relativePath),
          hint.content,
          hint.relativePath,
        ),
      );
    }

    const skillsPath = this.platform.projectPaths.skills;
    if (skillsPath) {
      resources.push(...this.scanSkillsAt(projectRoot, skillsPath));
    }
    for (const alternate of this.platform.projectPaths.pathAlternates?.skills ?? []) {
      resources.push(...this.scanSkillsAt(projectRoot, alternate));
    }

    resources.push(...this.scanRecipesAt(projectRoot));
    resources.push(
      ...(await this.scanPluginsAt(join(projectRoot, ".agents", "plugins"), ".agents/plugins/")),
    );
    resources.push(
      ...this.scanGooseConfigDir(join(projectRoot, ".config", "goose"), ".config/goose/"),
    );

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    resources.push(
      ...this.scanInstructionsAt(join(homeRoot, ".config", "goose"), ".goosehints"),
    );

    const skillsPath = this.platform.globalPaths.skills;
    if (skillsPath) {
      resources.push(
        ...this.scanSkillsDirAt(
          this.resolveHomePath(homeRoot, skillsPath),
          skillsPath.replace(/\/$/, ""),
        ),
      );
    }

    resources.push(
      ...(await this.scanPluginsAt(
        join(homeRoot, ".agents", "plugins"),
        "~/.agents/plugins/",
      )),
    );
    resources.push(
      ...this.scanGooseConfigDir(
        join(homeRoot, ".config", "goose"),
        "~/.config/goose/",
      ),
    );

    return resources;
  }

  async serialize(
    resources: Resource[],
    projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];
    const target = options.target ?? "project";
    const targetPaths = this.getTargetPaths(target);

    const instructionPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ?? "AGENTS.md";
    const skillsPath =
      this.toTargetRelativePath(targetPaths.skills, target) ?? ".agents/skills/";
    const recipesPath = this.toTargetRelativePath(targetPaths.commands, target);
    const configPath =
      target === "global"
        ? this.toTargetRelativePath(targetPaths.settings, target)
        : this.toTargetRelativePath(targetPaths.mcp, target);

    const instructions = resources.filter((r) => r.type === "instruction");
    const agentsMd = instructions.find(
      (r) => r.name === "agents-instructions" || r.source === "AGENTS.md",
    );
    if (agentsMd && instructionPath) {
      files.push({ path: instructionPath, content: agentsMd.content });
    }

    for (const hint of instructions.filter((r) => r.name.startsWith("goosehints"))) {
      const outputPath =
        hint.source && hint.source.endsWith(".goosehints")
          ? hint.source
          : hint.name === "goosehints"
            ? ".goosehints"
            : undefined;
      if (outputPath) {
        files.push({ path: outputPath, content: hint.content });
      }
    }

    const skills = resources.filter((r) => r.type === "skill");
    if (skillsPath && skills.length > 0) {
      for (const skill of skills) {
        files.push(
          ...this.emitSkillWithAuxiliary(
            skill,
            `${skillsPath}${skill.name}/SKILL.md`,
            options,
          ),
        );
      }
    }

    const recipes = resources.filter((r) => r.type === "command");
    if (recipesPath && recipes.length > 0) {
      for (const recipe of recipes) {
        const extension = recipe.source?.endsWith(".yml") ? "yml" : "yaml";
        const outputName = recipe.source?.includes("/")
          ? recipe.source
          : `${recipesPath}${recipe.name}.${extension}`;
        files.push({ path: outputName, content: recipe.content });
      }
    }

    const hooks = resources.filter((r) => r.type === "hook");
    if (hooks.length > 0 && target === "project") {
      const pluginRoot = `.agents/plugins/${GOOSE_LAYER_PLUGIN_NAME}`;
      files.push({
        path: `${pluginRoot}/plugin.json`,
        content: `${JSON.stringify(
          {
            name: GOOSE_LAYER_PLUGIN_NAME,
            version: "0.0.0",
            description: "Hooks materialized by HarnessTap layer apply",
          },
          null,
          2,
        )}\n`,
      });
      files.push({
        path: `${pluginRoot}/hooks/hooks.json`,
        content: JSON.stringify(
          buildHooksJson(
            hooks.map((r) => ({
              ...(r.metadata as HookMetadata),
              name: r.name,
            })),
            { version: 1 },
          ),
          null,
          2,
        ),
      });
    }

    const mcpServers = resources.filter((r) => r.type === "mcp_server");
    if (mcpServers.length > 0 && configPath) {
      const fullConfigPath = join(projectRoot, configPath);
      const existingContent = this.readFile(fullConfigPath);
      const existing = existingContent ? parseGooseYaml(existingContent) : {};
      const overlay: Record<string, GooseExtensionEntry> = {};
      for (const resource of mcpServers) {
        const metadata = resource.metadata as McpServerMetadata;
        if (!metadata) continue;
        overlay[resource.name] = mcpToExtension(resource.name, metadata);
      }
      files.push({
        path: configPath,
        content: `${stringify(mergeGooseExtensions(existing, overlay))}\n`,
      });
    }

    return files;
  }
}
