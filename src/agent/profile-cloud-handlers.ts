import { isProfilePlugin } from "../constants/profile.js";
import { getPluginByName } from "../models/plugin-model.js";
import {
  listCatalogPluginsPage,
  resolveCatalogAccess,
} from "../services/catalog-client.js";
import type {
  CatalogPlugin,
  CatalogListOptions,
  CatalogListResult,
} from "../services/catalog-types.js";
import {
  resolveInstallSelector,
  type ResolveInstallSelectorOptions,
} from "../services/plugin-bare-name-resolve.js";
import {
  installPluginFromCatalog,
  type InstallPluginFromCatalogOptions,
  type InstallPluginFromCatalogResult,
} from "../services/plugin-catalog-install.js";
import type { ResolvedRemotePluginSelector } from "../services/plugin-selector.js";
import { tagProfileCommand } from "../services/profile-commands.js";
import type { Plugin } from "../types.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";
import { isAgentSwitchInProgress } from "./switch-registry.js";

export interface ProfileCloudDeps {
  resolveAccess(): Promise<{ isAuthenticated: boolean }>;
  listPlugins(options?: CatalogListOptions): Promise<CatalogListResult>;
  resolveSelector(
    selector: string,
    options?: ResolveInstallSelectorOptions,
  ): Promise<ResolvedRemotePluginSelector>;
  installPlugin(
    selector: ResolvedRemotePluginSelector,
    options?: InstallPluginFromCatalogOptions,
  ): Promise<InstallPluginFromCatalogResult>;
  getPluginByName(name: string): Plugin | undefined;
  isProfilePlugin(plugin: Pick<Plugin, "tags">): boolean;
  tagProfile(name: string): { plugin_id: string; tags: string[] };
  isSwitchInProgress(): boolean;
}

export interface ProfileCloudHandlers {
  handleBrowse(request: Request, token: string): Promise<Response>;
  handlePull(request: Request, token: string): Promise<Response>;
}

interface ProfileCloudPullInput {
  selector: string;
  as?: string;
  use: boolean;
}

function createDefaultProfileCloudDeps(): ProfileCloudDeps {
  return {
    resolveAccess: resolveCatalogAccess,
    listPlugins: listCatalogPluginsPage,
    resolveSelector: resolveInstallSelector,
    installPlugin: installPluginFromCatalog,
    getPluginByName,
    isProfilePlugin,
    tagProfile: tagProfileCommand,
    isSwitchInProgress: isAgentSwitchInProgress,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authRequiredResponse(): Response {
  return jsonResponse(
    {
      error: "auth_required",
      message: "Sign in to a HarnessTap cloud account to browse or pull profiles",
    },
    { status: 401 },
  );
}

function formatCatalogSelector(plugin: CatalogPlugin): string {
  const selector = `${plugin.orgSlug}/${plugin.catalogSlug}/${plugin.slug}`;
  return plugin.latestVersion
    ? `${selector}@${plugin.latestVersion}`
    : selector;
}

function profilePayload(plugin: CatalogPlugin) {
  return {
    selector: formatCatalogSelector(plugin),
    name: plugin.name,
    orgSlug: plugin.orgSlug,
    catalogSlug: plugin.catalogSlug,
    version: plugin.latestVersion ?? "",
    tags: plugin.tags,
    description: plugin.summary,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parsePullInput(request: Request): Promise<ProfileCloudPullInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.selector !== "string" || body.selector.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_selector", message: "selector must be a non-empty string" },
      { status: 400 },
    );
  }
  if (
    body.as !== undefined
    && (typeof body.as !== "string" || body.as.trim().length === 0)
  ) {
    return jsonResponse(
      { error: "invalid_as", message: "as must be a non-empty string" },
      { status: 400 },
    );
  }
  if (body.use !== undefined && typeof body.use !== "boolean") {
    return jsonResponse(
      { error: "invalid_use", message: "use must be a boolean" },
      { status: 400 },
    );
  }
  return {
    selector: body.selector.trim(),
    ...(typeof body.as === "string" ? { as: body.as.trim() } : {}),
    use: body.use === true,
  };
}

async function requireCloudAuth(deps: ProfileCloudDeps): Promise<Response | undefined> {
  const access = await deps.resolveAccess();
  return access.isAuthenticated ? undefined : authRequiredResponse();
}

export function createProfileCloudHandlers(
  deps: ProfileCloudDeps = createDefaultProfileCloudDeps(),
): ProfileCloudHandlers {
  return {
    async handleBrowse(request, token) {
      const agentAuthError = requireAgentBearerAuth(request, token);
      if (agentAuthError) {
        return agentAuthError;
      }
      try {
        const cloudAuthError = await requireCloudAuth(deps);
        if (cloudAuthError) {
          return cloudAuthError;
        }
        const query = new URL(request.url).searchParams.get("q")?.trim();
        const result = await deps.listPlugins({
          ...(query ? { q: query } : {}),
          limit: 50,
          sort: "name",
        });
        return jsonResponse({
          profiles: result.plugins.map(profilePayload),
        });
      } catch (error) {
        return jsonResponse(
          { error: "cloud_browse_failed", message: errorMessage(error) },
          { status: 502 },
        );
      }
    },

    async handlePull(request, token) {
      const agentAuthError = requireAgentBearerAuth(request, token);
      if (agentAuthError) {
        return agentAuthError;
      }
      if (deps.isSwitchInProgress()) {
        return jsonResponse(
          {
            error: "switch_in_progress",
            message: "Another profile switch is already running",
          },
          { status: 409 },
        );
      }
      const input = await parsePullInput(request);
      if (input instanceof Response) {
        return input;
      }

      try {
        const cloudAuthError = await requireCloudAuth(deps);
        if (cloudAuthError) {
          return cloudAuthError;
        }
        const parsed = await deps.resolveSelector(input.selector, {
          noInteractive: true,
          format: "json",
        });
        if (!input.as && deps.getPluginByName(parsed.plugin_slug)) {
          return jsonResponse(
            {
              error: "name_collision",
              message: `A local plugin named "${parsed.plugin_slug}" already exists; provide as to pull under a different name`,
            },
            { status: 409 },
          );
        }

        const installed = await deps.installPlugin(parsed, {
          ...(input.as ? { as: input.as } : {}),
        });
        const plugin = deps.getPluginByName(installed.pluginName);
        let tagged = Boolean(plugin && deps.isProfilePlugin(plugin));
        if (!tagged) {
          deps.tagProfile(installed.pluginName);
          tagged = true;
        }

        return jsonResponse({
          profile: {
            name: installed.pluginName,
            id: installed.pluginId,
          },
          tagged,
        });
      } catch (error) {
        return jsonResponse(
          { error: "pull_failed", message: errorMessage(error) },
          { status: 400 },
        );
      }
    },
  };
}
