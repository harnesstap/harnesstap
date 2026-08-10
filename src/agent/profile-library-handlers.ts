import { listPlugins } from "../models/plugin-model.js";
import { listResources, resolveResource } from "../models/resource.js";
import { readResourceContentFromPathHint } from "../services/resource-editor-path.js";
import { truncateResourceContent } from "../services/resource-show.js";
import { parseUntrackedResourceSelector } from "../services/untracked-resource.js";
import { jsonResponse } from "./http.js";

export function handleLibraryPlugins(): Response {
  return jsonResponse({
    plugins: listPlugins().map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      tags: plugin.tags,
      description: plugin.description ?? null,
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
      updated_at: resource.updated_at,
      origin_kind: resource.origin_kind,
    })),
  });
}

export function handleLibraryResourceDetail(
  selector: string,
  options?: { pathHint?: string | null },
): Response {
  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  const untracked = parseUntrackedResourceSelector(trimmed);
  if (untracked) {
    const pathHint = options?.pathHint?.trim();
    if (!pathHint) {
      return jsonResponse(
        { error: "not_found", message: `Resource not found: ${trimmed}` },
        { status: 404 },
      );
    }
    try {
      const onDisk = readResourceContentFromPathHint(pathHint);
      const content = truncateResourceContent(onDisk.content, 80);
      return jsonResponse({
        resource: {
          id: trimmed,
          type: untracked.type,
          name: untracked.name,
          namespace: null,
          description: null,
          source: pathHint,
          origin_kind: "untracked",
          origin_ref: onDisk.path,
          updated_at: onDisk.updatedAt,
          content,
          content_truncated: onDisk.content.split("\n").length > 80,
        },
      });
    } catch (error) {
      return jsonResponse(
        {
          error: "not_found",
          message:
            error instanceof Error
              ? error.message
              : `Resource not found: ${trimmed}`,
        },
        { status: 404 },
      );
    }
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
