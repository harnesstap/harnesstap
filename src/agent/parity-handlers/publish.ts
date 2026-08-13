import { getPluginByName, getPluginResources, resolvePluginSelector } from "../../models/plugin-model.js";
import {
  loadRegisteredCatalogs,
  parsePublishCatalogSelector,
  publishCatalogKey,
  registerPublishCatalog,
  unregisterPublishCatalog,
  type RegisteredCatalog,
} from "../../config/catalog.js";
import { resolveCatalogAccess } from "../../services/catalog-client.js";
import { listAttachedPluginRefs } from "../../services/plugin-composition.js";
import {
  assertAuthored,
  PluginProvenanceError,
} from "../../services/plugin-origin.js";
import {
  planPluginPublish,
  publishPluginToCatalogs,
} from "../../services/plugin-publish.js";
import {
  buildPluginCatalogBindingsView,
  clearPluginPublishTargets,
  resolvePublishTargets,
  setPluginPublishTargets,
} from "../../services/plugin-publish-targets.js";
import {
  assertPluginsCleanForShare,
  PluginVersionError,
} from "../../services/plugin-versioning.js";
import type { Plugin } from "../../types.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { dirtyPluginsConflictResponse } from "../profile-cut-handlers.js";

export interface PublishHandlerDeps {
  resolveAccess(): Promise<{ isAuthenticated: boolean }>;
  getPluginByName(name: string): Plugin | undefined;
  assertAuthored(pluginId: string, capability: "publish"): void;
  listAttachedPluginRefs(pluginId: string): Array<{
    dependency_name: string;
    version_constraint?: string;
  }>;
  getPluginResources(pluginId: string): Array<{ type: string }>;
  resolvePluginSelector(selector: string): Plugin | undefined;
  loadRegisteredCatalogs(): RegisteredCatalog[];
  resolvePublishTargets(pluginId: string): RegisteredCatalog[];
  planPluginPublish: typeof planPluginPublish;
  publishPluginToCatalogs: typeof publishPluginToCatalogs;
  assertPluginsCleanForShare(plugins: Plugin[]): void;
  registerPublishCatalog(
    selector: string,
  ): { catalog: RegisteredCatalog; created: boolean };
  unregisterPublishCatalog(selector: string): void;
  buildPluginCatalogBindingsView: typeof buildPluginCatalogBindingsView;
  setPluginPublishTargets(pluginId: string, targets: RegisteredCatalog[]): void;
  clearPluginPublishTargets(pluginId: string): void;
}

export function createDefaultPublishHandlerDeps(): PublishHandlerDeps {
  return {
    resolveAccess: async () => {
      const access = await resolveCatalogAccess();
      return { isAuthenticated: access.isAuthenticated };
    },
    getPluginByName,
    assertAuthored: (pluginId) => assertAuthored(pluginId, "publish"),
    listAttachedPluginRefs,
    getPluginResources,
    resolvePluginSelector,
    loadRegisteredCatalogs,
    resolvePublishTargets,
    planPluginPublish,
    publishPluginToCatalogs,
    assertPluginsCleanForShare,
    registerPublishCatalog: (selector) => {
      const result = registerPublishCatalog(selector);
      return { catalog: result.catalog, created: result.created };
    },
    unregisterPublishCatalog: (selector) => {
      unregisterPublishCatalog(selector);
    },
    buildPluginCatalogBindingsView,
    setPluginPublishTargets,
    clearPluginPublishTargets,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptionalJson(
  request: Request,
): Promise<unknown | Response> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }
}

function profilePublishWarnings(
  plugin: Plugin,
  d: PublishHandlerDeps,
): Array<{ code: string; message: string }> {
  const refs = d.listAttachedPluginRefs(plugin.id);
  const materialCount = d
    .getPluginResources(plugin.id)
    .filter((resource) => resource.type !== "plugin").length;
  const warnings: Array<{ code: string; message: string }> = [];
  if (refs.length === 0 && materialCount === 0) {
    warnings.push({
      code: "empty_profile",
      message: `Profile ${plugin.name} has no plugin references and no material resources.`,
    });
  }
  const unpublished: string[] = [];
  for (const ref of refs) {
    const selector = ref.version_constraint
      ? `${ref.dependency_name}@${ref.version_constraint}`
      : ref.dependency_name;
    const local = d.resolvePluginSelector(selector);
    if (local && (!local.org_slug || !local.catalog_slug)) {
      unpublished.push(ref.dependency_name);
    }
  }
  if (unpublished.length > 0) {
    warnings.push({
      code: "unpublished_local_refs",
      message: `Profile ${plugin.name} references unpublished local plugins: ${unpublished.join(", ")}`,
    });
  }
  return warnings;
}

function authRequired(): Response {
  return jsonResponse(
    {
      error: "auth_required",
      message: "Sign in to a HarnessTap cloud account to publish",
    },
    { status: 401 },
  );
}

function mapCaught(error: unknown): Response {
  if (error instanceof PluginProvenanceError) {
    return jsonResponse(
      { error: "not_authored", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof PluginVersionError && error.code === "dirty_plugins") {
    return dirtyPluginsConflictResponse(error.dirtyPlugins ?? []);
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse({ error: "internal_error", message }, { status: 500 });
}

function catalogAccount(catalog: RegisteredCatalog): string {
  return catalog.account ?? "default";
}

const REGISTERED_PREFIX = "/v1/catalogs/registered/";

export function createPublishTryHandle(service: PublishHandlerDeps) {
  return async function tryHandle(
    request: Request,
    token: string,
    _deps: { isAgentSwitchInProgress: () => boolean },
  ): Promise<Response | null> {
    const url = new URL(request.url);
    const method = request.method;
    const planMatch = url.pathname.match(
      /^\/v1\/profiles\/([^/]+)\/publish\/plan$/,
    );
    const publishMatch = url.pathname.match(
      /^\/v1\/profiles\/([^/]+)\/publish$/,
    );
    const bindingsMatch = url.pathname.match(
      /^\/v1\/profiles\/([^/]+)\/catalog-bindings$/,
    );
    const registeredExact = url.pathname === "/v1/catalogs/registered";
    const registeredDeleteRest = url.pathname.startsWith(REGISTERED_PREFIX)
      ? url.pathname.slice(REGISTERED_PREFIX.length)
      : "";

    const matched =
      (method === "POST" && (planMatch || publishMatch || registeredExact))
      || (method === "GET" && (registeredExact || bindingsMatch))
      || (method === "PUT" && bindingsMatch)
      || (method === "DELETE" && registeredDeleteRest.length > 0);

    if (!matched) {
      return null;
    }

    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }

    try {
      if (method === "POST" && planMatch) {
        return await handlePlan(
          decodeURIComponent(planMatch[1] ?? ""),
          service,
        );
      }
      if (method === "POST" && publishMatch) {
        return await handlePublish(
          decodeURIComponent(publishMatch[1] ?? ""),
          service,
        );
      }
      if (method === "GET" && registeredExact) {
        return jsonResponse({ registered: service.loadRegisteredCatalogs() });
      }
      if (method === "POST" && registeredExact) {
        return await handleRegister(request, service);
      }
      if (method === "DELETE" && registeredDeleteRest.length > 0) {
        return handleUnregister(
          decodeURIComponent(registeredDeleteRest),
          service,
        );
      }
      if (bindingsMatch && (method === "GET" || method === "PUT")) {
        const name = decodeURIComponent(bindingsMatch[1] ?? "");
        if (method === "GET") {
          return handleGetBindings(name, service);
        }
        return await handlePutBindings(request, name, service);
      }
    } catch (error) {
      return mapCaught(error);
    }

    return null;
  };
}

async function requireCloudAndPlugin(
  name: string,
  service: PublishHandlerDeps,
): Promise<{ plugin: Plugin } | Response> {
  const access = await service.resolveAccess();
  if (!access.isAuthenticated) {
    return authRequired();
  }
  const found = service.getPluginByName(name);
  if (!found) {
    return jsonResponse(
      { error: "not_found", message: `Profile not found: ${name}` },
      { status: 404 },
    );
  }
  service.assertAuthored(found.id, "publish");
  return { plugin: found };
}

function requireTargets(
  pluginId: string,
  service: PublishHandlerDeps,
): RegisteredCatalog[] | Response {
  const registered = service.loadRegisteredCatalogs();
  if (registered.length === 0) {
    return jsonResponse(
      {
        error: "no_publish_catalogs",
        message:
          "No publish catalogs registered. Register one in Settings first.",
      },
      { status: 400 },
    );
  }
  const targets = service.resolvePublishTargets(pluginId);
  if (targets.length === 0) {
    return jsonResponse(
      {
        error: "no_effective_catalogs",
        message:
          "No effective publish catalogs for this profile. Update the publish catalog allow list.",
      },
      { status: 400 },
    );
  }
  return targets;
}

async function handlePlan(
  name: string,
  service: PublishHandlerDeps,
): Promise<Response> {
  const loaded = await requireCloudAndPlugin(name, service);
  if (loaded instanceof Response) {
    return loaded;
  }
  const targets = requireTargets(loaded.plugin.id, service);
  if (targets instanceof Response) {
    return targets;
  }
  const plans = await service.planPluginPublish(loaded.plugin, targets);
  return jsonResponse({
    profile: loaded.plugin.name,
    dirty: loaded.plugin.dirty,
    authored: true,
    warnings: profilePublishWarnings(loaded.plugin, service),
    plans: plans.map((row) => ({
      target: {
        org: row.target.org,
        catalog: row.target.catalog,
        account: catalogAccount(row.target),
      },
      account: row.account ?? catalogAccount(row.target),
      nextVersion: row.nextVersion,
      ok: row.ok,
      ...(row.error ? { error: row.error } : {}),
    })),
  });
}

async function handlePublish(
  name: string,
  service: PublishHandlerDeps,
): Promise<Response> {
  const loaded = await requireCloudAndPlugin(name, service);
  if (loaded instanceof Response) {
    return loaded;
  }
  if (loaded.plugin.dirty) {
    return dirtyPluginsConflictResponse([
      { name: loaded.plugin.name, version: loaded.plugin.version },
    ]);
  }
  service.assertPluginsCleanForShare([loaded.plugin]);
  const targets = requireTargets(loaded.plugin.id, service);
  if (targets instanceof Response) {
    return targets;
  }
  const results = await service.publishPluginToCatalogs(loaded.plugin, targets);
  const firstOk = results.find((row) => row.ok);
  return jsonResponse({
    profile: loaded.plugin.name,
    version: firstOk?.version ?? loaded.plugin.version,
    results: results.map((row) => ({
      org: row.target.org,
      catalog: row.target.catalog,
      account: catalogAccount(row.target),
      ok: row.ok,
      ...(row.version ? { version: row.version } : {}),
      ...(row.error ? { error: row.error } : {}),
    })),
  });
}

async function handleRegister(
  request: Request,
  service: PublishHandlerDeps,
): Promise<Response> {
  const body = await readOptionalJson(request);
  if (body instanceof Response) {
    return body;
  }
  if (!isRecord(body) || typeof body.selector !== "string") {
    return jsonResponse(
      { error: "invalid_selector", message: "selector must be a string" },
      { status: 400 },
    );
  }
  try {
    const parsed = parsePublishCatalogSelector(body.selector);
    const account =
      typeof body.account === "string" && body.account.trim()
        ? body.account.trim()
        : parsed.account;
    const selector = account
      ? `${account}@${parsed.org}/${parsed.catalog}`
      : `${parsed.org}/${parsed.catalog}`;
    const result = service.registerPublishCatalog(selector);
    return jsonResponse({
      catalog: result.catalog,
      created: result.created,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "invalid_selector", message }, { status: 400 });
  }
}

function handleUnregister(
  selector: string,
  service: PublishHandlerDeps,
): Response {
  let parsed: RegisteredCatalog;
  try {
    parsed = parsePublishCatalogSelector(selector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "invalid_selector", message }, { status: 400 });
  }
  const key = publishCatalogKey(parsed);
  const existing = service
    .loadRegisteredCatalogs()
    .find((entry) => publishCatalogKey(entry) === key);
  if (!existing) {
    return jsonResponse(
      {
        error: "not_found",
        message: `Publish catalog not registered: ${parsed.org}/${parsed.catalog}`,
      },
      { status: 404 },
    );
  }
  service.unregisterPublishCatalog(`${parsed.org}/${parsed.catalog}`);
  return jsonResponse({
    removed: { org: parsed.org, catalog: parsed.catalog },
  });
}

function handleGetBindings(
  name: string,
  service: PublishHandlerDeps,
): Response {
  const found = service.getPluginByName(name);
  if (!found) {
    return jsonResponse(
      { error: "not_found", message: `Profile not found: ${name}` },
      { status: 404 },
    );
  }
  return jsonResponse(service.buildPluginCatalogBindingsView(found));
}

async function handlePutBindings(
  request: Request,
  name: string,
  service: PublishHandlerDeps,
): Promise<Response> {
  const found = service.getPluginByName(name);
  if (!found) {
    return jsonResponse(
      { error: "not_found", message: `Profile not found: ${name}` },
      { status: 404 },
    );
  }
  const body = await readOptionalJson(request);
  if (body instanceof Response) {
    return body;
  }
  if (!isRecord(body) || (body.mode !== "all_registered" && body.mode !== "explicit")) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "mode must be all_registered or explicit",
      },
      { status: 400 },
    );
  }
  if (body.mode === "all_registered") {
    service.clearPluginPublishTargets(found.id);
    return jsonResponse(service.buildPluginCatalogBindingsView(found));
  }
  const rawList = body.allowList;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "explicit allowList must be a non-empty array",
      },
      { status: 400 },
    );
  }
  const registered = service.loadRegisteredCatalogs();
  const registeredKeys = new Set(registered.map((entry) => publishCatalogKey(entry)));
  const allowList: RegisteredCatalog[] = [];
  for (const entry of rawList) {
    if (
      !isRecord(entry)
      || typeof entry.org !== "string"
      || typeof entry.catalog !== "string"
    ) {
      return jsonResponse(
        { error: "invalid_body", message: "allowList entries need org and catalog" },
        { status: 400 },
      );
    }
    const catalog = { org: entry.org, catalog: entry.catalog };
    if (!registeredKeys.has(publishCatalogKey(catalog))) {
      return jsonResponse(
        {
          error: "unregistered_catalog",
          message: `${entry.org}/${entry.catalog} is not a registered publish catalog`,
        },
        { status: 400 },
      );
    }
    allowList.push(catalog);
  }
  service.setPluginPublishTargets(found.id, allowList);
  return jsonResponse(service.buildPluginCatalogBindingsView(found));
}

export const tryHandle = createPublishTryHandle(createDefaultPublishHandlerDeps());
