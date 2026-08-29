import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseJsonc } from "../config/settings.js";
import { getHarnesstapDir } from "../db/connection.js";
import { getPluginById, getPluginByName, getPluginResources } from "../models/plugin-model.js";
import type { McpServerMetadata, Resource } from "../types.js";
import { canonicalApmRepoUrl } from "./apm-git-resolve.js";
import {
  loadProjectPolicy,
  matchPolicyPattern,
  type ApmPolicyDocument,
  type OrgExecutablePolicy,
  type PolicyLoadResult,
} from "./apm-policy.js";
import type { ApmGitLockFields, LockEntry, Lockfile } from "./lockfile.js";
import { resolutionKey } from "./resolve/resource-resolution.js";
import type { ResolutionResult, SelectedPlugin } from "./resolve/types.js";

const APM_MANIFEST_FILENAME = "apm.yml";

export const EXEC_TYPES = ["hooks", "bin", "mcp"] as const;
export type ExecType = (typeof EXEC_TYPES)[number];

export const EXEC_STATUSES = [
  "deployed",
  "gated_pending_approval",
  "denied",
  "absent",
] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];

export const EXEC_LAYERS = [
  "org-deny-all",
  "org-deny",
  "user-deny",
  "project-deny",
  "project-allow",
  "user-allow",
  "org-recommend",
  "none",
] as const;
export type ExecLayer = (typeof EXEC_LAYERS)[number];

export type ExecOutcome = "allowed" | "denied" | "gated_pending_approval";

export interface ExecTypeFlags {
  hooks?: boolean;
  bin?: boolean;
  mcp?: boolean;
}

export interface ExecGrantMap {
  allow: Record<string, ExecTypeFlags>;
  deny: Record<string, ExecTypeFlags>;
}

export interface ProjectExecutables extends ExecGrantMap {
  present: boolean;
}

export interface ExecTypeDecision {
  type: ExecType;
  outcome: ExecOutcome;
  layer: ExecLayer;
  shadowed: Array<{ layer: ExecLayer; outcome: ExecOutcome }>;
}

export interface PackageTrustReport {
  ref: string;
  name: string;
  version: string;
  identities: string[];
  gatedTypes: ExecType[];
  decisions: ExecTypeDecision[];
  execStatus: ExecStatus;
}

export interface ExecutableTrustContext {
  optedIn: boolean;
  warnings: string[];
  org?: OrgExecutablePolicy;
  binDeployDenyAll: boolean;
  binDeployDeny: string[];
  project: ProjectExecutables;
  user: ExecGrantMap;
}

export interface ExecutableTrustApplyResult {
  optedIn: boolean;
  warnings: string[];
  resources: Resource[];
  parked: Array<{ ref: string; types: ExecType[] }>;
  reports: PackageTrustReport[];
  execStatuses: Record<string, ExecStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function grantKeyBase(value: string): string {
  const hash = value.lastIndexOf("#");
  return (hash > 0 ? value.slice(0, hash) : value).trim();
}

export function ownerRepoFromIdentity(identity: string): string {
  const base = grantKeyBase(identity).replace(/\.git$/i, "");
  const parts = base.split("/").filter(Boolean);
  if (parts.length >= 3 && (parts[0]?.includes(".") || parts[0] === "localhost")) {
    return `${parts[1]}/${parts[2]}`;
  }
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return base;
}

function identityBases(identity: string): string[] {
  const base = grantKeyBase(identity).toLowerCase();
  const ownerRepo = ownerRepoFromIdentity(identity).toLowerCase();
  return [...new Set([base, ownerRepo].filter((entry) => entry.length > 0))];
}

export function exactGrantMatch(grantKey: string, identities: string[]): boolean {
  const grantBases = new Set(identityBases(grantKey));
  return identities.some((identity) => identityBases(identity).some((base) => grantBases.has(base)));
}

export function globGrantMatch(pattern: string, identities: string[]): boolean {
  const candidates = [...new Set(identities.flatMap((identity) => identityBases(identity)))];
  return matchPolicyPattern(pattern, candidates) || matchPolicyPattern(pattern, identities);
}

function parseTypeFlags(value: unknown, field: string): ExecTypeFlags {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping of executable types`);
  }
  const flags: ExecTypeFlags = {};
  for (const type of EXEC_TYPES) {
    const entry = value[type];
    if (entry === true) {
      flags[type] = true;
    } else if (entry === false) {
      flags[type] = false;
    }
  }
  return flags;
}

function parseGrantMap(value: unknown, field: string): Record<string, ExecTypeFlags> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  const grants: Record<string, ExecTypeFlags> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim()) {
      continue;
    }
    grants[key.trim()] = parseTypeFlags(entry, `${field}.${key}`);
  }
  return grants;
}

export function parseProjectExecutables(value: unknown): ProjectExecutables {
  if (value === undefined) {
    return { present: false, allow: {}, deny: {} };
  }
  if (value === null) {
    return { present: true, allow: {}, deny: {} };
  }
  if (!isRecord(value)) {
    throw new Error("executables must be a mapping");
  }
  return {
    present: true,
    allow: parseGrantMap(value.allow, "executables.allow"),
    deny: parseGrantMap(value.deny, "executables.deny"),
  };
}

export function parseUserExecutables(value: unknown): ExecGrantMap {
  if (!isRecord(value)) {
    return { allow: {}, deny: {} };
  }
  return {
    allow: parseGrantMap(value.allow, "executables.allow"),
    deny: parseGrantMap(value.deny, "executables.deny"),
  };
}

export function emptyGrantMap(): ExecGrantMap {
  return { allow: {}, deny: {} };
}

function userConfigPath(harnesstapDir: string): string {
  const jsoncPath = join(harnesstapDir, "config.jsonc");
  const jsonPath = join(harnesstapDir, "config.json");
  if (existsSync(jsoncPath) || !existsSync(jsonPath)) {
    return jsoncPath;
  }
  return jsonPath;
}

export function loadUserExecutables(harnesstapDir = getHarnesstapDir()): ExecGrantMap {
  const path = userConfigPath(harnesstapDir);
  if (!existsSync(path)) {
    return emptyGrantMap();
  }
  try {
    const parsed = parseJsonc(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      return emptyGrantMap();
    }
    return parseUserExecutables(parsed.executables);
  } catch {
    return emptyGrantMap();
  }
}

export function loadProjectExecutables(projectRoot: string): ProjectExecutables {
  const manifestPath = join(projectRoot, APM_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return { present: false, allow: {}, deny: {} };
  }
  const parsed = parseYaml(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed)) {
    return { present: false, allow: {}, deny: {} };
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "executables")) {
    return { present: false, allow: {}, deny: {} };
  }
  return parseProjectExecutables(parsed.executables);
}

export function orgExecutablesOptIn(policy: ApmPolicyDocument): boolean {
  return policy.executables.nonEmpty || policy.binDeployNonEmpty;
}

export function executableGateOptedIn(
  project: ProjectExecutables,
  policy?: ApmPolicyDocument,
): boolean {
  if (project.present) {
    return true;
  }
  return policy ? orgExecutablesOptIn(policy) : false;
}

export function buildExecutableTrustContext(options: {
  projectRoot: string;
  loaded?: PolicyLoadResult;
  harnesstapDir?: string;
}): ExecutableTrustContext {
  const loaded = options.loaded ?? loadProjectPolicy({ projectRoot: options.projectRoot });
  const project = loadProjectExecutables(options.projectRoot);
  const user = loadUserExecutables(options.harnesstapDir);
  const policy = loaded.policy;
  const warnings = [
    ...(loaded.warnings ?? []),
    ...(policy?.warnings ?? []),
    ...(policy?.executables.warnings ?? []),
  ];
  return {
    optedIn: executableGateOptedIn(project, policy),
    warnings,
    ...(policy ? { org: policy.executables } : {}),
    binDeployDenyAll: policy?.binDeployDenyAll ?? false,
    binDeployDeny: policy?.binDeployDeny ?? [],
    project,
    user,
  };
}

function grantHitsType(
  grants: Record<string, ExecTypeFlags>,
  identities: string[],
  type: ExecType,
): string | undefined {
  for (const [key, flags] of Object.entries(grants)) {
    if (flags[type] === true && exactGrantMatch(key, identities)) {
      return key;
    }
  }
  return undefined;
}

function orgListHits(
  patterns: string[],
  identities: string[],
  glob: boolean,
): string | undefined {
  return patterns.find((pattern) =>
    glob ? globGrantMatch(pattern, identities) : exactGrantMatch(pattern, identities),
  );
}

export function evaluateExecutableType(
  context: ExecutableTrustContext,
  identities: string[],
  type: ExecType,
): ExecTypeDecision {
  const hits: Array<{ layer: ExecLayer; outcome: ExecOutcome }> = [];
  const org = context.org;

  if (org?.denyAll) {
    hits.push({ layer: "org-deny-all", outcome: "denied" });
  } else if (org && orgListHits(org.deny, identities, true)) {
    hits.push({ layer: "org-deny", outcome: "denied" });
  }

  if (
    type === "bin" &&
    (context.binDeployDenyAll || orgListHits(context.binDeployDeny, identities, true))
  ) {
    hits.push({ layer: "org-deny", outcome: "denied" });
  }

  if (grantHitsType(context.user.deny, identities, type)) {
    hits.push({ layer: "user-deny", outcome: "denied" });
  }
  if (grantHitsType(context.project.deny, identities, type)) {
    hits.push({ layer: "project-deny", outcome: "denied" });
  }
  if (grantHitsType(context.project.allow, identities, type)) {
    hits.push({ layer: "project-allow", outcome: "allowed" });
  }
  if (grantHitsType(context.user.allow, identities, type)) {
    hits.push({ layer: "user-allow", outcome: "allowed" });
  }
  if (org && orgListHits(org.recommend, identities, false)) {
    hits.push({ layer: "org-recommend", outcome: "allowed" });
  }

  const first = hits[0];
  if (!first) {
    return { type, outcome: "gated_pending_approval", layer: "none", shadowed: [] };
  }
  return {
    type,
    outcome: first.outcome,
    layer: first.layer,
    shadowed: hits.slice(1),
  };
}

export function execStatusFromDecisions(
  gatedTypes: ExecType[],
  decisions: ExecTypeDecision[],
): ExecStatus {
  if (gatedTypes.length === 0) {
    return "absent";
  }
  const relevant = decisions.filter((decision) => gatedTypes.includes(decision.type));
  if (relevant.some((decision) => decision.outcome === "denied")) {
    return "denied";
  }
  if (relevant.some((decision) => decision.outcome === "gated_pending_approval")) {
    return "gated_pending_approval";
  }
  return "deployed";
}

export function isSelfDefinedMcp(resource: Resource): boolean {
  if (resource.type !== "mcp_server") {
    return false;
  }
  const metadata = resource.metadata as McpServerMetadata;
  return Boolean(metadata.command || metadata.url);
}

export function gatedTypeForResource(resource: Resource): ExecType | undefined {
  switch (resource.type) {
    case "hook":
      return "hooks";
    case "mcp_server":
      return isSelfDefinedMcp(resource) ? "mcp" : undefined;
    case "instruction":
    case "skill":
    case "rule":
    case "permission":
    case "agent":
    case "command":
    case "env_var":
    case "model_config":
    case "plugin":
      return undefined;
    default: {
      const _exhaustive: never = resource.type;
      return _exhaustive;
    }
  }
}

export function gatedTypesFromResources(resources: Resource[]): ExecType[] {
  return [...new Set(resources.map(gatedTypeForResource).filter((value): value is ExecType => value !== undefined))];
}

export function packageIdentities(
  plugin: SelectedPlugin,
  gitLocks?: ApmGitLockFields[],
): string[] {
  const ids = new Set<string>([plugin.name, `${plugin.name}#${plugin.version}`]);
  const extra = gitLocks?.find((entry) => entry.name === plugin.name);
  const stored = getPluginById(plugin.pluginId);
  const repo = extra?.repo_url ?? stored?.origin_locator;
  if (repo) {
    const canonical = canonicalApmRepoUrl(repo);
    ids.add(canonical);
    ids.add(ownerRepoFromIdentity(canonical));
    if (plugin.version) {
      ids.add(`${ownerRepoFromIdentity(canonical)}#${plugin.version}`);
    }
  }
  return [...ids];
}

export function packageRefFor(plugin: SelectedPlugin, gitLocks?: ApmGitLockFields[]): string {
  const extra = gitLocks?.find((entry) => entry.name === plugin.name);
  const stored = getPluginById(plugin.pluginId);
  const repo = extra?.repo_url ?? stored?.origin_locator;
  if (repo) {
    return ownerRepoFromIdentity(canonicalApmRepoUrl(repo));
  }
  return plugin.name;
}

function pluginHasBinDirectory(pluginId: string): boolean {
  const plugin = getPluginById(pluginId);
  const locator = plugin?.origin_locator;
  if (!locator) {
    return false;
  }
  try {
    if (locator.startsWith("/") || locator.startsWith("./") || locator.startsWith("../")) {
      return existsSync(join(locator, "bin"));
    }
  } catch {
    return false;
  }
  return false;
}

export function gatedTypesForPlugin(pluginId: string): ExecType[] {
  const resources = getPluginResources(pluginId);
  const types = new Set(gatedTypesFromResources(resources));
  if (pluginHasBinDirectory(pluginId)) {
    types.add("bin");
  }
  return [...types];
}

export function reportForPlugin(
  context: ExecutableTrustContext,
  plugin: SelectedPlugin,
  gitLocks?: ApmGitLockFields[],
): PackageTrustReport {
  const identities = packageIdentities(plugin, gitLocks);
  const gatedTypes = plugin.depth === 0 ? [] : gatedTypesForPlugin(plugin.pluginId);
  const decisions = EXEC_TYPES.map((type) => evaluateExecutableType(context, identities, type));
  return {
    ref: packageRefFor(plugin, gitLocks),
    name: plugin.name,
    version: plugin.version,
    identities,
    gatedTypes,
    decisions,
    execStatus: execStatusFromDecisions(gatedTypes, decisions),
  };
}

function winnerPluginName(
  resolution: ResolutionResult,
  resource: Resource,
): string | undefined {
  const key = resolutionKey(resource);
  return resolution.decisions.find((decision) => decision.key === key)?.winner.pluginName;
}

export function applyExecutableTrustGate(options: {
  projectRoot: string;
  resolution: ResolutionResult;
  resources: Resource[];
  gitLocks?: ApmGitLockFields[];
  loaded?: PolicyLoadResult;
  harnesstapDir?: string;
}): ExecutableTrustApplyResult {
  const context = buildExecutableTrustContext({
    projectRoot: options.projectRoot,
    ...(options.loaded ? { loaded: options.loaded } : {}),
    ...(options.harnesstapDir ? { harnesstapDir: options.harnesstapDir } : {}),
  });
  const selectedByName = new Map(
    options.resolution.selected.map((plugin) => [plugin.name, plugin]),
  );
  const reports = options.resolution.selected
    .filter((plugin) => plugin.depth > 0)
    .map((plugin) => reportForPlugin(context, plugin, options.gitLocks));
  const execStatuses = Object.fromEntries(
    reports.map((report) => [report.name, context.optedIn ? report.execStatus : "absent"]),
  );

  if (!context.optedIn) {
    return {
      optedIn: false,
      warnings: context.warnings,
      resources: options.resources,
      parked: [],
      reports,
      execStatuses,
    };
  }

  const parkedByRef = new Map<string, Set<ExecType>>();
  const resources = options.resources.filter((resource) => {
    const type = gatedTypeForResource(resource);
    if (!type) {
      return true;
    }
    const pluginName = winnerPluginName(options.resolution, resource);
    if (!pluginName) {
      return true;
    }
    const plugin = selectedByName.get(pluginName);
    if (!plugin || plugin.depth === 0) {
      return true;
    }
    const identities = packageIdentities(plugin, options.gitLocks);
    const decision = evaluateExecutableType(context, identities, type);
    if (decision.outcome === "allowed") {
      return true;
    }
    const ref = packageRefFor(plugin, options.gitLocks);
    const types = parkedByRef.get(ref) ?? new Set<ExecType>();
    types.add(type);
    parkedByRef.set(ref, types);
    return false;
  });

  return {
    optedIn: true,
    warnings: context.warnings,
    resources,
    parked: [...parkedByRef.entries()].map(([ref, types]) => ({
      ref,
      types: [...types],
    })),
    reports,
    execStatuses,
  };
}

export function overlappingDeployedHashes(
  expected: Record<string, string>,
  files: Array<{ path: string }>,
): Record<string, string> {
  const actual = new Set(files.map((file) => file.path));
  return Object.fromEntries(
    Object.entries(expected).filter(([path]) => actual.has(path)),
  );
}

export function formatApproveRemedy(refs: string[]): string {
  if (refs.length === 0) {
    return "ht approve <PACKAGE_REF>";
  }
  return `ht approve ${refs.join(" ")}`;
}

function readYamlMapping(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${filePath}`);
  }
  const parsed = parseYaml(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must be a YAML mapping`);
  }
  return parsed;
}

function writeYamlMapping(filePath: string, document: Record<string, unknown>): void {
  writeFileSync(
    filePath,
    stringifyYaml(document, {
      indent: 2,
      lineWidth: 0,
      defaultKeyType: "PLAIN",
    }),
    "utf8",
  );
}

const ALL_TYPE_FLAGS: ExecTypeFlags = { hooks: true, bin: true, mcp: true };

function mergeGrantFlags(
  existing: ExecTypeFlags | undefined,
  types: ExecType[] | undefined,
): ExecTypeFlags {
  if (!types || types.length === 0) {
    return { ...ALL_TYPE_FLAGS };
  }
  const next = { ...(existing ?? {}) };
  for (const type of types) {
    next[type] = true;
  }
  return next;
}

export function writeProjectExecutableGrant(options: {
  projectRoot: string;
  side: "allow" | "deny";
  refs: string[];
  types?: ExecType[];
}): void {
  const manifestPath = join(options.projectRoot, APM_MANIFEST_FILENAME);
  const document = existsSync(manifestPath)
    ? readYamlMapping(manifestPath)
    : { name: "project", version: "1.0.0" };
  const current = isRecord(document.executables) ? { ...document.executables } : {};
  const side = isRecord(current[options.side]) ? { ...current[options.side] } : {};
  for (const ref of options.refs) {
    side[ref] = mergeGrantFlags(
      isRecord(side[ref]) ? parseTypeFlags(side[ref], `executables.${options.side}.${ref}`) : undefined,
      options.types,
    );
  }
  document.executables = {
    ...current,
    [options.side]: side,
  };
  writeYamlMapping(manifestPath, document);
}

function readUserConfigObject(harnesstapDir: string): Record<string, unknown> {
  const path = userConfigPath(harnesstapDir);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = parseJsonc(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeUserExecutableGrant(options: {
  side: "allow" | "deny";
  refs: string[];
  types?: ExecType[];
  harnesstapDir?: string;
}): void {
  const dir = options.harnesstapDir ?? getHarnesstapDir();
  const document = readUserConfigObject(dir);
  const current = isRecord(document.executables) ? { ...document.executables } : {};
  const side = isRecord(current[options.side]) ? { ...current[options.side] } : {};
  for (const ref of options.refs) {
    side[ref] = mergeGrantFlags(
      isRecord(side[ref]) ? parseTypeFlags(side[ref], `executables.${options.side}.${ref}`) : undefined,
      options.types,
    );
  }
  document.executables = {
    ...current,
    [options.side]: side,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(userConfigPath(dir), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function installedTrustReports(
  context: ExecutableTrustContext,
  options: {
    resolution?: ResolutionResult;
    lock?: Lockfile;
    gitLocks?: ApmGitLockFields[];
  },
): PackageTrustReport[] {
  if (options.resolution) {
    return options.resolution.selected
      .filter((plugin) => plugin.depth > 0)
      .map((plugin) => reportForPlugin(context, plugin, options.gitLocks));
  }
  if (!options.lock) {
    return [];
  }
  return options.lock.plugins.map((entry) => reportFromLockEntry(context, entry));
}

function reportFromLockEntry(
  context: ExecutableTrustContext,
  entry: LockEntry,
): PackageTrustReport {
  const identities = [
    entry.name,
    `${entry.name}#${entry.version}`,
    ...(entry.repo_url
      ? [entry.repo_url, ownerRepoFromIdentity(entry.repo_url)]
      : []),
  ];
  const library = getPluginByName(entry.name, entry.version) ?? getPluginByName(entry.name);
  const gatedTypes = library ? gatedTypesForPlugin(library.id) : [];
  const decisions = EXEC_TYPES.map((type) => evaluateExecutableType(context, identities, type));
  const computed = execStatusFromDecisions(gatedTypes, decisions);
  return {
    ref: entry.repo_url ? ownerRepoFromIdentity(entry.repo_url) : entry.name,
    name: entry.name,
    version: entry.version,
    identities,
    gatedTypes,
    decisions,
    execStatus: context.optedIn ? (entry.exec_status ?? computed) : "absent",
  };
}

export function findRequiredExecutableViolations(options: {
  context: ExecutableTrustContext;
  require: string[];
  lock?: Lockfile;
  reports?: PackageTrustReport[];
}): Array<{ code: string; message: string; subject?: string }> {
  if (options.require.length === 0) {
    return [];
  }
  const reports = options.reports ?? [];
  const lock = options.lock;
  const violations: Array<{ code: string; message: string; subject?: string }> = [];

  for (const ref of options.require) {
    const report = reports.find((entry) => exactGrantMatch(ref, [entry.ref, entry.name, ...entry.identities]));
    const lockEntry = lock?.plugins.find((entry) =>
      exactGrantMatch(ref, [
        entry.name,
        ...(entry.repo_url ? [entry.repo_url, ownerRepoFromIdentity(entry.repo_url)] : []),
      ]),
    );
    const status = lockEntry?.exec_status ?? report?.execStatus;
    const present = Boolean(lockEntry || report);
    if (!present || status === "denied" || status === "gated_pending_approval") {
      const detail = !present
        ? "is not installed"
        : `has untrusted executables (${status})`;
      violations.push({
        code: "required-executable-untrusted",
        subject: ref,
        message: `Required package ${ref} ${detail}`,
      });
    }
  }
  return violations;
}

export function recommendRefs(org?: OrgExecutablePolicy): string[] {
  return org?.recommend ?? [];
}

export function pendingRefs(reports: PackageTrustReport[]): string[] {
  return reports
    .filter((report) => report.execStatus === "gated_pending_approval")
    .map((report) => report.ref);
}
