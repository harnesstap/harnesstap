import { basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  collectApmAndDevDependencies,
  type ParsedApmDependency,
  type ParsedMcpDependency,
} from "./apm-dependencies.js";
import { inspectApmOverlay, type ApmOverlayInfo } from "./apm-overlay.js";
import { collectApmTargetTokens, mapApmTargets } from "./apm-targets.js";
import type { ProjectConfig } from "./project-config.js";

export const APM_MANIFEST_FILENAME = "apm.yml";
export const HARNESSTAP_VENDOR_EXTENSION = "x-harnesstap";

export interface ApmManifestFields {
  name: string;
  version: string;
  description?: string;
  vendor: Record<string, unknown>;
  harnessTargets: string[];
  skippedTargets: string[];
  apmDependencies: ParsedApmDependency[];
  mcpDependencies: ParsedMcpDependency[];
  overlay?: ApmOverlayInfo;
  warnings: string[];
  rest: Record<string, unknown>;
}

const RESERVED_TOP_LEVEL = new Set([
  "name",
  "version",
  "description",
  HARNESSTAP_VENDOR_EXTENSION,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  const targetMapping = mapApmTargets(collectApmTargetTokens(document));
  warnings.push(...targetMapping.warnings);

  const deps = collectApmAndDevDependencies(document);

  const vendorRaw = document[HARNESSTAP_VENDOR_EXTENSION];
  if (vendorRaw !== undefined && !isRecord(vendorRaw)) {
    throw new Error(`${filePath} field ${HARNESSTAP_VENDOR_EXTENSION} must be a mapping`);
  }
  const vendor = vendorRaw ?? {};

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (RESERVED_TOP_LEVEL.has(key)) {
      continue;
    }
    rest[key] = value;
  }

  let overlay: ApmOverlayInfo | undefined;
  if (rootPath) {
    overlay = inspectApmOverlay(rootPath);
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
    ...(overlay ? { overlay } : {}),
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

export function apmDocumentFromProjectConfig(
  config: ProjectConfig,
  projectPath: string,
): Record<string, unknown> {
  const name = config.apm_name ?? sanitizePackageName(projectPath);
  const version = config.apm_version ?? "1.0.0";
  const xHarnesstap: Record<string, unknown> = {
    ...(config.default_profile ? { default_profile: config.default_profile } : {}),
    ...(config.default_environment ? { default_environment: config.default_environment } : {}),
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
    ...(config.environments.length > 0 ? { environments: config.environments } : {}),
    ...(config.plugins.length > 0 ? { plugins: config.plugins } : {}),
  };

  return {
    ...(config.apm_document ?? {}),
    name,
    version,
    ...(config.apm_description ? { description: config.apm_description } : {}),
    [HARNESSTAP_VENDOR_EXTENSION]: xHarnesstap,
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
