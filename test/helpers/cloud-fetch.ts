type CloudOrg = { id: string; slug: string; name: string };

type CloudPublishLayer = {
  id: string;
  slug: string;
  catalogSlug: string;
  latestVersion: string | null;
  name: string;
  summary: string;
};

export function createCloudPublishFetchMock(input?: {
  baseUrl?: string;
  orgs?: CloudOrg[];
  existingLayers?: CloudPublishLayer[];
  createStatus?: number;
  patchStatus?: number;
  onCreate?: (body: Record<string, unknown>) => void;
  onPatch?: (body: Record<string, unknown>) => void;
}) {
  const baseUrl = (input?.baseUrl ?? "https://mock").replace(/\/+$/, "");
  const orgs = input?.orgs ?? [{ id: "org-1", slug: "acme", name: "Acme Corp" }];
  const layers = [...(input?.existingLayers ?? [])];
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
    if (url.includes("/api/layers?orgId=")) {
      return { ok: true, json: async () => ({ layers }) };
    }
    if (url.endsWith("/api/layers") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      input?.onCreate?.(body);
      if ((input?.createStatus ?? 201) !== 201) {
        return {
          ok: false,
          status: input?.createStatus ?? 409,
          json: async () => ({ error: { code: "duplicate_slug", message: "A layer with this slug already exists." } }),
        };
      }
      const created: CloudPublishLayer = {
        id: `layer-${layers.length + 1}`,
        slug: String(body.slug),
        catalogSlug: String(body.catalogSlug ?? "default"),
        latestVersion: null,
        name: String(body.name),
        summary: String(body.summary),
      };
      layers.push(created);
      return { ok: true, status: 201, json: async () => ({ layer: created }) };
    }
    if (url.endsWith("/api/layers") && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      input?.onPatch?.(body);
      if ((input?.patchStatus ?? 200) !== 200) {
        return {
          ok: false,
          status: input?.patchStatus ?? 409,
          json: async () => ({ error: { code: "duplicate_version", message: "Version already exists." } }),
        };
      }
      const layer = layers.find((entry) => entry.id === body.layerId);
      if (layer) {
        layer.latestVersion = String(body.version);
      }
      return {
        ok: true,
        json: async () => ({ version: { version: String(body.version) } }),
      };
    }

    if (
      url.startsWith(`${baseUrl}/api/public/layers`)
      || url.startsWith(`${baseUrl}/api/catalog/layers`)
      || /\/api\/public\/.+\/versions\/.+\/layer-export/.test(url)
      || /\/api\/catalog\/.+\/versions\/.+\/layer-export/.test(url)
    ) {
      return originalFetch(urlInput, init);
    }

    return { ok: false, status: 404, text: async () => "not found" };
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
