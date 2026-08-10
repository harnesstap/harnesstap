import { resolve } from "node:path";
import { getActiveProfilePayload } from "./profile-commands.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { environmentCascadePayload } from "./environment-commands.js";
import { assessProjectScanStatus, type ProjectScanStatus } from "./project-scan-status.js";
import { validatePluginPinsAgainstInventory } from "./plugin-apply-validation.js";
import { listAttachedPluginPins } from "./layer-composition.js";
import { getLayerById, getLayerResources, resolveLayerSelector } from "../models/plugin-model.js";
import { getProjectByLocalPath, getProjectByOrigin, getProjectConfiguredLayers } from "../models/project.js";
import { detectProjectDriftFromLatest, type ProjectDriftReport } from "./project-drift.js";
import { compareLockToResolution, readLockfile, type LockDrift } from "./lockfile.js";
import { resolveComposition } from "./resolve/index.js";
import { detectPlatforms } from "./scanner.js";
import { getGitOrigin, normalizeGitUrl } from "./git.js";
import { isProfileLayer } from "../constants/profile.js";
import { listSnapshots } from "../models/snapshot.js";
import type { Layer, Project, Resource, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";

export interface AppliedLayerStatusRow {
  layer: Layer;
  resource_count: number;
  resource_summary: string;
  platforms: string[];
  applied_at: string;
}

export interface ResolvedPluginPinStatus {
  ref: string;
  version_constraint: string;
  status: "synced" | "never_synced" | "stale";
  message?: string;
}

export interface ProjectStatusPayload {
  project_root: string;
  git_origin: string | null;
  git_origin_raw: string | null;
  platforms: string[];
  project: Project | null;
  drift: ProjectDriftReport | null;
  snapshots_count: number;
  environment_cascade: ReturnType<typeof environmentCascadePayload>;
  profile: {
    active_profile: string | null;
    layer: Layer | null;
    stack_resource_count: number;
    stack_summary: string | null;
    warning?: string;
  };
  applied_layers: AppliedLayerStatusRow[];
  resolved: {
    resource_count: number;
    resource_summary: string;
    plugin_pins: ResolvedPluginPinStatus[];
    environment_vars: number;
    environment_secrets: number;
  };
  project_resources: ProjectScanStatus;
  lock?: LockDrift;
}

function materialResources(resources: Resource[]): Resource[] {
  return resources.filter(
    (resource) => resource.type !== "plugin",
  );
}

export function formatResourceTypeSummary(resources: Pick<Resource, "type">[]): string {
  const counts = new Map<ResourceType, number>();
  for (const resource of resources) {
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }
  const summary = RESOURCE_TYPES.filter((type) => (counts.get(type) ?? 0) > 0).map(
    (type) => `${counts.get(type)} ${type}${(counts.get(type) ?? 0) === 1 ? "" : "s"}`,
  );
  return summary.join(", ");
}

function formatLayerLabel(layer: Pick<Layer, "name" | "version">): string {
  return `${layer.name}@${layer.version}`;
}

function summarizeLayerResources(layerId: string): {
  count: number;
  summary: string;
} {
  const resources = materialResources(getLayerResources(layerId));
  return {
    count: resources.length,
    summary: formatResourceTypeSummary(resources),
  };
}

function buildProfileSection(): ProjectStatusPayload["profile"] {
  const active = getActiveProfilePayload();
  if (!active.active_profile) {
    return {
      active_profile: null,
      layer: null,
      stack_resource_count: 0,
      stack_summary: null,
    };
  }

  const layer = resolveLayerSelector(active.active_profile);
  if (!layer) {
    return {
      active_profile: active.active_profile,
      layer: null,
      stack_resource_count: 0,
      stack_summary: null,
      warning: `missing layer "${active.active_profile}"`,
    };
  }

  if (!isProfileLayer(layer)) {
    return {
      active_profile: active.active_profile,
      layer,
      stack_resource_count: 0,
      stack_summary: null,
      warning: `layer "${layer.name}" is not tagged as a profile`,
    };
  }

  const merged = mergeLayersForApply([layer.id]);
  const resources = materialResources(merged.resources);
  return {
    active_profile: formatLayerLabel(layer),
    layer,
    stack_resource_count: resources.length,
    stack_summary: formatResourceTypeSummary(resources),
  };
}

function buildAppliedLayers(project: Project | null): AppliedLayerStatusRow[] {
  if (!project) {
    return [];
  }

  return getProjectConfiguredLayers(project.id).flatMap((row) => {
    const layer = getLayerById(row.layer_id);
    if (!layer) {
      return [];
    }
    const { count, summary } = summarizeLayerResources(layer.id);
    return [{
      layer,
      resource_count: count,
      resource_summary: summary,
      platforms: row.platforms,
      applied_at: row.applied_at,
    }];
  });
}

function buildResolvedSection(
  configuredLayerIds: string[],
): ProjectStatusPayload["resolved"] {
  const environmentCascade = environmentCascadePayload({
    configuredLayerIds,
  });

  if (configuredLayerIds.length === 0) {
    return {
      resource_count: 0,
      resource_summary: "",
      plugin_pins: [],
      environment_vars: Object.keys(environmentCascade.resolved.vars).length,
      environment_secrets: Object.keys(environmentCascade.resolved.secretRefs).length,
    };
  }

  const merged = mergeLayersForApply(configuredLayerIds);
  const resources = materialResources(merged.resources);
  const pinMap = new Map<string, { ref: string; version_constraint: string }>();
  for (const layerId of configuredLayerIds) {
    for (const pin of listAttachedPluginPins(layerId)) {
      pinMap.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }
  }
  const pins = [...pinMap.values()];
  const validationIssues = validatePluginPinsAgainstInventory(pins);
  const issueByRef = new Map(validationIssues.map((issue) => [issue.ref, issue]));

  const pluginPins: ResolvedPluginPinStatus[] = pins.map((pin) => {
    const issue = issueByRef.get(pin.ref);
    if (!issue) {
      return {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
        status: "synced",
      };
    }
    return {
      ref: pin.ref,
      version_constraint: pin.version_constraint,
      status: issue.installed === "never_synced" ? "never_synced" : "stale",
      message: issue.message,
    };
  });

  return {
    resource_count: resources.length,
    resource_summary: formatResourceTypeSummary(resources),
    plugin_pins: pluginPins,
    environment_vars: Object.keys(environmentCascade.resolved.vars).length,
    environment_secrets: Object.keys(environmentCascade.resolved.secretRefs).length,
  };
}

export function formatDriftStatusLabel(
  project: Project | null,
  driftReport: ProjectDriftReport | null,
): string {
  if (!project) {
    return "(not tracked)";
  }
  if (!driftReport?.snapshot_id) {
    return "(no snapshots)";
  }
  if (!driftReport.has_drift) {
    return "none";
  }
  return `${driftReport.changes.length} change(s) since snapshot ${driftReport.snapshot_id}`;
}

export async function buildProjectStatusPayload(projectRoot: string): Promise<ProjectStatusPayload> {
  const resolvedRoot = resolve(projectRoot);
  const gitOriginRaw = getGitOrigin(resolvedRoot);
  const gitOrigin = gitOriginRaw ? normalizeGitUrl(gitOriginRaw) : null;
  const projectByPath = getProjectByLocalPath(resolvedRoot);
  const project =
    projectByPath
    ?? (gitOrigin ? getProjectByOrigin(gitOrigin) : undefined)
    ?? null;
  const configuredLayerIds = project
    ? getProjectConfiguredLayers(project.id).map((row) => row.layer_id)
    : [];
  const environmentCascade = environmentCascadePayload({
    configuredLayerIds,
  });
  const driftReport = project
    ? detectProjectDriftFromLatest(resolvedRoot, project.id)
    : null;
  const appliedLayers = buildAppliedLayers(project);
  const resolved = buildResolvedSection(configuredLayerIds);
  const projectResources = await assessProjectScanStatus(resolvedRoot);

  const lock = readLockfile(resolvedRoot);
  const lockSection = lock
    ? (() => {
        try {
          return compareLockToResolution(
            lock,
            resolveComposition({ rootSelectors: [lock.root] }),
          );
        } catch {
          // A lock whose root no longer resolves is itself drift.
          return {
            drift: true,
            root: lock.root,
            changes: [],
            added: [],
            removed: lock.plugins.map((entry) => entry.name),
          };
        }
      })()
    : undefined;

  return {
    project_root: resolvedRoot,
    git_origin: gitOrigin,
    git_origin_raw: gitOriginRaw ?? null,
    platforms: detectPlatforms(resolvedRoot),
    project,
    drift: driftReport,
    snapshots_count: project ? listSnapshots(project.id).length : 0,
    environment_cascade: environmentCascade,
    profile: buildProfileSection(),
    applied_layers: appliedLayers,
    resolved,
    project_resources: projectResources,
    ...(lockSection ? { lock: lockSection } : {}),
  };
}
