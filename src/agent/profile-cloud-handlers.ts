import { isProfileLayer } from "../constants/profile.js";
import { getLayerByName } from "../models/layer-model.js";
import {
  listCatalogLayersPage,
  resolveCatalogAccess,
} from "../services/catalog-client.js";
import type {
  CatalogLayer,
  CatalogListOptions,
  CatalogListResult,
} from "../services/catalog-types.js";
import {
  resolveInstallSelector,
  type ResolveInstallSelectorOptions,
} from "../services/layer-bare-name-resolve.js";
import {
  installLayerFromCatalog,
  type InstallLayerFromCatalogOptions,
  type InstallLayerFromCatalogResult,
} from "../services/layer-catalog-install.js";
import type { ResolvedRemoteLayerSelector } from "../services/layer-selector.js";
import { tagProfileCommand } from "../services/profile-commands.js";
import type { Layer } from "../types.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";
import { isAgentSwitchInProgress } from "./switch-registry.js";

export interface ProfileCloudDeps {
  resolveAccess(): Promise<{ isAuthenticated: boolean }>;
  listLayers(options?: CatalogListOptions): Promise<CatalogListResult>;
  resolveSelector(
    selector: string,
    options?: ResolveInstallSelectorOptions,
  ): Promise<ResolvedRemoteLayerSelector>;
  installLayer(
    selector: ResolvedRemoteLayerSelector,
    options?: InstallLayerFromCatalogOptions,
  ): Promise<InstallLayerFromCatalogResult>;
  getLayerByName(name: string): Layer | undefined;
  isProfileLayer(layer: Pick<Layer, "tags">): boolean;
  tagProfile(name: string): { layer_id: string; tags: string[] };
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
    listLayers: listCatalogLayersPage,
    resolveSelector: resolveInstallSelector,
    installLayer: installLayerFromCatalog,
    getLayerByName,
    isProfileLayer,
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

function formatCatalogSelector(layer: CatalogLayer): string {
  const selector = `${layer.orgSlug}/${layer.catalogSlug}/${layer.slug}`;
  return layer.latestVersion
    ? `${selector}@${layer.latestVersion}`
    : selector;
}

function profilePayload(layer: CatalogLayer) {
  return {
    selector: formatCatalogSelector(layer),
    name: layer.name,
    orgSlug: layer.orgSlug,
    catalogSlug: layer.catalogSlug,
    version: layer.latestVersion ?? "",
    tags: layer.tags,
    description: layer.summary,
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
        const result = await deps.listLayers({
          ...(query ? { q: query } : {}),
          limit: 50,
          sort: "name",
        });
        return jsonResponse({
          profiles: result.layers.map(profilePayload),
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
        if (!input.as && deps.getLayerByName(parsed.layer_slug)) {
          return jsonResponse(
            {
              error: "name_collision",
              message: `A local layer named "${parsed.layer_slug}" already exists; provide as to pull under a different name`,
            },
            { status: 409 },
          );
        }

        const installed = await deps.installLayer(parsed, {
          ...(input.as ? { as: input.as } : {}),
        });
        const layer = deps.getLayerByName(installed.layerName);
        let tagged = Boolean(layer && deps.isProfileLayer(layer));
        if (!tagged) {
          deps.tagProfile(installed.layerName);
          tagged = true;
        }

        return jsonResponse({
          profile: {
            name: installed.layerName,
            id: installed.layerId,
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
