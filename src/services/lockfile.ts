import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { hasParentTraversalSegment } from "../utils/path-containment.js";
import { getPluginById, getPluginResources } from "../models/plugin-model.js";
import type { McpServerMetadata, Resource } from "../types.js";
import { PACKAGE_VERSION } from "../version.js";
import { recoverOriginLocator } from "./plugin-origin-locator.js";
import { canonicalApmRepoUrl } from "./apm-git-resolve.js";
import { resourceFingerprint, resolutionKey } from "./resolve/resource-resolution.js";
import type { ResolutionResult, SelectedPlugin } from "./resolve/types.js";

export const APM_LOCKFILE_FILENAME = "apm.lock.yaml";
export const LOCKFILE_VERSION = "1";

export type LockSource = "local" | "marketplace" | "git" | "catalog";

export interface LockEntry {
  name: string;
  version: string;
  source: LockSource;
  /** Hash over the plugin's attached resource fingerprints. */
  integrity: string;
  depth: number;
  /** Dependency path from the root that selected this version. */
  path: string[];
  repo_url?: string;
  resolved_commit?: string;
  resolved_ref?: string;
  constraint?: string;
  resolved_tag?: string;
  virtual_path?: string;
  content_hash?: string;
}

export interface LockMcpServer {
  name: string;
  transport?: string;
  command?: string;
  url?: string;
}

export interface Lockfile {
  root: string;
  resolved_at: string;
  /** Hash over the resolved `type:name` → fingerprint map, for drift detection. */
  resource_map_hash: string;
  plugins: LockEntry[];
  environment?: string;
  mcp_servers?: LockMcpServer[];
  deployed_file_hashes?: Record<string, string>;
}

export interface ApmGitLockFields {
  name: string;
  repo_url: string;
  resolved_commit: string;
  resolved_ref?: string;
  constraint?: string;
  resolved_tag?: string;
  virtual_path?: string;
}

export interface LockfileFromResolutionExtras {
  environment?: string;
  deployedFiles?: Array<{ path: string; content: string }>;
  gitLocks?: ApmGitLockFields[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sha256Envelope(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}

function canonicalizeText(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function lockfilePath(projectRoot: string): string {
  return join(projectRoot, APM_LOCKFILE_FILENAME);
}

export function resourceMapHash(resources: Resource[]): string {
  const entries = resources
    .map((resource) => `${resolutionKey(resource)}=${resourceFingerprint(resource)}`)
    .sort();
  return sha256Envelope(entries.join("\n"));
}

export function pluginIntegrity(pluginId: string): string {
  const entries = getPluginResources(pluginId)
    .map((resource) => `${resolutionKey(resource)}=${resourceFingerprint(resource)}`)
    .sort();
  return sha256Envelope(entries.join("\n"));
}

function lockSourceFromSelected(plugin: SelectedPlugin): LockSource {
  switch (plugin.source) {
    case "local":
    case "marketplace":
    case "git":
    case "catalog":
      return plugin.source;
    default: {
      const unhandled: never = plugin.source;
      return unhandled;
    }
  }
}

function gitFieldsForPlugin(pluginId: string): Pick<
  LockEntry,
  "repo_url" | "resolved_commit" | "resolved_ref"
> {
  const plugin = getPluginById(pluginId);
  if (!plugin) {
    return {};
  }
  const locator = recoverOriginLocator(plugin);
  const repo_url = locator?.kind === "git"
    ? canonicalApmRepoUrl(locator.url)
    : plugin.origin_locator || undefined;
  const resolved_commit =
    plugin.origin_fingerprint_kind === "git_sha" && plugin.origin_fingerprint
      ? plugin.origin_fingerprint
      : undefined;
  return {
    ...(repo_url ? { repo_url } : {}),
    ...(resolved_commit ? { resolved_commit, resolved_ref: resolved_commit } : {}),
  };
}

function mergeGitLockFields(
  entry: LockEntry,
  extras: ApmGitLockFields[] | undefined,
): LockEntry {
  const extra = extras?.find((item) => item.name === entry.name);
  if (!extra) {
    return entry;
  }
  return {
    ...entry,
    source: "git",
    repo_url: extra.repo_url,
    resolved_commit: extra.resolved_commit,
    resolved_ref: extra.resolved_ref,
    constraint: extra.constraint,
    resolved_tag: extra.resolved_tag,
    virtual_path: extra.virtual_path,
  };
}

function mcpServersFromResources(resources: Resource[]): LockMcpServer[] {
  return resources
    .filter((resource) => resource.type === "mcp_server")
    .map((resource) => {
      const metadata = resource.metadata as McpServerMetadata;
      return {
        name: resource.name,
        ...(metadata.transport ? { transport: metadata.transport } : {}),
        ...(metadata.command ? { command: metadata.command } : {}),
        ...(metadata.url ? { url: metadata.url } : {}),
      };
    });
}

function deployedFileHashes(
  files: Array<{ path: string; content: string }>,
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hashes[file.path] = sha256Envelope(canonicalizeText(file.content));
  }
  return hashes;
}

function normalizeDigest(value: string): string {
  return value.replace(/^sha256:/i, "").toLowerCase();
}

export class LockIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockIntegrityError";
  }
}

export type DeployedHashIssueKind = "missing" | "extra" | "mismatch" | "unsafe-path";

export interface DeployedHashIssue {
  kind: DeployedHashIssueKind;
  path: string;
  expected?: string;
  actual?: string;
}

export function diffDeployedFileHashes(
  expected: Record<string, string>,
  files: Array<{ path: string; content: string }>,
): DeployedHashIssue[] {
  const issues: DeployedHashIssue[] = [];
  const actual = deployedFileHashes(files);

  for (const relativePath of Object.keys(expected).sort()) {
    if (hasParentTraversalSegment(relativePath) || relativePath.startsWith("/")) {
      issues.push({ kind: "unsafe-path", path: relativePath });
    }
  }

  for (const relativePath of Object.keys(expected).sort()) {
    const expectedHash = expected[relativePath];
    const actualHash = actual[relativePath];
    if (actualHash === undefined) {
      issues.push({ kind: "missing", path: relativePath, expected: expectedHash });
      continue;
    }
    if (expectedHash && normalizeDigest(expectedHash) !== normalizeDigest(actualHash)) {
      issues.push({
        kind: "mismatch",
        path: relativePath,
        expected: normalizeDigest(expectedHash),
        actual: normalizeDigest(actualHash),
      });
    }
  }

  for (const relativePath of Object.keys(actual).sort()) {
    if (expected[relativePath] === undefined) {
      issues.push({ kind: "extra", path: relativePath, actual: actual[relativePath] });
    }
  }

  return issues;
}

export function verifyDeployedFileHashes(
  expected: Record<string, string>,
  files: Array<{ path: string; content: string }>,
): void {
  const issues = diffDeployedFileHashes(expected, files);
  const first = issues[0];
  if (!first) return;

  switch (first.kind) {
    case "unsafe-path":
      throw new LockIntegrityError(
        `Unsafe local_deployed_file_hashes path ${first.path} — apply aborted closed`,
      );
    case "missing":
      throw new LockIntegrityError(
        `Deployed tree is missing ${first.path} listed in local_deployed_file_hashes`,
      );
    case "mismatch":
      throw new LockIntegrityError(
        `Hash mismatch for ${first.path}: lockfile records ${first.expected}, file is ${first.actual}`,
      );
    case "extra":
      throw new LockIntegrityError(
        `Deployed tree contains extra file ${first.path} that is not listed in local_deployed_file_hashes`,
      );
    default: {
      const unhandled: never = first.kind;
      throw new LockIntegrityError(`Unknown lock integrity issue: ${String(unhandled)}`);
    }
  }
}

export function lockfileFromResolution(
  result: ResolutionResult,
  extras: LockfileFromResolutionExtras = {},
): Lockfile {
  const mcp_servers = mcpServersFromResources(result.resources);
  const deployed = extras.deployedFiles ? deployedFileHashes(extras.deployedFiles) : undefined;
  return {
    root: result.root.name,
    resolved_at: new Date().toISOString(),
    resource_map_hash: resourceMapHash(result.resources),
    plugins: result.selected
      .filter((plugin) => plugin.depth > 0)
      .map((plugin) => {
        const integrity = pluginIntegrity(plugin.pluginId);
        return mergeGitLockFields(
          {
            name: plugin.name,
            version: plugin.version,
            source: lockSourceFromSelected(plugin),
            integrity,
            depth: plugin.depth,
            path: plugin.path,
            content_hash: integrity,
            ...gitFieldsForPlugin(plugin.pluginId),
          },
          extras.gitLocks,
        );
      }),
    ...(extras.environment ? { environment: extras.environment } : {}),
    ...(mcp_servers.length > 0 ? { mcp_servers } : {}),
    ...(deployed && Object.keys(deployed).length > 0 ? { deployed_file_hashes: deployed } : {}),
  };
}

function apmSourceForEntry(entry: LockEntry): string | undefined {
  if (entry.source === "local") return "local";
  if (entry.source === "catalog") return "registry";
  return undefined;
}

function serializeLockDependency(entry: LockEntry): Record<string, unknown> {
  return {
    name: entry.name,
    version: entry.version,
    depth: entry.depth,
    ...(apmSourceForEntry(entry) ? { source: apmSourceForEntry(entry) } : {}),
    ...(entry.repo_url ? { repo_url: entry.repo_url } : {}),
    ...(entry.resolved_commit ? { resolved_commit: entry.resolved_commit } : {}),
    ...(entry.resolved_ref ? { resolved_ref: entry.resolved_ref } : {}),
    ...(entry.constraint ? { constraint: entry.constraint } : {}),
    ...(entry.resolved_tag ? { resolved_tag: entry.resolved_tag } : {}),
    ...(entry.virtual_path ? { virtual_path: entry.virtual_path } : {}),
    ...(entry.content_hash ? { content_hash: entry.content_hash } : {}),
  };
}

export function writeLockfile(projectRoot: string, lock: Lockfile): void {
  const path = lockfilePath(projectRoot);
  const document: Record<string, unknown> = {
    lockfile_version: LOCKFILE_VERSION,
    generated_at: lock.resolved_at,
    apm_version: PACKAGE_VERSION,
    dependencies: [...lock.plugins]
      .sort((left, right) => {
        const byRepo = (left.repo_url ?? left.name).localeCompare(right.repo_url ?? right.name);
        return byRepo;
      })
      .map(serializeLockDependency),
    ...(lock.mcp_servers && lock.mcp_servers.length > 0
      ? { mcp_servers: lock.mcp_servers }
      : {}),
    ...(lock.deployed_file_hashes
      ? { local_deployed_file_hashes: lock.deployed_file_hashes }
      : {}),
    root: lock.root,
    resource_map_hash: lock.resource_map_hash,
    ...(lock.environment ? { environment: lock.environment } : {}),
    plugins: lock.plugins.map((entry) => ({
      name: entry.name,
      version: entry.version,
      source: entry.source,
      integrity: entry.integrity,
      depth: entry.depth,
      path: entry.path,
      ...(entry.repo_url ? { repo_url: entry.repo_url } : {}),
      ...(entry.resolved_commit ? { resolved_commit: entry.resolved_commit } : {}),
      ...(entry.resolved_ref ? { resolved_ref: entry.resolved_ref } : {}),
      ...(entry.constraint ? { constraint: entry.constraint } : {}),
      ...(entry.resolved_tag ? { resolved_tag: entry.resolved_tag } : {}),
      ...(entry.virtual_path ? { virtual_path: entry.virtual_path } : {}),
      ...(entry.content_hash ? { content_hash: entry.content_hash } : {}),
    })),
  };
  writeFileSync(
    path,
    stringifyYaml(document, {
      indent: 2,
      lineWidth: 0,
      defaultKeyType: "PLAIN",
    }),
    "utf8",
  );
}

function parseLockSource(value: unknown): LockSource {
  switch (value) {
    case "local":
    case "marketplace":
    case "git":
    case "catalog":
      return value;
    case "registry":
      return "catalog";
    default:
      return "local";
  }
}

function parseHtPluginEntry(entry: Record<string, unknown>): LockEntry {
  return {
    name: String(entry.name ?? ""),
    version: String(entry.version ?? ""),
    source: parseLockSource(entry.source),
    integrity: String(entry.integrity ?? entry.content_hash ?? ""),
    depth: Number(entry.depth ?? 1),
    path: Array.isArray(entry.path) ? entry.path.map(String) : [],
    ...(typeof entry.repo_url === "string" ? { repo_url: entry.repo_url } : {}),
    ...(typeof entry.resolved_commit === "string"
      ? { resolved_commit: entry.resolved_commit }
      : {}),
    ...(typeof entry.resolved_ref === "string" ? { resolved_ref: entry.resolved_ref } : {}),
    ...(typeof entry.constraint === "string" ? { constraint: entry.constraint } : {}),
    ...(typeof entry.resolved_tag === "string" ? { resolved_tag: entry.resolved_tag } : {}),
    ...(typeof entry.virtual_path === "string" ? { virtual_path: entry.virtual_path } : {}),
    ...(typeof entry.content_hash === "string" ? { content_hash: entry.content_hash } : {}),
  };
}

function parseApmDependencyEntry(entry: Record<string, unknown>): LockEntry {
  return parseHtPluginEntry({
    name: entry.name,
    version: entry.version,
    source: entry.source,
    integrity: entry.integrity ?? entry.content_hash,
    depth: entry.depth,
    path: entry.path,
    repo_url: entry.repo_url,
    resolved_commit: entry.resolved_commit,
    resolved_ref: entry.resolved_ref,
    constraint: entry.constraint,
    resolved_tag: entry.resolved_tag,
    virtual_path: entry.virtual_path,
    content_hash: entry.content_hash,
  });
}

export function readLockfile(projectRoot: string): Lockfile | undefined {
  const path = lockfilePath(projectRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = parseYaml(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Invalid lockfile in ${path}: expected a YAML mapping`);
  }
  const version = String(parsed.lockfile_version ?? "");
  if (version !== LOCKFILE_VERSION && version !== "2") {
    throw new Error(
      `Unsupported lockfile_version: ${version || "(missing)"}. Expected "${LOCKFILE_VERSION}". ` +
        `Delete ${APM_LOCKFILE_FILENAME} and re-run apply to regenerate it.`,
    );
  }

  const htPlugins = Array.isArray(parsed.plugins)
    ? parsed.plugins.filter(isRecord).map(parseHtPluginEntry)
    : [];
  const apmDeps = Array.isArray(parsed.dependencies)
    ? parsed.dependencies.filter(isRecord).map(parseApmDependencyEntry)
    : [];
  const plugins = htPlugins.length > 0 ? htPlugins : apmDeps;

  const mcpRaw = parsed.mcp_servers;
  const mcp_servers = Array.isArray(mcpRaw)
    ? mcpRaw.filter(isRecord).map((entry) => ({
        name: String(entry.name ?? ""),
        ...(typeof entry.transport === "string" ? { transport: entry.transport } : {}),
        ...(typeof entry.command === "string" ? { command: entry.command } : {}),
        ...(typeof entry.url === "string" ? { url: entry.url } : {}),
      }))
    : undefined;

  const deployedRaw = parsed.local_deployed_file_hashes;
  const deployed_file_hashes = isRecord(deployedRaw)
    ? Object.fromEntries(
        Object.entries(deployedRaw).map(([filePath, hash]) => [filePath, String(hash)]),
      )
    : undefined;

  return {
    root: String(parsed.root ?? ""),
    resolved_at: String(parsed.generated_at ?? parsed.resolved_at ?? ""),
    resource_map_hash: String(parsed.resource_map_hash ?? ""),
    plugins,
    ...(typeof parsed.environment === "string" ? { environment: parsed.environment } : {}),
    ...(mcp_servers && mcp_servers.length > 0 ? { mcp_servers } : {}),
    ...(deployed_file_hashes ? { deployed_file_hashes } : {}),
  };
}

export function lockedVersionsFrom(lock: Lockfile): Map<string, string> {
  return new Map(lock.plugins.map((entry) => [entry.name, entry.version]));
}

export function lockfileMatchesResolution(
  lock: Lockfile,
  result: ResolutionResult,
): boolean {
  if (lock.root !== result.root.name) return false;
  if (lock.resource_map_hash !== resourceMapHash(result.resources)) return false;
  const resolved = new Map(
    result.selected.filter((p) => p.depth > 0).map((p) => [p.name, p.version]),
  );
  if (resolved.size !== lock.plugins.length) return false;
  return lock.plugins.every((entry) => resolved.get(entry.name) === entry.version);
}

/**
 * True when every locked plugin is still available at the locked version.
 * A stale lock falls back to a full re-resolution rather than failing.
 */
export function lockIsUsable(lock: Lockfile, rootName: string): boolean {
  return lock.root === rootName && lock.plugins.every((entry) => entry.version !== "");
}

export interface LockDrift {
  drift: boolean;
  root: string;
  changes: Array<{ name: string; locked: string; resolved: string }>;
  added: string[];
  removed: string[];
}

export function compareLockToResolution(
  lock: Lockfile,
  result: ResolutionResult,
): LockDrift {
  const lockedByName = new Map(lock.plugins.map((entry) => [entry.name, entry.version]));
  const resolvedByName = new Map(
    result.selected.filter((p) => p.depth > 0).map((p) => [p.name, p.version]),
  );

  const changes: LockDrift["changes"] = [];
  for (const [name, locked] of lockedByName) {
    const resolved = resolvedByName.get(name);
    if (resolved !== undefined && resolved !== locked) {
      changes.push({ name, locked, resolved });
    }
  }
  const added = [...resolvedByName.keys()].filter((name) => !lockedByName.has(name));
  const removed = [...lockedByName.keys()].filter((name) => !lockedByName.has(name));
  const resourceDrift = lock.resource_map_hash !== resourceMapHash(result.resources);

  return {
    drift: changes.length > 0 || added.length > 0 || removed.length > 0 || resourceDrift,
    root: lock.root,
    changes,
    added,
    removed,
  };
}
