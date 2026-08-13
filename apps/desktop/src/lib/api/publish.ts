import { agentFetch, throwAgentError } from "./http";

export interface PublishCatalogRef {
  org: string;
  catalog: string;
  account?: string;
}

export interface PublishPlanWarning {
  code: "empty_profile" | "unpublished_local_refs" | string;
  message: string;
}

export interface PublishPlanRow {
  target: PublishCatalogRef;
  account: string;
  nextVersion?: string;
  ok: boolean;
  error?: string;
}

export interface ProfilePublishPlan {
  profile: string;
  dirty: boolean;
  authored: boolean;
  warnings: PublishPlanWarning[];
  plans: PublishPlanRow[];
}

export interface ProfilePublishResultRow {
  org: string;
  catalog: string;
  account: string;
  ok: boolean;
  version?: string;
  error?: string;
}

export interface ProfilePublishResult {
  profile: string;
  version: string;
  results: ProfilePublishResultRow[];
}

export interface RegisteredCatalogsPayload {
  registered: PublishCatalogRef[];
}

export interface RegisterCatalogResult {
  catalog: PublishCatalogRef;
  created: boolean;
}

export type CatalogBindingMode = "all_registered" | "explicit";

export interface CatalogBindingsView {
  plugin: string;
  mode: CatalogBindingMode;
  registered: PublishCatalogRef[];
  effective: PublishCatalogRef[];
  allowList: PublishCatalogRef[];
}

function encodeName(name: string): string {
  return encodeURIComponent(name);
}

export async function planProfilePublish(
  baseUrl: string,
  token: string | null,
  profileName: string,
): Promise<ProfilePublishPlan> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeName(profileName)}/publish/plan`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not plan profile publish");
  }
  return (await response.json()) as ProfilePublishPlan;
}

export async function publishProfile(
  baseUrl: string,
  token: string | null,
  profileName: string,
): Promise<ProfilePublishResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeName(profileName)}/publish`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not publish profile");
  }
  return (await response.json()) as ProfilePublishResult;
}

export async function fetchRegisteredCatalogs(
  baseUrl: string,
  token: string | null,
): Promise<PublishCatalogRef[]> {
  const response = await agentFetch(baseUrl, token, "/v1/catalogs/registered");
  if (!response.ok) {
    return throwAgentError(response, "Could not load publish catalogs");
  }
  const body = (await response.json()) as RegisteredCatalogsPayload;
  return body.registered;
}

export async function registerCatalog(
  baseUrl: string,
  token: string | null,
  input: { selector: string; account?: string },
): Promise<RegisterCatalogResult> {
  const response = await agentFetch(baseUrl, token, "/v1/catalogs/registered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not register publish catalog");
  }
  return (await response.json()) as RegisterCatalogResult;
}

export async function unregisterCatalog(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<{ org: string; catalog: string }> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/catalogs/registered/${encodeURIComponent(selector)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not unregister publish catalog");
  }
  const body = (await response.json()) as { removed: { org: string; catalog: string } };
  return body.removed;
}

export async function fetchCatalogBindings(
  baseUrl: string,
  token: string | null,
  profileName: string,
): Promise<CatalogBindingsView> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeName(profileName)}/catalog-bindings`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load catalog bindings");
  }
  return (await response.json()) as CatalogBindingsView;
}

export async function putCatalogBindings(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body:
    | { mode: "all_registered" }
    | { mode: "explicit"; allowList: Array<{ org: string; catalog: string }> },
): Promise<CatalogBindingsView> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeName(profileName)}/catalog-bindings`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not save catalog bindings");
  }
  return (await response.json()) as CatalogBindingsView;
}
