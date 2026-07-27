import { resolveCloudBaseUrl } from "../config/catalog.js";
import {
  type CloudAccount,
  getCloudAccount,
  removeCloudAccount,
  saveCloudAccount,
  setDefaultCloudAccount,
  updateCloudAccount,
} from "../config/cloud-accounts.js";
import { ensureCloudAccountAccess } from "../services/cloud-account-auth.js";
import {
  createCloudClient,
  type DeviceCodeResponse,
  type DeviceTokenPollOnceResult,
  type DeviceTokenResponse,
  deviceVerificationUri,
  pollDeviceTokenOnce,
  requestDeviceCode,
  resolveDeviceVerificationUris,
} from "../services/cloud-client.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

const DEFAULT_ACCOUNT_NAME = "default";

export interface CloudPendingLogin {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: number;
}

export interface CloudAuthStatus {
  authenticated: boolean;
  accountName?: string;
  email?: string;
  name?: string;
  orgSlug?: string;
  cloudBaseUrl?: string;
  pendingLogin?: CloudPendingLogin;
}

export interface CloudAuthLoginPollResult {
  status: "pending" | "complete" | "error";
  intervalMs?: number;
  message?: string;
  auth?: CloudAuthStatus;
}

interface PendingDeviceLogin {
  accountName: string;
  cloudBaseUrl: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalMs: number;
}

export interface CloudAuthDeps {
  resolveBaseUrl(override?: string): string;
  getAccount(accountName?: string): Promise<{
    accountName?: string | null;
    account?: CloudAccount | undefined;
  }>;
  ensureAccess(accountName?: string): Promise<{
    accountName: string;
    account: CloudAccount;
    accessToken: string;
  } | null>;
  saveAccount(accountName: string, account: CloudAccount): Promise<void>;
  setDefaultAccount(accountName: string | null): Promise<void>;
  removeAccount(accountName: string): Promise<void>;
  requestDeviceCode(baseUrl: string): Promise<DeviceCodeResponse>;
  pollDeviceTokenOnce(
    baseUrl: string,
    deviceCode: string,
    opts?: { intervalMs?: number },
  ): Promise<DeviceTokenPollOnceResult>;
  whoami(account: CloudAccount, accountName: string): Promise<Record<string, unknown>>;
  revokeRefreshToken(account: CloudAccount): Promise<void>;
  deviceVerificationUri(baseUrl: string): string;
  now(): number;
  getPending(): PendingDeviceLogin | null;
  setPending(pending: PendingDeviceLogin | null): void;
}

export interface CloudAuthHandlers {
  handleStatus(request: Request, token: string): Promise<Response>;
  handleLogin(request: Request, token: string): Promise<Response>;
  handleLoginPoll(request: Request, token: string): Promise<Response>;
  handleLoginCancel(request: Request, token: string): Promise<Response>;
  handleLogout(request: Request, token: string): Promise<Response>;
}

let pendingLogin: PendingDeviceLogin | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function pendingPayload(pending: PendingDeviceLogin): CloudPendingLogin {
  return {
    user_code: pending.userCode,
    verification_uri: pending.verificationUri,
    verification_uri_complete: pending.verificationUriComplete,
    expires_at: pending.expiresAt,
  };
}

function extractIdentity(
  account: CloudAccount,
  whoami?: Record<string, unknown>,
): { email?: string; name?: string; orgSlug?: string } {
  const user = isRecord(whoami?.user) ? whoami.user : undefined;
  const activeOrg = isRecord(whoami?.activeOrg) ? whoami.activeOrg : undefined;
  return {
    email:
      stringField(user?.email)
      ?? stringField(whoami?.user_email)
      ?? stringField(account.userEmail),
    name:
      stringField(user?.name)
      ?? stringField(whoami?.user_name)
      ?? stringField(account.userName),
    orgSlug:
      stringField(account.orgSlug)
      ?? stringField(activeOrg?.slug)
      ?? stringField(whoami?.org_slug),
  };
}

async function buildStatus(deps: CloudAuthDeps): Promise<CloudAuthStatus> {
  const pending = deps.getPending();
  const pendingLoginPayload =
    pending && pending.expiresAt > deps.now()
      ? pendingPayload(pending)
      : undefined;

  if (pending && pending.expiresAt <= deps.now()) {
    deps.setPending(null);
  }

  const ensured = await deps.ensureAccess();
  if (!ensured) {
    return {
      authenticated: false,
      ...(pendingLoginPayload ? { pendingLogin: pendingLoginPayload } : {}),
    };
  }

  let whoami: Record<string, unknown> | undefined;
  try {
    whoami = await deps.whoami(ensured.account, ensured.accountName);
  } catch {
    return {
      authenticated: false,
      accountName: ensured.accountName,
      cloudBaseUrl: ensured.account.cloudBaseUrl,
      ...(pendingLoginPayload ? { pendingLogin: pendingLoginPayload } : {}),
    };
  }

  const identity = extractIdentity(ensured.account, whoami);
  return {
    authenticated: true,
    accountName: ensured.accountName,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.orgSlug ? { orgSlug: identity.orgSlug } : {}),
    cloudBaseUrl: ensured.account.cloudBaseUrl,
    ...(pendingLoginPayload ? { pendingLogin: pendingLoginPayload } : {}),
  };
}

function createDefaultCloudAuthDeps(): CloudAuthDeps {
  return {
    resolveBaseUrl: resolveCloudBaseUrl,
    getAccount: getCloudAccount,
    ensureAccess: ensureCloudAccountAccess,
    saveAccount: saveCloudAccount,
    setDefaultAccount: setDefaultCloudAccount,
    removeAccount: removeCloudAccount,
    requestDeviceCode,
    pollDeviceTokenOnce,
    deviceVerificationUri,
    now: () => Date.now(),
    getPending: () => pendingLogin,
    setPending: (next) => {
      pendingLogin = next;
    },
    async whoami(account, accountName) {
      const client = createCloudClient({
        baseUrl: account.cloudBaseUrl,
        token: {
          access_token: account.accessToken as string,
          refresh_token: account.refreshToken as string | undefined,
          expires_at: typeof account.accessTokenExpiresAt === "number"
            ? account.accessTokenExpiresAt
            : undefined,
        },
        onTokenRefreshed: async (token) => {
          await updateCloudAccount(accountName, {
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? account.refreshToken,
            accessTokenExpiresAt: token.expires_at,
          });
        },
      });
      return await client.whoami();
    },
    async revokeRefreshToken(account) {
      if (!account.refreshToken) {
        return;
      }
      const client = createCloudClient({
        baseUrl: account.cloudBaseUrl,
        token: {
          access_token: account.accessToken ?? "",
          refresh_token: account.refreshToken,
          expires_at: typeof account.accessTokenExpiresAt === "number"
            ? account.accessTokenExpiresAt
            : undefined,
        },
      });
      await client.revokeRefreshToken();
    },
  };
}

function accountFromToken(
  cloudBaseUrl: string,
  token: DeviceTokenResponse,
  nowSeconds: number,
): CloudAccount {
  return {
    cloudBaseUrl,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: token.expires_in
      ? nowSeconds + token.expires_in
      : undefined,
    refreshTokenExpiresAt: undefined,
    orgId: token.orgId,
    orgSlug: token.orgSlug,
    scopes: token.scopes ?? [],
  };
}

export function createCloudAuthHandlers(
  deps: CloudAuthDeps = createDefaultCloudAuthDeps(),
): CloudAuthHandlers {
  return {
    async handleStatus(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      return jsonResponse(await buildStatus(deps));
    },

    async handleLogin(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      try {
        const cloudBaseUrl = deps.resolveBaseUrl();
        const device = await deps.requestDeviceCode(cloudBaseUrl);
        const now = deps.now();
        const uris = resolveDeviceVerificationUris(cloudBaseUrl, device);
        const pending: PendingDeviceLogin = {
          accountName: DEFAULT_ACCOUNT_NAME,
          cloudBaseUrl,
          deviceCode: device.device_code,
          userCode: device.user_code,
          verificationUri: uris.verification_uri,
          verificationUriComplete: uris.verification_uri_complete,
          expiresAt: now + (device.expires_in ?? 600) * 1000,
          intervalMs: (device.interval ?? 5) * 1000,
        };
        deps.setPending(pending);
        return jsonResponse({
          ...(await buildStatus(deps)),
          pendingLogin: pendingPayload(pending),
        } satisfies CloudAuthStatus);
      } catch (error) {
        return jsonResponse(
          {
            error: "cloud_login_failed",
            message: errorMessage(error),
          },
          { status: 502 },
        );
      }
    },

    async handleLoginPoll(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      const pending = deps.getPending();
      if (!pending) {
        return jsonResponse(
          {
            status: "error",
            message: "No cloud login in progress",
          } satisfies CloudAuthLoginPollResult,
          { status: 409 },
        );
      }

      if (pending.expiresAt <= deps.now()) {
        deps.setPending(null);
        return jsonResponse(
          {
            status: "error",
            message: "Cloud login code expired",
          } satisfies CloudAuthLoginPollResult,
          { status: 410 },
        );
      }

      try {
        const result = await deps.pollDeviceTokenOnce(
          pending.cloudBaseUrl,
          pending.deviceCode,
          { intervalMs: pending.intervalMs },
        );

        if (result.status === "pending") {
          pending.intervalMs = result.intervalMs;
          deps.setPending(pending);
          return jsonResponse({
            status: "pending",
            intervalMs: result.intervalMs,
          } satisfies CloudAuthLoginPollResult);
        }

        if (result.status === "error") {
          deps.setPending(null);
          return jsonResponse(
            {
              status: "error",
              message: result.message,
            } satisfies CloudAuthLoginPollResult,
            { status: 502 },
          );
        }

        const account = accountFromToken(
          pending.cloudBaseUrl,
          result.token,
          Math.floor(deps.now() / 1000),
        );
        await deps.saveAccount(pending.accountName, account);
        await deps.setDefaultAccount(pending.accountName);
        deps.setPending(null);

        return jsonResponse({
          status: "complete",
          auth: await buildStatus(deps),
        } satisfies CloudAuthLoginPollResult);
      } catch (error) {
        deps.setPending(null);
        return jsonResponse(
          {
            status: "error",
            message: errorMessage(error),
          } satisfies CloudAuthLoginPollResult,
          { status: 502 },
        );
      }
    },

    async handleLoginCancel(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      deps.setPending(null);
      return jsonResponse(await buildStatus(deps));
    },

    async handleLogout(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      deps.setPending(null);
      const { accountName, account } = await deps.getAccount();
      if (!accountName) {
        return jsonResponse(await buildStatus(deps));
      }

      if (account) {
        try {
          await deps.revokeRefreshToken(account);
        } catch {
          // ignore revoke errors — still clear local credentials
        }
      }
      await deps.removeAccount(accountName);
      return jsonResponse(await buildStatus(deps));
    },
  };
}
