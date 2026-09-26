import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import semver from "semver";
import { getHarnesstapDir } from "../db/connection.js";
import {
  claudePluginsDir,
  parsePluginRef,
  readJsonFile,
} from "../plugins/claude-installed.js";
import { refreshGitSource } from "../plugins/refresh.js";
import type { RunCommand } from "../plugins/run-command.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  DEFAULT_GIT_CLONE_TIMEOUT_MS,
  runCommandWithTimeout,
} from "../utils/run-command-with-timeout.js";
import { builtinMarketplaceGitUrl } from "./builtin-marketplaces.js";
import { listMarketplaces } from "./marketplace-registry.js";
import { resolveMarketplacePluginDirectory } from "./plugin-origin-apply.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SNAPSHOT_FILE = "host-plugin-source-versions.json";
const MARKETPLACE_MANIFEST_RELATIVE_PATHS = [
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
  "marketplace.json",
] as const;

export interface MarketplacePluginSource {
  version: string | null;
  url: string | null;
  gitRef: string | null;
  path: string | null;
}

export interface HostPluginSourceSnapshot {
  source_url: string | null;
  source_ref: string | null;
  advertised_version: string | null;
  git_refs: Record<string, string>;
  fetched_at: string;
}

interface KnownMarketplaceFile {
  [name: string]: unknown;
}

interface MarketplaceFile {
  plugins?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripGitSuffix(value: string): string {
  return value.replace(/\/+$/, "").replace(/\.git$/i, "");
}

function githubCloneUrl(repo: string): string {
  const trimmed = repo.trim();
  if (trimmed.startsWith("file:")) {
    return trimmed;
  }
  if (trimmed.includes("://")) {
    return trimmed.endsWith(".git") ? trimmed : `${stripGitSuffix(trimmed)}.git`;
  }
  return `https://github.com/${stripGitSuffix(trimmed)}.git`;
}

function runGit(
  run: RunCommand,
  args: string[],
  cwd?: string,
): { stdout: string; stderr: string; exitCode: number } {
  return run("git", ["-c", "protocol.file.allow=always", ...args], {
    timeoutMs: DEFAULT_GIT_CLONE_TIMEOUT_MS,
    ...(cwd ? { cwd } : {}),
  });
}

export function isRelativePluginSourcePath(path: string | null | undefined): boolean {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.startsWith("git@")) {
    return false;
  }
  if (trimmed.startsWith("/")) {
    return false;
  }
  return true;
}

export function parseMarketplacePluginSource(
  entry: unknown,
): MarketplacePluginSource | null {
  if (!isRecord(entry)) {
    return null;
  }
  const version =
    typeof entry.version === "string" && entry.version.trim()
      ? entry.version.trim()
      : null;
  const source = entry.source;
  if (typeof source === "string" && source.trim()) {
    return { version, url: null, gitRef: null, path: source.trim() };
  }
  if (!isRecord(source)) {
    return { version, url: null, gitRef: null, path: null };
  }
  const kind = typeof source.source === "string" ? source.source : "";
  const gitRef =
    typeof source.ref === "string" && source.ref.trim()
      ? source.ref.trim()
      : null;
  switch (kind) {
    case "url": {
      const url = typeof source.url === "string" ? source.url.trim() : "";
      return {
        version,
        url: url ? githubCloneUrl(url) : null,
        gitRef,
        path: null,
      };
    }
    case "github": {
      const repo = typeof source.repo === "string" ? source.repo.trim() : "";
      return {
        version,
        url: repo ? githubCloneUrl(repo) : null,
        gitRef,
        path: null,
      };
    }
    case "directory": {
      const path = typeof source.path === "string" ? source.path.trim() : "";
      return { version, url: null, gitRef, path: path || null };
    }
    default: {
      const url = typeof source.url === "string" ? source.url.trim() : "";
      const repo = typeof source.repo === "string" ? source.repo.trim() : "";
      const path = typeof source.path === "string" ? source.path.trim() : "";
      return {
        version,
        url: url ? githubCloneUrl(url) : repo ? githubCloneUrl(repo) : null,
        gitRef,
        path: path || null,
      };
    }
  }
}

export function defaultMarketplaceRoot(
  homeRoot: string,
  marketplace: string,
): string {
  return join(claudePluginsDir(homeRoot), "marketplaces", marketplace);
}

export function resolveMarketplaceRoot(
  homeRoot: string,
  marketplace: string,
): string | null {
  const known = readKnownMarketplace(homeRoot, marketplace);
  if (known?.installLocation && existsSync(known.installLocation)) {
    return known.installLocation;
  }
  const fallback = defaultMarketplaceRoot(homeRoot, marketplace);
  return existsSync(fallback) ? fallback : null;
}

function readClaudeKnownMarketplace(
  homeRoot: string,
  marketplace: string,
): { url: string | null; installLocation: string | null } | null {
  const knownPath = join(
    claudePluginsDir(homeRoot),
    "known_marketplaces.json",
  );
  const known = readJsonFile<KnownMarketplaceFile>(knownPath);
  if (!known || !isRecord(known)) {
    return null;
  }
  const value = known[marketplace];
  if (!isRecord(value)) {
    return null;
  }
  const source = isRecord(value.source) ? value.source : {};
  const kind = typeof source.source === "string" ? source.source : "";
  const installLocation =
    typeof value.installLocation === "string" && value.installLocation.trim()
      ? value.installLocation.trim()
      : null;
  let url: string | null = null;
  switch (kind) {
    case "github": {
      const repo = typeof source.repo === "string" ? source.repo : "";
      url = repo.trim() ? githubCloneUrl(repo) : null;
      break;
    }
    case "url": {
      const raw = typeof source.url === "string" ? source.url : "";
      url = raw.trim() ? githubCloneUrl(raw) : null;
      break;
    }
    case "directory": {
      url = null;
      break;
    }
    default:
      break;
  }
  return { url, installLocation };
}

function githubRepoFromCloneUrl(url: string): string | null {
  const stripped = stripGitSuffix(url);
  const match = stripped.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  return match?.[1] ?? null;
}

function claudeKnownMarketplaceSource(url: string): Record<string, unknown> {
  const repo = githubRepoFromCloneUrl(url);
  if (repo) {
    return { source: "github", repo };
  }
  return { source: "url", url };
}

function persistBuiltinClaudeKnownMarketplace(
  homeRoot: string,
  marketplace: string,
  root: string,
  url: string | null,
): void {
  const builtinUrl = builtinMarketplaceGitUrl(marketplace);
  if (!builtinUrl || !existsSync(root)) {
    return;
  }
  const knownPath = join(claudePluginsDir(homeRoot), "known_marketplaces.json");
  const raw = readJsonFile<KnownMarketplaceFile>(knownPath);
  const file: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const previous = isRecord(file[marketplace]) ? { ...file[marketplace] } : {};
  const previousSource = isRecord(previous.source) ? previous.source : {};
  const hasSource =
    typeof previousSource.source === "string" && previousSource.source.trim().length > 0;
  file[marketplace] = {
    ...previous,
    source: hasSource ? previousSource : claudeKnownMarketplaceSource(url ?? builtinUrl),
    installLocation: root,
  };
  mkdirSync(dirname(knownPath), { recursive: true });
  writeFileSync(knownPath, `${JSON.stringify(file, null, 2)}\n`);
}

function readKnownMarketplace(
  homeRoot: string,
  marketplace: string,
  harnesstapDir: string = getHarnesstapDir(),
): { url: string | null; installLocation: string | null } | null {
  const known = readClaudeKnownMarketplace(homeRoot, marketplace);
  const builtinUrl = builtinMarketplaceGitUrl(marketplace);
  if (known) {
    return {
      url: known.url ?? builtinUrl,
      installLocation: known.installLocation,
    };
  }
  if (builtinUrl) {
    return { url: builtinUrl, installLocation: null };
  }
  const registered = listMarketplaces(harnesstapDir).find(
    (entry) => entry.name === marketplace,
  );
  if (registered?.url) {
    return { url: githubCloneUrl(registered.url), installLocation: null };
  }
  return null;
}

export function marketplaceNotInstalledMessage(marketplace: string): string {
  return `Marketplace ${marketplace} is not installed`;
}

function readMarketplaceManifestRecord(
  root: string,
): Record<string, unknown> | null {
  for (const relative of MARKETPLACE_MANIFEST_RELATIVE_PATHS) {
    const file = readJsonFile<Record<string, unknown>>(join(root, relative));
    if (file && isRecord(file)) {
      return file;
    }
  }
  return null;
}

function readMarketplaceFile(root: string): MarketplaceFile | null {
  const file = readMarketplaceManifestRecord(root);
  if (!file || !Array.isArray(file.plugins)) {
    return null;
  }
  return file as MarketplaceFile;
}

function marketplaceManifestRepositoryUrl(root: string): string | null {
  const file = readMarketplaceManifestRecord(root);
  if (!file) {
    return null;
  }
  const repository = file.repository;
  if (typeof repository === "string" && repository.trim()) {
    return githubCloneUrl(repository.trim());
  }
  if (isRecord(repository) && typeof repository.url === "string" && repository.url.trim()) {
    return githubCloneUrl(repository.url.trim());
  }
  return null;
}

export function resolveMarketplaceCloneUrl(
  homeRoot: string,
  marketplace: string,
  runCommand: RunCommand = runCommandWithTimeout,
): string | null {
  const known = readKnownMarketplace(homeRoot, marketplace);
  if (known?.url) {
    return known.url;
  }
  const root = resolveMarketplaceRoot(homeRoot, marketplace);
  if (!root) {
    return null;
  }
  if (existsSync(join(root, ".git"))) {
    const remote = runGit(runCommand, ["remote", "get-url", "origin"], root);
    const url = remote.stdout.trim();
    if (remote.exitCode === 0 && url) {
      return githubCloneUrl(url);
    }
  }
  return marketplaceManifestRepositoryUrl(root);
}

export function resolveHostPluginCloneUrl(input: {
  homeRoot: string;
  marketplace: string;
  live: MarketplacePluginSource | null;
  snapshot?: HostPluginSourceSnapshot | null;
  runCommand?: RunCommand;
}): string | null {
  if (input.live?.url) {
    return input.live.url;
  }
  if (input.snapshot?.source_url) {
    return input.snapshot.source_url;
  }
  if (!isRelativePluginSourcePath(input.live?.path)) {
    return null;
  }
  return resolveMarketplaceCloneUrl(
    input.homeRoot,
    input.marketplace,
    input.runCommand ?? runCommandWithTimeout,
  );
}

export function readMarketplacePluginSource(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): MarketplacePluginSource | null {
  const root = resolveMarketplaceRoot(homeRoot, marketplace);
  if (!root) {
    return null;
  }
  const file = readMarketplaceFile(root);
  const entry = file?.plugins?.find((plugin) => {
    if (!isRecord(plugin)) {
      return false;
    }
    return plugin.name === pluginName;
  });
  if (!entry) {
    return null;
  }
  return parseMarketplacePluginSource(entry);
}

function snapshotPath(harnesstapDir: string): string {
  return join(harnesstapDir, SNAPSHOT_FILE);
}

export function readHostPluginSourceSnapshot(
  originRef: string,
  harnesstapDir: string = getHarnesstapDir(),
): HostPluginSourceSnapshot | null {
  const raw = readJsonFile<Record<string, HostPluginSourceSnapshot>>(
    snapshotPath(harnesstapDir),
  );
  const row = raw?.[originRef];
  if (!row || !isRecord(row) || !isRecord(row.git_refs)) {
    return null;
  }
  return row;
}

export function writeHostPluginSourceSnapshot(
  originRef: string,
  snapshot: HostPluginSourceSnapshot,
  harnesstapDir: string = getHarnesstapDir(),
): void {
  const path = snapshotPath(harnesstapDir);
  const existing =
    readJsonFile<Record<string, HostPluginSourceSnapshot>>(path) ?? {};
  existing[originRef] = snapshot;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
}

function parseLsRemoteTags(stdout: string): string[] {
  const tags = new Set<string>();
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const sha = line.slice(0, tab).trim().toLowerCase();
    const rawName = line.slice(tab + 1).trim();
    if (!FULL_SHA.test(sha) || !rawName.startsWith("refs/tags/")) continue;
    const peeled = rawName.endsWith("^{}");
    const name = (peeled ? rawName.slice(0, -3) : rawName).replace(
      /^refs\/tags\//,
      "",
    );
    if (name) {
      tags.add(name);
    }
  }
  return [...tags];
}

export function semverFromGitTag(tagName: string): string | null {
  const withoutV = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  return semver.valid(withoutV) ? withoutV : null;
}

export function listRemotePluginVersionTags(
  cloneUrl: string,
  runCommand: RunCommand = runCommandWithTimeout,
): Array<{ version: string; gitRef: string }> {
  const result = runGit(runCommand, ["ls-remote", "--tags", cloneUrl]);
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `git ls-remote failed for ${cloneUrl}`,
    );
  }
  const byVersion = new Map<string, string>();
  for (const tag of parseLsRemoteTags(result.stdout)) {
    const version = semverFromGitTag(tag);
    if (!version) {
      continue;
    }
    const existing = byVersion.get(version);
    if (!existing || (tag.startsWith("v") && !existing.startsWith("v"))) {
      byVersion.set(version, tag);
    }
  }
  return [...byVersion.entries()].map(([version, gitRef]) => ({
    version,
    gitRef,
  }));
}

function originDefaultRef(runCommand: RunCommand, root: string): string | null {
  const symbolic = runGit(
    runCommand,
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    root,
  );
  if (symbolic.exitCode === 0 && symbolic.stdout.trim()) {
    return symbolic.stdout.trim();
  }
  const abbrev = runGit(
    runCommand,
    ["rev-parse", "--abbrev-ref", "origin/HEAD"],
    root,
  );
  return abbrev.exitCode === 0 && abbrev.stdout.trim()
    ? abbrev.stdout.trim()
    : null;
}

export function refreshMarketplaceCheckout(
  homeRoot: string,
  marketplace: string,
  runCommand: RunCommand = runCommandWithTimeout,
): { ok: boolean; message: string; root: string | null } {
  const known = readKnownMarketplace(homeRoot, marketplace);
  const root =
    resolveMarketplaceRoot(homeRoot, marketplace) ??
    defaultMarketplaceRoot(homeRoot, marketplace);
  const url = known?.url ?? null;
  if (existsSync(join(root, ".git"))) {
    let fetch = runGit(runCommand, ["fetch", "origin", "--tags", "--prune"], root);
    if (fetch.exitCode !== 0) {
      fetch = runGit(runCommand, ["fetch", "origin"], root);
    }
    if (fetch.exitCode !== 0) {
      return {
        ok: false,
        message: fetch.stderr.trim() || "git fetch failed",
        root,
      };
    }
    const refsToTry = [
      originDefaultRef(runCommand, root),
      "origin/main",
      "origin/master",
    ];
    let lastMessage = "git reset failed";
    for (const ref of refsToTry) {
      if (!ref) continue;
      const reset = runGit(runCommand, ["reset", "--hard", ref], root);
      if (reset.exitCode === 0) {
        persistBuiltinClaudeKnownMarketplace(homeRoot, marketplace, root, url);
        return { ok: true, message: "Refreshed marketplace", root };
      }
      lastMessage = reset.stderr.trim() || lastMessage;
    }
    return {
      ok: false,
      message: lastMessage,
      root,
    };
  }
  if (!url) {
    const exists = existsSync(root);
    if (exists) {
      persistBuiltinClaudeKnownMarketplace(
        homeRoot,
        marketplace,
        root,
        builtinMarketplaceGitUrl(marketplace),
      );
    }
    return {
      ok: exists,
      message: exists
        ? "Using local marketplace checkout"
        : marketplaceNotInstalledMessage(marketplace),
      root: exists ? root : null,
    };
  }
  const cloned = refreshGitSource({
    url,
    targetDir: root,
    runCommand: (command, args, options) =>
      runGit(
        runCommand,
        command === "git" ? args : [command, ...args],
        options?.cwd,
      ),
  });
  if (cloned.ok) {
    persistBuiltinClaudeKnownMarketplace(homeRoot, marketplace, root, url);
  }
  return {
    ok: cloned.ok,
    message: cloned.message,
    root: cloned.ok ? root : existsSync(root) ? root : null,
  };
}

export function cacheVersionDir(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
  version: string,
): string {
  return join(
    claudePluginsDir(homeRoot),
    "cache",
    marketplace,
    pluginName,
    version,
  );
}

function clonePluginVersion(input: {
  url: string;
  gitRef: string;
  targetDir: string;
  runCommand: RunCommand;
}): { ok: boolean; message: string } {
  const run: RunCommand = (command, args, options) =>
    runGit(
      input.runCommand,
      command === "git" ? args : [command, ...args],
      options?.cwd,
    );
  return refreshGitSource({
    url: input.url,
    ref: input.gitRef,
    targetDir: input.targetDir,
    runCommand: run,
  });
}

export function gitRefsToTry(input: {
  version: string;
  storedRef?: string | null;
  sourceRef?: string | null;
  advertisedVersion?: string | null;
}): string[] {
  const refs: string[] = [];
  const add = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !refs.includes(trimmed)) {
      refs.push(trimmed);
    }
  };
  add(input.storedRef);
  if (input.advertisedVersion === input.version) {
    add(input.sourceRef);
  }
  add(`v${input.version}`);
  add(input.version);
  return refs;
}

export function downloadHostPluginVersion(input: {
  originRef: string;
  version: string;
  homeRoot?: string;
  harnesstapDir?: string;
  runCommand?: RunCommand;
}): { version: string; install_path: string } {
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    throw new Error(
      `Plugin ${input.originRef} has no marketplace, so a source version cannot be downloaded`,
    );
  }
  const target = cacheVersionDir(homeRoot, marketplace, name, input.version);
  if (existsSync(target) && isPluginInstallRoot(target)) {
    return { version: input.version, install_path: target };
  }
  const live = readMarketplacePluginSource(homeRoot, marketplace, name);
  const snapshot = readHostPluginSourceSnapshot(
    input.originRef,
    input.harnesstapDir,
  );
  const sourceUrl = resolveHostPluginCloneUrl({
    homeRoot,
    marketplace,
    live,
    snapshot,
    runCommand: input.runCommand,
  });
  const refs = gitRefsToTry({
    version: input.version,
    storedRef: snapshot?.git_refs[input.version],
    sourceRef: live?.gitRef ?? snapshot?.source_ref,
    advertisedVersion: live?.version ?? snapshot?.advertised_version,
  });
  const run = input.runCommand ?? runCommandWithTimeout;
  if (sourceUrl) {
    let lastMessage = "git clone failed";
    for (const gitRef of refs) {
      const cloned = clonePluginVersion({
        url: sourceUrl,
        gitRef,
        targetDir: target,
        runCommand: run,
      });
      if (cloned.ok && isPluginInstallRoot(target)) {
        return { version: input.version, install_path: target };
      }
      lastMessage = cloned.message;
    }
    throw new Error(
      `Could not download ${input.originRef}@${input.version}: ${lastMessage}`,
    );
  }
  const advertised = live?.version ?? snapshot?.advertised_version;
  const marketplaceRoot = resolveMarketplaceRoot(homeRoot, marketplace);
  if (
    marketplaceRoot &&
    advertised === input.version &&
    (live?.path || resolveMarketplacePluginDirectory(marketplaceRoot, name))
  ) {
    const pluginDir =
      (live?.path
        ? join(marketplaceRoot, live.path)
        : undefined) ??
      resolveMarketplacePluginDirectory(marketplaceRoot, name);
    if (pluginDir && existsSync(pluginDir) && isPluginInstallRoot(pluginDir)) {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(pluginDir, target, { recursive: true });
      return { version: input.version, install_path: target };
    }
  }
  throw new Error(
    `Version ${input.version} is not available from the source for ${input.originRef}`,
  );
}

export function pullHostPluginSourceVersions(input: {
  originRef: string;
  homeRoot?: string;
  harnesstapDir?: string;
  runCommand?: RunCommand;
}): HostPluginSourceSnapshot {
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  const run = input.runCommand ?? runCommandWithTimeout;
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    throw new Error(
      `Plugin ${input.originRef} has no marketplace, so source versions cannot be pulled`,
    );
  }
  const refreshed = refreshMarketplaceCheckout(homeRoot, marketplace, run);
  const live = readMarketplacePluginSource(homeRoot, marketplace, name);
  const sourceUrl = resolveHostPluginCloneUrl({
    homeRoot,
    marketplace,
    live,
    runCommand: run,
  });
  const gitRefs: Record<string, string> = {};
  if (sourceUrl) {
    const tags = listRemotePluginVersionTags(sourceUrl, run);
    for (const row of tags) {
      gitRefs[row.version] = row.gitRef;
    }
  }
  if (live?.version && !gitRefs[live.version] && live.gitRef) {
    gitRefs[live.version] = live.gitRef;
  }
  if (live?.version && !gitRefs[live.version]) {
    gitRefs[live.version] = live.version;
  }
  const advertisedVersion =
    Object.keys(gitRefs)
      .filter((version) => semver.valid(version))
      .sort(semver.rcompare)[0] ??
    live?.version ??
    null;
  const snapshot: HostPluginSourceSnapshot = {
    source_url: sourceUrl,
    source_ref: live?.gitRef ?? null,
    advertised_version: advertisedVersion,
    git_refs: gitRefs,
    fetched_at: new Date().toISOString(),
  };
  writeHostPluginSourceSnapshot(input.originRef, snapshot, harnesstapDir);
  if (!refreshed.ok && Object.keys(gitRefs).length === 0 && !live) {
    throw new Error(refreshed.message);
  }
  return snapshot;
}
