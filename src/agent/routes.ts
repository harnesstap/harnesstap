import { executeConfigInit } from "../services/config-init.js";
import {
  detectGlobalProfileStatus,
  type GlobalProfileStatus,
} from "../services/global-profile-drift.js";
import type { GlobalProfileStatusDepth } from "../services/global-profile-status-panel.js";
import { PROFILE_PLUGIN_TAG, isEmptyBuiltinProfile } from "../constants/profile.js";
import { listProfilePluginsCommand } from "../services/profile-commands.js";
import type { ProfileSwitchStepEvent } from "../services/profile-switch.js";
import { findProjectConfig } from "../services/project-config.js";
import { PACKAGE_VERSION } from "../version.js";
import { getAgentFirstRun } from "./boot-state.js";
import { requireAgentBearerAuth } from "./auth.js";
import {
  type CloudAuthHandlers,
  createCloudAuthHandlers,
} from "./cloud-auth-handlers.js";
import { jsonResponse } from "./http.js";
import { tryParityRoutes } from "./parity-routes.js";
import { handleConstraintRecoveryRun } from "./constraint-recovery-handlers.js";
import { handleProfileApplyPreview } from "./profile-apply-preview-handlers.js";
import { handleProfileAddAllResources, handleProfileAddResource, handleProfileCommitResource } from "./profile-add-resource-handlers.js";
import { handleProfileRestoreFile } from "./profile-restore-file-handlers.js";
import { handleProfileFileDiff } from "./profile-file-diff-handlers.js";
import { handleProfileRemoveResource } from "./profile-remove-resource-handlers.js";
import { handleEnvironmentsList } from "./environment-handlers.js";
import { handleMigrateDetectImportScope, handleMigrateExport, handleMigrateImport } from "./migrate-handlers.js";
import {
  handleHarnessSettingsGet,
  handleHarnessSettingsPut,
} from "./harness-settings-handlers.js";
import {
  handleMarketplacePluginsList,
  handleMarketplacesAdd,
  handleMarketplacesList,
} from "./marketplace-handlers.js";
import { handleOpenPath } from "./open-path-handlers.js";
import {
  createProfileCloudHandlers,
  type ProfileCloudHandlers,
} from "./profile-cloud-handlers.js";
import {
  handleProfileCreate,
  handleProfileCreatePreview,
  handleProfileRename,
  handleProfileTag,
} from "./profile-create-handlers.js";
import {
  handleProfileAttach,
  handleProfileDetach,
  handleProfileDetail,
  handleProfilePatch,
} from "./profile-edit-handlers.js";
import { handleProfileCut } from "./profile-cut-handlers.js";
import { handleProfilePluginAdd } from "./profile-plugin-handlers.js";
import {
  handleProfileStashList,
  handleProfileStashPop,
  handleProfileStashPush,
} from "./profile-stash-handlers.js";
import {
  handleLibraryPlugins,
  handleLibraryResourceCreate,
  handleLibraryResourceDetail,
  handleLibraryResources,
} from "./profile-library-handlers.js";
import {
  handleResourceTrackedDirectoriesList,
  handleResourceTrackedDirectoriesRescan,
  handleResourceTrackedDirectoryAdd,
  handleResourceTrackedDirectoryRemove,
} from "./resource-tracked-directories-handlers.js";
import {
  type AgentSwitchRequest,
  type AgentSwitchScope,
  getAgentSwitchSessionById,
  preflightAgentSwitchOwnedOverwrite,
  startAgentSwitch,
} from "./switch-orchestrator.js";
import {
  type AgentSwitchFinalEvent,
  isAgentSwitchInProgress,
  requestAgentSwitchCancel,
  subscribeAgentSwitchEvents,
} from "./switch-registry.js";

export type ProfileViewScope = "home" | "project";

export interface ProfileSummaryPayload {
  name: string;
  version: string;
  tags: string[];
  description: string | null;
  scopes: ProfileViewScope[];
  dirty: boolean;
}

function listProfilesWithScopes(projectPath?: string): ProfileSummaryPayload[] {
  const byName = new Map<string, ProfileSummaryPayload>();

  for (const profile of listProfilePluginsCommand()) {
    byName.set(profile.name, {
      name: profile.name,
      version: profile.version,
      tags: profile.tags,
      description: profile.description ?? null,
      scopes: ["home"],
      dirty: profile.dirty,
    });
  }

  if (projectPath) {
    const config = findProjectConfig(projectPath);
    if (config) {
      for (const entry of config.profiles) {
        if (isEmptyBuiltinProfile(entry.name)) {
          continue;
        }
        const existing = byName.get(entry.name);
        if (existing) {
          if (!existing.scopes.includes("project")) {
            existing.scopes = [...existing.scopes, "project"];
          }
          continue;
        }
        byName.set(entry.name, {
          name: entry.name,
          version: "",
          tags: [PROFILE_PLUGIN_TAG],
          description: null,
          scopes: ["project"],
          dirty: false,
        });
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseStatusDepth(value: string | null): GlobalProfileStatusDepth | Response {
  if (!value || value === "full") {
    return "full";
  }
  if (value === "fast") {
    return "fast";
  }
  return jsonResponse(
    { error: "invalid_depth", message: "depth must be fast or full" },
    { status: 400 },
  );
}

export interface AgentRouteDeps {
  detectGlobalProfileStatus: typeof detectGlobalProfileStatus;
  preflightAgentSwitchOwnedOverwrite: typeof preflightAgentSwitchOwnedOverwrite;
  startAgentSwitch: typeof startAgentSwitch;
  getAgentSwitchSessionById: typeof getAgentSwitchSessionById;
  requestAgentSwitchCancel: typeof requestAgentSwitchCancel;
  subscribeAgentSwitchEvents: typeof subscribeAgentSwitchEvents;
  isAgentSwitchInProgress: typeof isAgentSwitchInProgress;
  profileCloudHandlers: ProfileCloudHandlers;
  cloudAuthHandlers: CloudAuthHandlers;
}

export function createDefaultAgentRouteDeps(): AgentRouteDeps {
  return {
    detectGlobalProfileStatus,
    preflightAgentSwitchOwnedOverwrite,
    startAgentSwitch,
    getAgentSwitchSessionById,
    requestAgentSwitchCancel,
    subscribeAgentSwitchEvents,
    isAgentSwitchInProgress,
    profileCloudHandlers: createProfileCloudHandlers(),
    cloudAuthHandlers: createCloudAuthHandlers(),
  };
}

function withSwitchingStatus(
  status: GlobalProfileStatus,
  deps: AgentRouteDeps,
): GlobalProfileStatus & { switching: boolean } {
  if (!deps.isAgentSwitchInProgress()) {
    return { ...status, switching: false };
  }

  return {
    ...status,
    switching: true,
    panel: {
      status: "yellow",
      reasons: ["switching", ...status.panel.reasons.filter((reason) => reason !== "switching")],
    },
  };
}

function parseSwitchScope(value: unknown): AgentSwitchScope | Response {
  if (value === "home" || value === "project" || value === "both") {
    return value;
  }
  return jsonResponse(
    { error: "invalid_scope", message: "scope must be home, project, or both" },
    { status: 400 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSwitchRequest(body: unknown): AgentSwitchRequest | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const profile = body.profile;
  if (typeof profile !== "string" || profile.trim().length === 0) {
    return jsonResponse({ error: "invalid_profile" }, { status: 400 });
  }

  const scope = parseSwitchScope(body.scope);
  if (scope instanceof Response) {
    return scope;
  }

  const projectPath =
    typeof body.projectPath === "string" ? body.projectPath : undefined;
  const confirmOwnedOverwrite = body.confirmOwnedOverwrite === true;
  const harness = typeof body.harness === "string" ? body.harness : undefined;

  return {
    profile: profile.trim(),
    scope,
    ...(projectPath ? { projectPath } : {}),
    ...(confirmOwnedOverwrite ? { confirmOwnedOverwrite } : {}),
    ...(harness ? { harness } : {}),
  };
}

function formatSseEvent(payload: ProfileSwitchStepEvent | AgentSwitchFinalEvent): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export interface AgentRouteHandlers {
  handleHealth(): Response;
  handleProfiles(request: Request): Response;
  handleStatus(request: Request): Promise<Response>;
  handleBootstrap(request: Request): Promise<Response>;
  handleSwitch(request: Request): Promise<Response>;
  handleSwitchEvents(switchId: string, request: Request): Response;
  handleSwitchCancel(switchId: string, request: Request): Response;
}

export function createAgentRouteHandlers(
  token: string,
  port: number,
  deps: AgentRouteDeps = createDefaultAgentRouteDeps(),
): AgentRouteHandlers {
  return {
    handleHealth() {
      return jsonResponse({
        status: "healthy",
        version: PACKAGE_VERSION,
        port,
        first_run: getAgentFirstRun(),
      });
    },

    handleProfiles(request) {
      const projectPath = new URL(request.url).searchParams.get("projectPath") ?? undefined;
      return jsonResponse({
        profiles: listProfilesWithScopes(projectPath || undefined),
      });
    },

    async handleStatus(request) {
      const url = new URL(request.url);
      const depthResult = parseStatusDepth(url.searchParams.get("depth"));
      if (depthResult instanceof Response) {
        return depthResult;
      }
      const projectPath = url.searchParams.get("projectPath") ?? undefined;
      const harness = url.searchParams.get("harness") ?? undefined;

      const status = await deps.detectGlobalProfileStatus({
        depth: depthResult,
        ...(projectPath ? { projectPath } : {}),
        ...(harness ? { harness } : {}),
      });

      return jsonResponse(withSwitchingStatus(status, deps));
    },

    async handleBootstrap(request) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "invalid_json" }, { status: 400 });
      }

      if (
        typeof body !== "object"
        || body === null
        || typeof (body as { projectPath?: unknown }).projectPath !== "string"
        || !(body as { projectPath: string }).projectPath
      ) {
        return jsonResponse({ error: "projectPath_required" }, { status: 400 });
      }

      const projectPath = (body as { projectPath: string }).projectPath;
      const profilesRaw = (body as { profiles?: unknown }).profiles;
      const defaultProfileRaw = (body as { defaultProfile?: unknown }).defaultProfile;
      const profiles = Array.isArray(profilesRaw)
        ? profilesRaw.filter((name): name is string => typeof name === "string" && name.length > 0)
        : undefined;
      const defaultProfile =
        typeof defaultProfileRaw === "string" && defaultProfileRaw.length > 0
          ? defaultProfileRaw
          : undefined;

      // Idempotent: project view re-enters bootstrap whenever the repo is not
      // DB-tracked yet; existing `.harnesstap/config.toml` must not re-init.
      const existing = findProjectConfig(projectPath);
      if (existing) {
        const profileNames = existing.profiles.map((profile) => profile.name);
        return jsonResponse({
          config_path: existing.configPath,
          default_profile: existing.default_profile ?? profileNames[0] ?? "",
          profiles: profileNames,
          already_existed: true,
        });
      }

      try {
        const result = await executeConfigInit({
          project: projectPath,
          ...(profiles && profiles.length > 0 ? { profiles } : {}),
          ...(defaultProfile ? { defaultProfile } : {}),
          noInteractive: true,
          format: "json",
        });
        return jsonResponse(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(
          {
            error: "bootstrap_failed",
            message,
          },
          { status: 500 },
        );
      }
    },

    async handleSwitch(request) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "invalid_json" }, { status: 400 });
      }

      const parsed = parseSwitchRequest(body);
      if (parsed instanceof Response) {
        return parsed;
      }

      if (parsed.scope !== "home" && !parsed.projectPath) {
        return jsonResponse(
          {
            error: "missing_project_path",
            message: "projectPath is required when scope is project or both",
          },
          { status: 400 },
        );
      }

      if (deps.isAgentSwitchInProgress()) {
        return jsonResponse(
          { error: "switch_in_progress", message: "Another profile switch is already running" },
          { status: 409 },
        );
      }

      try {
        const preflight = await deps.preflightAgentSwitchOwnedOverwrite(parsed);
        if (preflight.conflict) {
          return jsonResponse(
            {
              error: "owned_overwrite_confirmation_required",
              message: "Owned-path conflicts would be replaced. Set confirmOwnedOverwrite to proceed.",
              conflicts: preflight.summary,
            },
            { status: 409 },
          );
        }

        const started = await deps.startAgentSwitch(parsed);
        return jsonResponse({ id: started.id }, { status: 202 });
      } catch (error) {
        return jsonResponse(
          {
            error: "switch_failed",
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 400 },
        );
      }
    },

    handleSwitchEvents(switchId, request) {
      const session = deps.getAgentSwitchSessionById(switchId);
      if (!session) {
        return jsonResponse({ error: "not_found" }, { status: 404 });
      }

      const encoder = new TextEncoder();
      let unsubscribe = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: ProfileSwitchStepEvent | AgentSwitchFinalEvent) => {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
            if ("type" in event && event.type === "result") {
              unsubscribe();
              controller.close();
            }
          };
          unsubscribe = deps.subscribeAgentSwitchEvents(session, send);
          request.signal.addEventListener("abort", () => {
            unsubscribe();
            controller.close();
          });
        },
        cancel() {
          unsubscribe();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },

    handleSwitchCancel(switchId, request) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      const session = deps.getAgentSwitchSessionById(switchId);
      if (!session) {
        return jsonResponse({ error: "not_found" }, { status: 404 });
      }

      const result = deps.requestAgentSwitchCancel(session);
      if (!result.accepted) {
        const status = result.reason === "already_done" ? 404 : 409;
        return jsonResponse(
          {
            error: result.reason ?? "cancel_rejected",
            message:
              result.reason === "apply_in_progress"
                ? "Cancel is disabled while an apply step is running"
                : "Switch is already complete",
          },
          { status },
        );
      }

      return jsonResponse({ cancelled: true });
    },
  };
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const loopbackHost =
      url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]"
      || url.hostname === "::1"
      || url.hostname === "tauri.localhost"
      || url.hostname === "ipc.localhost";
    const allowedProtocol =
      url.protocol === "http:"
      || url.protocol === "https:"
      || url.protocol === "tauri:";
    return loopbackHost && allowedProtocol;
  } catch {
    return false;
  }
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get("Origin");
  if (!origin || !isLoopbackOrigin(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept",
  );
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, PUT, POST, PATCH, DELETE, OPTIONS, HEAD",
  );
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAgentFetchHandler(
  token: string,
  port: number,
  deps?: AgentRouteDeps,
): (request: Request) => Response | Promise<Response> {
  const routeDeps = deps ?? createDefaultAgentRouteDeps();
  const handlers = createAgentRouteHandlers(token, port, routeDeps);

  return async (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }));
    }

    let response: Response;
    if (method === "GET" && url.pathname === "/v1/health") {
      response = handlers.handleHealth();
    } else if (method === "GET" && url.pathname === "/v1/profiles") {
      response = handlers.handleProfiles(request);
    } else if (method === "POST" && url.pathname === "/v1/profiles/preview") {
      response = await handleProfileCreatePreview(request, token);
    } else if (method === "POST" && url.pathname === "/v1/profiles/apply-preview") {
      response = await handleProfileApplyPreview(request, token);
    } else if (method === "POST" && url.pathname === "/v1/recovery/run") {
      response = await handleConstraintRecoveryRun(request, token);
    } else if (method === "POST" && url.pathname === "/v1/profiles") {
      response = await handleProfileCreate(
        request,
        token,
        routeDeps.isAgentSwitchInProgress,
      );
    } else if (method === "GET" && url.pathname === "/v1/profiles/cloud") {
      response = await routeDeps.profileCloudHandlers.handleBrowse(request, token);
    } else if (method === "POST" && url.pathname === "/v1/profiles/cloud/pull") {
      response = await routeDeps.profileCloudHandlers.handlePull(request, token);
    } else if (method === "GET" && url.pathname === "/v1/cloud/auth") {
      response = await routeDeps.cloudAuthHandlers.handleStatus(request, token);
    } else if (method === "POST" && url.pathname === "/v1/cloud/auth/login") {
      response = await routeDeps.cloudAuthHandlers.handleLogin(request, token);
    } else if (method === "POST" && url.pathname === "/v1/cloud/auth/login/poll") {
      response = await routeDeps.cloudAuthHandlers.handleLoginPoll(request, token);
    } else if (method === "POST" && url.pathname === "/v1/cloud/auth/login/cancel") {
      response = await routeDeps.cloudAuthHandlers.handleLoginCancel(request, token);
    } else if (method === "POST" && url.pathname === "/v1/cloud/auth/logout") {
      response = await routeDeps.cloudAuthHandlers.handleLogout(request, token);
    } else if (method === "GET" && url.pathname === "/v1/profiles/stash") {
      response = handleProfileStashList(request, token);
    } else if (method === "POST" && url.pathname === "/v1/profiles/stash") {
      response = await handleProfileStashPush(
        request,
        token,
        routeDeps.isAgentSwitchInProgress,
      );
    } else if (method === "POST" && url.pathname === "/v1/profiles/stash/pop") {
      response = await handleProfileStashPop(
        request,
        token,
        routeDeps.isAgentSwitchInProgress,
      );
    } else if (method === "GET" && url.pathname === "/v1/status") {
      response = await handlers.handleStatus(request);
    } else if (method === "POST" && url.pathname === "/v1/bootstrap") {
      response = await handlers.handleBootstrap(request);
    } else if (method === "POST" && url.pathname === "/v1/switch") {
      response = await handlers.handleSwitch(request);
    } else if (method === "POST" && url.pathname === "/v1/open-path") {
      response = await handleOpenPath(request, token);
    } else if (method === "GET" && url.pathname === "/v1/harness") {
      response = handleHarnessSettingsGet(request, token);
    } else if (method === "PUT" && url.pathname === "/v1/harness") {
      response = await handleHarnessSettingsPut(request, token);
    } else if (method === "GET" && url.pathname === "/v1/marketplaces") {
      response = handleMarketplacesList(request, token);
    } else if (method === "POST" && url.pathname === "/v1/marketplaces") {
      response = await handleMarketplacesAdd(request, token);
    } else if (method === "GET" && url.pathname.match(/^\/v1\/marketplaces\/[^/]+\/plugins$/)) {
      const name = decodeURIComponent(
        url.pathname.slice("/v1/marketplaces/".length).replace(/\/plugins$/, ""),
      );
      response = handleMarketplacePluginsList(request, token, name);
    } else if (method === "GET" && url.pathname === "/v1/environments") {
      response = handleEnvironmentsList(request, token);
    } else if (method === "POST" && url.pathname === "/v1/migrate/detect-import-scope") {
      response = await handleMigrateDetectImportScope(request, token);
    } else if (method === "POST" && url.pathname === "/v1/migrate/export") {
      response = await handleMigrateExport(request, token);
    } else if (method === "POST" && url.pathname === "/v1/migrate/import") {
      response = await handleMigrateImport(request, token);
    } else if (method === "GET" && url.pathname === "/v1/library/plugins") {
      const authError = requireAgentBearerAuth(request, token);
      response = authError ?? handleLibraryPlugins();
    } else if (method === "GET" && url.pathname === "/v1/library/resources") {
      const authError = requireAgentBearerAuth(request, token);
      response = authError ?? handleLibraryResources();
    } else if (method === "POST" && url.pathname === "/v1/library/resources") {
      response = await handleLibraryResourceCreate(request, token);
    } else if (method === "GET" && url.pathname === "/v1/library/resource-directories") {
      response = handleResourceTrackedDirectoriesList(request, token);
    } else if (
      method === "POST" && url.pathname === "/v1/library/resource-directories/rescan"
    ) {
      response = await handleResourceTrackedDirectoriesRescan(request, token);
    } else if (method === "POST" && url.pathname === "/v1/library/resource-directories") {
      response = await handleResourceTrackedDirectoryAdd(request, token);
    } else if (method === "DELETE" && url.pathname === "/v1/library/resource-directories") {
      response = await handleResourceTrackedDirectoryRemove(request, token);
    } else if (method === "GET" && url.pathname.startsWith("/v1/library/resources/")) {
      const deletePlanMatch = url.pathname.match(
        /^\/v1\/library\/resources\/([^/]+)\/delete-plan$/,
      );
      if (deletePlanMatch) {
        const parity = await tryParityRoutes(request, token, {
          isAgentSwitchInProgress: routeDeps.isAgentSwitchInProgress,
        });
        response = parity ?? jsonResponse({ error: "not_found" }, { status: 404 });
      } else {
        const authError = requireAgentBearerAuth(request, token);
        if (authError) {
          response = authError;
        } else {
          const selector = decodeURIComponent(
            url.pathname.slice("/v1/library/resources/".length),
          );
          response = handleLibraryResourceDetail(selector, {
            pathHint: url.searchParams.get("path"),
          });
        }
      }
    } else {
      const profileAttachmentMatch = url.pathname.match(
        /^\/v1\/profiles\/([^/]+)\/attachments$/,
      );
      const profilePluginMatch = url.pathname.match(
        /^\/v1\/profiles\/([^/]+)\/plugins$/,
      );
      if (method === "POST" && profileAttachmentMatch) {
        response = await handleProfileAttach(
          request,
          token,
          decodeURIComponent(profileAttachmentMatch[1] ?? ""),
        );
      } else if (method === "DELETE" && profileAttachmentMatch) {
        response = await handleProfileDetach(
          request,
          token,
          decodeURIComponent(profileAttachmentMatch[1] ?? ""),
        );
      } else if (method === "POST" && profilePluginMatch) {
        response = await handleProfilePluginAdd(
          request,
          token,
          decodeURIComponent(profilePluginMatch[1] ?? ""),
        );
      } else {
      const profileDetailMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)$/);
      if (method === "GET" && profileDetailMatch) {
        response = handleProfileDetail(
          request,
          token,
          decodeURIComponent(profileDetailMatch[1] ?? ""),
        );
      } else if (method === "PATCH" && profileDetailMatch) {
        response = await handleProfilePatch(
          request,
          token,
          decodeURIComponent(profileDetailMatch[1] ?? ""),
        );
      } else {
      const renameMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/rename$/);
      if (method === "POST" && renameMatch) {
        response = await handleProfileRename(
          request,
          token,
          decodeURIComponent(renameMatch[1] ?? ""),
        );
      } else {
        const cutMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/cut$/);
        if (method === "POST" && cutMatch) {
          response = await handleProfileCut(
            request,
            token,
            decodeURIComponent(cutMatch[1] ?? ""),
          );
        } else {
        const tagMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/tag$/);
        if (method === "POST" && tagMatch) {
          response = handleProfileTag(
            request,
            token,
            decodeURIComponent(tagMatch[1] ?? ""),
          );
        } else {
          const addAllMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/add-all-resources$/);
          if (method === "POST" && addAllMatch) {
            response = await handleProfileAddAllResources(
              request,
              token,
              decodeURIComponent(addAllMatch[1] ?? ""),
            );
          } else {
          const addMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/add-resource$/);
          if (method === "POST" && addMatch) {
            response = await handleProfileAddResource(
              request,
              token,
              decodeURIComponent(addMatch[1] ?? ""),
            );
          } else {
            const commitMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/commit-resource$/);
            if (method === "POST" && commitMatch) {
              response = await handleProfileCommitResource(
                request,
                token,
                decodeURIComponent(commitMatch[1] ?? ""),
              );
            } else {
            const restoreMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/restore-file$/);
            if (method === "POST" && restoreMatch) {
              response = await handleProfileRestoreFile(
                request,
                token,
                decodeURIComponent(restoreMatch[1] ?? ""),
              );
            } else {
            const fileDiffMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/file-diff$/);
            if (method === "POST" && fileDiffMatch) {
              response = await handleProfileFileDiff(
                request,
                token,
                decodeURIComponent(fileDiffMatch[1] ?? ""),
              );
            } else {
            const removeMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/remove-resource$/);
            if (method === "POST" && removeMatch) {
              response = await handleProfileRemoveResource(
                request,
                token,
                decodeURIComponent(removeMatch[1] ?? ""),
              );
            } else {
            const eventsMatch = url.pathname.match(/^\/v1\/switch\/([^/]+)\/events$/);
            if (method === "GET" && eventsMatch) {
              response = handlers.handleSwitchEvents(eventsMatch[1] ?? "", request);
            } else if (method !== "GET" && method !== "HEAD") {
              const cancelMatch = url.pathname.match(/^\/v1\/switch\/([^/]+)\/cancel$/);
              if (method === "POST" && cancelMatch) {
                response = handlers.handleSwitchCancel(cancelMatch[1] ?? "", request);
              } else {
                const authError = requireAgentBearerAuth(request, token);
                response = authError ?? jsonResponse({ error: "not_found" }, { status: 404 });
              }
            } else {
              response = jsonResponse({ error: "not_found" }, { status: 404 });
            }
          }
          }
          }
          }
          }
          }
          }
        }
      }
      }
      }
    }

    if (response.status === 404) {
      const parity = await tryParityRoutes(request, token, {
        isAgentSwitchInProgress: routeDeps.isAgentSwitchInProgress,
      });
      if (parity) {
        response = parity;
      }
    }

    return withCors(request, response);
  };
}
