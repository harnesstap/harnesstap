import {
  type CloudAccount,
  clearCloudTokens,
  getCloudAccount,
  updateCloudAccount,
} from "../config/cloud-accounts.js";
import {
  createCloudClient,
  type CloudClient,
  refreshCloudAccessToken,
  type CloudTokenRefreshResult,
} from "./cloud-client.js";

const ACCESS_TOKEN_SKEW_SECONDS = 60;

function parseExpiresAtSeconds(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return undefined;
}

function accessTokenNeedsRefresh(
  account: CloudAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!account.accessToken) {
    return true;
  }
  const expiresAt = parseExpiresAtSeconds(account.accessTokenExpiresAt);
  if (expiresAt == null) {
    return false;
  }
  return expiresAt <= nowSeconds + ACCESS_TOKEN_SKEW_SECONDS;
}

function accountFromRefresh(
  account: CloudAccount,
  refreshed: CloudTokenRefreshResult,
  nowSeconds: number,
): CloudAccount {
  return {
    ...account,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? account.refreshToken,
    accessTokenExpiresAt: nowSeconds + (refreshed.expires_in ?? 3600),
    ...(refreshed.orgId ? { orgId: refreshed.orgId } : {}),
    ...(refreshed.orgSlug ? { orgSlug: refreshed.orgSlug } : {}),
    ...(refreshed.scopes ? { scopes: refreshed.scopes } : {}),
  };
}

/**
 * Ensure the stored cloud account has a usable access token.
 * Access tokens expire (~1h); refresh tokens rotate and must be persisted.
 */
export async function ensureCloudAccountAccess(accountName?: string): Promise<{
  accountName: string;
  account: CloudAccount;
  accessToken: string;
} | null> {
  const loaded = await getCloudAccount(accountName);
  const name = loaded.accountName;
  const account = loaded.account;
  if (!name || !account) {
    return null;
  }
  if (!account.accessToken && !account.refreshToken) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!accessTokenNeedsRefresh(account, nowSeconds)) {
    return {
      accountName: name,
      account,
      accessToken: account.accessToken as string,
    };
  }

  if (!account.refreshToken) {
    if (account.accessToken) {
      return {
        accountName: name,
        account,
        accessToken: account.accessToken,
      };
    }
    return null;
  }

  try {
    const refreshed = await refreshCloudAccessToken(
      account.cloudBaseUrl,
      account.refreshToken,
    );
    const next = accountFromRefresh(account, refreshed, nowSeconds);
    await updateCloudAccount(name, next);
    return {
      accountName: name,
      account: next,
      accessToken: next.accessToken as string,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Invalid/revoked refresh → clear local credentials so UI stops claiming signed-in.
    if (/Failed to refresh token: (400|401)/.test(message)) {
      await clearCloudTokens(name);
      return null;
    }
    // Transient network errors: fall back to existing access token if any.
    if (account.accessToken) {
      return {
        accountName: name,
        account,
        accessToken: account.accessToken,
      };
    }
    return null;
  }
}

export async function forceRefreshCloudAccountAccess(accountName?: string): Promise<{
  accountName: string;
  account: CloudAccount;
  accessToken: string;
} | null> {
  const loaded = await getCloudAccount(accountName);
  const name = loaded.accountName;
  const account = loaded.account;
  if (!name || !account?.refreshToken) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  try {
    const refreshed = await refreshCloudAccessToken(
      account.cloudBaseUrl,
      account.refreshToken,
    );
    const next = accountFromRefresh(account, refreshed, nowSeconds);
    await updateCloudAccount(name, next);
    return {
      accountName: name,
      account: next,
      accessToken: next.accessToken as string,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Failed to refresh token: (400|401)/.test(message)) {
      await clearCloudTokens(name);
    }
    return null;
  }
}

/** Cloud client that refreshes tokens and persists rotated refresh tokens to disk. */
export async function createPersistingCloudClient(
  accountName?: string,
): Promise<{ accountName: string; client: CloudClient } | null> {
  const ensured = await ensureCloudAccountAccess(accountName);
  if (!ensured) {
    return null;
  }

  const { account } = ensured;
  const client = createCloudClient({
    baseUrl: account.cloudBaseUrl,
    token: {
      access_token: ensured.accessToken,
      refresh_token: account.refreshToken,
      expires_at: parseExpiresAtSeconds(account.accessTokenExpiresAt),
    },
    onTokenRefreshed: async (token) => {
      await updateCloudAccount(ensured.accountName, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? account.refreshToken,
        accessTokenExpiresAt: token.expires_at,
      });
    },
  });
  return { accountName: ensured.accountName, client };
}
