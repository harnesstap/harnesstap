import { resolvePluginSelector } from "../models/plugin-model.js";
import type { DependencySourceKind, Plugin } from "../types.js";
import { formatCommand } from "../cli/shared.js";
import { listDependencies } from "./plugin-dependency.js";

/**
 * A published package names its dependencies, so whoever installs it must be
 * able to fetch each one. A bare (local) dependency that points at a plugin
 * which only exists in this library cannot be fetched by anyone else, so
 * publish refuses it. Marketplace, git and catalog dependencies carry their
 * own source, and embedded dependencies ship inside the package.
 */
export interface PublishDependencyRef {
  name: string;
  source_kind: DependencySourceKind;
  version_constraint: string;
  embed_on_export: boolean;
}

export function findUnpublishedDependencies(
  refs: PublishDependencyRef[],
  resolve: (selector: string) => Plugin | undefined = resolvePluginSelector,
): string[] {
  const unpublished: string[] = [];
  for (const ref of refs) {
    if (ref.embed_on_export || ref.source_kind !== "local") {
      continue;
    }
    const selector = ref.version_constraint && ref.version_constraint !== "*"
      ? `${ref.name}@${ref.version_constraint}`
      : ref.name;
    const local = resolve(selector);
    if (local && (!local.org_slug || !local.catalog_slug)) {
      if (!unpublished.includes(ref.name)) {
        unpublished.push(ref.name);
      }
    }
  }
  return unpublished;
}

export function unpublishedDependenciesMessage(
  pluginName: string,
  dependencies: string[],
  opts?: { cliHint?: boolean },
): string {
  const lead = `Cannot publish ${pluginName}: it depends on local plugins that are not in a catalog: ${dependencies.join(", ")}. Publish them first, or remove them`;
  if (opts?.cliHint === false) {
    return `${lead} from ${pluginName}.`;
  }
  const removeArgs = dependencies.flatMap((name) => ["--remove", `plugin:${name}`]);
  return `${lead} with ${formatCommand(["plugin", "edit", pluginName, ...removeArgs])}`;
}

export class UnpublishedDependenciesError extends Error {
  readonly code = "unpublished_dependencies";
  readonly pluginName: string;
  readonly dependencies: string[];

  constructor(pluginName: string, dependencies: string[]) {
    super(unpublishedDependenciesMessage(pluginName, dependencies));
    this.name = "UnpublishedDependenciesError";
    this.pluginName = pluginName;
    this.dependencies = dependencies;
  }
}

export function listUnpublishedDependencies(pluginId: string): string[] {
  return findUnpublishedDependencies(listDependencies(pluginId));
}

export function assertDependenciesPublished(plugin: Plugin): void {
  const unpublished = listUnpublishedDependencies(plugin.id);
  if (unpublished.length > 0) {
    throw new UnpublishedDependenciesError(plugin.name, unpublished);
  }
}
