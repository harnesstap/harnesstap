export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface CloudClientOptions {
  baseUrl: string;
  token?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number; // unix seconds
  };
}

export async function requestDeviceCode(baseUrl: string, opts?: { client_id?: string }): Promise<DeviceCodeResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/oauth/device/code`;
  const body = new URLSearchParams();
  if (opts?.client_id) body.set("client_id", opts.client_id);

  const resp = await fetch(url, { method: "POST", body });
  if (!resp.ok) throw new Error(`Failed to request device code: ${resp.status}`);
  const data = await resp.json() as DeviceCodeResponse;
  return data;
}

export async function pollDeviceToken(baseUrl: string, deviceCode: string, opts?: { interval?: number; maxPolls?: number; client_id?: string; }) : Promise<DeviceTokenResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/oauth/token`;
  const interval = (opts?.interval ?? 5) * 1000;
  const maxPolls = opts?.maxPolls ?? 60;

  for (let i = 0; i < maxPolls; i++) {
    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    body.set("device_code", deviceCode);
    if (opts?.client_id) body.set("client_id", opts.client_id);

    const resp = await fetch(url, { method: "POST", body });
    if (resp.ok) {
      const data = await resp.json() as DeviceTokenResponse;
      return data;
    }

    // non-ok: read error and decide
    const errBody = await resp.json().catch(() => ({}));
    const err = (errBody && (errBody as any).error) || null;
    if (err === "authorization_pending") {
      await new Promise((r) => setTimeout(r, interval));
      continue;
    }
    throw new Error(`Failed to poll device token: ${JSON.stringify(errBody)}`);
  }
  throw new Error("Timed out polling device token");
}

export interface CloudClient {
  whoami(): Promise<Record<string, unknown>>;
  listOrgs(): Promise<Record<string, unknown>[]>;
  searchLibraries(query: string): Promise<Record<string, unknown>[]>;
  downloadLibraryBundle(id: string, version?: string): Promise<{ version: string; body: string }>;
  publishPresetBundle(metadata: Record<string, unknown>, bundleJson: string): Promise<Record<string, unknown>>;
  revokeRefreshToken(): Promise<boolean | void>;
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
    // If expires_at is absent, treat the token as non-expiring/valid and skip refresh.
    if (state.token.expires_at == null || state.token.expires_at > now + 5) return;

    // refresh
    if (!state.token.refresh_token) throw new Error("No refresh token available");
    const url = `${state.baseUrl}/oauth/token`;
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", state.token.refresh_token);

    const resp = await fetch(url, { method: "POST", body });
    if (!resp.ok) throw new Error(`Failed to refresh token: ${resp.status}`);
    const data = await resp.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const expires_in = data.expires_in ?? 3600;
    state.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || state.token.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expires_in,
    };
  }

  async function authFetch(input: string, init?: RequestInit): Promise<Response> {
    await ensureTokenValid();
    const headers = new Headers(init?.headers as any);
    headers.set("Authorization", `Bearer ${state.token!.access_token}`);
    const res = await fetch(input, { ...init, headers });
    return res;
  }

  return {
    async whoami() {
      const res = await authFetch(`${state.baseUrl}/me`);
      if (!res.ok) throw new Error(`whoami failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      return data;
    },

    async listOrgs() {
      const res = await authFetch(`${state.baseUrl}/orgs`);
      if (!res.ok) throw new Error(`listOrgs failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>[];
      return data;
    },

    async searchLibraries(query: string) {
      // ensure token automatically inside authFetch
      const q = encodeURIComponent(query);
      const res = await authFetch(`${state.baseUrl}/libraries/search?query=${q}`);
      if (!res.ok) throw new Error(`searchLibraries failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>[];
      return data;
    },

    async downloadLibraryBundle(id: string, version?: string) {
      // Resolve latest version when omitted
      if (!version) {
        const metaRes = await fetch(`${state.baseUrl}/libraries/${id}/meta`);
        if (!metaRes.ok) throw new Error(`Failed to get library meta: ${metaRes.status}`);
        const meta = await metaRes.json() as { latest_version: string };
        version = meta.latest_version as string;
      }
      const res = await fetch(`${state.baseUrl}/libraries/${id}/bundle/${version}`);
      if (!res.ok) throw new Error(`Failed to download bundle: ${res.status}`);
      const body = await res.text();
      return { version: version as string, body };
    },
    async publishPresetBundle(metadata: Record<string, unknown>, bundleJson: string) {
      const form = new FormData();
      form.set("metadata", JSON.stringify(metadata));
      // Some FormData implementations (Node test env) require the value to be a Blob when a filename is provided.
      const bundleBlob = typeof Blob !== 'undefined' ? new Blob([bundleJson], { type: 'application/json' }) : undefined;
      if (bundleBlob) form.set("bundle", bundleBlob, "bundle.json");
      else form.set("bundle", bundleJson);
      const res = await authFetch(`${state.baseUrl}/presets/publish`, { method: "POST", body: form as any });
      if (!res.ok) throw new Error(`publish failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      return data;
    },
    async revokeRefreshToken() {
      if (!state.token || !state.token.refresh_token) return undefined;
      const res = await authFetch(`${state.baseUrl}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: state.token.refresh_token }) });
      if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
      state.token = undefined;
      return true;
    },
    // expose internals for tests
    _state: state,
  };
}
