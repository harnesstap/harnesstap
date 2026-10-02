import {
  GITHUB_API_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_VERIFICATION_URL,
  GITHUB_OAUTH_ACCESS_TOKEN_URL,
  resolveGithubAppClientId,
  resolveGithubAppClientSecret,
} from "../config/github-app.js";
import type { GithubSession } from "../config/github-session.js";
import { publishedReleaseUserAgent } from "./self-update.js";

export interface GithubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface GithubDeviceTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export type GithubDeviceTokenPollOnceResult =
  | { status: "authorized"; token: GithubDeviceTokenResponse }
  | { status: "pending"; intervalMs: number }
  | { status: "error"; message: string };

export interface GithubUserIdentity {
  login: string;
  id: number;
  name?: string;
}

export interface GithubDeviceFlowOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function githubHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": publishedReleaseUserAgent(),
    ...extra,
  };
}

function formBody(fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readJson(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const response = await fetchFn(input, init);
  const text = await response.text();
  if (!text.trim()) {
    return { ok: response.ok, status: response.status, body: {}, text: "" };
  }
  try {
    return {
      ok: response.ok,
      status: response.status,
      body: JSON.parse(text) as unknown,
      text,
    };
  } catch {
    return { ok: response.ok, status: response.status, body: {}, text };
  }
}

function oauthErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body)) {
    return fallback;
  }
  const description = stringField(body.error_description) ?? stringField(body.message);
  const code = stringField(body.error);
  if (code === "incorrect_client_credentials") {
    return (
      "GitHub rejected the App credentials. Set HARNESSTAP_GITHUB_APP_CLIENT_SECRET "
      + "if this GitHub App requires a client secret for device flow."
    );
  }
  if (description) {
    return description;
  }
  if (code) {
    return code;
  }
  return fallback;
}

export function resolveGithubDeviceVerificationUris(
  device: Pick<
    GithubDeviceCodeResponse,
    "user_code" | "verification_uri" | "verification_uri_complete"
  >,
): { verification_uri: string; verification_uri_complete: string } {
  const verificationUri =
    device.verification_uri?.trim() || GITHUB_DEVICE_VERIFICATION_URL;
  const completeFromApi = device.verification_uri_complete?.trim();
  return {
    verification_uri: verificationUri,
    verification_uri_complete:
      completeFromApi
      || `${verificationUri}?user_code=${encodeURIComponent(device.user_code)}`,
  };
}

export async function requestGithubDeviceCode(
  opts: GithubDeviceFlowOptions = {},
): Promise<GithubDeviceCodeResponse> {
  const fetchFn = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const clientId = resolveGithubAppClientId(env);
  const { ok, status, body, text } = await readJson(
    fetchFn,
    GITHUB_DEVICE_CODE_URL,
    {
      method: "POST",
      headers: githubHeaders(),
      body: formBody({
        client_id: clientId,
      }),
    },
  );
  if (!ok) {
    throw new Error(
      oauthErrorMessage(body, `Failed to request GitHub device code (${status})`),
    );
  }
  if (!isRecord(body)) {
    throw new Error(`Failed to request GitHub device code: ${text || "empty response"}`);
  }
  const deviceCode = stringField(body.device_code);
  const userCode = stringField(body.user_code);
  if (!deviceCode || !userCode) {
    throw new Error(
      oauthErrorMessage(body, "GitHub device code response was missing codes"),
    );
  }
  const raw: GithubDeviceCodeResponse = {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri:
      stringField(body.verification_uri) ?? GITHUB_DEVICE_VERIFICATION_URL,
    verification_uri_complete: stringField(body.verification_uri_complete),
    expires_in: numberField(body.expires_in) ?? 900,
    interval: numberField(body.interval) ?? 5,
  };
  const uris = resolveGithubDeviceVerificationUris(raw);
  return {
    ...raw,
    verification_uri: uris.verification_uri,
    verification_uri_complete: uris.verification_uri_complete,
  };
}

export async function pollGithubDeviceTokenOnce(
  deviceCode: string,
  opts: GithubDeviceFlowOptions & { intervalMs?: number } = {},
): Promise<GithubDeviceTokenPollOnceResult> {
  const fetchFn = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const pollIntervalMs = opts.intervalMs ?? 5000;
  const { ok, status, body } = await readJson(
    fetchFn,
    GITHUB_OAUTH_ACCESS_TOKEN_URL,
    {
      method: "POST",
      headers: githubHeaders(),
      body: formBody({
        client_id: resolveGithubAppClientId(env),
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_secret: resolveGithubAppClientSecret(env),
      }),
    },
  );

  const errorCode = isRecord(body) ? stringField(body.error) : undefined;
  if (errorCode === "authorization_pending") {
    return { status: "pending", intervalMs: pollIntervalMs };
  }
  if (errorCode === "slow_down") {
    return { status: "pending", intervalMs: pollIntervalMs + 5000 };
  }
  if (errorCode === "expired_token") {
    return { status: "error", message: "GitHub login code expired" };
  }
  if (errorCode === "access_denied") {
    return { status: "error", message: "GitHub login was denied" };
  }
  if (errorCode) {
    return {
      status: "error",
      message: oauthErrorMessage(body, errorCode),
    };
  }

  if (ok && isRecord(body) && stringField(body.access_token)) {
    return {
      status: "authorized",
      token: {
        access_token: stringField(body.access_token) as string,
        token_type: stringField(body.token_type),
        expires_in: numberField(body.expires_in),
        refresh_token: stringField(body.refresh_token),
        refresh_token_expires_in: numberField(body.refresh_token_expires_in),
      },
    };
  }

  if (status >= 500 || status === 408 || status === 429) {
    return { status: "pending", intervalMs: pollIntervalMs };
  }

  return {
    status: "error",
    message: oauthErrorMessage(body, `Failed to poll GitHub device token (${status})`),
  };
}

export async function pollGithubDeviceToken(
  deviceCode: string,
  opts: GithubDeviceFlowOptions & { interval?: number; maxPolls?: number } = {},
): Promise<GithubDeviceTokenResponse> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  let pollIntervalMs = (opts.interval ?? 5) * 1000;
  const maxPolls = opts.maxPolls ?? 180;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const result = await pollGithubDeviceTokenOnce(deviceCode, {
      ...opts,
      intervalMs: pollIntervalMs,
    });
    if (result.status === "authorized") {
      return result.token;
    }
    if (result.status === "error") {
      throw new Error(result.message);
    }
    pollIntervalMs = result.intervalMs;
    if (pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  throw new Error("Timed out waiting for GitHub device login");
}

export async function fetchGithubUser(
  accessToken: string,
  opts: GithubDeviceFlowOptions = {},
): Promise<GithubUserIdentity> {
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${GITHUB_API_URL}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": publishedReleaseUserAgent(),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to read GitHub user (${response.status})`);
  }
  let body: unknown = {};
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error("GitHub user response was not JSON");
  }
  if (!isRecord(body) || typeof body.login !== "string") {
    throw new Error("GitHub user response was missing login");
  }
  return {
    login: body.login,
    id: typeof body.id === "number" ? body.id : 0,
    ...(typeof body.name === "string" && body.name.trim()
      ? { name: body.name.trim() }
      : {}),
  };
}

export async function refreshGithubAccessToken(
  refreshToken: string,
  opts: GithubDeviceFlowOptions = {},
): Promise<GithubDeviceTokenResponse> {
  const fetchFn = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const secret = resolveGithubAppClientSecret(env);
  if (!secret) {
    throw new Error(
      "GitHub token refresh requires HARNESSTAP_GITHUB_APP_CLIENT_SECRET",
    );
  }
  const { ok, status, body } = await readJson(
    fetchFn,
    GITHUB_OAUTH_ACCESS_TOKEN_URL,
    {
      method: "POST",
      headers: githubHeaders(),
      body: formBody({
        client_id: resolveGithubAppClientId(env),
        client_secret: secret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
  );
  if (!ok || !isRecord(body) || !stringField(body.access_token)) {
    throw new Error(
      oauthErrorMessage(body, `Failed to refresh GitHub token (${status})`),
    );
  }
  return {
    access_token: stringField(body.access_token) as string,
    token_type: stringField(body.token_type),
    expires_in: numberField(body.expires_in),
    refresh_token: stringField(body.refresh_token),
    refresh_token_expires_in: numberField(body.refresh_token_expires_in),
  };
}

export function sessionFromDeviceToken(
  token: GithubDeviceTokenResponse,
  identity: GithubUserIdentity | undefined,
  opts: GithubDeviceFlowOptions = {},
): GithubSession {
  const env = opts.env ?? process.env;
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  return {
    clientId: resolveGithubAppClientId(env),
    accessToken: token.access_token,
    tokenType: token.token_type,
    ...(token.expires_in ? { accessTokenExpiresAt: now + token.expires_in } : {}),
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(token.refresh_token_expires_in
      ? { refreshTokenExpiresAt: now + token.refresh_token_expires_in }
      : {}),
    ...(identity
      ? {
          login: identity.login,
          userId: identity.id,
          ...(identity.name ? { name: identity.name } : {}),
        }
      : {}),
  };
}
