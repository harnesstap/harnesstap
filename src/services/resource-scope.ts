import {
  getPluginResourceHarnessScope,
  listPluginsAttachingResource,
  setPluginResourceHarnessScope,
} from "../models/plugin-model.js";
import { resolveResource } from "../models/resource.js";
import { getPlatform } from "../platforms/registry.js";
import {
  type HarnessScope,
  unionHarnessScopes,
} from "./harness-scope.js";

export function parseHarnessIdList(raw: string): string[] {
  return [...new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )];
}

export function addHarnessesToResourceScope(input: {
  selector: string;
  harnessIds: readonly string[];
}): {
  resourceName: string;
  resourceType: string;
  scope: HarnessScope;
  pluginsUpdated: number;
} {
  const resolved = resolveResource(input.selector);
  if (resolved.status === "not_found") {
    throw new Error(`Error: "${input.selector}" isn't in your library.`);
  }
  if (resolved.status === "ambiguous") {
    throw new Error(`Error: "${input.selector}" matches more than one resource.`);
  }

  const unknown = input.harnessIds.filter((id) => !getPlatform(id));
  if (unknown.length > 0) {
    throw new Error(`Error: Unknown harness "${unknown[0]}".`);
  }
  if (input.harnessIds.length === 0) {
    throw new Error("Error: Pass at least one harness id.");
  }

  const added: HarnessScope = { kind: "subset", harnesses: [...input.harnessIds] };
  const plugins = listPluginsAttachingResource(resolved.resource.id);
  if (plugins.length === 0) {
    throw new Error(
      `Error: "${resolved.resource.name}" isn't attached to a profile or plugin.`,
    );
  }
  let last: HarnessScope = added;
  for (const plugin of plugins) {
    const current = getPluginResourceHarnessScope(plugin.id, resolved.resource.id);
    last = unionHarnessScopes(current, added);
    setPluginResourceHarnessScope(plugin.id, resolved.resource.id, last);
  }

  return {
    resourceName: resolved.resource.name,
    resourceType: resolved.resource.type,
    scope: last,
    pluginsUpdated: plugins.length,
  };
}
