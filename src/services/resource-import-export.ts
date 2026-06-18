import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveResource } from "../models/resource.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import type { Resource, ResourceExport } from "../types.js";
import { RESOURCE_SCHEMA, RESOURCE_SCHEMA_VERSION } from "../types.js";
import { parseResourceSelector } from "./resource-selector.js";
import { isCompositionResourceType } from "./layer-composition.js";
import { formatResourceExportToml, parseResourceExportToml } from "./transport/resource.js";
import { assertTransportExtension } from "./transport/validate.js";

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
): ResourceExport {
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
  assertTransportExtension(out);
  const exportDoc = toResourceExport(resolved.resource);
  writeFileSync(out, formatResourceExportToml(exportDoc), "utf-8");
  return exportDoc;
}

export function importResourceFromFile(filePath: string): {
  resource: Resource;
  action: "created" | "updated" | "unchanged";
} {
  const resolved = resolve(filePath);
  const exportDoc = parseResourceExportToml(readFileSync(resolved, "utf-8"));
  if (exportDoc.type.length === 0 || exportDoc.name.length === 0) {
    throw new Error("Resource export must include non-empty type and name.");
  }
  if (isCompositionResourceType(exportDoc.type)) {
    throw new Error(`Cannot import composition resource type: ${exportDoc.type}`);
  }
  const upserted = upsertResource(
    normalizeResourceInput({
      type: exportDoc.type,
      name: exportDoc.name,
      namespace: exportDoc.namespace,
      description: exportDoc.description,
      content: exportDoc.content,
      metadata: exportDoc.metadata,
      source: `import:${resolved}`,
      origin_kind: exportDoc.origin_kind,
      origin_ref: exportDoc.origin_ref,
    }),
    { policy: "overwrite" },
  );
  if (upserted.action === "skipped") {
    throw new Error(`Failed to import resource: ${exportDoc.type}:${exportDoc.name}`);
  }
  return {
    resource: upserted.resource,
    action: upserted.action,
  };
}
