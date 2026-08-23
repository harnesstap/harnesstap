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
  org_slug: string;
  catalog_slug: string;
}

export interface LibraryPluginDetailPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  origin: PluginOrigin;
  dirty: boolean;
  frozen_at: string | null;
  default_environment_id: string | null;
}

export interface LibraryPluginVersionRow {
  id: string;
  name: string;
  version: string;
  dirty: boolean;
  frozen_at: string | null;
  is_head: boolean;
  updated_at: string;
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

export interface LibraryPluginCreateResource {
  type: string;
  selector: string;
}

export async function createLibraryPlugin(
  baseUrl: string,
  token: string | null,
  input: {
    name: string;
    description?: string;
    resources?: LibraryPluginCreateResource[];
  },
): Promise<LibraryPluginHead> {
  const response = await agentFetch(baseUrl, token, "/v1/library/plugins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.resources && input.resources.length > 0
        ? { resources: input.resources }
        : {}),
    }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not create plugin");
  }
  const body = (await response.json()) as { plugin: LibraryPluginHead };
  return body.plugin;
}

export async function patchLibraryPlugin(
  baseUrl: string,
  token: string | null,
  selector: string,
  input: {
    name?: string;
    description?: string;
    tags?: string[];
    default_environment_id?: string | null;
  },
): Promise<LibraryPluginDetail> {
  const response = await agentFetch(baseUrl, token, pluginPath(selector), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not update plugin");
  }
  return (await response.json()) as LibraryPluginDetail;
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

export async function fetchLibraryPluginVersions(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<LibraryPluginVersionRow[]> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/versions"),
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load plugin versions");
  }
  const body = (await response.json()) as { versions: LibraryPluginVersionRow[] };
  return body.versions;
}

export async function rollbackLibraryPlugin(
  baseUrl: string,
  token: string | null,
  selector: string,
  version: string,
): Promise<LibraryPluginDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    pluginPath(selector, "/rollback"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not restore plugin version");
  }
  return (await response.json()) as LibraryPluginDetail;
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
