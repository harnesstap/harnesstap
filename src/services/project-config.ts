import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeckJsonEnvironment, DeckJsonEnvironmentSecretRef, DeckJsonSecretProvider } from "../types.js";
import type { ParsedApmDependency, ParsedMcpDependency } from "./apm-dependencies.js";
import {
  APM_MANIFEST_FILENAME,
  parseApmManifestContents,
} from "./apm-manifest.js";
import type { ApmOverlayInfo } from "./apm-overlay.js";
import { parseTransportToml } from "./toml/read.js";

export type ProjectProfileSource = "catalog" | "local" | "inline";

export interface ProjectProfileEntry {
  name: string;
  source: ProjectProfileSource;
  selector?: string;
  plugin?: string;
  environment?: string;
}

export type ProjectPluginTable = Record<string, unknown> & { name: string };

export interface ProjectConfig {
  default_profile?: string;
  default_environment?: string;
  profiles: ProjectProfileEntry[];
  environments: DeckJsonEnvironment[];
  plugins: ProjectPluginTable[];
  apm_name?: string;
  apm_version?: string;
  apm_description?: string;
  apm_document?: Record<string, unknown>;
}

export interface ResolvedProjectConfig extends ProjectConfig {
  rootPath: string;
  configPath: string;
  harnessTargets: string[];
  skippedTargets: string[];
  apmDependencies: ParsedApmDependency[];
  mcpDependencies: ParsedMcpDependency[];
  overlay?: ApmOverlayInfo;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveWalkRoot(startPath: string): string {
  const absolute = resolve(startPath);
  try {
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      return dirname(absolute);
    }
  } catch {
    // Fall through to treat the path as a directory.
  }
  return absolute;
}

export function projectManifestPath(rootPath: string): string {
  return join(rootPath, APM_MANIFEST_FILENAME);
}

function locateProjectConfigFile(
  startPath: string,
): { rootPath: string; configPath: string; configDir: string } | null {
  let current = resolveWalkRoot(startPath);

  while (true) {
    const configPath = projectManifestPath(current);
    if (existsSync(configPath)) {
      return {
        rootPath: current,
        configPath,
        configDir: join(current, ".harnesstap"),
      };
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function parseProfileSource(value: unknown, profileName: string): ProjectProfileSource {
  if (typeof value !== "string") {
    throw new Error(`Profile ${profileName} must include a source string`);
  }
  switch (value) {
    case "catalog":
    case "local":
    case "inline":
      return value;
    default:
      throw new Error(`Unknown profile source for ${profileName}: ${value}`);
  }
}

function parseProfileEntry(value: unknown, index: number): ProjectProfileEntry {
  if (!isRecord(value)) {
    throw new Error(`Profile at index ${index} must be a table`);
  }

  const name = value.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Profile at index ${index} must include a non-empty name`);
  }

  const source = parseProfileSource(value.source, name);
  const environment =
    typeof value.environment === "string" && value.environment.length > 0
      ? value.environment
      : undefined;

  switch (source) {
    case "catalog": {
      const selector = value.selector;
      if (typeof selector !== "string" || selector.length === 0) {
        throw new Error(`Profile ${name} with catalog source must include a selector`);
      }
      return { name, source, selector, ...(environment ? { environment } : {}) };
    }
    case "local": {
      const selector =
        typeof value.selector === "string" && value.selector.length > 0
          ? value.selector
          : name;
      return { name, source, selector, ...(environment ? { environment } : {}) };
    }
    case "inline": {
      const plugin = value.plugin;
      if (typeof plugin !== "string" || plugin.length === 0) {
        throw new Error(`Profile ${name} with inline source must include a plugin key`);
      }
      return { name, source, plugin, ...(environment ? { environment } : {}) };
    }
    default: {
      const unhandledSource: never = source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function parseSecretProvider(
  value: unknown,
  environmentName: string,
  key: string,
): DeckJsonSecretProvider {
  const provider = String(value ?? "env");
  switch (provider) {
    case "keychain":
    case "env":
    case "file":
      return provider;
    default:
      throw new Error(
        `Environment ${environmentName} secret_refs.${key} has unknown provider: ${provider}`,
      );
  }
}

function parseNamedEnvironment(name: string, value: unknown): DeckJsonEnvironment {
  if (!isRecord(value)) {
    throw new Error(`Environment ${name} must be a mapping`);
  }

  const valuesRaw = value.values;
  const values: Record<string, string> = {};
  if (valuesRaw !== undefined && !isRecord(valuesRaw)) {
    throw new Error(`Environment ${name} field values must be a mapping`);
  }
  if (isRecord(valuesRaw)) {
    for (const [key, entry] of Object.entries(valuesRaw)) {
      values[key] = String(entry);
    }
  }

  const secretRefsRaw = value.secret_refs;
  const secret_refs: Record<string, DeckJsonEnvironmentSecretRef> = {};
  if (secretRefsRaw !== undefined && !isRecord(secretRefsRaw)) {
    throw new Error(`Environment ${name} field secret_refs must be a mapping`);
  }
  if (isRecord(secretRefsRaw)) {
    for (const [key, entry] of Object.entries(secretRefsRaw)) {
      if (!isRecord(entry)) {
        throw new Error(`Environment ${name} secret_refs.${key} must be a mapping`);
      }
      secret_refs[key] = {
        provider: parseSecretProvider(entry.provider, name, key),
        ref: String(entry.ref ?? ""),
      };
    }
  }

  return {
    name,
    values,
    ...(Object.keys(secret_refs).length > 0 ? { secret_refs } : {}),
  };
}

function parsePluginTable(value: unknown, index: number): ProjectPluginTable {
  if (!isRecord(value)) {
    throw new Error(`Plugin at index ${index} must be a table`);
  }

  const name = value.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Plugin at index ${index} must include a non-empty name`);
  }

  return { ...value, name };
}

function parseOptionalStringField(
  document: Record<string, unknown>,
  field: "default_profile" | "default_environment",
): string | undefined {
  const value = document[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Project config field ${field} must be a non-empty string when set`);
  }
  return value;
}

function parseProfiles(document: Record<string, unknown>): ProjectProfileEntry[] {
  const profilesRaw = document.profiles;
  if (profilesRaw === undefined) {
    return [];
  }
  if (!Array.isArray(profilesRaw)) {
    throw new Error("Project config profiles must be an array of tables");
  }

  const profiles = profilesRaw.map(parseProfileEntry);
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.name)) {
      throw new Error(`Duplicate profile name: ${profile.name}`);
    }
    seen.add(profile.name);
  }
  return profiles;
}

function parseEnvironmentBlock(document: Record<string, unknown>): {
  default_environment?: string;
  environments: DeckJsonEnvironment[];
} {
  const raw = document.environment;
  if (raw === undefined) {
    return { environments: [] };
  }
  if (!isRecord(raw)) {
    throw new Error("Project config field environment must be a mapping");
  }

  let default_environment: string | undefined;
  const environments: DeckJsonEnvironment[] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(raw)) {
    if (key === "default") {
      if (value === undefined) {
        continue;
      }
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(
          "Project config field environment.default must be a non-empty string when set",
        );
      }
      default_environment = value;
      continue;
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate environment name: ${key}`);
    }
    seen.add(key);
    environments.push(parseNamedEnvironment(key, value));
  }

  return {
    ...(default_environment !== undefined ? { default_environment } : {}),
    environments,
  };
}

function parsePlugins(document: Record<string, unknown>): ProjectPluginTable[] {
  const pluginsRaw = document.plugins;
  if (pluginsRaw === undefined) {
    return [];
  }
  if (!Array.isArray(pluginsRaw)) {
    throw new Error("Project config plugins must be an array of tables");
  }
  return pluginsRaw.map(parsePluginTable);
}

export function projectConfigFromTomlDocument(document: Record<string, unknown>): ProjectConfig {
  const default_profile = parseOptionalStringField(document, "default_profile");
  const parsedEnvironment = parseEnvironmentBlock(document);

  return {
    ...(default_profile !== undefined ? { default_profile } : {}),
    ...parsedEnvironment,
    profiles: parseProfiles(document),
    plugins: parsePlugins(document),
  };
}

export function parseProjectConfigFile(filePath: string, rootPath?: string): ProjectConfig {
  const raw = readFileSync(filePath, "utf-8");
  const fields = parseApmManifestContents(raw, filePath, rootPath);
  const config = projectConfigFromTomlDocument(fields.vendor);
  return {
    ...config,
    apm_name: fields.name,
    apm_version: fields.version,
    ...(fields.description ? { apm_description: fields.description } : {}),
    ...(Object.keys(fields.rest).length > 0 ? { apm_document: fields.rest } : {}),
  };
}

function parseResolvedProjectConfig(
  filePath: string,
  rootPath: string,
): Omit<ResolvedProjectConfig, "rootPath" | "configPath"> {
  const raw = readFileSync(filePath, "utf-8");
  const fields = parseApmManifestContents(raw, filePath, rootPath);
  const config = projectConfigFromTomlDocument(fields.vendor);
  return {
    ...config,
    apm_name: fields.name,
    apm_version: fields.version,
    ...(fields.description ? { apm_description: fields.description } : {}),
    ...(Object.keys(fields.rest).length > 0 ? { apm_document: fields.rest } : {}),
    harnessTargets: fields.harnessTargets,
    skippedTargets: fields.skippedTargets,
    apmDependencies: fields.apmDependencies,
    mcpDependencies: fields.mcpDependencies,
    ...(fields.overlay ? { overlay: fields.overlay } : {}),
    warnings: fields.warnings,
  };
}

export function mergeProjectConfigLocalOverrides(
  config: ProjectConfig,
  configDir: string,
): ProjectConfig {
  const localPath = join(configDir, "local.toml");
  if (!existsSync(localPath)) {
    return config;
  }

  const raw = readFileSync(localPath, "utf-8");
  const document = parseTransportToml(raw, "project local overrides");
  const default_profile = parseOptionalStringField(document, "default_profile");
  const default_environment = parseOptionalStringField(document, "default_environment");

  return {
    ...config,
    ...(default_profile !== undefined ? { default_profile } : {}),
    ...(default_environment !== undefined ? { default_environment } : {}),
  };
}

export function findProjectConfig(startPath: string): ResolvedProjectConfig | null {
  const located = locateProjectConfigFile(startPath);
  if (!located) {
    return null;
  }

  const parsed = parseResolvedProjectConfig(located.configPath, located.rootPath);
  const merged = mergeProjectConfigLocalOverrides(parsed, located.configDir);

  return {
    ...parsed,
    ...merged,
    rootPath: located.rootPath,
    configPath: located.configPath,
    harnessTargets: parsed.harnessTargets,
    skippedTargets: parsed.skippedTargets,
    apmDependencies: parsed.apmDependencies,
    mcpDependencies: parsed.mcpDependencies,
    warnings: parsed.warnings,
    ...(parsed.overlay ? { overlay: parsed.overlay } : {}),
  };
}

export function getProfileEntry(
  config: ProjectConfig,
  profileKey: string,
): ProjectProfileEntry {
  const entry = config.profiles.find((profile) => profile.name === profileKey);
  if (!entry) {
    throw new Error(`Unknown profile: ${profileKey}`);
  }
  return entry;
}

export function resolveProfileEnvironment(
  config: ProjectConfig,
  entry: ProjectProfileEntry,
): string | undefined {
  if (entry.environment) {
    return entry.environment;
  }
  return config.default_environment;
}

export interface ProjectConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProjectConfig(config: ProjectConfig): ProjectConfigValidationResult {
  const errors: string[] = [];
  const profileNames = new Set(config.profiles.map((profile) => profile.name));
  const environmentNames = new Set(config.environments.map((environment) => environment.name));
  const pluginNames = new Set(config.plugins.map((plugin) => plugin.name));

  if (config.default_profile && !profileNames.has(config.default_profile)) {
    errors.push(`default_profile references unknown profile: ${config.default_profile}`);
  }

  if (config.default_environment && !environmentNames.has(config.default_environment)) {
    errors.push(
      `environment.default references unknown environment: ${config.default_environment}`,
    );
  }

  for (const profile of config.profiles) {
    if (profile.environment && !environmentNames.has(profile.environment)) {
      errors.push(
        `Profile ${profile.name} references unknown environment: ${profile.environment}`,
      );
    }

    if (profile.source === "inline") {
      const pluginKey = profile.plugin;
      if (!pluginKey || !pluginNames.has(pluginKey)) {
        errors.push(
          `Profile ${profile.name} with inline source references unknown plugin: ${pluginKey ?? "(missing)"}`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
