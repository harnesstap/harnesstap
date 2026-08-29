import { basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  collectApmAndDevDependencies,
  type ParsedApmDependency,
  type ParsedMcpDependency,
} from "./apm-dependencies.js";
import { parseApmPolicyPin, type ApmPolicyPin } from "./apm-policy.js";
import { inspectApmOverlay, type ApmOverlayInfo } from "./apm-overlay.js";
import { collectApmTargetTokens, mapApmTargets } from "./apm-targets.js";
import type { ProjectConfig } from "./project-config.js";

export interface ApmCompilationConfig {
  targetTokens: string[];
  strategy?: string;
  sourceAttribution?: boolean;
  exclude: string[];
  chatmode?: string;
  singleFile?: boolean;
}

export const APM_MANIFEST_FILENAME = "apm.yml";

const HT_TOP_LEVEL_KEYS = [
  "default_profile",
  "environments",
  "profiles",
  "plugins",
] as const;

const STRIP_TOP_LEVEL_KEYS = [
  "x-harnesstap",
  "default_environment",
  "environment",
] as const;

const RESERVED_TOP_LEVEL = new Set([
  "name",
  "version",
  "description",
  ...HT_TOP_LEVEL_KEYS,
  ...STRIP_TOP_LEVEL_KEYS,
]);

export interface ApmManifestFields {
  name: string;
  version: string;
  description?: string;
  vendor: Record<string, unknown>;
  harnessTargets: string[];
  skippedTargets: string[];
  apmDependencies: ParsedApmDependency[];
  mcpDependencies: ParsedMcpDependency[];
  policyPin?: ApmPolicyPin;
  overlay?: ApmOverlayInfo;
  compilation?: ApmCompilationConfig;
  warnings: string[];
  rest: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseApmCompilation(value: unknown): ApmCompilationConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const targetTokens = collectApmTargetTokens({
    target: value.target,
    targets: value.targets,
  });
  const exclude = Array.isArray(value.exclude)
    ? value.exclude.filter((entry): entry is string => typeof entry === "string")
    : typeof value.exclude === "string"
      ? [value.exclude]
      : [];
  return {
    targetTokens,
    ...(typeof value.strategy === "string" ? { strategy: value.strategy } : {}),
    ...(typeof value.source_attribution === "boolean"
      ? { sourceAttribution: value.source_attribution }
      : {}),
    exclude,
    ...(typeof value.chatmode === "string" ? { chatmode: value.chatmode } : {}),
    ...(value.single_file === true ? { singleFile: true } : {}),
  };
}

function coerceString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function parseApmYamlDocument(
  raw: string,
  filePath: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${filePath}: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must be a YAML mapping`);
  }
  return parsed;
}

function htFieldsFromDocument(document: Record<string, unknown>): Record<string, unknown> {
  const vendor: Record<string, unknown> = {};
  for (const key of HT_TOP_LEVEL_KEYS) {
    if (document[key] !== undefined) {
      vendor[key] = document[key];
    }
  }
  return vendor;
}

export function extractApmManifestFields(
  document: Record<string, unknown>,
  filePath: string,
  rootPath?: string,
): ApmManifestFields {
  const name = coerceString(document.name).trim();
  if (!name) {
    throw new Error(`${filePath} is missing required field name`);
  }
  const version = coerceString(document.version).trim();
  if (!version) {
    throw new Error(`${filePath} is missing required field version`);
  }

  const warnings: string[] = [];
  if (document.workspaces !== undefined) {
    warnings.push("apm.yml field workspaces is reserved for OpenAPM v0.2 and is ignored");
  }

  const descriptionRaw = document.description;
  const description = typeof descriptionRaw === "string" && descriptionRaw.length > 0
    ? descriptionRaw
    : undefined;

  const compilation = parseApmCompilation(document.compilation);
  const topLevelTargets = collectApmTargetTokens(document);
  const targetTokens =
    topLevelTargets.length > 0 ? topLevelTargets : (compilation?.targetTokens ?? []);
  const targetMapping = mapApmTargets(targetTokens);
  warnings.push(...targetMapping.warnings);
  if (compilation?.strategy === "distributed") {
    warnings.push(
      "apm.yml compilation.strategy is distributed; ht compile / ht apply write existing harness files (single-file root context) rather than per-directory AGENTS.md",
    );
  }

  const deps = collectApmAndDevDependencies(document);
  const policyPin = parseApmPolicyPin(document.policy);
  const vendor = htFieldsFromDocument(document);

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (RESERVED_TOP_LEVEL.has(key)) {
      continue;
    }
    rest[key] = value;
  }

  let overlay: ApmOverlayInfo | undefined;
  if (rootPath) {
    overlay = inspectApmOverlay(rootPath, { exclude: compilation?.exclude ?? [] });
    if (overlay) {
      warnings.push(...overlay.warnings);
    }
  }

  return {
    name,
    version,
    ...(description ? { description } : {}),
    vendor,
    harnessTargets: targetMapping.harnessTargets,
    skippedTargets: targetMapping.skippedTargets,
    apmDependencies: deps.apm,
    mcpDependencies: deps.mcp,
    ...(policyPin ? { policyPin } : {}),
    ...(overlay ? { overlay } : {}),
    ...(compilation ? { compilation } : {}),
    warnings,
    rest,
  };
}

export function parseApmManifestContents(
  raw: string,
  filePath: string,
  rootPath?: string,
): ApmManifestFields {
  const document = parseApmYamlDocument(raw, filePath);
  return extractApmManifestFields(document, filePath, rootPath);
}

function sanitizePackageName(projectPath: string): string {
  const base = basename(projectPath).trim();
  return base.length > 0 ? base : "project";
}

export function serializeEnvironmentBlock(
  config: ProjectConfig,
): Record<string, unknown> | undefined {
  if (!config.default_environment && config.environments.length === 0) {
    return undefined;
  }
  const block: Record<string, unknown> = {};
  if (config.default_environment) {
    block.default = config.default_environment;
  }
  for (const environment of config.environments) {
    const entry: Record<string, unknown> = {};
    if (Object.keys(environment.values).length > 0) {
      entry.values = environment.values;
    }
    if (environment.secret_refs && Object.keys(environment.secret_refs).length > 0) {
      entry.secret_refs = environment.secret_refs;
    }
    block[environment.name] = entry;
  }
  return block;
}

export function apmDocumentFromProjectConfig(
  config: ProjectConfig,
  projectPath: string,
): Record<string, unknown> {
  const name = config.apm_name ?? sanitizePackageName(projectPath);
  const version = config.apm_version ?? "1.0.0";
  const rest = { ...(config.apm_document ?? {}) };
  for (const key of STRIP_TOP_LEVEL_KEYS) {
    delete rest[key];
  }
  for (const key of HT_TOP_LEVEL_KEYS) {
    delete rest[key];
  }

  const environments = serializeEnvironmentBlock(config);

  return {
    ...rest,
    name,
    version,
    ...(config.apm_description ? { description: config.apm_description } : {}),
    ...(config.default_profile ? { default_profile: config.default_profile } : {}),
    ...(environments ? { environments } : {}),
    ...(config.profiles.length > 0
      ? {
          profiles: config.profiles.map((profile) => ({
            name: profile.name,
            source: profile.source,
            ...(profile.selector ? { selector: profile.selector } : {}),
            ...(profile.plugin ? { plugin: profile.plugin } : {}),
            ...(profile.environment ? { environment: profile.environment } : {}),
          })),
        }
      : {}),
    ...(config.plugins.length > 0 ? { plugins: config.plugins } : {}),
  };
}

export function formatApmManifest(config: ProjectConfig, projectPath: string): string {
  const document = apmDocumentFromProjectConfig(config, projectPath);
  return stringifyYaml(document, {
    indent: 2,
    lineWidth: 0,
    defaultKeyType: "PLAIN",
  });
}
