import {
  addResourceToPlugin,
  getPluginResources,
  removeResourceFromPlugin,
} from "../models/plugin-model.js";
import { findResourceByKey, normalizeResourceInput, upsertResource } from "../models/resource.js";
import { markPluginDirty } from "./plugin-versioning.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import type { DependencySourceKind, PluginDependencyMetadata, Resource } from "../types.js";

export interface ParsedDependencyRef {
  name: string;
  source_kind: DependencySourceKind;
  origin_ref: string;
  namespace: string;
}

export interface DependencyView {
  name: string;
  source_kind: DependencySourceKind;
  ref: string;
  version_constraint: string;
  embed_on_export: boolean;
  resource: Resource;
}

const GIT_PREFIXES = ["http://", "https://", "git@", "ssh://", "git+"];

export function parseDependencyRef(ref: string): ParsedDependencyRef {
  const trimmed = ref.trim();

  if (GIT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    const tail = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    const name = tail.replace(/\.git$/, "").split(":").pop() ?? tail;
    return { name, source_kind: "git", origin_ref: trimmed, namespace: "" };
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const name = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    return { name, source_kind: "local", origin_ref: trimmed, namespace: "" };
  }

  const slashParts = trimmed.split("/");
  if (slashParts.length === 3) {
    const [org, catalog, name] = slashParts;
    if (org && catalog && name) {
      return {
        name,
        source_kind: "catalog",
        origin_ref: trimmed,
        namespace: `${org}/${catalog}`,
      };
    }
  }

  const at = trimmed.lastIndexOf("@");
  if (at > 0) {
    const name = trimmed.slice(0, at);
    const namespace = trimmed.slice(at + 1);
    return { name, source_kind: "marketplace", origin_ref: trimmed, namespace };
  }

  return { name: trimmed, source_kind: "local", origin_ref: trimmed, namespace: "" };
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
  if (opts?.versionConstraint) {
    parseVersionConstraint(opts.versionConstraint);
  }
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

export function listDependencies(pluginId: string): DependencyView[] {
  return getPluginResources(pluginId)
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
