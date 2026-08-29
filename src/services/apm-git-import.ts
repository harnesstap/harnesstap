import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import matter from "gray-matter";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  removeResourceFromPlugin,
  stampPluginOrigin,
} from "../models/plugin-model.js";
import { normalizeResourceInput, upsertResource } from "../models/resource.js";
import type { Plugin, ResourceCreateInput, ResourceType } from "../types.js";
import { BundleSymlinkError, listContainedRegularFiles } from "../utils/path-containment.js";
import { collectSkillMdFiles } from "./apm-overlay.js";
import type { ApmGitResolution } from "./apm-git-resolve.js";
import {
  ApmGitResolveError,
  assertCheckoutPathSafe,
  isApmVirtualFilePath,
} from "./apm-git-resolve.js";
import { getPluginOrigin, setPluginOrigin } from "./plugin-origin.js";
import { isPluginInstallRoot, scanPluginSource } from "./plugin-source-import.js";
import { persistPluginSourceScanResults } from "./scanner.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function virtualFileType(path: string): ResourceType {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".agent.md")) return "agent";
  if (lowered.endsWith(".prompt.md")) return "command";
  return "instruction";
}

function importVirtualFile(
  checkoutRoot: string,
  relativePath: string,
): ResourceCreateInput {
  const absolute = assertCheckoutPathSafe(checkoutRoot, relativePath);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
    throw new ApmGitResolveError(
      `Virtual package file ${relativePath} is missing — apply aborted closed`,
    );
  }
  const raw = readFileSync(absolute, "utf8");
  const parsed = matter(raw);
  const data = isRecord(parsed.data) ? parsed.data : {};
  const fallback = basename(relativePath).replace(/\.(agent|prompt|instructions)\.md$/i, "");
  const name =
    typeof data.name === "string" && data.name.trim().length > 0
      ? data.name.trim()
      : fallback;
  return {
    type: virtualFileType(relativePath),
    name,
    description: typeof data.description === "string" ? data.description : "",
    content: parsed.content,
    metadata: {},
    source: relativePath,
  };
}

function skillResources(packageRoot: string): ResourceCreateInput[] {
  const skills = [
    ...collectSkillMdFiles(packageRoot, ".apm/skills"),
    ...collectSkillMdFiles(packageRoot, "skills"),
  ];
  return skills.map((skill) => ({
    type: "skill" as const,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    metadata: {},
    source: skill.skillMdRelative,
  }));
}

function assertPackageRootSafe(packageRoot: string): void {
  if (lstatSync(packageRoot).isSymbolicLink()) {
    throw new BundleSymlinkError(".");
  }
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const child = join(packageRoot, entry.name);
    if (entry.isSymbolicLink() || lstatSync(child).isSymbolicLink()) {
      throw new BundleSymlinkError(entry.name);
    }
    if (entry.isDirectory()) {
      listContainedRegularFiles(child);
      continue;
    }
    if (!entry.isFile()) {
      throw new BundleSymlinkError(entry.name);
    }
  }
}

async function resourcesFromPackageRoot(
  packageRoot: string,
): Promise<{ name?: string; version?: string; resources: ResourceCreateInput[] }> {
  assertPackageRootSafe(packageRoot);

  if (isPluginInstallRoot(packageRoot)) {
    const scans = await scanPluginSource(packageRoot);
    const persisted = persistPluginSourceScanResults(scans);
    const scan = scans[0];
    return {
      name: scan?.plugin_name,
      version: scan?.plugin_version,
      resources: persisted.resources.map((resource) => ({
        type: resource.type,
        name: resource.name,
        namespace: resource.namespace,
        description: resource.description,
        content: resource.content,
        metadata: resource.metadata,
        source: resource.source,
      })),
    };
  }

  const unique = new Map<string, ResourceCreateInput>();
  for (const resource of skillResources(packageRoot)) {
    unique.set(`${resource.type}:${resource.name}`, resource);
  }
  if (unique.size === 0) {
    throw new ApmGitResolveError(
      `No supported plugin resources found in ${packageRoot} — apply aborted closed`,
    );
  }
  return { resources: [...unique.values()] };
}

function replaceAttachments(
  pluginId: string,
  resources: ResourceCreateInput[],
  originRef: string,
): void {
  for (const attached of getPluginResources(pluginId)) {
    removeResourceFromPlugin(pluginId, attached.id);
  }
  for (const resource of resources) {
    const upserted = upsertResource(
      normalizeResourceInput({
        ...resource,
        origin_kind: "marketplace_link",
        origin_ref: originRef,
      }),
      { policy: "overwrite" },
    );
    const saved = upserted.action === "skipped" ? upserted.existing : upserted.resource;
    addResourceToPlugin(pluginId, saved.id);
  }
}

export interface ImportedApmGitPlugin {
  plugin: Plugin;
  resolution: ApmGitResolution;
}

function upsertGitPlugin(
  resolution: ApmGitResolution,
  resources: ResourceCreateInput[],
  name: string,
  version: string,
): ImportedApmGitPlugin {
  const existing = getPluginByName(name, version);
  if (existing) {
    if (getPluginOrigin(existing.id) !== "upstream") {
      throw new ApmGitResolveError(
        `${name}@${version} is an authored plugin; rename it or change the git dependency name.`,
      );
    }
    replaceAttachments(existing.id, resources, resolution.cloneUrl);
    stampPluginOrigin(existing.id, {
      locator: resolution.cloneUrl,
      fingerprint: resolution.commit,
      fingerprintKind: "git_sha",
    });
    return { plugin: existing, resolution };
  }

  const plugin = createPlugin({
    name,
    version,
    description: `APM git ${resolution.repoUrl}@${resolution.commit.slice(0, 12)}`,
    origin: "upstream",
  });
  setPluginOrigin(plugin.id, "upstream");
  replaceAttachments(plugin.id, resources, resolution.cloneUrl);
  stampPluginOrigin(plugin.id, {
    locator: resolution.cloneUrl,
    fingerprint: resolution.commit,
    fingerprintKind: "git_sha",
  });
  return { plugin, resolution };
}

export async function importApmGitCheckout(
  resolution: ApmGitResolution,
  checkoutRoot: string,
): Promise<ImportedApmGitPlugin> {
  if (resolution.virtualPath && isApmVirtualFilePath(resolution.virtualPath)) {
    const file = importVirtualFile(checkoutRoot, resolution.virtualPath);
    return upsertGitPlugin(resolution, [file], resolution.name, resolution.commit.slice(0, 12));
  }

  const packageRoot = resolution.virtualPath
    ? assertCheckoutPathSafe(checkoutRoot, resolution.virtualPath)
    : checkoutRoot;

  if (!existsSync(packageRoot)) {
    throw new ApmGitResolveError(
      `Virtual package path ${resolution.virtualPath ?? "."} is missing — apply aborted closed`,
    );
  }
  if (!lstatSync(packageRoot).isDirectory()) {
    throw new ApmGitResolveError(
      `Virtual package path ${resolution.virtualPath} is not a directory — apply aborted closed`,
    );
  }

  const imported = await resourcesFromPackageRoot(packageRoot);
  const version = imported.version || resolution.commit.slice(0, 12);
  const name = imported.name || resolution.name;
  return upsertGitPlugin(resolution, imported.resources, name, version);
}
