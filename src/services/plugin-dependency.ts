import {
  addResourceToPlugin,
  getPluginResources,
  removeResourceFromPlugin,
} from "../models/plugin-model.js";
import { findResourceByKey, normalizeResourceInput, upsertResource } from "../models/resource.js";
import type { DependencySourceKind, PluginDependencyMetadata, Resource } from "../types.js";
import {
  parseDependencyRef,
  type ParsedDependencyRef,
} from "../utils/plugin-dependency-ref.js";
import { markPluginDirty } from "./plugin-versioning.js";

export { parseDependencyRef, type ParsedDependencyRef };

export interface DependencyView {
  name: string;
  source_kind: DependencySourceKind;
  ref: string;
  version_constraint: string;
  embed_on_export: boolean;
  resource: Resource;
}

function dependencyNamespace(parsed: ParsedDependencyRef, constraint?: string): string {
  if (!constraint) return parsed.namespace;
  return parsed.namespace ? `${parsed.namespace}#${constraint}` : constraint;
}

export function ensureDependencyResource(
  ref: string,
  opts?: { versionConstraint?: string; portable?: "reference" | "embed" },
): Resource {
  const parsed = parseDependencyRef(ref);
  // Store constraints as authored; doctor / apply validate semver separately so
  // invalid values remain inspectable via `plugin doctor` / plugin-metadata.
  const namespace = dependencyNamespace(parsed, opts?.versionConstraint);

  const existing = findResourceByKey("plugin", parsed.name, namespace);
  if (existing) {
    return existing;
  }

  const metadata: PluginDependencyMetadata = {
    source_kind: parsed.source_kind,
    ...(parsed.namespace ? { marketplace_name: parsed.namespace } : {}),
    ...(opts?.versionConstraint ? { version_constraint: opts.versionConstraint } : {}),
    sync_status: "never_synced",
    portable: opts?.portable ?? "reference",
  };

  const result = upsertResource(
    normalizeResourceInput({
      type: "plugin",
      name: parsed.name,
      namespace,
      description: `Dependency: ${ref}`,
      content: "{}",
      metadata,
      source: "composition:plugin",
      origin_kind: parsed.source_kind === "local" ? "manual" : "marketplace_link",
      origin_ref: parsed.origin_ref,
    }),
    { policy: "overwrite" },
  );

  if (result.action === "skipped") {
    throw new Error(`Failed to create dependency: ${ref}`);
  }
  return result.resource;
}

export function addDependency(
  pluginId: string,
  ref: string,
  opts?: { versionConstraint?: string; embedOnExport?: boolean },
): Resource {
  markPluginDirty(pluginId);
  const resource = ensureDependencyResource(ref, {
    ...(opts?.versionConstraint ? { versionConstraint: opts.versionConstraint } : {}),
    ...(opts?.embedOnExport ? { portable: "embed" as const } : {}),
  });
  addResourceToPlugin(pluginId, resource.id);
  return resource;
}

export function dependenciesFromResources(resources: Resource[]): DependencyView[] {
  return resources
    .filter((resource) => resource.type === "plugin")
    .map((resource) => {
      const metadata = resource.metadata as PluginDependencyMetadata;
      return {
        name: resource.name,
        source_kind: metadata.source_kind ?? "local",
        ref: resource.origin_ref || resource.name,
        version_constraint: metadata.version_constraint ?? "",
        embed_on_export: metadata.portable === "embed",
        resource,
      };
    });
}

export function listDependencies(pluginId: string): DependencyView[] {
  return dependenciesFromResources(getPluginResources(pluginId));
}

export function removeDependency(pluginId: string, nameOrRef: string): boolean {
  const parsed = parseDependencyRef(nameOrRef);
  const match = listDependencies(pluginId).find(
    (dependency) =>
      dependency.name === parsed.name || dependency.ref === nameOrRef,
  );
  if (!match) return false;
  markPluginDirty(pluginId);
  removeResourceFromPlugin(pluginId, match.resource.id);
  return true;
}
