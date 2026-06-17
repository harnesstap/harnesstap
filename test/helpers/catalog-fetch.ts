import { formatLayerExportToml } from "../../src/services/transport/layer.ts";

const DEFAULT_BUNDLE = formatLayerExportToml({
  $schema: "urn:harnessdeck:layer:v1",
  version: 1,
  layers: [
    {
      name: "remote-team",
      version: "1.0.0",
      description: "from cloud",
      tags: [],
      resources: [
        {
          type: "instruction",
          name: "r",
          description: "",
          content: "#x",
          metadata: {},
          namespace: "",
          origin_kind: "manual",
          origin_ref: "",
          content_hash: "",
          content_blob_ref: "",
        },
      ],
      plugin_pins: [],
    },
  ],
  embedded_plugins: [],
});

function normalizeLayer(layer: Record<string, unknown>) {
  return {
    catalogSlug: "default",
    ...layer,
  };
}

export function createCatalogFetchMock(input?: {
  layers?: Array<Record<string, unknown>>;
  bundle?: string;
  baseUrl?: string;
}) {
  const baseUrl = (input?.baseUrl ?? "https://mock").replace(/\/+$/, "");
  const layers = (input?.layers ?? [{
    orgSlug: "harnessdeck-cloud",
    slug: "team",
    name: "Team Layer",
    summary: "Team layer",
    latestVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    tags: [],
    visibility: "public",
  }]).map((layer) => normalizeLayer(layer));
  const bundle = input?.bundle ?? DEFAULT_BUNDLE;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (urlInput: unknown, init?: RequestInit) => {
    const url = String(urlInput);
    if (url.endsWith("/oauth/token") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
      };
    }
    if (url.startsWith(`${baseUrl}/api/public/layers`) || url.startsWith(`${baseUrl}/api/catalog/layers`)) {
      const parsed = new URL(url);
      const orgFilters = parsed.searchParams.getAll("org");
      const query = parsed.searchParams.get("q")?.trim().toLowerCase() ?? "";
      let filtered = orgFilters.length === 0
        ? layers
        : layers.filter((layer) =>
            orgFilters.includes(String(layer.orgSlug)),
          );
      if (query) {
        filtered = filtered.filter((layer) => {
          const slug = String(layer.slug ?? "").toLowerCase();
          const name = String(layer.name ?? "").toLowerCase();
          return slug.includes(query) || name.includes(query);
        });
      }
      return {
        ok: true,
        json: async () => ({ layers: filtered, nextCursor: null }),
      };
    }
    if (/\/api\/public\/.+\/versions\/.+\/layer-export/.test(url)) {
      return { ok: true, text: async () => bundle };
    }
    if (/\/api\/catalog\/.+\/versions\/.+\/layer-export/.test(url)) {
      return { ok: true, text: async () => bundle };
    }
    if (url.endsWith("/api/me/orgs")) {
      return {
        ok: true,
        json: async () => ({ orgs: [{ id: "org-1", slug: "acme", name: "Acme Corp" }] }),
      };
    }
    return originalFetch(urlInput, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
