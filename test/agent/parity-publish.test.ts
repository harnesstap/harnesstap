import { describe, expect, it, mock } from "bun:test";
import { PluginProvenanceError } from "../../src/services/plugin-origin.ts";
import type { Plugin } from "../../src/types.ts";
import {
  createPublishTryHandle,
  type PublishHandlerDeps,
} from "../../src/agent/parity-handlers/publish.ts";

const TOKEN = "agent-secret";

function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "plug-1",
    name: "focus",
    version: "1.1.0",
    org_slug: "",
    catalog_slug: "",
    origin: "authored",
    description: "",
    tags: ["profile"],
    dirty: false,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function deps(overrides: Partial<PublishHandlerDeps> = {}): PublishHandlerDeps {
  return {
    resolveAccess: async () => ({ isAuthenticated: true }),
    getPluginByName: (name) => (name === "focus" ? plugin() : undefined),
    assertAuthored: () => undefined,
    listAttachedPluginRefs: () => [],
    getPluginResources: () => [],
    resolvePluginSelector: () => undefined,
    loadRegisteredCatalogs: () => [
      { org: "acme", catalog: "internal", account: "default" },
    ],
    resolvePublishTargets: () => [
      { org: "acme", catalog: "internal", account: "default" },
    ],
    planPluginPublish: async () => [
      {
        target: { org: "acme", catalog: "internal", account: "default" },
        account: "default",
        nextVersion: "1.2.0",
        ok: true,
      },
    ],
    publishPluginToCatalogs: async () => [],
    assertPluginsCleanForShare: () => undefined,
    registerPublishCatalog: () => ({
      catalog: { org: "acme", catalog: "internal" },
      created: true,
    }),
    unregisterPublishCatalog: () => undefined,
    buildPluginCatalogBindingsView: () => ({
      plugin: "focus",
      mode: "all_registered",
      registered: [{ org: "acme", catalog: "internal" }],
      effective: [{ org: "acme", catalog: "internal" }],
      allowList: [],
    }),
    setPluginPublishTargets: () => undefined,
    clearPluginPublishTargets: () => undefined,
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${TOKEN}`);
  }
  return new Request(`http://127.0.0.1:7474${path}`, { ...init, headers });
}

describe("parity publish tryHandle", () => {
  it("returns null for unrelated paths", async () => {
    const handle = createPublishTryHandle(deps());
    const result = await handle(request("/v1/health"), TOKEN, {
      isAgentSwitchInProgress: () => true,
    });
    expect(result).toBeNull();
  });

  it("plans while dirty with warnings and does not 409", async () => {
    const handle = createPublishTryHandle(
      deps({
        getPluginByName: () => plugin({ dirty: true }),
        listAttachedPluginRefs: () => [],
        getPluginResources: () => [],
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST", body: "{}" }),
      TOKEN,
      { isAgentSwitchInProgress: () => true },
    );
    expect(response?.status).toBe(200);
    await expect(response!.json()).resolves.toEqual({
      profile: "focus",
      dirty: true,
      authored: true,
      warnings: [
        {
          code: "empty_profile",
          message:
            "Profile focus has no plugin references and no material resources.",
        },
      ],
      plans: [
        {
          target: { org: "acme", catalog: "internal", account: "default" },
          account: "default",
          nextVersion: "1.2.0",
          ok: true,
        },
      ],
    });
  });

  it("returns auth_required when cloud session is missing", async () => {
    const handle = createPublishTryHandle(
      deps({ resolveAccess: async () => ({ isAuthenticated: false }) }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(401);
    await expect(response!.json()).resolves.toEqual({
      error: "auth_required",
      message: "Sign in to a HarnessTap cloud account to publish",
    });
  });

  it("returns not_authored for catalog plugins", async () => {
    const handle = createPublishTryHandle(
      deps({
        assertAuthored: () => {
          throw new PluginProvenanceError(
            "focus is a catalog plugin and cannot be published directly",
            ["ht plugin fork focus"],
          );
        },
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("not_authored");
  });

  it("returns no_publish_catalogs when none are registered", async () => {
    const handle = createPublishTryHandle(
      deps({
        loadRegisteredCatalogs: () => [],
        resolvePublishTargets: () => [],
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("no_publish_catalogs");
  });

  it("returns 404 when the profile is missing", async () => {
    const handle = createPublishTryHandle(
      deps({ getPluginByName: () => undefined }),
    );
    const response = await handle(
      request("/v1/profiles/missing/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(404);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("warns about unpublished local plugin refs", async () => {
    const handle = createPublishTryHandle(
      deps({
        listAttachedPluginRefs: () => [
          { dependency_name: "local-helper", version_constraint: "1.0.0" },
        ],
        resolvePluginSelector: (selector) =>
          selector.startsWith("local-helper")
            ? plugin({ name: "local-helper", org_slug: "", catalog_slug: "" })
            : undefined,
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      warnings: Array<{ code: string; message: string }>;
    };
    expect(body.warnings).toEqual([
      {
        code: "unpublished_local_refs",
        message:
          "Profile focus references unpublished local plugins: local-helper",
      },
    ]);
  });

  it("returns no_effective_catalogs when registered catalogs do not apply", async () => {
    const handle = createPublishTryHandle(
      deps({
        loadRegisteredCatalogs: () => [
          { org: "acme", catalog: "internal" },
        ],
        resolvePublishTargets: () => [],
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish/plan", { method: "POST" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("no_effective_catalogs");
  });

  it("publish returns 409 dirty_plugins without cutting", async () => {
    const publishPluginToCatalogs = mock(async () => []);
    const handle = createPublishTryHandle(
      deps({
        getPluginByName: () => plugin({ dirty: true }),
        publishPluginToCatalogs,
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish", { method: "POST", body: "{}" }),
      TOKEN,
      { isAgentSwitchInProgress: () => true },
    );
    expect(response?.status).toBe(409);
    const body = (await response!.json()) as {
      error: string;
      dirty_plugins: Array<{ name: string; version: string }>;
    };
    expect(body.error).toBe("dirty_plugins");
    expect(body.dirty_plugins).toEqual([{ name: "focus", version: "1.1.0" }]);
    expect(publishPluginToCatalogs).not.toHaveBeenCalled();
  });

  it("publish returns 200 with mixed results", async () => {
    const handle = createPublishTryHandle(
      deps({
        publishPluginToCatalogs: async () => [
          {
            target: { org: "acme", catalog: "internal", account: "default" },
            ok: true,
            version: "1.1.0",
          },
          {
            target: { org: "acme", catalog: "other", account: "default" },
            ok: false,
            error: "cloud down",
          },
        ],
        resolvePublishTargets: () => [
          { org: "acme", catalog: "internal", account: "default" },
          { org: "acme", catalog: "other", account: "default" },
        ],
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/publish", { method: "POST", body: "{}" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(200);
    await expect(response!.json()).resolves.toEqual({
      profile: "focus",
      version: "1.1.0",
      results: [
        {
          org: "acme",
          catalog: "internal",
          account: "default",
          ok: true,
          version: "1.1.0",
        },
        {
          org: "acme",
          catalog: "other",
          account: "default",
          ok: false,
          error: "cloud down",
        },
      ],
    });
  });

  it("register POST created true then false", async () => {
    let created = true;
    const handle = createPublishTryHandle(
      deps({
        registerPublishCatalog: () => {
          const result = {
            catalog: { org: "acme", catalog: "internal" },
            created,
          };
          created = false;
          return result;
        },
      }),
    );
    const first = await handle(
      request("/v1/catalogs/registered", {
        method: "POST",
        body: JSON.stringify({ selector: "acme/internal" }),
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(first?.status).toBe(200);
    await expect(first!.json()).resolves.toEqual({
      catalog: { org: "acme", catalog: "internal" },
      created: true,
    });
    const second = await handle(
      request("/v1/catalogs/registered", {
        method: "POST",
        body: JSON.stringify({ selector: "acme/internal", account: "work" }),
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(second?.status).toBe(200);
    const secondBody = (await second!.json()) as { created: boolean };
    expect(secondBody.created).toBe(false);
  });

  it("rejects invalid catalog selectors", async () => {
    const handle = createPublishTryHandle(deps());
    const response = await handle(
      request("/v1/catalogs/registered", {
        method: "POST",
        body: JSON.stringify({ selector: "nope" }),
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("invalid_selector");
  });

  it("DELETE encoded selector 404s when missing", async () => {
    const handle = createPublishTryHandle(
      deps({ loadRegisteredCatalogs: () => [] }),
    );
    const response = await handle(
      request("/v1/catalogs/registered/acme%2Finternal", { method: "DELETE" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(404);
  });

  it("DELETE encoded selector removes a registered catalog", async () => {
    const unregisterPublishCatalog = mock(() => undefined);
    const handle = createPublishTryHandle(
      deps({
        loadRegisteredCatalogs: () => [{ org: "acme", catalog: "internal" }],
        unregisterPublishCatalog,
      }),
    );
    const response = await handle(
      request("/v1/catalogs/registered/acme%2Finternal", { method: "DELETE" }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(200);
    await expect(response!.json()).resolves.toEqual({
      removed: { org: "acme", catalog: "internal" },
    });
    expect(unregisterPublishCatalog).toHaveBeenCalled();
  });

  it("GET bindings is all_registered when allow list is empty", async () => {
    const handle = createPublishTryHandle(deps());
    const response = await handle(
      request("/v1/profiles/focus/catalog-bindings"),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as { mode: string; allowList: unknown[] };
    expect(body.mode).toBe("all_registered");
    expect(body.allowList).toEqual([]);
  });

  it("PUT bindings rejects unregistered catalogs", async () => {
    const setPluginPublishTargets = mock(() => undefined);
    const handle = createPublishTryHandle(
      deps({
        loadRegisteredCatalogs: () => [{ org: "acme", catalog: "internal" }],
        setPluginPublishTargets,
      }),
    );
    const response = await handle(
      request("/v1/profiles/focus/catalog-bindings", {
        method: "PUT",
        body: JSON.stringify({
          mode: "explicit",
          allowList: [{ org: "acme", catalog: "nope" }],
        }),
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("unregistered_catalog");
    expect(setPluginPublishTargets).not.toHaveBeenCalled();
  });
});
