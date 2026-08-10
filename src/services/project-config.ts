import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeckJsonEnvironment, DeckJsonEnvironmentSecretRef } from "../types.js";
import {
  PLUGIN_SCHEMA,
  PROJECT_SCHEMA,
  PROJECT_SCHEMA_VERSION,
} from "../types.js";
import { parseTransportToml } from "./transport/read.js";
import { readSchemaHeader } from "./transport/validate.js";

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
}

export interface ResolvedProjectConfig extends ProjectConfig {
  rootPath: string;
  configPath: string;
}

const CONFIG_FILE_NAMES = ["config.toml"] as const;

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

function locateProjectConfigFile(
  startPath: string,
): { rootPath: string; configPath: string; configDir: string } | null {
  let current = resolveWalkRoot(startPath);

  while (true) {
    const harnesstapDir = join(current, ".harnesstap");
    for (const fileName of CONFIG_FILE_NAMES) {
      const configPath = join(harnesstapDir, fileName);
      if (existsSync(configPath)) {
        return {
          rootPath: current,
          configPath,
          configDir: harnesstapDir,
        };
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function assertProjectSchema(schema: string, version: number, filePath: string): void {
  if (schema === PLUGIN_SCHEMA) {
    throw new Error(
      `${filePath} uses plugin bundle schema (${PLUGIN_SCHEMA}); place plugin exports in *.harnesstap.toml, not project config`,
    );
  }
  if (schema !== PROJECT_SCHEMA) {
    throw new Error(`Unsupported project schema in ${filePath}: ${schema}`);
  }
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project version in ${filePath}: ${version} (expected ${PROJECT_SCHEMA_VERSION})`,
    );
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

function parseEnvironmentEntry(value: unknown, index: number): DeckJsonEnvironment {
  if (!isRecord(value)) {
    throw new Error(`Environment at index ${index} must be a table`);
  }

  const name = value.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Environment at index ${index} must include a non-empty name`);
  }

  const valuesRaw = value.values;
  const values: Record<string, string> = {};
  if (isRecord(valuesRaw)) {
    for (const [key, entry] of Object.entries(valuesRaw)) {
      values[key] = String(entry);
    }
  }

  const secretRefsRaw = value.secret_refs;
  const secret_refs: Record<string, DeckJsonEnvironmentSecretRef> = {};
  if (isRecord(secretRefsRaw)) {
    for (const [key, entry] of Object.entries(secretRefsRaw)) {
      if (!isRecord(entry)) {
        continue;
      }
      secret_refs[key] = {
        provider: String(entry.provider ?? "env") as DeckJsonEnvironmentSecretRef["provider"],
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

function parseEnvironments(document: Record<string, unknown>): DeckJsonEnvironment[] {
  const environmentsRaw = document.environments;
  if (environmentsRaw === undefined) {
    return [];
  }
  if (!Array.isArray(environmentsRaw)) {
    throw new Error("Project config environments must be an array of tables");
  }
  return environmentsRaw.map(parseEnvironmentEntry);
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
  const default_environment = parseOptionalStringField(document, "default_environment");

  return {
    ...(default_profile !== undefined ? { default_profile } : {}),
    ...(default_environment !== undefined ? { default_environment } : {}),
    profiles: parseProfiles(document),
    environments: parseEnvironments(document),
    plugins: parsePlugins(document),
  };
}

export function parseProjectConfigFile(filePath: string): ProjectConfig {
  const raw = readFileSync(filePath, "utf-8");
  const document = parseTransportToml(raw, "project config");
  const { schema, version } = readSchemaHeader(document);
  assertProjectSchema(schema, version, filePath);
  return projectConfigFromTomlDocument(document);
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

  const config = mergeProjectConfigLocalOverrides(
    parseProjectConfigFile(located.configPath),
    located.configDir,
  );

  return {
    ...config,
    rootPath: located.rootPath,
    configPath: located.configPath,
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
      `default_environment references unknown environment: ${config.default_environment}`,
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
