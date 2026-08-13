import { agentFetch, throwAgentError } from "./http";

export type PluginOrigin = "authored" | "upstream" | "catalog";

export interface LibraryPluginHead {
  id: string;
  name: string;
  version: string;
  tags: string[];
  description: string | null;
  origin: PluginOrigin;
  dirty: boolean;
}

export interface LibraryPluginDetailPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  origin: PluginOrigin;
  dirty: boolean;
  default_environment_id: string | null;
}

export interface LibraryPluginDetail {
  plugin: LibraryPluginDetailPlugin;
  dependencies: Array<{
    dependency_name: string;
    version_constraint: string;
    order: number;
    resource_id: string | null;
  }>;
  resources: Array<{
    id: string;
    type: string;
    name: string;
    source: string;
  }>;
}

export interface LibraryPluginAttachmentAdd {
  type: string;
  selector: string;
  version?: string;
  embed?: boolean;
  sync?: boolean;
}

export interface LibraryPluginAttachmentRemove {
  type?: string;
  selector: string;
}

export interface PluginDoctorResultRow {
  check: string;
  severity: "ok" | "warn" | "error";
  message: string;
  detail?: string;
  fix?: string;
}

export interface PluginDoctorReport {
  plugin: string;
  valid: boolean;
  checks: string[];
  results: PluginDoctorResultRow[];
}

export interface PluginForkResult {
  name: string;
  version: string;
  origin: "authored";
  forked_from: string;
}

function pluginPath(selector: string, suffix = ""): string {
  return `/v1/library/plugins/${encodeURIComponent(selector)}${suffix}`;
}

export async function fetchLibraryPluginHeads(
  baseUrl: string,
  token: string | null,
): Promise<LibraryPluginHead[]> {
  const response = await agentFetch(baseUrl, token, "/v1/library/plugins/heads");
  if (!response.ok) {
    return throwAgentError(response, "Could not load plugins");
  }
  const body = (await response.json()) as { plugins: LibraryPluginHead[] };
  return body.plugins;
}

export async function fetchLibraryPluginDetail(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<LibraryPluginDetail> {
  const response = await agentFetch(baseUrl, token, pluginPath(selector));
  if (!response.ok) {
    return throwAgentError(response, "Could not load plugin");
  }
  return (await response.json()) as LibraryPluginDetail;
}

export async function patchLibraryPluginAttachments(
  baseUrl: string,
  token: string | null,
  selector: string,
  body: {
    add?: LibraryPluginAttachmentAdd[];
    remove?: LibraryPluginAttachmentRemove[];
  },
): Promise<LibraryPluginDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/attachments"),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not update plugin composition");
  }
  return (await response.json()) as LibraryPluginDetail;
}

export async function deleteLibraryPlugin(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<{ deleted: true; name: string; version: string }> {
  const response = await agentFetch(baseUrl, token, pluginPath(selector), {
    method: "DELETE",
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not delete plugin");
  }
  return (await response.json()) as {
    deleted: true;
    name: string;
    version: string;
  };
}

export async function cutLibraryPlugin(
  baseUrl: string,
  token: string | null,
  selector: string,
  version: string,
): Promise<{ plugin: { id: string; name: string; version: string; dirty: boolean } }> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/cut"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not cut plugin version");
  }
  return (await response.json()) as {
    plugin: { id: string; name: string; version: string; dirty: boolean };
  };
}

export async function runLibraryPluginDoctor(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<PluginDoctorReport> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/doctor"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not run plugin doctor");
  }
  return (await response.json()) as PluginDoctorReport;
}

export async function forkLibraryPlugin(
  baseUrl: string,
  token: string | null,
  selector: string,
  asName?: string,
): Promise<PluginForkResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/fork"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(asName ? { as: asName } : {}),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not fork plugin");
  }
  return (await response.json()) as PluginForkResult;
}
