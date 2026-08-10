import { DEFAULT_CLOUD_BASE_URL } from "../../src/config/catalog.ts";
import { formatPluginExportToml } from "../../src/services/transport/plugin.ts";
import { PLUGIN_SCHEMA, PLUGIN_SCHEMA_VERSION } from "../../src/types.ts";

const DEFAULT_BUNDLE = formatPluginExportToml({
  $schema: PLUGIN_SCHEMA,
  version: PLUGIN_SCHEMA_VERSION,
  plugins: [
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

function normalizePlugin(plugin: Record<string, unknown>) {
  return {
    catalogSlug: "default",
    ...plugin,
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
  plugins?: Array<Record<string, unknown>>;
  bundle?: string;
  baseUrl?: string;
  failOrgFilters?: string[];
  pageDelayMs?: number;
}) {
  const baseUrl = (input?.baseUrl ?? DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, "");
  const plugins = (input?.plugins ?? input?.layers ?? [{
    orgSlug: "harnesstap-cloud",
    slug: "team",
    name: "Team Layer",
    summary: "Team layer",
    latestVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    tags: [],
    visibility: "public",
  }]).map((plugin) => normalizePlugin(plugin));
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
    const isPluginList =
      url.startsWith(`${baseUrl}/api/public/plugins`)
      || url.startsWith(`${baseUrl}/api/catalog/plugins`)
      || url.startsWith(`${baseUrl}/api/public/layers`)
      || url.startsWith(`${baseUrl}/api/catalog/layers`);
    if (isPluginList) {
      const parsed = new URL(url);
      const orgFilters = parsed.searchParams.getAll("org");
      if (input?.failOrgFilters?.some((org) => orgFilters.includes(org))) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const query = parsed.searchParams.get("q")?.trim().toLowerCase() ?? "";
      const tag = parsed.searchParams.get("tag")?.trim().toLowerCase();
      const catalog = parsed.searchParams.get("catalog")?.trim();
      let filtered = orgFilters.length === 0
        ? plugins
        : plugins.filter((plugin) =>
            orgFilters.includes(String(plugin.orgSlug)),
          );
      if (catalog) {
        filtered = filtered.filter((plugin) => String(plugin.catalogSlug ?? "default") === catalog);
      }
      if (query) {
        filtered = filtered.filter((plugin) => {
          const slug = String(plugin.slug ?? "").toLowerCase();
          const name = String(plugin.name ?? "").toLowerCase();
          return slug.includes(query) || name.includes(query);
        });
      }
      if (tag) {
        filtered = filtered.filter((plugin) => {
          const pluginTags = Array.isArray(plugin.tags) ? plugin.tags : [];
          return pluginTags.some((entry) => String(entry).toLowerCase() === tag);
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
        json: async () => ({ plugins: page, layers: page, nextCursor }),
      };
    }
    if (
      /\/api\/public\/.+\/versions\/.+\/(?:plugin|layer)-export/.test(url)
      || /\/api\/catalog\/.+\/versions\/.+\/(?:plugin|layer)-export/.test(url)
    ) {
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
