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

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function createCatalogFetchMock(input?: {
  layers?: Array<Record<string, unknown>>;
  bundle?: string;
  baseUrl?: string;
  failOrgFilters?: string[];
  pageDelayMs?: number;
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
  const pageDelayMs = input?.pageDelayMs ?? 0;
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
      if (input?.failOrgFilters?.some((org) => orgFilters.includes(org))) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const query = parsed.searchParams.get("q")?.trim().toLowerCase() ?? "";
      const tag = parsed.searchParams.get("tag")?.trim().toLowerCase();
      const catalog = parsed.searchParams.get("catalog")?.trim();
      let filtered = orgFilters.length === 0
        ? layers
        : layers.filter((layer) =>
            orgFilters.includes(String(layer.orgSlug)),
          );
      if (catalog) {
        filtered = filtered.filter((layer) => String(layer.catalogSlug ?? "default") === catalog);
      }
      if (query) {
        filtered = filtered.filter((layer) => {
          const slug = String(layer.slug ?? "").toLowerCase();
          const name = String(layer.name ?? "").toLowerCase();
          return slug.includes(query) || name.includes(query);
        });
      }
      if (tag) {
        filtered = filtered.filter((layer) => {
          const layerTags = Array.isArray(layer.tags) ? layer.tags : [];
          return layerTags.some((entry) => String(entry).toLowerCase() === tag);
        });
      }
      const limit = Math.min(Number(parsed.searchParams.get("limit") ?? 10) || 10, 100);
      const offset = decodeCursor(parsed.searchParams.get("cursor"));
      const page = filtered.slice(offset, offset + limit);
      const nextCursor = offset + page.length < filtered.length
        ? encodeCursor(offset + page.length)
        : null;
      if (pageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
      return {
        ok: true,
        json: async () => ({ layers: page, nextCursor }),
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
