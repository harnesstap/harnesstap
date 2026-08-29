import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import {
  DEFAULT_GIT_CLONE_TIMEOUT_MS,
  runCommandWithTimeout,
} from "../utils/run-command-with-timeout.js";
import type { RunCommand } from "../plugins/run-command.js";
import {
  BundleSymlinkError,
  assertContainedPath,
  hasParentTraversalSegment,
} from "../utils/path-containment.js";
import type { ParsedApmDependency } from "./apm-dependencies.js";
import { cloneUrlFromOrigin } from "./apm-dependencies.js";
import type { LockEntry, Lockfile } from "./lockfile.js";

export type ApmGitRefKind = "semver" | "literal" | "none";

export class ApmGitResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApmGitResolveError";
  }
}

export interface ApmGitResolution {
  name: string;
  cloneUrl: string;
  repoUrl: string;
  commit: string;
  resolvedRef?: string;
  constraint?: string;
  resolvedTag?: string;
  resolvedAt?: string;
  virtualPath?: string;
  replayed: boolean;
}

export interface ResolveApmGitOptions {
  update?: boolean;
  lock?: Lockfile;
  runCommand?: RunCommand;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;
const LITERAL_SEMVER_TAG = /^v?\d+\.\d+\.\d+$/;
const RANGE_OPERATOR = /[\^~><*=xX]| \|\|| - /;

export function classifyApmGitRef(ref?: string): ApmGitRefKind {
  if (!ref || ref.trim().length === 0) {
    return "none";
  }
  const trimmed = ref.trim();
  if (FULL_SHA.test(trimmed) || LITERAL_SEMVER_TAG.test(trimmed)) {
    return "literal";
  }
  if (semver.validRange(trimmed) && RANGE_OPERATOR.test(trimmed)) {
    return "semver";
  }
  return "literal";
}

/**
 * Canonical lockfile `repo_url`: host + repository path, no scheme or `.git`.
 * file:// remotes keep the path after stripping one trailing `.git`.
 */
export function canonicalApmRepoUrl(originRef: string): string {
  const cloneUrl = cloneUrlFromOrigin(originRef.trim());

  if (cloneUrl.startsWith("git@")) {
    const match = cloneUrl.match(/^git@([^:]+):(.+)$/);
    if (match?.[1] && match[2]) {
      return `${match[1].toLowerCase()}/${stripGitSuffix(match[2])}`;
    }
  }

  const ssh = cloneUrl.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (ssh?.[1] && ssh[2]) {
    return `${hostWithoutDefaultPort(ssh[1])}/${stripGitSuffix(ssh[2])}`;
  }

  try {
    const parsed = new URL(cloneUrl);
    const host = hostWithoutDefaultPort(parsed.host);
    const path = stripGitSuffix(parsed.pathname.replace(/^\/+/, ""));
    if (parsed.protocol === "file:") {
      return `file:///${path}`;
    }
    return host ? `${host}/${path}` : path;
  } catch {
    return stripGitSuffix(cloneUrl.replace(/^https?:\/\//, ""));
  }
}

function hostWithoutDefaultPort(host: string): string {
  const lowered = host.toLowerCase();
  return lowered
    .replace(/:443$/, "")
    .replace(/:22$/, "")
    .replace(/:80$/, "")
    .replace(/:9418$/, "");
}

function stripGitSuffix(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.replace(/\.git$/i, "");
}

export function apmGitCacheDir(
  harnesstapDir: string,
  repoUrl: string,
  commit: string,
): string {
  const digest = createHash("sha256").update(repoUrl, "utf8").digest("hex");
  return join(harnesstapDir, "cache", "apm-git", digest, commit.toLowerCase());
}

export function assertSafeApmVirtualPath(path: string): void {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    throw new ApmGitResolveError("dependencies.apm path must be a non-empty repository subpath");
  }
  if (normalized.startsWith("/") || hasParentTraversalSegment(normalized)) {
    throw new ApmGitResolveError(
      `Unsafe dependencies.apm path ${path} — apply aborted closed`,
    );
  }
  assertContainedPath(".", normalized);
}

const VIRTUAL_FILE_SUFFIXES = [".prompt.md", ".instructions.md", ".agent.md"] as const;

export function isApmVirtualFilePath(path: string): boolean {
  const lowered = path.replaceAll("\\", "/").toLowerCase();
  return VIRTUAL_FILE_SUFFIXES.some((suffix) => lowered.endsWith(suffix));
}

export function assertCheckoutPathSafe(checkoutRoot: string, relativePath: string): string {
  assertSafeApmVirtualPath(relativePath);
  const absolute = join(checkoutRoot, relativePath);
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new BundleSymlinkError(relativePath);
  }
  assertContainedPath(checkoutRoot, relativePath);
  return absolute;
}

interface RemoteRef {
  sha: string;
  name: string;
  peeled: boolean;
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

function parseLsRemote(stdout: string): RemoteRef[] {
  const refs: RemoteRef[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const sha = line.slice(0, tab).trim().toLowerCase();
    const rawName = line.slice(tab + 1).trim();
    if (!FULL_SHA.test(sha) || !rawName) continue;
    const peeled = rawName.endsWith("^{}");
    const name = peeled ? rawName.slice(0, -3) : rawName;
    refs.push({ sha, name, peeled });
  }
  return refs;
}

function shaForRefName(refs: RemoteRef[], name: string): string | undefined {
  const matches = refs.filter((entry) => entry.name === name || entry.name.endsWith(`/${name}`));
  const peeled = matches.find((entry) => entry.peeled);
  return peeled?.sha ?? matches[0]?.sha;
}

function tagSemver(tagName: string): { tag: string; version: string } | undefined {
  const name = tagName.replace(/^refs\/tags\//, "");
  const withoutV = name.startsWith("v") ? name.slice(1) : name;
  if (!semver.valid(withoutV)) {
    return undefined;
  }
  return { tag: name, version: withoutV };
}

export function selectSemverTag(
  range: string,
  tagNames: string[],
): { tag: string; version: string } | undefined {
  const candidates: Array<{ tag: string; version: string }> = [];
  for (const tagName of tagNames) {
    const parsed = tagSemver(tagName);
    if (!parsed) continue;
    if (!semver.satisfies(parsed.version, range, { includePrerelease: false })) {
      continue;
    }
    candidates.push(parsed);
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((left, right) => {
    const byVersion = semver.rcompare(left.version, right.version);
    if (byVersion !== 0) return byVersion;
    return right.tag < left.tag ? -1 : right.tag > left.tag ? 1 : 0;
  });
  return candidates[0];
}

function listRemoteTags(run: RunCommand, cloneUrl: string): RemoteRef[] {
  const result = runGit(run, ["ls-remote", "--tags", cloneUrl]);
  if (result.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to list tags for ${cloneUrl}: ${result.stderr.trim() || "git ls-remote failed"}`,
    );
  }
  return parseLsRemote(result.stdout);
}

function resolveLiteralRef(run: RunCommand, cloneUrl: string, ref: string): string {
  if (FULL_SHA.test(ref)) {
    const probe = runGit(run, ["ls-remote", cloneUrl, ref]);
    if (probe.exitCode === 0) {
      const parsed = parseLsRemote(probe.stdout);
      const sha = parsed[0]?.sha ?? ref.toLowerCase();
      if (FULL_SHA.test(sha)) {
        return sha;
      }
    }
    return ref.toLowerCase();
  }

  const listed = runGit(run, ["ls-remote", cloneUrl, ref, `refs/heads/${ref}`, `refs/tags/${ref}`]);
  if (listed.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to resolve ${ref} for ${cloneUrl}: ${listed.stderr.trim() || "git ls-remote failed"}`,
    );
  }
  const refs = parseLsRemote(listed.stdout);
  const sha =
    shaForRefName(refs, `refs/tags/${ref}`)
    ?? shaForRefName(refs, `refs/heads/${ref}`)
    ?? shaForRefName(refs, ref)
    ?? refs[0]?.sha;
  if (!sha) {
    throw new ApmGitResolveError(
      `Could not resolve git ref ${ref} for ${cloneUrl} — apply aborted closed`,
    );
  }
  return sha;
}

function resolveHead(run: RunCommand, cloneUrl: string): string {
  const result = runGit(run, ["ls-remote", cloneUrl, "HEAD"]);
  if (result.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to resolve HEAD for ${cloneUrl}: ${result.stderr.trim() || "git ls-remote failed"}`,
    );
  }
  const sha = parseLsRemote(result.stdout)[0]?.sha;
  if (!sha) {
    throw new ApmGitResolveError(
      `Could not resolve HEAD for ${cloneUrl} — apply aborted closed`,
    );
  }
  return sha;
}

function lockMatchesDependency(entry: LockEntry, dependency: ParsedApmDependency): boolean {
  const repoUrl = canonicalApmRepoUrl(dependency.originRef);
  if (entry.repo_url && entry.repo_url !== repoUrl) {
    return false;
  }
  if (!entry.repo_url && entry.name !== dependency.name) {
    return false;
  }
  const lockedPath = entry.virtual_path ?? "";
  const declaredPath = dependency.path ?? "";
  return lockedPath === declaredPath;
}

function findLockedGit(lock: Lockfile | undefined, dependency: ParsedApmDependency): LockEntry | undefined {
  if (!lock) return undefined;
  return lock.plugins.find((entry) => lockMatchesDependency(entry, dependency));
}

function canReplayLock(
  entry: LockEntry,
  dependency: ParsedApmDependency,
  kind: ApmGitRefKind,
): boolean {
  if (!entry.resolved_commit || !FULL_SHA.test(entry.resolved_commit)) {
    return false;
  }
  if (kind === "semver") {
    const constraint = dependency.versionConstraint ?? dependency.ref ?? "";
    return Boolean(entry.constraint && entry.constraint === constraint);
  }
  const declared = dependency.ref ?? dependency.versionConstraint ?? "";
  const locked = entry.resolved_ref ?? "";
  if (!declared && !locked) {
    return true;
  }
  return declared === locked;
}

export function resolveApmGitDependency(
  dependency: ParsedApmDependency,
  options: ResolveApmGitOptions = {},
): ApmGitResolution {
  if (dependency.sourceKind !== "git") {
    throw new ApmGitResolveError(`Expected a git dependency, got ${dependency.sourceKind}`);
  }
  if (dependency.path) {
    assertSafeApmVirtualPath(dependency.path);
  }

  const cloneUrl = cloneUrlFromOrigin(dependency.originRef);
  const repoUrl = canonicalApmRepoUrl(cloneUrl);
  const kind = classifyApmGitRef(dependency.ref ?? dependency.versionConstraint);
  const locked = options.update ? undefined : findLockedGit(options.lock, dependency);

  if (locked && canReplayLock(locked, dependency, kind)) {
    return {
      name: dependency.name,
      cloneUrl,
      repoUrl,
      commit: locked.resolved_commit!.toLowerCase(),
      ...(locked.resolved_ref ? { resolvedRef: locked.resolved_ref } : {}),
      ...(locked.constraint ? { constraint: locked.constraint } : {}),
      ...(locked.resolved_tag ? { resolvedTag: locked.resolved_tag } : {}),
      ...(dependency.path ? { virtualPath: dependency.path } : {}),
      replayed: true,
    };
  }

  const run = options.runCommand ?? runCommandWithTimeout;

  if (kind === "semver") {
    const constraint = dependency.ref ?? dependency.versionConstraint ?? "";
    const tags = listRemoteTags(run, cloneUrl);
    const tagNames = [...new Set(tags.map((entry) => entry.name.replace(/^refs\/tags\//, "")))];
    const selected = selectSemverTag(constraint, tagNames);
    if (!selected) {
      throw new ApmGitResolveError(
        `No git tag satisfies ${constraint} for ${cloneUrl} — apply aborted closed`,
      );
    }
    const sha =
      shaForRefName(tags, `refs/tags/${selected.tag}`)
      ?? resolveLiteralRef(run, cloneUrl, selected.tag);
    return {
      name: dependency.name,
      cloneUrl,
      repoUrl,
      commit: sha,
      resolvedRef: constraint,
      constraint,
      resolvedTag: selected.tag,
      resolvedAt: new Date().toISOString(),
      ...(dependency.path ? { virtualPath: dependency.path } : {}),
      replayed: false,
    };
  }

  if (kind === "none") {
    const commit = resolveHead(run, cloneUrl);
    return {
      name: dependency.name,
      cloneUrl,
      repoUrl,
      commit,
      ...(dependency.path ? { virtualPath: dependency.path } : {}),
      replayed: false,
    };
  }

  const ref = dependency.ref ?? dependency.versionConstraint ?? "";
  const commit = resolveLiteralRef(run, cloneUrl, ref);
  return {
    name: dependency.name,
    cloneUrl,
    repoUrl,
    commit,
    resolvedRef: ref,
    ...(dependency.path ? { virtualPath: dependency.path } : {}),
    replayed: false,
  };
}

export function checkoutApmGitCommit(
  resolution: ApmGitResolution,
  targetDir: string,
  runCommand: RunCommand = runCommandWithTimeout,
): string {
  if (existsSync(join(targetDir, ".git"))) {
    const current = runGit(runCommand, ["-C", targetDir, "rev-parse", "HEAD"]);
    if (current.exitCode === 0 && current.stdout.trim().toLowerCase() === resolution.commit) {
      return targetDir;
    }
  }

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  const init = runGit(runCommand, ["init", "--quiet", targetDir]);
  if (init.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to initialize checkout for ${resolution.cloneUrl}: ${init.stderr.trim()}`,
    );
  }
  const remote = runGit(runCommand, ["-C", targetDir, "remote", "add", "origin", resolution.cloneUrl]);
  if (remote.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to add origin ${resolution.cloneUrl}: ${remote.stderr.trim()}`,
    );
  }

  let fetch = runGit(runCommand, [
    "-C",
    targetDir,
    "fetch",
    "--depth",
    "1",
    "origin",
    resolution.commit,
  ]);
  if (fetch.exitCode !== 0) {
    fetch = runGit(runCommand, ["-C", targetDir, "fetch", "origin", resolution.commit]);
  }
  if (fetch.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to fetch ${resolution.commit} from ${resolution.cloneUrl}: ${fetch.stderr.trim() || "git fetch failed"}`,
    );
  }

  const checkout = runGit(runCommand, ["-C", targetDir, "checkout", "--quiet", "FETCH_HEAD"]);
  if (checkout.exitCode !== 0) {
    throw new ApmGitResolveError(
      `Failed to checkout ${resolution.commit}: ${checkout.stderr.trim() || "git checkout failed"}`,
    );
  }

  const head = runGit(runCommand, ["-C", targetDir, "rev-parse", "HEAD"]);
  const sha = head.stdout.trim().toLowerCase();
  if (head.exitCode !== 0 || sha !== resolution.commit) {
    throw new ApmGitResolveError(
      `Checkout HEAD ${sha || "(unknown)"} does not match resolved commit ${resolution.commit} — apply aborted closed`,
    );
  }
  return targetDir;
}

export function resolveAndFetchApmGitDependency(
  dependency: ParsedApmDependency,
  harnesstapDir: string,
  options: ResolveApmGitOptions = {},
): ApmGitResolution & { checkoutRoot: string } {
  const resolution = resolveApmGitDependency(dependency, options);
  const checkoutRoot = checkoutApmGitCommit(
    resolution,
    apmGitCacheDir(harnesstapDir, resolution.repoUrl, resolution.commit),
    options.runCommand,
  );
  return { ...resolution, checkoutRoot };
}
