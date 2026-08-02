import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findResourceByKey,
  upsertResource,
} from "../models/resource.js";
import { resolveLayerSelector } from "../models/layer-model.js";
import { isProfileLayer } from "../constants/profile.js";
import type { Resource, ResourceType } from "../types.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { collectProfileLayerIds } from "./profile-apply.js";
import {
  toContentsResource,
  type ProfileContentsResource,
} from "./profile-contents.js";
import type { ProfileApplyPreviewScope } from "./profile-apply-preview.js";
import { resolveMainHarnessTarget } from "./profile-harness-sync.js";
import {
  persistScanResults,
  scanHomeDefaults,
  scanProject,
} from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { normalizeManagedPath } from "./profile-untracked-resources.js";

function profileHasResource(
  profileSelector: string,
  resourceType: string,
  resourceName: string,
): Resource | null {
  const profileLayer = resolveLayerSelector(profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    return null;
  }
  const merged = mergeLayersForApply(collectProfileLayerIds(profileLayer));
  return (
    merged.resources.find(
      (resource) =>
        resource.type === resourceType && resource.name === resourceName,
    ) ?? null
  );
}

/**
 * Map a managed harness path to a material resource identity when the mapping is 1:1.
 */
export function resourceKeyFromManagedPath(
  path: string,
  rootPath?: string,
): { type: string; name: string } | null {
  const normalized = normalizeManagedPath(path, rootPath);
  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.cursor\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.copilot\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.agents\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.claude\/rules\/([^/]+)\.md$/i, type: "rule" },
    { re: /(?:^|\/)\.cursor\/rules\/([^/]+)\.mdc$/i, type: "rule" },
    { re: /(?:^|\/)\.claude\/commands\/([^/]+)\.md$/i, type: "command" },
    { re: /(?:^|\/)\.cursor\/commands\/([^/]+)\.md$/i, type: "command" },
    { re: /(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i, type: "agent" },
    { re: /(?:^|\/)\.cursor\/agents\/([^/]+)\.md$/i, type: "agent" },
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern.re);
    if (match?.[1]) {
      return { type: pattern.type, name: match[1] };
    }
  }
  return null;
}

/**
 * Snapshot live disk content into the library for a profile-managed resource.
 */
export async function commitManagedResourceFromLive(input: {
  profileSelector: string;
  resourceType: string;
  resourceName: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
  path?: string;
}): Promise<ProfileContentsResource> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }

  let resourceType = input.resourceType;
  let resourceName = input.resourceName;
  if ((!resourceType || !resourceName) && input.path) {
    const mapped = resourceKeyFromManagedPath(input.path);
    if (!mapped) {
      throw new Error(
        `Cannot map path to a single resource for commit: ${input.path}`,
      );
    }
    resourceType = mapped.type;
    resourceName = mapped.name;
  }

  const attached = profileHasResource(
    input.profileSelector,
    resourceType,
    resourceName,
  );
  if (!attached) {
    throw new Error(
      `Resource is not in profile: ${resourceType}:${resourceName}`,
    );
  }

  const originRef =
    input.scope === "project"
      ? resolve(input.projectPath ?? "")
      : resolveHomeRoot();
  if (input.scope === "project" && !input.projectPath) {
    throw new Error("projectPath is required for project scope");
  }

  const scanned =
    input.scope === "project"
      ? await scanProject(originRef)
      : await scanHomeDefaults(
          input.harness ? resolveMainHarnessTarget(input.harness) : undefined,
          originRef,
        );

  const matching = scanned
    .map((result) => ({
      ...result,
      resources: result.resources.filter(
        (resource) =>
          resource.type === resourceType && resource.name === resourceName,
      ),
    }))
    .filter((result) => result.resources.length > 0);

  if (matching.length === 0) {
    // Fall back: update from attached resource path if scan name differs (instructions).
    if (input.path && attached.type === "instruction") {
      const fullPath = join(originRef, normalizeManagedPath(input.path, originRef));
      if (!existsSync(fullPath)) {
        throw new Error(`Live file not found: ${input.path}`);
      }
      const content = readFileSync(fullPath, "utf-8");
      const updated = upsertResource(
        {
          type: attached.type,
          name: attached.name,
          namespace: attached.namespace,
          description: attached.description,
          content,
          metadata: attached.metadata,
          source: attached.source,
          origin_kind: "local_snapshot",
          origin_ref: attached.origin_ref || originRef,
        },
        { policy: "overwrite" },
      );
      if (updated.action === "skipped") {
        throw new Error(`Could not update resource: ${resourceType}:${resourceName}`);
      }
      return toContentsResource(updated.resource);
    }
    throw new Error(
      `Resource not found on disk: ${resourceType}:${resourceName}`,
    );
  }

  const persisted = persistScanResults(matching, {
    conflictPolicy: "overwrite",
    originRef,
  });
  const resource =
    persisted.resolved.find(
      (entry) => entry.type === resourceType && entry.name === resourceName,
    )
    ?? findResourceByKey(
      resourceType as ResourceType,
      resourceName,
      attached.namespace,
    );
  if (!resource) {
    throw new Error(
      `Could not commit resource: ${resourceType}:${resourceName}`,
    );
  }
  return toContentsResource(resource);
}
