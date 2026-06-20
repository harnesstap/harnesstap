export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  orgId?: string;
  orgSlug?: string;
  scopes?: string[];
}

export interface CloudClientOptions {
  baseUrl: string;
  token?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number; // unix seconds
  };
}

type PublishedLayerRecord = {
  id: string;
  slug: string;
  catalogSlug: string;
  latestVersion: string | null;
  name: string;
  summary: string;
};

const DEFAULT_DEVICE_SCOPES = ["read", "publish"] as const;
const DEVICE_AUTH_PATH = "/cli/auth/device";

export function deviceVerificationUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${DEVICE_AUTH_PATH}`;
}

function apiUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/api${path.startsWith("/") ? path : `/${path}`}`;
}

function parseApiError(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string; code?: string } }).error;
    if (error?.message) return error.message;
    if (error?.code) return error.code;
  }
  return JSON.stringify(body);
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function nextPublishVersion(latestVersion: string | null | undefined): string {
  if (!latestVersion) return "1.0.0";
  const match = latestVersion.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/);
  if (!match) return "1.0.0";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export { nextPublishVersion };

import { fetchWithTimeout } from "./transport/fetch-with-timeout.js";
import { parseLayerExportToml } from "./transport/index.js";

function exportLayerExportToCloudPayload(layerExportToml: string): { layers: Array<Record<string, unknown>> } {
  const parsed = parseLayerExportToml(layerExportToml);
  return {
    layers: parsed.layers.map((layer) => {
      const pluginPins = layer.plugin_pins.map((pluginPin) => {
        const ref = pluginPin.ref;
        const at = ref.lastIndexOf("@");
        const id = at >= 0 ? ref.slice(0, at) : ref;
        const author = at >= 0 ? ref.slice(at + 1) : "";
        return {
          id,
          author,
          version: pluginPin.version_constraint,
        };
      });
      return {
        name: layer.name,
        description: layer.description,
        tags: layer.tags,
        pluginPins,
        resources: layer.resources,
        ...(layer.claude ? { claude: layer.claude } : {}),
      };
    }),
  };
}

export async function requestDeviceCode(
  baseUrl: string,
  opts?: { scopes?: Array<"read" | "publish" | "admin"> },
): Promise<DeviceCodeResponse> {
  const response = await fetchWithTimeout(apiUrl(baseUrl, "/cli/device/code"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopes: opts?.scopes ?? [...DEFAULT_DEVICE_SCOPES] }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Failed to request device code: ${response.status} ${parseApiError(body)}`);
  }
  return await response.json() as DeviceCodeResponse;
}

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  opts?: { interval?: number; maxPolls?: number },
): Promise<DeviceTokenResponse> {
  const interval = (opts?.interval ?? 5) * 1000;
  const maxPolls = opts?.maxPolls ?? 60;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const response = await fetchWithTimeout(apiUrl(baseUrl, "/cli/device/token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (response.ok) {
      return await response.json() as DeviceTokenResponse;
    }

    const body = await response.json().catch(() => ({}));
    const code = body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: string } }).error?.code
      : undefined;
    if (code === "authorization_pending" || code === "slow_down") {
      await new Promise((resolve) => setTimeout(resolve, interval));
      continue;
    }

    throw new Error(`Failed to poll device token: ${parseApiError(body)}`);
  }

  throw new Error("Timed out polling device token");
}

export interface CloudClient {
  whoami(): Promise<Record<string, unknown>>;
  listOrgs(): Promise<Record<string, unknown>[]>;
  planLayerPublishVersion(metadata: Record<string, unknown>): Promise<{ nextVersion: string }>;
  publishLayerExport(metadata: Record<string, unknown>, layerExportToml: string): Promise<Record<string, unknown>>;
  revokeRefreshToken(): Promise<boolean | undefined>;
  _state: { baseUrl: string; token?: { access_token: string; refresh_token?: string; expires_at?: number } };
}

export function createCloudClient(opts: CloudClientOptions): CloudClient {
  const state = {
    baseUrl: opts.baseUrl.replace(/\/+$/, ""),
    token: opts.token ? { ...opts.token } : undefined,
  } as { baseUrl: string; token?: { access_token: string; refresh_token?: string; expires_at?: number } };

  async function ensureTokenValid(): Promise<void> {
    if (!state.token) throw new Error("Not authenticated");
    const now = Math.floor(Date.now() / 1000);
    if (state.token.expires_at == null || state.token.expires_at > now + 5) return;
    if (!state.token.refresh_token) throw new Error("No refresh token available");

    const response = await fetchWithTimeout(apiUrl(state.baseUrl, "/cli/token/refresh"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: state.token.refresh_token }),
    });
    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const expiresIn = data.expires_in ?? 3600;
    state.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || state.token.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    };
  }

  async function authFetch(input: string, init?: RequestInit): Promise<Response> {
    await ensureTokenValid();
    const headers = new Headers(init?.headers);
    if (!state.token) throw new Error("Missing auth token");
    headers.set("Authorization", `Bearer ${state.token.access_token}`);
    return fetchWithTimeout(input, { ...init, headers });
  }

  async function listPublishedLayers(orgId: string): Promise<PublishedLayerRecord[]> {
    const response = await authFetch(`${apiUrl(state.baseUrl, "/layers")}?orgId=${encodeURIComponent(orgId)}`);
    if (!response.ok) {
      throw new Error(`list layers failed: ${response.status}`);
    }
    const data = await response.json() as { layers?: PublishedLayerRecord[] };
    return data.layers ?? [];
  }

  async function createPublishedLayer(input: {
    orgId: string;
    name: string;
    slug: string;
    summary: string;
    layerCount: number;
    catalogSlug: string;
  }): Promise<PublishedLayerRecord> {
    const response = await authFetch(apiUrl(state.baseUrl, "/layers"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: input.orgId,
        name: input.name,
        slug: input.slug,
        summary: input.summary,
        layerCount: input.layerCount,
        catalogSlug: input.catalogSlug,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`create layer failed: ${response.status} ${parseApiError(body)}`);
    }
    return (body as { layer: PublishedLayerRecord }).layer;
  }

  async function publishVersion(input: {
    orgId: string;
    layerId: string;
    version: string;
    summary: string;
    layerExport: { layers: Array<Record<string, unknown>> };
    harnessdeckLayerExportBody: string;
  }): Promise<{ version: { version: string } }> {
    const response = await authFetch(apiUrl(state.baseUrl, "/layers"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: input.orgId,
        layerId: input.layerId,
        version: input.version,
        summary: input.summary,
        layerExport: input.layerExport,
        harnessdeckLayerExportBody: input.harnessdeckLayerExportBody,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`publish failed: ${response.status} ${parseApiError(body)}`);
    }
    return body as { version: { version: string } };
  }

  return {
    async whoami() {
      const response = await authFetch(apiUrl(state.baseUrl, "/me"));
      if (!response.ok) throw new Error(`whoami failed: ${response.status}`);
      return await response.json() as Record<string, unknown>;
    },

    async listOrgs() {
      const response = await authFetch(apiUrl(state.baseUrl, "/me/orgs"));
      if (!response.ok) throw new Error(`listOrgs failed: ${response.status}`);
      const data = await response.json() as { orgs?: Record<string, unknown>[] };
      return data.orgs ?? [];
    },

    async planLayerPublishVersion(metadata: Record<string, unknown>) {
      const orgSlug = String(metadata.org_slug ?? "");
      const catalogSlug = String(metadata.catalog_slug ?? "default");
      const layerName = String(metadata.layer_name ?? "");
      if (!orgSlug || !layerName) {
        throw new Error("publish metadata must include org_slug and layer_name.");
      }

      const orgs = await this.listOrgs();
      const org = orgs.find((entry) => String(entry.slug) === orgSlug);
      if (!org || typeof org.id !== "string") {
        throw new Error(`Organization not found: ${orgSlug}`);
      }

      const slug = toSlug(layerName);
      const publishedLayer = (await listPublishedLayers(org.id)).find(
        (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
      );

      return { nextVersion: nextPublishVersion(publishedLayer?.latestVersion) };
    },

    async publishLayerExport(metadata: Record<string, unknown>, layerExportToml: string) {
      const orgSlug = String(metadata.org_slug ?? "");
      const catalogSlug = String(metadata.catalog_slug ?? "default");
      const layerName = String(metadata.layer_name ?? "");
      if (!orgSlug || !layerName) {
        throw new Error("publish metadata must include org_slug and layer_name.");
      }

      const orgs = await this.listOrgs();
      const org = orgs.find((entry) => String(entry.slug) === orgSlug);
      if (!org || typeof org.id !== "string") {
        throw new Error(`Organization not found: ${orgSlug}`);
      }

      const slug = toSlug(layerName);
      const layerExportPayload = exportLayerExportToCloudPayload(layerExportToml);
      const layerCount = layerExportPayload.layers.length;
      const summary = String(
        (layerExportPayload.layers[0] as { description?: string } | undefined)?.description
          || `Published layer ${layerName}`,
      );

      let publishedLayer = (await listPublishedLayers(org.id)).find(
        (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
      );

      if (!publishedLayer) {
        try {
          publishedLayer = await createPublishedLayer({
            orgId: org.id,
            name: layerName,
            slug,
            summary,
            layerCount,
            catalogSlug,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("409")) {
            throw error;
          }
          publishedLayer = (await listPublishedLayers(org.id)).find(
            (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
          );
          if (!publishedLayer) {
            throw error;
          }
        }
      }

      const version = nextPublishVersion(publishedLayer.latestVersion);
      const published = await publishVersion({
        orgId: org.id,
        layerId: publishedLayer.id,
        version,
        summary,
        layerExport: layerExportPayload,
        harnessdeckLayerExportBody: layerExportToml,
      });

      return {
        id: publishedLayer.id,
        version: published.version.version,
        url: `${state.baseUrl}/catalogs/${catalogSlug}/${slug}`,
      };
    },

    async revokeRefreshToken() {
      state.token = undefined;
      return true;
    },

    _state: state,
  };
}
