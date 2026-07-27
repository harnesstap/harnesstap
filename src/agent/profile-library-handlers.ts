import { listLayers } from "../models/layer-model.js";
import { listResources, resolveResource } from "../models/resource.js";
import { truncateResourceContent } from "../services/resource-show.js";
import { jsonResponse } from "./http.js";

export function handleLibraryLayers(): Response {
  return jsonResponse({
    layers: listLayers().map((layer) => ({
      id: layer.id,
      name: layer.name,
      version: layer.version,
      tags: layer.tags,
      description: layer.description ?? null,
    })),
  });
}

export function handleLibraryResources(): Response {
  return jsonResponse({
    resources: listResources().map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      namespace: resource.namespace ?? null,
      description: resource.description ?? null,
      source: resource.source,
    })),
  });
}

export function handleLibraryResourceDetail(selector: string): Response {
  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  const result = resolveResource(trimmed);
  if (result.status === "not_found") {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }
  if (result.status === "ambiguous") {
    return jsonResponse(
      {
        error: "ambiguous",
        message: `Ambiguous resource name: ${trimmed}`,
        matches: result.matches.map((resource) => ({
          id: resource.id,
          type: resource.type,
          name: resource.name,
          namespace: resource.namespace || null,
        })),
      },
      { status: 409 },
    );
  }

  const resource = result.resource;
  return jsonResponse({
    resource: {
      id: resource.id,
      type: resource.type,
      name: resource.name,
      namespace: resource.namespace || null,
      description: resource.description || null,
      source: resource.source,
      origin_kind: resource.origin_kind,
      origin_ref: resource.origin_ref || null,
      updated_at: resource.updated_at,
      content: truncateResourceContent(resource.content, 80),
      content_truncated: resource.content.split("\n").length > 80,
    },
  });
}
