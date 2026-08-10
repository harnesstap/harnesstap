type CloudOrg = { id: string; slug: string; name: string };

type CloudPublishPlugin = {
  id: string;
  slug: string;
  catalogSlug: string;
  latestVersion: string | null;
  name: string;
  summary: string;
};

/** @deprecated Use CloudPublishPlugin */
type CloudPublishPlugin = CloudPublishPlugin;

export function createCloudPublishFetchMock(input?: {
  baseUrl?: string;
  orgs?: CloudOrg[];
  existingPlugins?: CloudPublishPlugin[];
  existingPlugins?: CloudPublishPlugin[];
  createStatus?: number;
  patchStatus?: number;
  onCreate?: (body: Record<string, unknown>) => void;
  onPatch?: (body: Record<string, unknown>) => void;
}) {
  const baseUrl = (input?.baseUrl ?? "https://mock").replace(/\/+$/, "");
  const orgs = input?.orgs ?? [{ id: "org-1", slug: "acme", name: "Acme Corp" }];
  const plugins = [...(input?.existingPlugins ?? input?.existingPlugins ?? [])];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (urlInput: unknown, init?: RequestInit) => {
    const url = String(urlInput);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/cli/token/refresh") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
      };
    }
    if (url.endsWith("/api/me/orgs")) {
      return { ok: true, json: async () => ({ orgs }) };
    }
    if (url.includes("/api/plugins?orgId=") || url.includes("/api/plugins?orgId=")) {
      return { ok: true, json: async () => ({ plugins, plugins: plugins }) };
    }
    if ((url.endsWith("/api/plugins") || url.endsWith("/api/plugins")) && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      input?.onCreate?.(body);
      if ((input?.createStatus ?? 201) !== 201) {
        return {
          ok: false,
          status: input?.createStatus ?? 409,
          json: async () => ({
            error: {
              code: "duplicate_slug",
              message: "A plugin with this slug already exists.",
            },
          }),
        };
      }
      const created: CloudPublishPlugin = {
        id: `plugin-${plugins.length + 1}`,
        slug: String(body.slug),
        catalogSlug: String(body.catalogSlug ?? "default"),
        latestVersion: null,
        name: String(body.name),
        summary: String(body.summary),
      };
      plugins.push(created);
      return { ok: true, status: 201, json: async () => ({ plugin: created, plugin: created }) };
    }
    if ((url.endsWith("/api/plugins") || url.endsWith("/api/plugins")) && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      input?.onPatch?.(body);
      if ((input?.patchStatus ?? 200) !== 200) {
        return {
          ok: false,
          status: input?.patchStatus ?? 409,
          json: async () => ({
            error: {
              code: "duplicate_version",
              message: "Version already exists.",
            },
          }),
        };
      }
      const pluginId = String(body.pluginId ?? body.pluginId ?? "");
      const plugin = plugins.find((entry) => entry.id === pluginId);
      if (plugin) {
        plugin.latestVersion = String(body.version);
      }
      return {
        ok: true,
        json: async () => ({ version: { version: String(body.version) } }),
      };
    }

    if (
      url.startsWith(`${baseUrl}/api/public/plugins`)
      || url.startsWith(`${baseUrl}/api/catalog/plugins`)
      || url.startsWith(`${baseUrl}/api/public/plugins`)
      || url.startsWith(`${baseUrl}/api/catalog/plugins`)
      || /\/api\/public\/.+\/versions\/.+\/(?:plugin|plugin)-export/.test(url)
      || /\/api\/catalog\/.+\/versions\/.+\/(?:plugin|plugin)-export/.test(url)
    ) {
      return originalFetch(urlInput, init);
    }

    return { ok: false, status: 404, text: async () => "not found" };
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
