import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getPluginResources } from "../models/plugin-model.js";
import { getResource, resolveResource } from "../models/resource.js";
import type { Resource, ResourceExport } from "../types.js";
import { RESOURCE_SCHEMA, RESOURCE_SCHEMA_VERSION } from "../types.js";
import {
  buildApPackageFilesForResource,
  readApPackageFiles,
  writeApPackageFiles,
} from "./agent-plugins/files.js";
import {
  isApEnvelopePath,
  readApEnvelope,
  writeApEnvelope,
} from "./agent-plugins/envelope.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import { isCompositionResourceType } from "./plugin-composition.js";
import { parseResourceSelector } from "./resource-selector.js";

function toResourceExport(resource: Resource): ResourceExport {
  const { id, created_at, updated_at, source, ...payload } = resource;
  return {
    $schema: RESOURCE_SCHEMA,
    version: RESOURCE_SCHEMA_VERSION,
    ...payload,
  };
}

export function formatResourceSelector(
  resource: Pick<Resource, "type" | "name" | "namespace">,
): string {
  const namePart = resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
  return `${resource.type}:${namePart}`;
}

export function exportResourceToFile(
  selector: string,
  filePath: string,
  options?: { singleFile?: boolean },
): ResourceExport & { files: string[] } {
  const parsed = parseResourceSelector(selector);
  if (parsed.type && isCompositionResourceType(parsed.type)) {
    throw new Error(
      `Cannot export composition resource type: ${parsed.type}`,
    );
  }
  const resolved = resolveResource(selector);
  if (resolved.status !== "found") {
    throw new Error(
      resolved.status === "ambiguous"
        ? `Ambiguous resource selector: ${selector}`
        : `Resource not found: ${selector}`,
    );
  }
  if (isCompositionResourceType(resolved.resource.type)) {
    throw new Error(
      `Cannot export composition resource type: ${resolved.resource.type}`,
    );
  }
  const out = resolve(filePath);
  const files = buildApPackageFilesForResource(resolved.resource.id);
  const singleFile = options?.singleFile === true || isApEnvelopePath(out);
  const written = singleFile
    ? (writeApEnvelope(files, out), Object.keys(files).sort())
    : writeApPackageFiles(files, out);
  return {
    ...toResourceExport(resolved.resource),
    files: written,
  };
}

export function importResourceFromFile(filePath: string): {
  resource: Resource;
  action: "created" | "updated" | "unchanged";
} {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }
  const packageFiles = statSync(resolved).isDirectory()
    ? readApPackageFiles(resolved)
    : isApEnvelopePath(resolved)
      ? readApEnvelope(resolved)
      : (() => {
          throw new Error(
            `${resolved} is not an Agent Plugins package directory or .ap.json envelope.`,
          );
        })();

  const plugin = importApPackageFiles(packageFiles);
  const resources = getPluginResources(plugin.id);
  const resource = resources[0];
  if (!resource) {
    throw new Error(`Package ${resolved} did not contain any resources.`);
  }
  const stored = getResource(resource.id) ?? resource;
  return {
    resource: stored,
    action: "created",
  };
}
