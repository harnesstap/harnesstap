const DEFAULT_BUNDLE = JSON.stringify({
  $schema: "urn:harnessdeck:bundle:v1",
  version: 1,
  layer: { name: "remote-team", description: "from cloud", tags: [] },
  resources: [{ type: "instruction", name: "r", description: "", content: "#x", metadata: {} }],
});

export function createCatalogFetchMock(input?: {
  libraries?: Array<Record<string, unknown>>;
  bundle?: string;
  baseUrl?: string;
}) {
  const baseUrl = (input?.baseUrl ?? "https://mock").replace(/\/+$/, "");
  const libraries = input?.libraries ?? [{
    orgSlug: "harnessdeck-cloud",
    slug: "team",
    name: "Team Layer",
    summary: "Team layer",
    latestVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    tags: [],
    visibility: "public",
  }];
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
    if (url.startsWith(`${baseUrl}/api/public/libraries`)) {
      const parsed = new URL(url);
      const orgFilters = parsed.searchParams.getAll("org");
      const filtered = orgFilters.length === 0
        ? libraries
        : libraries.filter((library) =>
            orgFilters.includes(String(library.orgSlug)),
          );
      return {
        ok: true,
        json: async () => ({ libraries: filtered, nextCursor: null }),
      };
    }
    if (url.startsWith(`${baseUrl}/api/catalog/libraries`)) {
      return {
        ok: true,
        json: async () => ({ libraries, nextCursor: null }),
      };
    }
    if (/\/api\/public\/.+\/versions\/.+\/bundle$/.test(url)) {
      return { ok: true, text: async () => bundle };
    }
    if (/\/api\/catalog\/.+\/versions\/.+\/bundle$/.test(url)) {
      return { ok: true, text: async () => bundle };
    }
    if (url.endsWith("/orgs")) {
      return {
        ok: true,
        json: async () => ([{ slug: "acme", name: "Acme Corp" }]),
      };
    }
    if (url.endsWith("/layers/publish")) {
      return { ok: true, json: async () => ({ id: "pub-1", version: "1.2.3", url: "https://mock/layers/pub-1" }) };
    }
    return originalFetch(urlInput, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
