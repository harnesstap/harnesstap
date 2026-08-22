import {
  addResourceToPlugin,
  createPlugin,
  deletePlugin,
  getPluginById,
  getPluginByName,
  getPluginResources,
  isFrozenPlugin,
  listPluginDependencies,
  listPlugins,
  resolvePluginSelector,
  setPluginDefaultEnvironment,
  setPluginTags,
  updatePluginDescription,
  updatePluginName,
} from "../../models/plugin-model.js";
import {
  PluginAttachmentHintError,
  validatePluginAttachmentType,
} from "../../services/plugin-composition.js";
import { runPluginDoctor } from "../../services/plugin-doctor.js";
import {
  applyPluginEditScripting,
  type PluginEditScriptAdd,
  type PluginEditScriptRemove,
} from "../../services/plugin-edit.js";
import {
  assertAuthored,
  getPluginOrigin,
  PluginProvenanceError,
} from "../../services/plugin-origin.js";
import {
  cutPluginVersion,
  listPluginVersionHistory,
  PluginVersionError,
  rollbackPluginVersion,
} from "../../services/plugin-versioning.js";
import { toContentsResource } from "../../services/profile-contents.js";
import type { Plugin, Resource } from "../../types.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { pluginVersionErrorResponse } from "../profile-cut-handlers.js";

const HEADS_PATH = "/v1/library/plugins/heads";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginRefResourceId(pluginId: string, dependencyName: string): string | null {
  const attached = getPluginResources(pluginId).find(
    (resource) =>
      resource.type === "plugin" &&
      resource.name === dependencyName &&
      (resource.metadata as { source_kind?: string }).source_kind === "local",
  );
  return attached?.id ?? null;
}

function editableDirectResources(resources: Resource[]): Resource[] {
  return resources.filter((resource) => {
    if (resource.type !== "plugin") {
      return true;
    }
    const metadata = resource.metadata as { source_kind?: string };
    return metadata.source_kind !== "local";
  });
}

function notFound(selector: string): Response {
  return jsonResponse(
    { error: "not_found", message: `Plugin not found: ${selector}` },
    { status: 404 },
  );
}

export function toPluginHead(plugin: {
  id: string;
  name: string;
  version: string;
  tags: string[];
  description: string;
  dirty: boolean;
  org_slug: string;
  catalog_slug: string;
}): {
  id: string;
  name: string;
  version: string;
  tags: string[];
  description: string | null;
  origin: "authored" | "upstream" | "catalog";
  dirty: boolean;
  org_slug: string;
  catalog_slug: string;
} {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    tags: plugin.tags,
    description: plugin.description || null,
    origin: getPluginOrigin(plugin.id),
    dirty: plugin.dirty,
    org_slug: plugin.org_slug,
    catalog_slug: plugin.catalog_slug,
  };
}

export function buildPluginDetail(plugin: Plugin) {
  return {
    plugin: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description ?? "",
      tags: plugin.tags,
      origin: getPluginOrigin(plugin.id),
      dirty: plugin.dirty,
      frozen_at: plugin.frozen_at ?? null,
      default_environment_id: plugin.default_environment_id ?? null,
    },
    dependencies: listPluginDependencies(plugin.id).map((dep) => ({
      dependency_name: dep.dependency_name,
      version_constraint: dep.version_constraint,
      order: dep.order,
      resource_id: pluginRefResourceId(plugin.id, dep.dependency_name),
    })),
    resources: editableDirectResources(getPluginResources(plugin.id)).map(
      (resource) => toContentsResource(resource),
    ),
  };
}

function matchSelectorPath(
  pathname: string,
): { selector: string; rest: string } | null {
  const prefix = "/v1/library/plugins/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const remainder = pathname.slice(prefix.length);
  if (!remainder || remainder === "heads") {
    return null;
  }
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    return { selector: decodeURIComponent(remainder), rest: "" };
  }
  return {
    selector: decodeURIComponent(remainder.slice(0, slash)),
    rest: remainder.slice(slash),
  };
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "invalid_json" }, { status: 400 }),
    };
  }
}

async function readOptionalJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "invalid_json" }, { status: 400 }),
    };
  }
}

function provenanceResponse(error: PluginProvenanceError): Response {
  return jsonResponse(
    {
      error: "not_authored",
      message: error.message,
      hints: error.hints,
    },
    { status: 400 },
  );
}

function parseAttachmentList(
  value: unknown,
  kind: "add" | "remove",
): PluginEditScriptAdd[] | PluginEditScriptRemove[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("invalid_body");
  }
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.selector !== "string" || !entry.selector.trim()) {
      throw new Error("invalid_body");
    }
    if (kind === "add") {
      if (typeof entry.type !== "string" || !entry.type.trim()) {
        throw new Error("invalid_type");
      }
      const type = validatePluginAttachmentType(entry.type);
      return {
        selector: entry.selector.trim(),
        type,
        version: typeof entry.version === "string" ? entry.version : undefined,
        embed: typeof entry.embed === "boolean" ? entry.embed : undefined,
        sync: typeof entry.sync === "boolean" ? entry.sync : undefined,
      };
    }
    return {
      selector: entry.selector.trim(),
      type: typeof entry.type === "string" ? entry.type : undefined,
    };
  });
}

function codedError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function forkLibraryPlugin(
  selector: string,
  asName?: string,
): {
  name: string;
  version: string;
  origin: "authored";
  forked_from: string;
} {
  const source = resolvePluginSelector(selector);
  if (!source) {
    throw codedError(`Plugin not found: ${selector}`, "not_found");
  }
  if (getPluginOrigin(source.id) === "authored") {
    throw codedError(
      `${source.name} is already authored; there is nothing to fork.`,
      "already_authored",
    );
  }
  const name = asName?.trim() || `${source.name}-fork`;
  if (getPluginByName(name)) {
    throw codedError(`Plugin ${name} already exists.`, "plugin_exists");
  }
  const fork = createPlugin({
    name,
    version: source.version,
    description: source.description || `Fork of ${source.name}@${source.version}`,
    tags: source.tags,
    ...(source.claude ? { claude: source.claude } : {}),
    ...(source.needs ? { needs: source.needs } : {}),
    origin: "authored",
  });
  for (const resource of getPluginResources(source.id)) {
    addResourceToPlugin(fork.id, resource.id);
  }
  return {
    name: fork.name,
    version: fork.version,
    origin: "authored",
    forked_from: `${source.name}@${source.version}`,
  };
}

function forkErrorResponse(error: unknown): Response {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  const message = error instanceof Error ? error.message : "fork failed";
  if (code === "not_found") {
    return jsonResponse({ error: "not_found", message }, { status: 404 });
  }
  if (code === "already_authored") {
    return jsonResponse({ error: "already_authored", message }, { status: 400 });
  }
  if (code === "plugin_exists") {
    return jsonResponse({ error: "plugin_exists", message }, { status: 409 });
  }
  return jsonResponse({ error: "invalid_body", message }, { status: 400 });
}

function patchErrorResponse(error: unknown): Response {
  if (error instanceof PluginProvenanceError) {
    return provenanceResponse(error);
  }
  if (error instanceof PluginAttachmentHintError) {
    return jsonResponse(
      {
        error: "invalid_attachment",
        message: error.message,
        hints: error.hints,
      },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.message.startsWith("Invalid --type")) {
    return jsonResponse(
      { error: "invalid_type", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.message === "invalid_type") {
    return jsonResponse({ error: "invalid_type" }, { status: 400 });
  }
  if (error instanceof Error) {
    return jsonResponse(
      { error: "invalid_body", message: error.message },
      { status: 400 },
    );
  }
  return jsonResponse({ error: "invalid_body" }, { status: 400 });
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const { method, pathname } = { method: request.method, pathname: url.pathname };

  if (method === "GET" && pathname === HEADS_PATH) {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    return jsonResponse({
      plugins: listPlugins()
        .filter((plugin) => !isFrozenPlugin(plugin))
        .map(toPluginHead),
    });
  }

  if (method === "POST" && pathname === "/v1/library/plugins") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isRecord(parsed.value) || typeof parsed.value.name !== "string" || !parsed.value.name.trim()) {
      return jsonResponse(
        { error: "invalid_body", message: "name is required" },
        { status: 400 },
      );
    }
    const name = parsed.value.name.trim();
    if (getPluginByName(name)) {
      return jsonResponse(
        { error: "plugin_exists", message: `Plugin ${name} already exists.` },
        { status: 409 },
      );
    }
    const description =
      typeof parsed.value.description === "string" ? parsed.value.description : undefined;
    const plugin = createPlugin({ name, description, origin: "authored" });
    return jsonResponse({ plugin: toPluginHead(plugin) });
  }

  const matched = matchSelectorPath(pathname);
  if (!matched) {
    return null;
  }

  if (method === "GET" && matched.rest === "/versions") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    return jsonResponse({ versions: listPluginVersionHistory(plugin.name) });
  }

  if (method === "POST" && matched.rest === "/rollback") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isRecord(parsed.value)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    const version = parsed.value.version;
    if (typeof version !== "string" || !version.trim()) {
      return jsonResponse(
        { error: "invalid_body", message: "version is required" },
        { status: 400 },
      );
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    try {
      const head = rollbackPluginVersion({
        selector: matched.selector,
        toVersion: version.trim(),
      });
      return jsonResponse(buildPluginDetail(head));
    } catch (error) {
      if (error instanceof PluginProvenanceError) {
        return provenanceResponse(error);
      }
      if (error instanceof PluginVersionError && error.code === "not_found") {
        return jsonResponse({ error: "not_found", message: error.message }, { status: 404 });
      }
      if (error instanceof PluginVersionError) {
        return pluginVersionErrorResponse(error);
      }
      return jsonResponse(
        {
          error: "invalid_body",
          message: error instanceof Error ? error.message : "rollback failed",
        },
        { status: 400 },
      );
    }
  }

  if (method === "GET" && matched.rest === "") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    return jsonResponse(buildPluginDetail(plugin));
  }

  if (method === "PATCH" && matched.rest === "") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isRecord(parsed.value)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    try {
      assertAuthored(plugin.id, "edit");
      if (typeof parsed.value.name === "string" && parsed.value.name.trim()) {
        const nextName = parsed.value.name.trim();
        if (nextName !== plugin.name && getPluginByName(nextName)) {
          return jsonResponse(
            { error: "plugin_exists", message: `Plugin ${nextName} already exists.` },
            { status: 409 },
          );
        }
        updatePluginName(plugin.id, nextName);
      }
      if (typeof parsed.value.description === "string") {
        updatePluginDescription(plugin.id, parsed.value.description);
      }
      if (Array.isArray(parsed.value.tags) && parsed.value.tags.every((tag): tag is string => typeof tag === "string")) {
        setPluginTags(plugin.id, parsed.value.tags);
      }
      if (parsed.value.default_environment_id === null) {
        setPluginDefaultEnvironment(plugin.id, null);
      } else if (typeof parsed.value.default_environment_id === "string") {
        setPluginDefaultEnvironment(plugin.id, parsed.value.default_environment_id);
      }
      const refreshed = getPluginById(plugin.id);
      if (!refreshed) {
        return notFound(matched.selector);
      }
      return jsonResponse(buildPluginDetail(refreshed));
    } catch (error) {
      return patchErrorResponse(error);
    }
  }

  if (method === "PATCH" && matched.rest === "/attachments") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isRecord(parsed.value)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    try {
      const adds = parseAttachmentList(parsed.value.add, "add") as PluginEditScriptAdd[];
      const removes = parseAttachmentList(
        parsed.value.remove,
        "remove",
      ) as PluginEditScriptRemove[];
      if (adds.length === 0 && removes.length === 0) {
        return jsonResponse({ error: "invalid_body" }, { status: 400 });
      }
      const plugin = resolvePluginSelector(matched.selector);
      if (!plugin) {
        return notFound(matched.selector);
      }
      assertAuthored(plugin.id, "edit");
      await applyPluginEditScripting({ plugin, adds, removes });
      const refreshed = getPluginById(plugin.id);
      if (!refreshed) {
        return notFound(matched.selector);
      }
      return jsonResponse(buildPluginDetail(refreshed));
    } catch (error) {
      return patchErrorResponse(error);
    }
  }

  if (method === "DELETE" && matched.rest === "") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    deletePlugin(plugin.id);
    return jsonResponse({
      deleted: true,
      name: plugin.name,
      version: plugin.version,
    });
  }

  if (method === "POST" && matched.rest === "/cut") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isRecord(parsed.value)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    const version = parsed.value.version;
    if (typeof version !== "string" || !version.trim()) {
      return jsonResponse(
        { error: "invalid_body", message: "version is required" },
        { status: 400 },
      );
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    try {
      assertAuthored(plugin.id, "cut");
      const head = cutPluginVersion({
        pluginId: plugin.id,
        newVersion: version.trim(),
      });
      return jsonResponse({
        plugin: {
          id: head.id,
          name: head.name,
          version: head.version,
          dirty: false,
        },
      });
    } catch (error) {
      if (error instanceof PluginProvenanceError) {
        return provenanceResponse(error);
      }
      if (error instanceof PluginVersionError) {
        return pluginVersionErrorResponse(error);
      }
      return jsonResponse(
        {
          error: "invalid_body",
          message: error instanceof Error ? error.message : "cut failed",
        },
        { status: 400 },
      );
    }
  }

  if (method === "POST" && matched.rest === "/doctor") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readOptionalJson(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    const plugin = resolvePluginSelector(matched.selector);
    if (!plugin) {
      return notFound(matched.selector);
    }
    let checkIds: string[] | undefined;
    if (parsed.value !== undefined && parsed.value !== null) {
      if (!isRecord(parsed.value)) {
        return jsonResponse({ error: "invalid_body" }, { status: 400 });
      }
      if (parsed.value.check_ids !== undefined) {
        if (!Array.isArray(parsed.value.check_ids)) {
          return jsonResponse({ error: "invalid_body" }, { status: 400 });
        }
        if (
          !parsed.value.check_ids.every((id) => typeof id === "string")
        ) {
          return jsonResponse({ error: "invalid_body" }, { status: 400 });
        }
        checkIds = parsed.value.check_ids.length
          ? parsed.value.check_ids
          : undefined;
      }
    }
    try {
      return jsonResponse(
        runPluginDoctor({ nameOrId: plugin.id, checkIds }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "doctor failed";
      if (message.startsWith("Unknown doctor check:")) {
        return jsonResponse({ error: "unknown_check", message }, { status: 400 });
      }
      return jsonResponse({ error: "invalid_body", message }, { status: 400 });
    }
  }

  if (method === "POST" && matched.rest === "/fork") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    const parsed = await readOptionalJson(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    let asName: string | undefined;
    if (parsed.value !== undefined && parsed.value !== null) {
      if (!isRecord(parsed.value)) {
        return jsonResponse({ error: "invalid_body" }, { status: 400 });
      }
      if (parsed.value.as !== undefined) {
        if (typeof parsed.value.as !== "string") {
          return jsonResponse({ error: "invalid_body" }, { status: 400 });
        }
        asName = parsed.value.as;
      }
    }
    try {
      return jsonResponse(forkLibraryPlugin(matched.selector, asName));
    } catch (error) {
      return forkErrorResponse(error);
    }
  }

  return null;
}
