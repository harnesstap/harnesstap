import { cloudFetch } from "./cloud-api-version.js";
import { parseApEnvelope } from "./agent-plugins/envelope.js";
import { parseApPackageFiles } from "./agent-plugins/import.js";

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
  /** Called after a successful access-token refresh so callers can persist rotated tokens. */
  onTokenRefreshed?: (token: {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
  }) => void | Promise<void>;
}

export interface CloudTokenRefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  orgId?: string;
  orgSlug?: string;
  scopes?: string[];
}

type PublishedPluginRecord = {
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

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:"
      && (url.hostname === "localhost"
        || url.hostname === "127.0.0.1"
        || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

/** Prefer the configured cloud base URL when the API returns a loopback verification URI. */
export function resolveDeviceVerificationUris(
  baseUrl: string,
  device: Pick<DeviceCodeResponse, "user_code" | "verification_uri" | "verification_uri_complete">,
): { verification_uri: string; verification_uri_complete: string } {
  const fallback = deviceVerificationUri(baseUrl);
  const verificationUri =
    device.verification_uri?.trim() && !isLoopbackHttpUrl(device.verification_uri)
      ? device.verification_uri.trim()
      : fallback;
  const completeFromApi = device.verification_uri_complete?.trim();
  const verificationUriComplete =
    completeFromApi && !isLoopbackHttpUrl(completeFromApi)
      ? completeFromApi
      : `${verificationUri}?user_code=${encodeURIComponent(device.user_code)}`;
  return {
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
  };
}

function apiUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/api${path.startsWith("/") ? path : `/${path}`}`;
}

export async function refreshCloudAccessToken(
  baseUrl: string,
  refreshToken: string,
): Promise<CloudTokenRefreshResult> {
  const response = await cloudFetch(apiUrl(baseUrl, "/cli/token/refresh"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status}`);
  }
  return await response.json() as CloudTokenRefreshResult;
}

function extractApiErrorCode(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    return (body as { error?: { code?: string } }).error?.code;
  }
  return undefined;
}

function parseApiError(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string; code?: string } }).error;
    if (error?.message) return error.message;
    if (error?.code) return error.code;
  }
  return JSON.stringify(body);
}

async function readResponseBody(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text();
  if (!text.trim()) {
    return { body: {}, text: "" };
  }
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch {
    return { body: {}, text };
  }
}

function describeApiFailure(response: Response, body: unknown, text: string): string {
  const parsed = parseApiError(body);
  if (parsed !== "{}") {
    return `${response.status} ${parsed}`;
  }
  const trimmed = text.trim();
  if (trimmed) {
    const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
    return `${response.status} ${preview}`;
  }
  return `${response.status} empty response (try again)`;
}

function isTransientPollFailure(response: Response, body: unknown, text: string): boolean {
  if (response.status >= 500) return true;
  if (response.status === 408 || response.status === 425) return true;
  if (!response.ok && !extractApiErrorCode(body) && !text.trim()) return true;
  return false;
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

function exportPluginExportToCloudPayload(packageBody: string): { plugins: Array<Record<string, unknown>> } {
  const files = parseApEnvelope(packageBody, "published package");
  const parsed = parseApPackageFiles(files);
  return {
    plugins: [
      {
        name: parsed.sourceName,
        description: parsed.description,
        tags: parsed.keywords,
        pluginPins: parsed.dependencies.map((dependency) => ({
          id: dependency.name,
          author: "",
          version: dependency.constraint,
        })),
        resources: parsed.resources,
        ...(parsed.claude ? { claude: parsed.claude } : {}),
      },
    ],
  };
}

export async function requestDeviceCode(
  baseUrl: string,
  opts?: { scopes?: Array<"read" | "publish" | "admin"> },
): Promise<DeviceCodeResponse> {
  const response = await cloudFetch(apiUrl(baseUrl, "/cli/device/code"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopes: opts?.scopes ?? [...DEFAULT_DEVICE_SCOPES] }),
  });
  if (!response.ok) {
    const { body, text } = await readResponseBody(response);
    if (response.status === 503 || /no available server/i.test(text)) {
      throw new Error(
        "HarnessTap Cloud is temporarily unavailable. Try again in a few minutes.",
      );
    }
    throw new Error(`Failed to request device code: ${describeApiFailure(response, body, text)}`);
  }
  const device = await response.json() as DeviceCodeResponse;
  const uris = resolveDeviceVerificationUris(baseUrl, device);
  return {
    ...device,
    verification_uri: uris.verification_uri,
    verification_uri_complete: uris.verification_uri_complete,
  };
}

function parseRetryAfterMs(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }
  return fallbackMs;
}

export type DeviceTokenPollOnceResult =
  | { status: "authorized"; token: DeviceTokenResponse }
  | { status: "pending"; intervalMs: number }
  | { status: "error"; message: string };

export async function pollDeviceTokenOnce(
  baseUrl: string,
  deviceCode: string,
  opts?: { intervalMs?: number },
): Promise<DeviceTokenPollOnceResult> {
  const pollIntervalMs = opts?.intervalMs ?? 5000;
  const response = await cloudFetch(apiUrl(baseUrl, "/cli/device/token"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  if (response.ok) {
    const { body } = await readResponseBody(response);
    return { status: "authorized", token: body as DeviceTokenResponse };
  }

  const { body, text } = await readResponseBody(response);
  const code = extractApiErrorCode(body);
  if (code === "authorization_pending") {
    return { status: "pending", intervalMs: pollIntervalMs };
  }
  if (code === "slow_down") {
    return { status: "pending", intervalMs: pollIntervalMs + 5000 };
  }
  if (code === "rate_limit_exceeded") {
    return {
      status: "pending",
      intervalMs: parseRetryAfterMs(response, pollIntervalMs),
    };
  }
  if (isTransientPollFailure(response, body, text)) {
    return { status: "pending", intervalMs: pollIntervalMs };
  }

  return {
    status: "error",
    message: `Failed to poll device token: ${describeApiFailure(response, body, text)}`,
  };
}

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  opts?: { interval?: number; maxPolls?: number },
): Promise<DeviceTokenResponse> {
  let pollIntervalMs = (opts?.interval ?? 5) * 1000;
  const maxPolls = opts?.maxPolls ?? 120;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const result = await pollDeviceTokenOnce(baseUrl, deviceCode, {
      intervalMs: pollIntervalMs,
    });
    if (result.status === "authorized") {
      return result.token;
    }
    if (result.status === "error") {
      throw new Error(result.message);
    }
    pollIntervalMs = result.intervalMs;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out polling device token");
}

export interface CloudClient {
  whoami(): Promise<Record<string, unknown>>;
  listOrgs(): Promise<Record<string, unknown>[]>;
  planPluginPublishVersion(metadata: Record<string, unknown>): Promise<{ nextVersion: string }>;
  publishPluginExport(metadata: Record<string, unknown>, packageBody: string): Promise<Record<string, unknown>>;
  deletePublishedPlugin(input: { orgId: string; pluginId: string }): Promise<void>;
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

    const data = await refreshCloudAccessToken(state.baseUrl, state.token.refresh_token);
    const expiresIn = data.expires_in ?? 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    state.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || state.token.refresh_token,
      expires_at: expiresAt,
    };
    if (opts.onTokenRefreshed) {
      await opts.onTokenRefreshed({
        access_token: state.token.access_token,
        refresh_token: state.token.refresh_token,
        expires_at: expiresAt,
      });
    }
  }

  async function authFetch(input: string, init?: RequestInit): Promise<Response> {
    await ensureTokenValid();
    const headers = new Headers(init?.headers);
    if (!state.token) throw new Error("Missing auth token");
    headers.set("Authorization", `Bearer ${state.token.access_token}`);
    return cloudFetch(input, { ...init, headers });
  }

  async function listPublishedPlugins(orgId: string): Promise<PublishedPluginRecord[]> {
    const response = await authFetch(`${apiUrl(state.baseUrl, "/plugins")}?orgId=${encodeURIComponent(orgId)}`);
    if (!response.ok) {
      throw new Error(`list plugins failed: ${response.status}`);
    }
    const data = await response.json() as { plugins?: PublishedPluginRecord[] };
    return data.plugins ?? [];
  }

  async function createPublishedPlugin(input: {
    orgId: string;
    name: string;
    slug: string;
    summary: string;
    pluginCount: number;
    catalogSlug: string;
  }): Promise<PublishedPluginRecord> {
    const response = await authFetch(apiUrl(state.baseUrl, "/plugins"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: input.orgId,
        name: input.name,
        slug: input.slug,
        summary: input.summary,
        pluginCount: input.pluginCount,
        catalogSlug: input.catalogSlug,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`create plugin failed: ${response.status} ${parseApiError(body)}`);
    }
    return (body as { plugin: PublishedPluginRecord }).plugin;
  }

  async function publishVersion(input: {
    orgId: string;
    pluginId: string;
    version: string;
    summary: string;
    pluginExport: { plugins: Array<Record<string, unknown>> };
    harnesstapPluginExportBody: string;
  }): Promise<{ version: { version: string } }> {
    const response = await authFetch(apiUrl(state.baseUrl, "/plugins"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: input.orgId,
        pluginId: input.pluginId,
        version: input.version,
        summary: input.summary,
        pluginExport: input.pluginExport,
        harnesstapPluginExportBody: input.harnesstapPluginExportBody,
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

    async planPluginPublishVersion(metadata: Record<string, unknown>) {
      const orgSlug = String(metadata.org_slug ?? "");
      const catalogSlug = String(metadata.catalog_slug ?? "default");
      const pluginName = String(metadata.plugin_name ?? "");
      if (!orgSlug || !pluginName) {
        throw new Error("publish metadata must include org_slug and plugin_name.");
      }

      const orgs = await this.listOrgs();
      const org = orgs.find((entry) => String(entry.slug) === orgSlug);
      if (!org || typeof org.id !== "string") {
        throw new Error(`Organization not found: ${orgSlug}`);
      }

      const slug = toSlug(pluginName);
      const publishedPlugin = (await listPublishedPlugins(org.id)).find(
        (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
      );

      return { nextVersion: nextPublishVersion(publishedPlugin?.latestVersion) };
    },

    async publishPluginExport(metadata: Record<string, unknown>, packageBody: string) {
      const orgSlug = String(metadata.org_slug ?? "");
      const catalogSlug = String(metadata.catalog_slug ?? "default");
      const pluginName = String(metadata.plugin_name ?? "");
      if (!orgSlug || !pluginName) {
        throw new Error("publish metadata must include org_slug and plugin_name.");
      }

      const orgs = await this.listOrgs();
      const org = orgs.find((entry) => String(entry.slug) === orgSlug);
      if (!org || typeof org.id !== "string") {
        throw new Error(`Organization not found: ${orgSlug}`);
      }

      const slug = toSlug(pluginName);
      const pluginExportPayload = exportPluginExportToCloudPayload(packageBody);
      const pluginCount = pluginExportPayload.plugins.length;
      const summary = String(
        (pluginExportPayload.plugins[0] as { description?: string } | undefined)?.description
          || `Published plugin ${pluginName}`,
      );

      let publishedPlugin = (await listPublishedPlugins(org.id)).find(
        (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
      );

      if (!publishedPlugin) {
        try {
          publishedPlugin = await createPublishedPlugin({
            orgId: org.id,
            name: pluginName,
            slug,
            summary,
            pluginCount,
            catalogSlug,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("409")) {
            throw error;
          }
          publishedPlugin = (await listPublishedPlugins(org.id)).find(
            (entry) => entry.slug === slug && entry.catalogSlug === catalogSlug,
          );
          if (!publishedPlugin) {
            throw error;
          }
        }
      }

      const version = nextPublishVersion(publishedPlugin.latestVersion);
      const published = await publishVersion({
        orgId: org.id,
        pluginId: publishedPlugin.id,
        version,
        summary,
        pluginExport: pluginExportPayload,
        harnesstapPluginExportBody: packageBody,
      });

      return {
        id: publishedPlugin.id,
        version: published.version.version,
        url: `${state.baseUrl}/catalogs/${catalogSlug}/${slug}`,
      };
    },

    async deletePublishedPlugin(input: { orgId: string; pluginId: string }) {
      const response = await authFetch(
        `${apiUrl(state.baseUrl, `/plugins/${encodeURIComponent(input.pluginId)}`)}?orgId=${encodeURIComponent(input.orgId)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`delete plugin failed: ${response.status} ${parseApiError(body)}`);
      }
    },

    async revokeRefreshToken() {
      state.token = undefined;
      return true;
    },

    _state: state,
  };
}
