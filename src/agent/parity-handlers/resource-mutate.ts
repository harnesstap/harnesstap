import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import {
  deleteResource,
  listLinkedResources,
  resolveResource,
  updateResource,
  type ImportConflictPolicy,
} from "../../models/resource.js";
import { PluginProvenanceError } from "../../services/plugin-origin.js";
import { parseUntrackedResourceSelector } from "../../services/untracked-resource.js";
import { syncLinkedResources } from "../../services/resource-sync.js";
import type { Resource } from "../../types.js";

const SYNC_PATH =
  /^\/v1\/library\/resources\/([^/]+)\/sync$/;
const DELETE_PATH = /^\/v1\/library\/resources\/([^/]+)$/;
const ON_CONFLICT = ["overwrite", "ignore", "fail"] as const;

type OnConflict = (typeof ON_CONFLICT)[number];

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const syncMatch = url.pathname.match(SYNC_PATH);
  const deleteMatch = url.pathname.match(DELETE_PATH);

  if (request.method === "POST" && syncMatch) {
    return handleSync(request, token, decodeSelector(syncMatch[1] ?? ""), url);
  }
  if (request.method === "DELETE" && deleteMatch) {
    return handleDelete(request, token, decodeSelector(deleteMatch[1] ?? ""));
  }
  if (request.method === "PATCH" && deleteMatch) {
    return handlePatch(request, token, decodeSelector(deleteMatch[1] ?? ""));
  }
  return null;
}

function decodeSelector(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resourceSummary(resource: Resource): {
  id: string;
  type: string;
  name: string;
  namespace: string | null;
} {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    namespace: resource.namespace ? resource.namespace : null,
  };
}

function ambiguousResponse(selector: string, matches: Resource[]): Response {
  return jsonResponse(
    {
      error: "ambiguous",
      message: `Ambiguous resource name: ${selector}`,
      matches: matches.map((resource) => ({
        id: resource.id,
        type: resource.type,
        name: resource.name,
        namespace: resource.namespace || null,
      })),
    },
    { status: 409 },
  );
}

function importPolicyFromOnConflict(onConflict: OnConflict): ImportConflictPolicy {
  switch (onConflict) {
    case "overwrite":
      return "overwrite";
    case "ignore":
      return "skip";
    case "fail":
      return "fail";
    default: {
      const _exhaustive: never = onConflict;
      return _exhaustive;
    }
  }
}

function parseOnConflict(value: unknown): OnConflict | "invalid" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && (ON_CONFLICT as readonly string[]).includes(value)) {
    return value as OnConflict;
  }
  return "invalid";
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === true || value === "true" || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === "0") {
    return false;
  }
  return fallback;
}

async function readJsonObject(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true, body: {} };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: jsonResponse(
          { error: "invalid_json", message: "Request body must be a JSON object" },
          { status: 400 },
        ),
      };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { error: "invalid_json", message: "Request body must be a JSON object" },
        { status: 400 },
      ),
    };
  }
}

async function handleSync(
  request: Request,
  token: string,
  selector: string,
  url: URL,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  if (parseUntrackedResourceSelector(trimmed)) {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }

  const parsedBody = await readJsonObject(request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;

  const onConflictRaw = parseOnConflict(
    body.on_conflict !== undefined ? body.on_conflict : url.searchParams.get("on_conflict"),
  );
  if (onConflictRaw === "invalid") {
    return jsonResponse(
      {
        error: "invalid_on_conflict",
        message: "on_conflict must be overwrite, ignore, or fail",
      },
      { status: 400 },
    );
  }
  const onConflict: OnConflict = onConflictRaw ?? "fail";
  const dryRun = parseBool(
    body.dry_run !== undefined ? body.dry_run : url.searchParams.get("dry_run"),
    false,
  );
  const force = parseBool(
    body.force !== undefined ? body.force : url.searchParams.get("force"),
    false,
  );

  const resolved = resolveResource(trimmed, { mode: "compose" });
  if (resolved.status === "ambiguous") {
    return ambiguousResponse(trimmed, resolved.matches);
  }
  if (resolved.status === "not_found") {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }
  if (resolved.resource.type !== "plugin") {
    const linked = listLinkedResources(trimmed);
    if (linked.length === 0) {
      return jsonResponse(
        { error: "not_found", message: `Resource not found: ${trimmed}` },
        { status: 404 },
      );
    }
  }

  try {
    const result = await syncLinkedResources({
      selector: trimmed,
      onConflict,
      policy: importPolicyFromOnConflict(onConflict),
      dryRun,
      force,
    });
    return jsonResponse({
      dry_run: dryRun,
      checked: result.checked,
      updated: result.updated.map(resourceSummary),
      unchanged: result.unchanged.map(resourceSummary),
      skipped: result.skipped.map(resourceSummary),
      stale: result.stale.map((entry) => ({
        resource: resourceSummary(entry.resource),
        reason: entry.reason,
      })),
    });
  } catch (error) {
    if (error instanceof PluginProvenanceError) {
      return jsonResponse(
        { error: "sync_not_allowed", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.startsWith("Resource conflict:")) {
      return jsonResponse(
        { error: "resource_conflict", message: error.message },
        { status: 409 },
      );
    }
    return jsonResponse(
      {
        error: "sync_failed",
        message: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 },
    );
  }
}

async function handleDelete(
  request: Request,
  token: string,
  selector: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  if (parseUntrackedResourceSelector(trimmed)) {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }

  const resolved = resolveResource(trimmed);
  if (resolved.status === "not_found") {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }
  if (resolved.status === "ambiguous") {
    return ambiguousResponse(trimmed, resolved.matches);
  }

  const deleted = deleteResource(resolved.resource.id);
  if (!deleted) {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }

  return jsonResponse({
    deleted: true,
    resource: resourceSummary(resolved.resource),
  });
}

function optionalPatchString(
  value: unknown,
): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  return { ok: true, value };
}

async function handlePatch(
  request: Request,
  token: string,
  selector: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  if (parseUntrackedResourceSelector(trimmed)) {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }

  const parsedBody = await readJsonObject(request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;

  if (
    "type" in body ||
    "origin_kind" in body ||
    "origin_ref" in body ||
    "source" in body
  ) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "type, origin, and path cannot be changed",
      },
      { status: 400 },
    );
  }

  const name = optionalPatchString(body.name);
  const description = optionalPatchString(body.description);
  const content = optionalPatchString(body.content);
  if (!name.ok || !description.ok || !content.ok) {
    return jsonResponse(
      { error: "invalid_body", message: "name, description, and content must be strings" },
      { status: 400 },
    );
  }

  const patch: { name?: string; description?: string; content?: string } = {};
  if (name.value !== undefined) {
    patch.name = name.value;
  }
  if (description.value !== undefined) {
    patch.description = description.value;
  }
  if (content.value !== undefined) {
    patch.content = content.value;
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse(
      { error: "invalid_body", message: "No updatable fields were provided" },
      { status: 400 },
    );
  }

  const resolved = resolveResource(trimmed);
  if (resolved.status === "not_found") {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }
  if (resolved.status === "ambiguous") {
    return ambiguousResponse(trimmed, resolved.matches);
  }

  const updated = updateResource(resolved.resource.id, patch);
  if (!updated) {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }

  return jsonResponse({
    resource: {
      ...resourceSummary(updated),
      description: updated.description,
      content: updated.content,
    },
  });
}
