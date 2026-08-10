import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getPluginResources } from "../models/plugin-model.js";
import { getResource, resolveResource } from "../models/resource.js";
import type { Resource } from "../types.js";
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

export interface ResourcePackageExportResult {
  type: Resource["type"];
  name: string;
  description: string;
  content: string;
  metadata: Resource["metadata"];
  namespace: string;
  origin_kind: Resource["origin_kind"];
  origin_ref: string;
  content_hash: string;
  content_blob_ref: string;
  files: string[];
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
): ResourcePackageExportResult {
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
  const { id: _id, created_at: _c, updated_at: _u, source: _s, ...payload } =
    resolved.resource;
  return {
    ...payload,
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
