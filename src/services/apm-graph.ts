import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { getPluginByName } from "../models/plugin-model.js";
import { assertContainedPath } from "../utils/path-containment.js";
import {
  isFilesystemApmDependency,
  type ParsedApmDependency,
} from "./apm-dependencies.js";
import {
  gitCheckoutPackageRoot,
  importApmGitCheckout,
  importApmLocalPackage,
  peekApmPackageIdentity,
} from "./apm-git-import.js";
import {
  ApmGitResolveError,
  canonicalApmRepoUrl,
  isApmVirtualFilePath,
  resolveAndFetchApmGitDependency,
} from "./apm-git-resolve.js";
import { readPackageRuntimeApmDependencies } from "./apm-manifest.js";
import { readDeclaredLicense } from "./export/license.js";
import type { ApmGitLockFields } from "./lockfile.js";
import { readLockfile } from "./lockfile.js";
import { addDependency } from "./plugin-dependency.js";
import type { ResolvedProjectConfig } from "./project-config.js";

export class ApmGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApmGraphError";
  }
}

export interface ImportedApmPackage {
  name: string;
  version: string;
  pluginId: string;
}

export interface MaterializeApmGraphResult {
  imported: Map<string, ImportedApmPackage>;
  gitLocks: ApmGitLockFields[];
}

interface ClaimedPackage {
  identity: string;
  name: string;
  version: string;
  pluginId: string;
}

interface WalkFrame {
  dependency: ParsedApmDependency;
  declaringRoot: string;
  parentPluginId: string | null;
  ancestors: string[];
  depth: number;
}

export function gitDependencyKey(originRef: string, path?: string): string {
  return path ? `${originRef}#${path}` : originRef;
}

export function apmDependencyIdentity(dependency: ParsedApmDependency, declaringRoot: string): string {
  switch (dependency.sourceKind) {
    case "git":
      return `git:${canonicalApmRepoUrl(dependency.originRef)}::${dependency.path ?? ""}`;
    case "catalog":
      return `catalog:${dependency.originRef}`;
    case "marketplace":
      return `marketplace:${dependency.originRef}`;
    case "local":
      if (isFilesystemApmDependency(dependency)) {
        return `path:${resolveFilesystemPackageRoot(declaringRoot, dependency)}`;
      }
      return `local:${dependency.name}`;
    default: {
      const unhandled: never = dependency.sourceKind;
      throw new ApmGraphError(`Unhandled dependencies.apm source ${unhandled}`);
    }
  }
}

function expandHome(originRef: string): string {
  if (originRef.startsWith("~/") || originRef.startsWith("~\\")) {
    return join(homedir(), originRef.slice(2));
  }
  return originRef;
}

export function resolveFilesystemPackageRoot(
  declaringRoot: string,
  dependency: ParsedApmDependency,
): string {
  const expanded = expandHome(dependency.originRef);
  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }
  const relative = expanded.replace(/^\.\//, "").replaceAll("\\", "/");
  assertContainedPath(declaringRoot, relative);
  return resolve(declaringRoot, relative);
}

function failClosedMissing(label: string): never {
  throw new ApmGraphError(`APM package ${label} is missing — apply aborted closed`);
}

function linkParent(
  parentPluginId: string | null,
  imported: ImportedApmPackage,
): void {
  if (!parentPluginId) {
    return;
  }
  addDependency(parentPluginId, imported.name, {
    versionConstraint: imported.version,
  });
}

function pushGitLock(
  gitLocks: ApmGitLockFields[],
  pluginName: string,
  fetched: {
    repoUrl: string;
    commit: string;
    resolvedRef?: string;
    constraint?: string;
    resolvedTag?: string;
    virtualPath?: string;
    checkoutRoot: string;
  },
): void {
  const licenseRoot = fetched.virtualPath
    ? join(fetched.checkoutRoot, fetched.virtualPath)
    : fetched.checkoutRoot;
  const declared_license = readDeclaredLicense(licenseRoot);
  gitLocks.push({
    name: pluginName,
    repo_url: fetched.repoUrl,
    resolved_commit: fetched.commit,
    ...(fetched.resolvedRef ? { resolved_ref: fetched.resolvedRef } : {}),
    ...(fetched.constraint ? { constraint: fetched.constraint } : {}),
    ...(fetched.resolvedTag ? { resolved_tag: fetched.resolvedTag } : {}),
    ...(fetched.virtualPath ? { virtual_path: fetched.virtualPath } : {}),
    ...(declared_license ? { declared_license } : {}),
  });
}

export async function materializeApmDependencyGraph(
  config: ResolvedProjectConfig,
  options: { update?: boolean; harnesstapDir?: string } = {},
): Promise<MaterializeApmGraphResult> {
  const imported = new Map<string, ImportedApmPackage>();
  const gitLocks: ApmGitLockFields[] = [];
  const claimedByName = new Map<string, ClaimedPackage>();
  const claimedByIdentity = new Map<string, ClaimedPackage>();
  const lock = options.update ? undefined : readLockfile(config.rootPath);
  const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();

  const queue: WalkFrame[] = config.apmDependencies.map((dependency) => ({
    dependency,
    declaringRoot: config.rootPath,
    parentPluginId: null,
    ancestors: [],
    depth: 1,
  }));

  while (queue.length > 0) {
    const frame = queue.shift();
    if (!frame) {
      break;
    }
    await visitFrame(frame, {
      imported,
      gitLocks,
      claimedByName,
      claimedByIdentity,
      queue,
      lock,
      harnesstapDir,
      update: options.update === true,
    });
  }

  return { imported, gitLocks };
}

async function visitFrame(
  frame: WalkFrame,
  state: {
    imported: Map<string, ImportedApmPackage>;
    gitLocks: ApmGitLockFields[];
    claimedByName: Map<string, ClaimedPackage>;
    claimedByIdentity: Map<string, ClaimedPackage>;
    queue: WalkFrame[];
    lock: ReturnType<typeof readLockfile>;
    harnesstapDir: string;
    update: boolean;
  },
): Promise<void> {
  const identity = apmDependencyIdentity(frame.dependency, frame.declaringRoot);
  if (frame.ancestors.includes(identity)) {
    throw new ApmGraphError(
      `APM dependency cycle: ${[...frame.ancestors, identity].join(" → ")} — apply aborted closed`,
    );
  }

  const already = state.claimedByIdentity.get(identity);
  if (already) {
    linkParent(frame.parentPluginId, already);
    return;
  }

  switch (frame.dependency.sourceKind) {
    case "git":
      await visitGit(frame, identity, state);
      return;
    case "local":
      await visitLocal(frame, identity, state);
      return;
    case "catalog":
    case "marketplace":
      visitLibraryPackage(frame, identity, state);
      return;
    default: {
      const unhandled: never = frame.dependency.sourceKind;
      throw new ApmGraphError(`Unhandled dependencies.apm source ${unhandled}`);
    }
  }
}

function claimAndEnqueue(
  frame: WalkFrame,
  identity: string,
  importedPackage: ImportedApmPackage,
  packageRoot: string | undefined,
  walkNested: boolean,
  state: {
    imported: Map<string, ImportedApmPackage>;
    claimedByName: Map<string, ClaimedPackage>;
    claimedByIdentity: Map<string, ClaimedPackage>;
    queue: WalkFrame[];
  },
): boolean {
  const existingName = state.claimedByName.get(importedPackage.name);
  if (existingName && existingName.identity !== identity) {
    // Root (or the first claimant) wins; do not replace or attach the loser.
    return false;
  }

  const claimed: ClaimedPackage = { identity, ...importedPackage };
  state.claimedByIdentity.set(identity, claimed);
  state.claimedByName.set(importedPackage.name, claimed);
  state.imported.set(
    gitDependencyKey(frame.dependency.originRef, frame.dependency.path),
    importedPackage,
  );
  if (isFilesystemApmDependency(frame.dependency)) {
    state.imported.set(identity, importedPackage);
  }
  linkParent(frame.parentPluginId, importedPackage);

  if (!walkNested || !packageRoot) {
    return true;
  }
  const nested = readPackageRuntimeApmDependencies(packageRoot);
  for (const dependency of nested) {
    state.queue.push({
      dependency,
      declaringRoot: packageRoot,
      parentPluginId: importedPackage.pluginId,
      ancestors: [...frame.ancestors, identity],
      depth: frame.depth + 1,
    });
  }
  return true;
}

async function visitGit(
  frame: WalkFrame,
  identity: string,
  state: Parameters<typeof visitFrame>[1],
): Promise<void> {
  const fetched = resolveAndFetchApmGitDependency(frame.dependency, state.harnesstapDir, {
    ...(state.update ? { update: true } : {}),
    ...(state.lock ? { lock: state.lock } : {}),
  });
  const virtualFile = Boolean(
    fetched.virtualPath && isApmVirtualFilePath(fetched.virtualPath),
  );
  const packageRoot = virtualFile
    ? undefined
    : gitCheckoutPackageRoot(fetched, fetched.checkoutRoot);

  if (packageRoot && (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory())) {
    failClosedMissing(frame.dependency.originRef);
  }

  const peeked = packageRoot ? peekApmPackageIdentity(packageRoot) : {};
  const previewName = peeked.name || frame.dependency.name;
  const nameClaim = state.claimedByName.get(previewName);
  if (nameClaim && nameClaim.identity !== identity) {
    return;
  }

  const nested = packageRoot ? readPackageRuntimeApmDependencies(packageRoot) : [];
  const { plugin, resolution } = await importApmGitCheckout(fetched, fetched.checkoutRoot, {
    allowEmpty: nested.length > 0,
  });
  const importedPackage: ImportedApmPackage = {
    name: plugin.name,
    version: plugin.version,
    pluginId: plugin.id,
  };
  const claimed = claimAndEnqueue(
    frame,
    identity,
    importedPackage,
    packageRoot,
    !virtualFile,
    state,
  );
  if (claimed) {
    pushGitLock(state.gitLocks, plugin.name, {
      repoUrl: resolution.repoUrl,
      commit: resolution.commit,
      resolvedRef: resolution.resolvedRef,
      constraint: resolution.constraint,
      resolvedTag: resolution.resolvedTag,
      virtualPath: resolution.virtualPath,
      checkoutRoot: fetched.checkoutRoot,
    });
  }
}

async function visitLocal(
  frame: WalkFrame,
  identity: string,
  state: Parameters<typeof visitFrame>[1],
): Promise<void> {
  if (!isFilesystemApmDependency(frame.dependency)) {
    visitLibraryPackage(frame, identity, state);
    return;
  }

  const packageRoot = resolveFilesystemPackageRoot(frame.declaringRoot, frame.dependency);
  if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
    failClosedMissing(frame.dependency.originRef);
  }
  if (lstatSync(packageRoot).isSymbolicLink()) {
    throw new ApmGitResolveError(`Symlinks are not allowed in a bundle: ${frame.dependency.originRef}`);
  }

  const peeked = peekApmPackageIdentity(packageRoot);
  const previewName = peeked.name || frame.dependency.name;
  const nameClaim = state.claimedByName.get(previewName);
  if (nameClaim && nameClaim.identity !== identity) {
    return;
  }

  const nested = readPackageRuntimeApmDependencies(packageRoot);
  const plugin = await importApmLocalPackage(
    packageRoot,
    frame.dependency.name,
    frame.dependency.originRef,
    { allowEmpty: nested.length > 0 },
  );
  claimAndEnqueue(
    frame,
    identity,
    { name: plugin.name, version: plugin.version, pluginId: plugin.id },
    packageRoot,
    true,
    state,
  );
}

function visitLibraryPackage(
  frame: WalkFrame,
  identity: string,
  state: Parameters<typeof visitFrame>[1],
): void {
  // Root catalog / marketplace / named local plugins stay on the existing
  // apply selector path (may be pulled later). Nested ones must already exist.
  if (!frame.parentPluginId) {
    return;
  }
  const plugin = getPluginByName(frame.dependency.name)
    ?? getPluginByName(frame.dependency.applySelector);
  if (!plugin) {
    failClosedMissing(frame.dependency.applySelector);
  }
  const nameClaim = state.claimedByName.get(plugin.name);
  if (nameClaim && nameClaim.identity !== identity) {
    return;
  }
  claimAndEnqueue(
    frame,
    identity,
    { name: plugin.name, version: plugin.version, pluginId: plugin.id },
    undefined,
    false,
    state,
  );
}
