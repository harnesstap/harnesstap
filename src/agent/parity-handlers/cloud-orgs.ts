import {
  type CloudAccount,
  updateCloudAccount,
} from "../../config/cloud-accounts.js";
import { ensureCloudAccountAccess } from "../../services/cloud-account-auth.js";
import { createCloudClient } from "../../services/cloud-client.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const ORGS_PATH = "/v1/cloud/auth/orgs";
const SWITCH_PATH = "/v1/cloud/auth/orgs/switch";

export interface CloudOrgsServiceDeps {
  ensureAccess(): Promise<{
    accountName: string;
    account: CloudAccount;
    accessToken: string;
  } | null>;
  listOrgs(
    account: CloudAccount,
    accountName: string,
  ): Promise<Record<string, unknown>[]>;
  updateAccount(
    accountName: string,
    patch: { orgId: string; orgSlug: string },
  ): Promise<void>;
  whoami(
    account: CloudAccount,
    accountName: string,
  ): Promise<Record<string, unknown>>;
}

type RouteDeps = { isAgentSwitchInProgress: () => boolean };

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

function pathnameOf(request: Request): string {
  return new URL(request.url).pathname;
}

function createPersistingClient(account: CloudAccount, accountName: string) {
  return createCloudClient({
    baseUrl: account.cloudBaseUrl,
    token: {
      access_token: account.accessToken as string,
      refresh_token: account.refreshToken as string | undefined,
      expires_at:
        typeof account.accessTokenExpiresAt === "number"
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
}

function extractOrgSlug(
  account: CloudAccount,
  whoami?: Record<string, unknown>,
): string | undefined {
  const activeOrg = isRecord(whoami?.activeOrg) ? whoami.activeOrg : undefined;
  return (
    stringField(account.orgSlug)
    ?? stringField(activeOrg?.slug)
    ?? stringField(whoami?.org_slug)
  );
}

function extractIdentity(
  account: CloudAccount,
  whoami?: Record<string, unknown>,
): { email?: string; name?: string; orgSlug?: string } {
  const user = isRecord(whoami?.user) ? whoami.user : undefined;
  return {
    email:
      stringField(user?.email)
      ?? stringField(whoami?.user_email)
      ?? stringField(account.userEmail),
    name:
      stringField(user?.name)
      ?? stringField(whoami?.user_name)
      ?? stringField(account.userName),
    orgSlug: extractOrgSlug(account, whoami),
  };
}

function isCurrentOrg(
  id: string,
  slug: string,
  account: CloudAccount,
  derivedSlug?: string,
): boolean {
  const needles = [account.orgSlug, account.orgId, derivedSlug].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return needles.some((needle) => needle === slug || needle === id);
}

function mapOrgs(
  raw: Record<string, unknown>[],
  account: CloudAccount,
  derivedSlug?: string,
): Array<{ id: string; slug: string; name: string; current: boolean }> {
  const mapped = raw.map((entry) => {
    const id = String(entry.id ?? "");
    const slug = String(entry.slug ?? "");
    const name = String(entry.name ?? slug);
    return {
      id,
      slug,
      name,
      current: isCurrentOrg(id, slug, account, derivedSlug),
    };
  });
  const current = mapped.filter((org) => org.current);
  const rest = mapped.filter((org) => !org.current);
  return [...current, ...rest];
}

async function buildStatus(
  service: CloudOrgsServiceDeps,
  ensured: {
    accountName: string;
    account: CloudAccount;
    accessToken: string;
  },
): Promise<{
  authenticated: boolean;
  accountName?: string;
  email?: string;
  name?: string;
  orgSlug?: string;
  cloudBaseUrl?: string;
}> {
  let whoami: Record<string, unknown> | undefined;
  try {
    whoami = await service.whoami(ensured.account, ensured.accountName);
  } catch {
    whoami = undefined;
  }
  const identity = extractIdentity(ensured.account, whoami);
  return {
    authenticated: true,
    accountName: ensured.accountName,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.orgSlug ? { orgSlug: identity.orgSlug } : {}),
    cloudBaseUrl: ensured.account.cloudBaseUrl,
  };
}

function notAuthenticated(): Response {
  return jsonResponse(
    {
      error: "not_authenticated",
      message: "Not authenticated to cloud.",
    },
    { status: 401 },
  );
}

function cloudOrgsFailed(error: unknown): Response {
  return jsonResponse(
    {
      error: "cloud_orgs_failed",
      message: errorMessage(error),
    },
    { status: 502 },
  );
}

async function handleList(
  service: CloudOrgsServiceDeps,
): Promise<Response> {
  const ensured = await service.ensureAccess();
  if (!ensured) {
    return notAuthenticated();
  }

  let whoami: Record<string, unknown> | undefined;
  try {
    whoami = await service.whoami(ensured.account, ensured.accountName);
  } catch {
    whoami = undefined;
  }
  const derivedSlug = extractOrgSlug(ensured.account, whoami);

  let raw: Record<string, unknown>[];
  try {
    raw = await service.listOrgs(ensured.account, ensured.accountName);
  } catch (error) {
    return cloudOrgsFailed(error);
  }

  const orgs = mapOrgs(raw, ensured.account, derivedSlug);
  return jsonResponse({
    orgs,
    ...(derivedSlug ? { current_org_slug: derivedSlug } : {}),
  });
}

async function handleSwitch(
  request: Request,
  service: CloudOrgsServiceDeps,
): Promise<Response> {
  const ensured = await service.ensureAccess();
  if (!ensured) {
    return notAuthenticated();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }
  if (!isRecord(body)) {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return jsonResponse(
      { error: "invalid_body", message: "slug is required" },
      { status: 400 },
    );
  }

  let raw: Record<string, unknown>[];
  try {
    raw = await service.listOrgs(ensured.account, ensured.accountName);
  } catch (error) {
    return cloudOrgsFailed(error);
  }

  const target = raw.find(
    (entry) => String(entry.slug ?? "") === slug || String(entry.id ?? "") === slug,
  );
  if (!target) {
    return jsonResponse(
      {
        error: "org_not_found",
        message: `Organization not found: ${slug}`,
      },
      { status: 404 },
    );
  }

  const orgId = String(target.id ?? "");
  const orgSlug = String(target.slug ?? "");
  await service.updateAccount(ensured.accountName, { orgId, orgSlug });
  const next = await service.ensureAccess();
  if (!next) {
    return notAuthenticated();
  }
  return jsonResponse(await buildStatus(service, next));
}

export function createCloudOrgsTryHandle(service: CloudOrgsServiceDeps) {
  return async function handleCloudOrgs(
    request: Request,
    token: string,
    _deps: RouteDeps,
  ): Promise<Response | null> {
    const path = pathnameOf(request);
    const isList = request.method === "GET" && path === ORGS_PATH;
    const isSwitch = request.method === "POST" && path === SWITCH_PATH;
    if (!isList && !isSwitch) {
      return null;
    }

    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }

    try {
      if (isList) {
        return await handleList(service);
      }
      return await handleSwitch(request, service);
    } catch (error) {
      return cloudOrgsFailed(error);
    }
  };
}

const defaultService: CloudOrgsServiceDeps = {
  ensureAccess: () => ensureCloudAccountAccess(),
  async listOrgs(account, accountName) {
    return await createPersistingClient(account, accountName).listOrgs();
  },
  updateAccount: (accountName, patch) => updateCloudAccount(accountName, patch),
  async whoami(account, accountName) {
    return await createPersistingClient(account, accountName).whoami();
  },
};

export async function tryHandle(
  request: Request,
  token: string,
  deps: RouteDeps,
): Promise<Response | null> {
  return createCloudOrgsTryHandle(defaultService)(request, token, deps);
}
