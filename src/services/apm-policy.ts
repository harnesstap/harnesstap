import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import type { ParsedApmDependency, ParsedMcpDependency } from "./apm-dependencies.js";
import { canonicalApmRepoUrl } from "./apm-git-resolve.js";
import { inspectApmOverlay } from "./apm-overlay.js";
import type { LockEntry, Lockfile, LockMcpServer } from "./lockfile.js";
import { recoverOriginLocator } from "./plugin-origin-locator.js";
import { getPluginById } from "../models/plugin-model.js";
import type { DependencySourceKind, Resource, ResourceType } from "../types.js";
import type { ResolutionResult } from "./resolve/types.js";
import { resolutionKey } from "./resolve/resource-resolution.js";
import { assertContainedPath } from "../utils/path-containment.js";

const APM_MANIFEST_FILENAME = "apm.yml";

export const APM_POLICY_FILENAME = "apm-policy.yml";

export const POLICY_HASH_ALGORITHMS = ["sha256", "sha384", "sha512"] as const;
export type PolicyHashAlgorithm = (typeof POLICY_HASH_ALGORITHMS)[number];

export const POLICY_ENFORCEMENTS = ["off", "warn", "block"] as const;
export type PolicyEnforcement = (typeof POLICY_ENFORCEMENTS)[number];

export const POLICY_FETCH_FAILURES = ["warn", "block"] as const;
export type PolicyFetchFailure = (typeof POLICY_FETCH_FAILURES)[number];

export const POLICY_PRIMITIVES = [
  "skill",
  "agent",
  "command",
  "hook",
  "instruction",
  "mcp",
] as const;
export type PolicyPrimitive = (typeof POLICY_PRIMITIVES)[number];

export type PolicySourceKind = DependencySourceKind;

export interface ApmPolicyPin {
  hash: string;
  algorithm: PolicyHashAlgorithm;
}

export interface OrgExecutablePolicy {
  present: boolean;
  nonEmpty: boolean;
  denyAll: boolean;
  deny: string[];
  require: string[];
  recommend: string[];
  enforce: string[];
  warnings: string[];
}

export interface ApmPolicyDocument {
  name: string;
  version: string;
  enforcement: PolicyEnforcement;
  fetchFailure: PolicyFetchFailure;
  extends?: string;
  dependenciesAllow: string[] | null;
  dependenciesDeny: string[] | null;
  mcpAllow: string[] | null;
  mcpDeny: string[] | null;
  trustTransitive: boolean;
  contentTypesAllow: string[] | null;
  executables: OrgExecutablePolicy;
  binDeployDenyAll: boolean;
  binDeployDeny: string[];
  binDeployNonEmpty: boolean;
  warnings: string[];
}

export interface PolicyPlanSource {
  kind: PolicySourceKind;
  name: string;
  identity: string;
  host?: string;
  path?: string;
  depth: number;
}

export interface PolicyPlanMcp {
  name: string;
  identity: string;
  depth: number;
  declaredInManifest: boolean;
}

export interface PolicyInstallPlan {
  sources: PolicyPlanSource[];
  primitives: PolicyPrimitive[];
  mcp: PolicyPlanMcp[];
}

export interface PolicyViolation {
  code: string;
  message: string;
  subject?: string;
}

export type PolicyLoadStatus = "evaluated" | "skipped" | "failed";

export interface PolicyLoadResult {
  status: PolicyLoadStatus;
  skippedReason?: "no-policy";
  source?: string;
  policy?: ApmPolicyDocument;
  pin?: ApmPolicyPin;
  warnings: string[];
  violations: PolicyViolation[];
}

export interface PolicyEvaluation {
  status: PolicyLoadStatus;
  skippedReason?: "no-policy";
  source?: string;
  name?: string;
  enforcement: PolicyEnforcement;
  warnings: string[];
  violations: PolicyViolation[];
  blocks: boolean;
}

export class PolicyError extends Error {
  readonly violations: PolicyViolation[];
  constructor(message: string, violations: PolicyViolation[] = []) {
    super(message);
    this.name = "PolicyError";
    this.violations = violations;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVendorExtensionKey(key: string): boolean {
  return /^x-[a-z][a-z0-9-]*$/.test(key);
}

function stringList(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new PolicyError(`${field} must be a list or null`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new PolicyError(`${field}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new PolicyError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

const KNOWN_TOP_LEVEL = new Set([
  "name",
  "version",
  "extends",
  "enforcement",
  "fetch_failure",
  "cache",
  "dependencies",
  "mcp",
  "compilation",
  "manifest",
  "unmanaged_files",
  "security",
  "registry_source",
  "executables",
  "bin_deploy",
  "discovery",
]);

export function parsePolicyHashAlgorithm(
  hash: string,
  explicit?: unknown,
): PolicyHashAlgorithm {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    if (typeof explicit !== "string") {
      throw new PolicyError("policy.hash_algorithm must be a string");
    }
    const lowered = explicit.toLowerCase();
    if (lowered === "md5" || lowered === "sha1") {
      throw new PolicyError("policy.hash_algorithm must be sha256, sha384, or sha512");
    }
    if (!(POLICY_HASH_ALGORITHMS as readonly string[]).includes(lowered)) {
      throw new PolicyError("policy.hash_algorithm must be sha256, sha384, or sha512");
    }
    return lowered as PolicyHashAlgorithm;
  }
  const prefix = hash.split(":")[0]?.toLowerCase();
  if (prefix && (POLICY_HASH_ALGORITHMS as readonly string[]).includes(prefix)) {
    return prefix as PolicyHashAlgorithm;
  }
  throw new PolicyError(
    "policy.hash must include a sha256:, sha384:, or sha512: prefix, or set policy.hash_algorithm",
  );
}

export function parseApmPolicyPin(value: unknown): ApmPolicyPin | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new PolicyError("apm.yml policy must be a mapping");
  }
  if (typeof value.hash !== "string" || value.hash.trim().length === 0) {
    return undefined;
  }
  const hash = value.hash.trim();
  const algorithm = parsePolicyHashAlgorithm(hash, value.hash_algorithm);
  return { hash, algorithm };
}

export function hashPolicyBytes(bytes: Uint8Array, algorithm: PolicyHashAlgorithm): string {
  return `${algorithm}:${createHash(algorithm).update(bytes).digest("hex")}`;
}

export function policyHashesMatch(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

function normalizeContentType(value: string): PolicyPrimitive | undefined {
  const key = value.trim().toLowerCase();
  switch (key) {
    case "skill":
    case "skills":
      return "skill";
    case "agent":
    case "agents":
      return "agent";
    case "command":
    case "commands":
    case "prompt":
    case "prompts":
      return "command";
    case "hook":
    case "hooks":
      return "hook";
    case "instruction":
    case "instructions":
    case "rule":
    case "rules":
      return "instruction";
    case "mcp":
    case "mcp_server":
    case "mcp-server":
      return "mcp";
    default:
      return undefined;
  }
}

export function primitiveFromResourceType(type: ResourceType): PolicyPrimitive | undefined {
  switch (type) {
    case "skill":
      return "skill";
    case "agent":
      return "agent";
    case "command":
      return "command";
    case "hook":
      return "hook";
    case "instruction":
    case "rule":
      return "instruction";
    case "mcp_server":
      return "mcp";
    case "permission":
    case "env_var":
    case "model_config":
    case "plugin":
      return undefined;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function parseYamlMapping(raw: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PolicyError(`Invalid YAML in ${filePath}: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new PolicyError(`${filePath} must be a YAML mapping`);
  }
  return parsed;
}

export function parseApmPolicyDocument(raw: string, filePath: string): ApmPolicyDocument {
  const document = parseYamlMapping(raw, filePath);
  const warnings: string[] = [];
  for (const key of Object.keys(document)) {
    if (isVendorExtensionKey(key) || KNOWN_TOP_LEVEL.has(key)) {
      continue;
    }
    warnings.push(`Unknown top-level policy key ${key} is ignored`);
  }

  const dependencies = isRecord(document.dependencies) ? document.dependencies : {};
  const mcp = isRecord(document.mcp) ? document.mcp : {};
  const manifest = isRecord(document.manifest) ? document.manifest : {};
  const contentTypes = isRecord(manifest.content_types) ? manifest.content_types : {};

  const contentTypesAllow = stringList(contentTypes.allow, "manifest.content_types.allow");
  if (contentTypesAllow) {
    for (const entry of contentTypesAllow) {
      if (!normalizeContentType(entry)) {
        throw new PolicyError(
          `manifest.content_types.allow entry ${entry} is not a supported primitive`,
        );
      }
    }
  }

  const extendsRef = typeof document.extends === "string" && document.extends.trim().length > 0
    ? document.extends.trim()
    : undefined;
  const fetchFailure = parseEnum(
    document.fetch_failure,
    POLICY_FETCH_FAILURES,
    "fetch_failure",
    "warn",
  );
  if (extendsRef) {
    const message =
      "apm-policy.yml extends is not fetched in this slice; inline the parent rules";
    if (fetchFailure === "block") {
      throw new PolicyError(message);
    }
    warnings.push(message);
  }

  const executables = parseOrgExecutables(document.executables);
  const binDeploy = parseBinDeploy(document.bin_deploy);
  warnings.push(...executables.warnings);

  return {
    name: typeof document.name === "string" ? document.name : "",
    version: typeof document.version === "string" ? document.version : "",
    enforcement: parseEnum(document.enforcement, POLICY_ENFORCEMENTS, "enforcement", "warn"),
    fetchFailure,
    ...(extendsRef ? { extends: extendsRef } : {}),
    dependenciesAllow: stringList(dependencies.allow, "dependencies.allow"),
    dependenciesDeny: stringList(dependencies.deny, "dependencies.deny"),
    mcpAllow: stringList(mcp.allow, "mcp.allow"),
    mcpDeny: stringList(mcp.deny, "mcp.deny"),
    trustTransitive: mcp.trust_transitive === undefined ? false : mcp.trust_transitive === true,
    contentTypesAllow,
    executables,
    binDeployDenyAll: binDeploy.denyAll,
    binDeployDeny: binDeploy.deny,
    binDeployNonEmpty: binDeploy.nonEmpty,
    warnings,
  };
}

function emptyOrgExecutables(present: boolean, nonEmpty: boolean): OrgExecutablePolicy {
  return {
    present,
    nonEmpty,
    denyAll: false,
    deny: [],
    require: [],
    recommend: [],
    enforce: [],
    warnings: [],
  };
}

export function parseOrgExecutables(value: unknown): OrgExecutablePolicy {
  if (value === undefined) {
    return emptyOrgExecutables(false, false);
  }
  if (value === null) {
    return emptyOrgExecutables(true, false);
  }
  if (!isRecord(value)) {
    throw new PolicyError("executables must be a mapping");
  }
  const nonEmpty = Object.keys(value).length > 0;
  const deny = stringList(value.deny, "executables.deny") ?? [];
  const require = stringList(value.require, "executables.require") ?? [];
  const recommend = stringList(value.recommend, "executables.recommend") ?? [];
  const enforce = stringList(value.enforce, "executables.enforce") ?? [];
  const warnings: string[] = [];
  if (enforce.length > 0) {
    warnings.push(
      "executables.enforce is accepted but inert in this release; treated as recommend",
    );
  }
  if (value.deny_all !== undefined && value.deny_all !== null && typeof value.deny_all !== "boolean") {
    throw new PolicyError("executables.deny_all must be a boolean");
  }
  return {
    present: true,
    nonEmpty,
    denyAll: value.deny_all === true,
    deny,
    require,
    recommend: [...new Set([...recommend, ...enforce])],
    enforce,
    warnings,
  };
}

function parseBinDeploy(value: unknown): {
  denyAll: boolean;
  deny: string[];
  nonEmpty: boolean;
} {
  if (value === undefined || value === null) {
    return { denyAll: false, deny: [], nonEmpty: false };
  }
  if (!isRecord(value)) {
    throw new PolicyError("bin_deploy must be a mapping");
  }
  if (value.deny_all !== undefined && value.deny_all !== null && typeof value.deny_all !== "boolean") {
    throw new PolicyError("bin_deploy.deny_all must be a boolean");
  }
  return {
    denyAll: value.deny_all === true,
    deny: stringList(value.deny, "bin_deploy.deny") ?? [],
    nonEmpty: Object.keys(value).length > 0,
  };
}

export function projectPolicyPath(projectRoot: string): string {
  return join(projectRoot, APM_POLICY_FILENAME);
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function resolvePolicyFile(projectRoot: string, policyPath?: string): string | undefined {
  if (policyPath && policyPath.trim().length > 0) {
    const resolved = isAbsolute(policyPath) ? resolve(policyPath) : resolve(projectRoot, policyPath);
    const rel = toPosix(relative(projectRoot, resolved));
    assertContainedPath(projectRoot, rel);
    return resolved;
  }
  const discovered = projectPolicyPath(projectRoot);
  return existsSync(discovered) ? discovered : undefined;
}

function pinViolation(code: string, message: string): PolicyViolation {
  return { code, message };
}

export function loadProjectPolicy(options: {
  projectRoot: string;
  policyPath?: string;
  pin?: ApmPolicyPin;
  requirePolicy?: boolean;
}): PolicyLoadResult {
  const projectRoot = resolve(options.projectRoot);
  const warnings: string[] = [];
  const pin = options.pin;

  let filePath: string | undefined;
  try {
    filePath = resolvePolicyFile(projectRoot, options.policyPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      pin,
      warnings,
      violations: [pinViolation("policy-path", message)],
    };
  }

  if (!filePath || !existsSync(filePath)) {
    if (pin) {
      return {
        status: "failed",
        pin,
        warnings,
        violations: [
          pinViolation(
            "policy-missing",
            `apm.yml pins policy.hash but ${APM_POLICY_FILENAME} is missing`,
          ),
        ],
      };
    }
    if (options.requirePolicy) {
      return {
        status: "failed",
        warnings,
        violations: [
          pinViolation(
            "policy-required",
            `No ${APM_POLICY_FILENAME} found (required by --require-policy)`,
          ),
        ],
      };
    }
    return { status: "skipped", skippedReason: "no-policy", warnings, violations: [] };
  }

  const bytes = readFileSync(filePath);
  if (pin) {
    const actual = hashPolicyBytes(bytes, pin.algorithm);
    if (!policyHashesMatch(pin.hash, actual)) {
      return {
        status: "failed",
        source: toPosix(relative(projectRoot, filePath)) || APM_POLICY_FILENAME,
        pin,
        warnings,
        violations: [
          pinViolation(
            "policy-hash-mismatch",
            `Pinned policy.hash does not match ${APM_POLICY_FILENAME} (${actual})`,
          ),
        ],
      };
    }
  }

  try {
    const policy = parseApmPolicyDocument(bytes.toString("utf8"), filePath);
    return {
      status: "evaluated",
      source: toPosix(relative(projectRoot, filePath)) || APM_POLICY_FILENAME,
      policy,
      pin,
      warnings: [...warnings, ...policy.warnings],
      violations: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      source: toPosix(relative(projectRoot, filePath)) || APM_POLICY_FILENAME,
      pin,
      warnings,
      violations: [pinViolation("policy-parse", message)],
    };
  }
}

function hostFromCanonicalRepo(repoUrl: string): string | undefined {
  if (repoUrl.startsWith("file://")) {
    return undefined;
  }
  const host = repoUrl.split("/")[0];
  return host && (host.includes(".") || host === "localhost") ? host.toLowerCase() : undefined;
}

function gitIdentities(identity: string, host?: string): string[] {
  const ids = new Set<string>([identity]);
  if (host && identity.startsWith(`${host}/`)) {
    ids.add(identity.slice(host.length + 1));
  }
  if (host) {
    ids.add(host);
  }
  ids.add("git");
  return [...ids];
}

function catalogIdentities(identity: string): string[] {
  return [...new Set([identity, "catalog"])];
}

function localIdentities(identity: string): string[] {
  const ids = new Set<string>([identity, "local", ".", "./"]);
  if (identity.startsWith("./") || identity.startsWith("../")) {
    ids.add(identity);
  }
  return [...ids];
}

export function matchPolicyPattern(pattern: string, candidates: string[]): boolean {
  const normalized = pattern.trim();
  if (!normalized) {
    return false;
  }
  if (candidates.includes(normalized)) {
    return true;
  }
  const match = picomatch(normalized, { dot: true });
  if (candidates.some((candidate) => match(candidate))) {
    return true;
  }
  if (normalized.endsWith("/*")) {
    const prefix = normalized.slice(0, -2);
    return candidates.some(
      (candidate) => candidate === prefix || candidate.startsWith(`${prefix}/`),
    );
  }
  return false;
}

function sourceCandidates(source: PolicyPlanSource): string[] {
  switch (source.kind) {
    case "git":
      return gitIdentities(source.identity, source.host);
    case "catalog":
      return catalogIdentities(source.identity);
    case "local":
      return localIdentities(source.path ?? source.identity);
    case "marketplace":
      return [...new Set([source.identity, "marketplace"])];
    default: {
      const _exhaustive: never = source.kind;
      return _exhaustive;
    }
  }
}

function sourceMatches(patterns: string[], source: PolicyPlanSource): string | undefined {
  const candidates = sourceCandidates(source);
  return patterns.find((pattern) => matchPolicyPattern(pattern, candidates));
}

function mcpCandidates(entry: PolicyPlanMcp): string[] {
  return [...new Set([entry.identity, entry.name])];
}

function mcpMatches(patterns: string[], entry: PolicyPlanMcp): string | undefined {
  const candidates = mcpCandidates(entry);
  return patterns.find((pattern) => matchPolicyPattern(pattern, candidates));
}

function uniquePrimitives(values: Array<PolicyPrimitive | undefined>): PolicyPrimitive[] {
  return [...new Set(values.filter((value): value is PolicyPrimitive => value !== undefined))].sort();
}

export function sourceFromApmDependency(dep: ParsedApmDependency, depth = 1): PolicyPlanSource {
  if (dep.sourceKind === "git") {
    const identity = canonicalApmRepoUrl(dep.originRef);
    return {
      kind: "git",
      name: dep.name,
      identity,
      ...(hostFromCanonicalRepo(identity) ? { host: hostFromCanonicalRepo(identity) } : {}),
      depth,
    };
  }
  if (dep.sourceKind === "catalog") {
    return { kind: "catalog", name: dep.name, identity: dep.originRef, depth };
  }
  if (dep.sourceKind === "marketplace") {
    return { kind: "marketplace", name: dep.name, identity: dep.originRef, depth };
  }
  return {
    kind: "local",
    name: dep.name,
    identity: dep.originRef,
    path: dep.originRef,
    depth,
  };
}

function sourceFromLockEntry(entry: LockEntry): PolicyPlanSource {
  if (entry.source === "git" || entry.repo_url) {
    const identity = entry.repo_url
      ? canonicalApmRepoUrl(entry.repo_url)
      : entry.name;
    return {
      kind: "git",
      name: entry.name,
      identity,
      ...(hostFromCanonicalRepo(identity) ? { host: hostFromCanonicalRepo(identity) } : {}),
      depth: entry.depth,
    };
  }
  if (entry.source === "catalog") {
    return {
      kind: "catalog",
      name: entry.name,
      identity: entry.repo_url ?? entry.name,
      depth: entry.depth,
    };
  }
  if (entry.source === "marketplace") {
    return {
      kind: "marketplace",
      name: entry.name,
      identity: entry.name,
      depth: entry.depth,
    };
  }
  return {
    kind: "local",
    name: entry.name,
    identity: entry.name,
    path: entry.name,
    depth: entry.depth,
  };
}

function sourceFromSelectedPlugin(
  name: string,
  source: DependencySourceKind,
  depth: number,
  pluginId?: string,
  repoUrl?: string,
): PolicyPlanSource {
  if (repoUrl) {
    const identity = canonicalApmRepoUrl(repoUrl);
    return {
      kind: "git",
      name,
      identity,
      ...(hostFromCanonicalRepo(identity) ? { host: hostFromCanonicalRepo(identity) } : {}),
      depth,
    };
  }
  if (pluginId) {
    const plugin = getPluginById(pluginId);
    if (plugin) {
      const locator = recoverOriginLocator(plugin);
      if (locator?.kind === "git") {
        const identity = canonicalApmRepoUrl(locator.url);
        return {
          kind: "git",
          name,
          identity,
          ...(hostFromCanonicalRepo(identity) ? { host: hostFromCanonicalRepo(identity) } : {}),
          depth,
        };
      }
      if (locator?.kind === "catalog") {
        return {
          kind: "catalog",
          name,
          identity: `${locator.org}/${locator.catalog}/${locator.slug}`,
          depth,
        };
      }
      if (locator?.kind === "marketplace") {
        return { kind: "marketplace", name, identity: locator.ref, depth };
      }
    }
  }
  if (source === "catalog") {
    return { kind: "catalog", name, identity: name, depth };
  }
  if (source === "marketplace") {
    return { kind: "marketplace", name, identity: name, depth };
  }
  if (source === "git") {
    return { kind: "git", name, identity: name, depth };
  }
  return { kind: "local", name, identity: name, path: name, depth };
}

function mergeSources(sources: PolicyPlanSource[]): PolicyPlanSource[] {
  const byKey = new Map<string, PolicyPlanSource>();
  for (const source of sources) {
    const key = `${source.kind}:${source.identity}`;
    const existing = byKey.get(key);
    if (!existing || source.depth < existing.depth) {
      byKey.set(key, source);
    }
  }
  return [...byKey.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function declaredMcpNames(deps: ParsedMcpDependency[]): Set<string> {
  return new Set(deps.map((dep) => dep.name));
}

function mcpFromManifest(deps: ParsedMcpDependency[]): PolicyPlanMcp[] {
  return deps.map((dep) => ({
    name: dep.name,
    identity: dep.registryId ?? dep.name,
    depth: 0,
    declaredInManifest: true,
  }));
}

function mcpFromLock(servers: LockMcpServer[] | undefined, declared: Set<string>): PolicyPlanMcp[] {
  if (!servers) {
    return [];
  }
  return servers.map((server) => ({
    name: server.name,
    identity: server.name,
    depth: declared.has(server.name) ? 0 : 1,
    declaredInManifest: declared.has(server.name),
  }));
}

function overlayPrimitives(projectRoot: string): PolicyPrimitive[] {
  try {
    const overlay = inspectApmOverlay(projectRoot);
    if (!overlay) {
      return [];
    }
    const types: Array<PolicyPrimitive | undefined> = [
      ...overlay.skills.map(() => "skill" as const),
      ...overlay.primitives.map((primitive) => primitiveFromResourceType(primitive.type)),
    ];
    return uniquePrimitives(types);
  } catch {
    return [];
  }
}

export function buildAuditInstallPlan(options: {
  projectRoot: string;
  apmDependencies?: ParsedApmDependency[];
  mcpDependencies?: ParsedMcpDependency[];
  lock?: Lockfile;
}): PolicyInstallPlan {
  const declared = declaredMcpNames(options.mcpDependencies ?? []);
  const sources = mergeSources([
    ...(options.apmDependencies ?? []).map((dep) => sourceFromApmDependency(dep, 1)),
    ...(options.lock?.plugins ?? []).map(sourceFromLockEntry),
  ]);
  const primitives = uniquePrimitives([
    ...overlayPrimitives(options.projectRoot),
    ...(options.lock?.mcp_servers?.length ? (["mcp"] as const) : []),
    ...(options.mcpDependencies?.length ? (["mcp"] as const) : []),
  ]);
  const mcp = [
    ...mcpFromManifest(options.mcpDependencies ?? []),
    ...mcpFromLock(options.lock?.mcp_servers, declared).filter(
      (entry) => !declared.has(entry.name),
    ),
  ];
  return { sources, primitives, mcp };
}

export function buildApplyInstallPlan(options: {
  resolution: ResolutionResult;
  resources: Resource[];
  apmDependencies?: ParsedApmDependency[];
  mcpDependencies?: ParsedMcpDependency[];
  gitLocks?: Array<{ name: string; repo_url: string }>;
}): PolicyInstallPlan {
  const declared = declaredMcpNames(options.mcpDependencies ?? []);
  const gitByName = new Map((options.gitLocks ?? []).map((entry) => [entry.name, entry.repo_url]));
  const sources = mergeSources([
    ...(options.apmDependencies ?? []).map((dep) => sourceFromApmDependency(dep, 1)),
    ...options.resolution.selected
      .filter((plugin) => plugin.depth > 0)
      .map((plugin) =>
        sourceFromSelectedPlugin(
          plugin.name,
          plugin.source,
          plugin.depth,
          plugin.pluginId,
          gitByName.get(plugin.name),
        ),
      ),
  ]);

  const primitives = uniquePrimitives(
    options.resources.map((resource) => primitiveFromResourceType(resource.type)),
  );

  const depthByResource = new Map(
    options.resolution.decisions.map((decision) => [decision.key, decision.winner.depth]),
  );
  const mcp: PolicyPlanMcp[] = options.resources
    .filter((resource) => resource.type === "mcp_server")
    .map((resource) => {
      const depth = depthByResource.get(resolutionKey(resource)) ?? 0;
      return {
        name: resource.name,
        identity: resource.origin_ref || resource.name,
        depth,
        declaredInManifest: declared.has(resource.name),
      };
    });

  return { sources, primitives, mcp };
}

export function evaluatePolicy(
  policy: ApmPolicyDocument,
  plan: PolicyInstallPlan,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const source of plan.sources) {
    const denied = sourceMatches(policy.dependenciesDeny ?? [], source);
    if (denied) {
      violations.push({
        code: "source-denied",
        subject: source.identity,
        message: `Source ${source.identity} matches deny pattern ${denied}`,
      });
      continue;
    }
    if (policy.dependenciesAllow) {
      const allowed = sourceMatches(policy.dependenciesAllow, source);
      if (!allowed) {
        violations.push({
          code: "source-not-allowed",
          subject: source.identity,
          message: `Source ${source.identity} (${source.kind}) is not in dependencies.allow`,
        });
      }
    }
  }

  if (policy.contentTypesAllow) {
    const allowed = new Set(
      policy.contentTypesAllow
        .map(normalizeContentType)
        .filter((value): value is PolicyPrimitive => value !== undefined),
    );
    for (const primitive of plan.primitives) {
      if (!allowed.has(primitive)) {
        violations.push({
          code: "primitive-not-allowed",
          subject: primitive,
          message: `Primitive ${primitive} is not in manifest.content_types.allow`,
        });
      }
    }
  }

  for (const entry of plan.mcp) {
    const denied = mcpMatches(policy.mcpDeny ?? [], entry);
    if (denied) {
      violations.push({
        code: "mcp-denied",
        subject: entry.name,
        message: `MCP server ${entry.name} matches deny pattern ${denied}`,
      });
      continue;
    }
    const allowListed = mcpMatches(policy.mcpAllow ?? [], entry);
    const transitive = entry.depth > 0 && !entry.declaredInManifest;
    if (transitive && !policy.trustTransitive && !allowListed) {
      violations.push({
        code: "mcp-transitive",
        subject: entry.name,
        message:
          `Transitive MCP server ${entry.name} is not declared in apm.yml dependencies.mcp ` +
          "or mcp.allow (mcp.trust_transitive is false)",
      });
      continue;
    }
    if (policy.mcpAllow && !allowListed && !entry.declaredInManifest) {
      violations.push({
        code: "mcp-not-allowed",
        subject: entry.name,
        message: `MCP server ${entry.name} is not in mcp.allow`,
      });
    }
  }

  return violations;
}

export function evaluationFromLoad(
  loaded: PolicyLoadResult,
  plan: PolicyInstallPlan,
): PolicyEvaluation {
  if (loaded.status === "skipped") {
    return {
      status: "skipped",
      skippedReason: "no-policy",
      enforcement: "off",
      warnings: loaded.warnings,
      violations: [],
      blocks: false,
    };
  }
  if (loaded.status === "failed" || !loaded.policy) {
    return {
      status: "failed",
      source: loaded.source,
      enforcement: "block",
      warnings: loaded.warnings,
      violations: loaded.violations,
      blocks: true,
    };
  }

  const violations = evaluatePolicy(loaded.policy, plan);
  const enforcement = loaded.policy.enforcement;
  const blocks = enforcement === "block" && violations.length > 0;

  return {
    status: "evaluated",
    source: loaded.source,
    name: loaded.policy.name || undefined,
    enforcement,
    warnings: loaded.warnings,
    violations,
    blocks,
  };
}

export function loadAndEvaluateProjectPolicy(options: {
  projectRoot: string;
  policyPath?: string;
  pin?: ApmPolicyPin;
  requirePolicy?: boolean;
  plan: PolicyInstallPlan;
}): PolicyEvaluation {
  const loaded = loadProjectPolicy({
    projectRoot: options.projectRoot,
    ...(options.policyPath ? { policyPath: options.policyPath } : {}),
    ...(options.pin ? { pin: options.pin } : {}),
    ...(options.requirePolicy ? { requirePolicy: true } : {}),
  });
  return evaluationFromLoad(loaded, options.plan);
}

export function readManifestPolicyPin(projectRoot: string): ApmPolicyPin | undefined {
  const manifestPath = join(projectRoot, APM_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  const document = parseYamlMapping(readFileSync(manifestPath, "utf8"), manifestPath);
  return parseApmPolicyPin(document.policy);
}

export function formatPolicyViolations(violations: PolicyViolation[]): string {
  if (violations.length === 1 && violations[0]) {
    return violations[0].message;
  }
  return [
    `${violations.length} policy violation(s)`,
    ...violations.map((violation) => `- ${violation.message}`),
  ].join("\n");
}

export function evaluateApplyPolicy(options: {
  projectRoot: string;
  resolution: ResolutionResult;
  resources: Resource[];
  apmDependencies?: ParsedApmDependency[];
  mcpDependencies?: ParsedMcpDependency[];
  gitLocks?: Array<{ name: string; repo_url: string }>;
  pin?: ApmPolicyPin;
}): PolicyEvaluation {
  const plan = buildApplyInstallPlan({
    resolution: options.resolution,
    resources: options.resources,
    apmDependencies: options.apmDependencies,
    mcpDependencies: options.mcpDependencies,
    gitLocks: options.gitLocks,
  });
  return loadAndEvaluateProjectPolicy({
    projectRoot: options.projectRoot,
    ...(options.pin ? { pin: options.pin } : {}),
    plan,
  });
}

export function assertPolicyAllowsApply(evaluation: PolicyEvaluation): void {
  if (!evaluation.blocks) {
    return;
  }
  throw new PolicyError(formatPolicyViolations(evaluation.violations), evaluation.violations);
}
